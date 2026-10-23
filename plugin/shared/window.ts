import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const windowRun = z.object({
  runId: z.number(),
  status: z.string(),
  url: z.string(),
  repo: z.string(),
  startedAt: z.string(),
});

export const windowStatusRpc = defineRpc({
  name: "window.status",
  input: z.object({ directory: z.string() }),
  output: z.object({
    repo: z.string(),
    branch: z.string(),
    runs: z.array(windowRun),
  }),
});

export const windowStartRpc = defineRpc({
  name: "window.start",
  input: z.object({ directory: z.string() }),
  output: z.object({ branch: z.string() }),
});

export const windowStopRpc = defineRpc({
  name: "window.stop",
  input: z.object({}),
  output: z.object({ cancelled: z.array(z.number()) }),
});
