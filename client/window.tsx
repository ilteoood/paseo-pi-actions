import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  getPaseoClient,
  useHosts,
  usePaseo,
  useRpc,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { ExternalLink, ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  windowHostRegistration,
  windowPairingRpc,
  windowSlotStopRpc,
  windowStartRpc,
  windowStatusRpc,
  windowStopRpc,
} from "../shared/window";
import { type RowAction, windowRows } from "./windowRows";
import { offloadSettings } from "../shared/settings";

export function WindowPanel({ theme, layout, workspaceId, host, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory) ?? "";
  const settings = useSettings(offloadSettings);
  const hosts = useHosts();
  const paseo = usePaseo();
  const callStatus = useRpc(windowStatusRpc);
  const callStart = useRpc(windowStartRpc);
  const callStop = useRpc(windowStopRpc);
  const callSlotStop = useRpc(windowSlotStopRpc);
  const callPairing = useRpc(windowPairingRpc);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const status = useQuery({
    queryKey: ["offload-window", workspaceId],
    queryFn: () => callStatus({ directory }),
    enabled: directory !== "",
    refetchInterval: 15000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["offload-window", workspaceId] });
  const start = useMutation({ mutationFn: () => callStart({ directory }), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => callStop({}), onSettled: refresh });
  const turnDown = useMutation({
    mutationFn: (slot: number) => callSlotStop({ slot }),
    onSettled: refresh,
  });
  const pair = useMutation({
    mutationFn: async (slot: number) => {
      const { relayUri } = await callPairing({ slot });
      return paseo.hosts.add(windowHostRegistration(slot, relayUri));
    },
    onSuccess: (_host, slot) =>
      setNotice({
        tone: "success",
        text: `Added Window ${slot} as a host — Paseo connects to it as soon as the window is up.`,
      }),
  });

  const switchToWindow = async (slot: number, repo: string) => {
    try {
      const client = getPaseoClient(`Window-${slot}`);
      const { entries } = await client.workspaces.list();
      const workspace = entries.find((entry) => entry.projectRootPath.endsWith(`/${repo}`));
      if (!workspace) {
        setNotice({
          tone: "error",
          text: `Window ${slot} has no workspace yet — it was started before this change.`,
        });
        return;
      }
      navigation?.openWorkspace({ workspaceId: workspace.id, serverId: `Window-${slot}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  const runs = status.data?.runs ?? [];
  const repo = status.data?.repo ?? "";
  const defaultBranch = status.data?.defaultBranch;
  const secrets = status.data?.secrets;
  const materialImported = (secrets?.slots ?? 0) > 0;
  const pending = start.isPending || stop.isPending || turnDown.isPending || pair.isPending;
  const configured = settings.status === "ready" && settings.values.repository !== "";
  const canStart = !pending && configured;
  const canStop = !pending && runs.length > 0;
  const failure = status.error ?? start.error ?? stop.error ?? turnDown.error ?? pair.error;

  const rows = windowRows({
    slots: status.data?.slots ?? [],
    hosts,
    localHost: { id: host.id, label: host.label },
    materialImported,
    canSwitch: navigation !== undefined,
  });
  const slotsByServerId = new Map((status.data?.slots ?? []).map((slot) => [`Window-${slot.slot}`, slot]));

  const runAction = (serverId: string, action: RowAction) => {
    const slot = slotsByServerId.get(serverId);
    if (!slot) {
      return;
    }
    if (action.kind === "turn-down") {
      turnDown.mutate(slot.slot);
    } else if (action.kind === "pair") {
      pair.mutate(slot.slot);
    } else {
      void switchToWindow(slot.slot, slot.repo);
    }
  };

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      content: { gap: layout.compact ? 12 : 16 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24 },
      heading: { color: theme.colors.foreground, fontSize: layout.compact ? 16 : 18 },
      detail: { color: theme.colors.foregroundMuted },
      hostRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      },
      hostCopy: { flex: 1, gap: 4 },
      hostName: { color: theme.colors.foreground, fontWeight: "600" as const },
      hostState: { color: theme.colors.foregroundMuted },
      hostActions: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        marginTop: 4,
      },
      rowButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      rowButtonText: { color: theme.colors.foreground, textAlign: "center" as const },
      rowDanger: { borderColor: theme.colors.statusDanger },
      rowDangerText: { color: theme.colors.statusDanger },
      button: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.accent },
      buttonDisabled: { opacity: 0.5 },
      buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
      dangerButton: {
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      dangerButtonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
      error: { color: theme.colors.statusDanger },
      success: { color: theme.colors.statusSuccess },
    }),
    [theme, layout.compact],
  );

  const noticeStyle = notice?.tone === "error" ? styles.error : styles.success;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{repo === "" ? "Reading the workspace" : repo}</Text>
        {defaultBranch ? (
          <Text style={styles.detail}>
            The window starts from {defaultBranch} and works on a feature/window-slot branch.
          </Text>
        ) : null}
        {settings.status === "ready" && !configured ? (
          <Text style={styles.detail}>
            Set the offload repository in Settings → Plugins → Offload window.
          </Text>
        ) : null}
        <Text style={styles.heading}>Hosts</Text>
        <Text style={styles.detail}>One local daemon and five window slots.</Text>
        {secrets && secrets.slots === 0 ? (
          <Text style={styles.detail}>
            The window identities are not imported — paste them in Settings → Plugins → Offload window.
          </Text>
        ) : null}
        {rows.map((row) => (
          <View key={row.serverId} style={styles.hostRow}>
            <View style={styles.hostCopy}>
              <Text style={styles.hostName}>{row.name}</Text>
              <Text style={styles.detail}>{row.detail}</Text>
              {row.runUrl ? <ExternalLink href={row.runUrl}>Open the window job</ExternalLink> : null}
              {row.actions.length > 0 ? (
                <View style={styles.hostActions}>
                  {row.actions.map((action) => (
                    <Pressable
                      key={action.kind}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      accessibilityState={{ disabled: action.disabled }}
                      disabled={action.disabled}
                      onPress={() => runAction(row.serverId, action)}
                      style={[
                        styles.rowButton,
                        action.disabled && styles.buttonDisabled,
                        action.danger && styles.rowDanger,
                      ]}
                    >
                      <Text style={[styles.rowButtonText, action.danger && styles.rowDangerText]}>
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={styles.hostState}>
              {row.hostStatus === null ? row.runStatus : `${row.runStatus} · ${row.hostStatus}`}
            </Text>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open a window for ${repo}`}
          accessibilityState={{ disabled: !canStart }}
          disabled={!canStart}
          onPress={() => start.mutate()}
          style={[styles.button, !canStart && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>
            {start.isPending ? "Dispatching…" : "Open a window for this repo"}
          </Text>
        </Pressable>
        {start.data ? (
          <Text style={styles.success}>
            Dispatched to Window {start.data.slot}. Use Pair Window {start.data.slot} once it boots.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tear down the offload windows"
          accessibilityState={{ disabled: !canStop }}
          disabled={!canStop}
          onPress={() => stop.mutate()}
          style={[styles.dangerButton, !canStop && styles.buttonDisabled]}
        >
          <Text style={styles.dangerButtonText}>
            {stop.isPending ? "Tearing down…" : "Tear down all windows"}
          </Text>
        </Pressable>
        {notice ? <Text style={noticeStyle}>{notice.text}</Text> : null}
        {failure ? <Text style={styles.error}>{failure.message}</Text> : null}
      </ScrollView>
    </View>
  );
}
