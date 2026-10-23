import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OffloadSettings } from "./client/settings";
import { WindowPanel } from "./client/window";

export default function contribute(client: PluginClientContext): () => void {
  client.addWorkspacePanel({
    id: "offload-window",
    title: "Offload window",
    icon: "PackageOpen",
    context: "workspace",
    Component: WindowPanel,
  });

  client.addSettingsScreen({
    id: "offload",
    title: "Offload window",
    icon: "PackageOpen",
    Component: OffloadSettings,
  });

  client.addCommandCenterItem({
    id: "open-offload-window",
    title: "Offload a window for this repo",
    icon: "PackageOpen",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("offload-window");
    },
  });

  return () => {};
}
