import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  WINDOW_SLOTS,
  windowStartRpc,
  windowStatusRpc,
  windowStopRpc,
} from "../shared/window";
import { offloadSettings } from "../shared/settings";

function readableStatus(status: string): string {
  if (status === "in_progress") {
    return "Running";
  }
  if (status === "dispatching") {
    return "Starting";
  }
  if (status === "not_paired") {
    return "Not paired";
  }
  if (status === "local") {
    return "Local";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function WindowPanel({ theme, layout, workspaceId, host }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory) ?? "";
  const settings = useSettings(offloadSettings);
  const callStatus = useRpc(windowStatusRpc);
  const callStart = useRpc(windowStartRpc);
  const callStop = useRpc(windowStopRpc);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["offload-window", workspaceId],
    queryFn: () => callStatus({ directory }),
    enabled: directory !== "",
    refetchInterval: 15000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["offload-window", workspaceId] });
  const start = useMutation({ mutationFn: () => callStart({ directory }), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => callStop({}), onSettled: refresh });

  const runs = status.data?.runs ?? [];
  const slots = status.data?.slots ?? [];
  const repo = status.data?.repo ?? "";
  const defaultBranch = status.data?.defaultBranch;
  const pending = start.isPending || stop.isPending;
  const configured = settings.status === "ready" && settings.values.repository !== "";
  const canStart = !pending && configured;
  const canStop = !pending && runs.length > 0;
  const failure = status.error ?? start.error ?? stop.error;

  const hostEntries = useMemo(() => {
    const slotStates = new Map(slots.map((entry) => [entry.slot, entry]));
    return [
      {
        serverId: host.id,
        name: host.label,
        detail: `Local daemon · ${host.id}`,
        status: "local",
        runUrl: "",
      },
      ...WINDOW_SLOTS.map((slot) => {
        const serverId = `Window-${slot}`;
        const slotState = slotStates.get(slot);
        const occupied = slotState !== undefined && slotState.status !== "free";
        return {
          serverId,
          name: `Window ${slot}`,
          detail: occupied
            ? `${slotState.repo} · since ${slotState.startedAt ?? "dispatch"}`
            : `${serverId} · no active window`,
          status: occupied ? slotState.status : "free",
          runUrl: slotState?.url ?? "",
        };
      }),
    ];
  }, [host.id, host.label, slots]);

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
      hostStatus: { color: theme.colors.foregroundMuted },
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
      dangerButtonText: { color: theme.colors.foreground, textAlign: "center" as const },
      error: { color: theme.colors.statusDanger },
      success: { color: theme.colors.statusSuccess },
    }),
    [theme, layout.compact],
  );

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
        {hostEntries.map((entry) => (
          <View key={entry.serverId} style={styles.hostRow}>
            <View style={styles.hostCopy}>
              <Text style={styles.hostName}>{entry.name}</Text>
              <Text style={styles.detail}>{entry.detail}</Text>
              {entry.runUrl ? <ExternalLink href={entry.runUrl}>Open Actions run</ExternalLink> : null}
            </View>
            <Text style={styles.hostStatus}>{readableStatus(entry.status)}</Text>
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
            Dispatched to Window {start.data.slot}. Open the {start.data.hostEntry} host entry when it
            appears.
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
        {failure ? <Text style={styles.error}>{failure.message}</Text> : null}
      </ScrollView>
    </View>
  );
}
