import type { PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import { startWindow, stopSlot, stopWindows, windowStatus } from "./server/window";
import { importMaterial, pairingString } from "./server/secrets";
import { offloadSettings } from "./shared/settings";
import {
  windowPairingRpc,
  windowSecretsImportRpc,
  windowSlotStopRpc,
  windowStartRpc,
  windowStatusRpc,
  windowStopRpc,
} from "./shared/window";

type OffloadSettings = PluginSettings<typeof offloadSettings.schema>;

async function configuredRepository(settings: OffloadSettings): Promise<string> {
  const state = await settings.read();
  return state.status === "ready" ? state.values.repository : "";
}

export default function contribute(server: PluginServerContext): () => void {
  const settings = server.registerSettings(offloadSettings);
  server.handle(windowStatusRpc, async ({ directory }) =>
    windowStatus(directory, await configuredRepository(settings)),
  );
  server.handle(windowStartRpc, async ({ directory }) =>
    startWindow(directory, await configuredRepository(settings)),
  );
  server.handle(windowStopRpc, async () => stopWindows(await configuredRepository(settings)));
  server.handle(windowSlotStopRpc, async ({ slot }) =>
    stopSlot(await configuredRepository(settings), slot),
  );
  server.handle(windowPairingRpc, async ({ slot }) => ({ relayUri: pairingString(slot) }));
  server.handle(windowSecretsImportRpc, async ({ material }) => importMaterial(material));

  return () => {};
}
