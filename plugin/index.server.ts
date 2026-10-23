import type { PluginServerContext } from "@getpaseo/plugin/server";
import { startWindow, stopWindows, windowStatus } from "./server/window";
import { windowStartRpc, windowStatusRpc, windowStopRpc } from "./shared/window";

export default function contribute(server: PluginServerContext): () => void {
  server.handle(windowStatusRpc, ({ directory }) => windowStatus(directory));
  server.handle(windowStartRpc, ({ directory }) => startWindow(directory));
  server.handle(windowStopRpc, () => stopWindows());

  return () => {};
}
