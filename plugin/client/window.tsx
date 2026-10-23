import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { windowStartRpc, windowStatusRpc, windowStopRpc } from "../shared/window";

export function WindowPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory) ?? "";
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

  const statusRevision = status.dataUpdatedAt;
  useEffect(() => {
    start.reset();
    stop.reset();
  }, [statusRevision]);
  const runs = status.data?.runs ?? [];
  const repo = status.data?.repo ?? "";
  const branch = status.data?.branch;
  const pending = start.isPending || stop.isPending;
  const canStart = !pending && runs.length === 0;
  const canStop = !pending && runs.length > 0;
  const failure = status.error ?? start.error ?? stop.error;

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      content: { gap: layout.compact ? 12 : 16 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24 },
      detail: { color: theme.colors.foregroundMuted },
      run: { color: theme.colors.foreground },
      button: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.accent },
      buttonDisabled: { opacity: 0.5 },
      buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
      dangerButton: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
      dangerButtonText: { color: theme.colors.foreground, textAlign: "center" as const },
      error: { color: theme.colors.statusDanger },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{repo === "" ? "Reading the workspace" : repo}</Text>
        {branch ? (
          <Text style={styles.detail}>The harness starts the agent on {branch} and pushes after every commit.</Text>
        ) : null}
        {runs.length === 0 ? (
          <Text style={styles.detail}>No window is open.</Text>
        ) : (
          runs.map((entry) => (
            <View key={entry.runId}>
              <Text style={styles.run}>
                {entry.status} since {entry.startedAt}
              </Text>
              <ExternalLink href={entry.url}>{entry.url}</ExternalLink>
            </View>
          ))
        )}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tear down the offload window"
          accessibilityState={{ disabled: !canStop }}
          disabled={!canStop}
          onPress={() => stop.mutate()}
          style={[styles.dangerButton, !canStop && styles.buttonDisabled]}
        >
          <Text style={styles.dangerButtonText}>
            {stop.isPending ? "Tearing down…" : "Tear down the window"}
          </Text>
        </Pressable>
        {failure ? <Text style={styles.error}>{failure.message}</Text> : null}
      </ScrollView>
    </View>
  );
}
