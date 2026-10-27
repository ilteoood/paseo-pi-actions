import {
  type PluginSurfaceProps,
  type SettingsState,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { offloadSettings } from "../shared/settings";
import { windowSecretsImportRpc } from "../shared/window";

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
function WindowIdentities() {
  const toast = useToast();
  const callImport = useRpc(windowSecretsImportRpc);
  const [material, setMaterial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importIdentities = useCallback(async () => {
    setBusy(true);
    try {
      const status = await callImport({ material });
      setMaterial("");
      setError(null);
      toast.show(`Imported the window identities for ${status.slots} windows.`, { variant: "success" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [callImport, material, toast]);

  return (
    <SettingsCard>
      <SettingsInput
        label="Window identities"
        hint="the .secrets.json printed by scripts/window-identities.sh"
        placeholder="[{ … }]"
        initialValue={material}
        onChangeText={setMaterial}
        disabled={busy}
        secureTextEntry
        error={error}
      />
      <SettingsAction
        label="Import the window identities"
        actionLabel={busy ? "Importing…" : "Import"}
        disabled={busy || material.trim() === ""}
        onPress={importIdentities}
      />
    </SettingsCard>
  );
}

function RepositorySection({ theme }: Pick<PluginSurfaceProps, "theme">) {
  const settings = useSettings(offloadSettings);
  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => {
    setEditing(false);
    void settings.reload();
  }, [settings]);
  const toggleEditor = useCallback(() => setEditing((value) => !value), []);

  if (settings.status === "loading") {
    return (
      <SettingsSection title="Offload">
        <Text style={style}>Loading settings…</Text>
      </SettingsSection>
    );
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

export function OffloadSettings({ theme }: PluginSurfaceProps) {
  return (
    <>
      <RepositorySection theme={theme} />
      <SettingsSection
        title="Window identities"
        info="The pairing material the panel hands to a client that pairs with a window."
      >
        <WindowIdentities />
      </SettingsSection>
    </>
  );
}
