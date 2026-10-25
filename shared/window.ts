import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const WINDOW_SLOTS = [1, 2, 3, 4, 5] as const;

const windowSlot = z.number().int().min(1).max(5);

const windowRun = z.object({
  runId: z.number(),
  status: z.string(),
  url: z.string(),
  repo: z.string(),
  slot: windowSlot,
  startedAt: z.string(),
});

const windowSlotState = z.object({
  slot: windowSlot,
  status: z.string(),
  repo: z.string(),
  runId: z.number().nullable(),
  url: z.string().nullable(),
  startedAt: z.string().nullable(),
});

export const windowStatusRpc = defineRpc({
  name: "window.status",
  input: z.object({ directory: z.string() }),
  output: z.object({
    repo: z.string(),
    defaultBranch: z.string(),
    runs: z.array(windowRun),
    slots: z.array(windowSlotState),
  }),
});

export const windowStartRpc = defineRpc({
  name: "window.start",
  input: z.object({ directory: z.string() }),
  output: z.object({
    branch: z.string(),
    slot: windowSlot,
    hostEntry: z.string(),
  }),
});

export const windowStopRpc = defineRpc({
  name: "window.stop",
  input: z.object({}),
  output: z.object({ cancelled: z.array(z.number()) }),
});
