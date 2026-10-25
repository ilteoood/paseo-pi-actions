import {
  type PluginSurfaceProps,
  type SettingsState,
  useSettings,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { offloadSettings } from "../shared/settings";

type ReadySettings = Extract<SettingsState<typeof offloadSettings.schema>, { status: "ready" }>;

function RepositoryEditor({ settings, onClose }: { settings: ReadySettings; onClose(): void }) {
  const [draft, setDraft] = useState(() => ({
    values: settings.values,
    revision: settings.revision,
  }));
  const changeRepository = useCallback(
    (repository: string) =>
      setDraft((current) => ({ ...current, values: { ...current.values, repository } })),
    [],
  );
  const saveRepository = useCallback(async () => {
    if (await settings.save(draft.values, draft.revision)) onClose();
  }, [settings, draft, onClose]);
  return (
    <SettingsCard>
      <SettingsInput
        label="Offload repository"
        hint="owner/repo that holds window-loop.yml"
        placeholder="owner/repo"
        initialValue={draft.values.repository}
        onChangeText={changeRepository}
        disabled={settings.saving}
        error={settings.saveError}
      />
      <SettingsAction
        label="Save the offload repository"
        actionLabel="Save"
        disabled={settings.saving}
        onPress={saveRepository}
      />
      <SettingsAction
        label="Discard changes"
        actionLabel="Discard"
        disabled={settings.saving}
        onPress={onClose}
      />
    </SettingsCard>
  );
}

export function OffloadSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(offloadSettings);
  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => {
    setEditing(false);
    void settings.reload();
  }, [settings]);
  const toggleEditor = useCallback(() => setEditing((value) => !value), []);

  if (settings.status === "loading") {
    return <Text style={style}>Loading settings…</Text>;
  }
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Offload">
        <Text accessibilityRole="alert" style={style}>
          {settings.error}
        </Text>
        <SettingsAction
          label="Read the settings again"
          actionLabel="Reload"
          onPress={settings.reload}
        />
        {settings.status === "invalid" ? (
          <SettingsAction
            label="Restore the default settings"
            actionLabel="Reset"
            onPress={settings.reset}
          />
        ) : null}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Offload" info="The repository that holds the window workflow.">
      <SettingsCard>
        <SettingsAction
          label="Offload repository"
          hint={settings.values.repository || "Not set"}
          actionLabel={editing ? "Close editor" : "Edit"}
          disabled={settings.saving}
          onPress={toggleEditor}
        />
      </SettingsCard>
      {editing ? <RepositoryEditor settings={settings} onClose={closeEditor} /> : null}
      {settings.saveError && !editing ? (
        <Text accessibilityRole="alert" style={style}>
          {settings.saveError}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
