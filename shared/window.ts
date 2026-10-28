import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const WINDOW_SLOTS = [1, 2, 3, 4, 5] as const;

const windowSlot = z.number().int().min(WINDOW_SLOTS[0]).max(WINDOW_SLOTS[WINDOW_SLOTS.length - 1]);

const relayHostPattern = /^relay:\/\/[^/?]+\/([^?/]+)\??/;

export function relayHostName(relayUri: string): string | null {
  return relayHostPattern.exec(relayUri)?.[1] ?? null;
}

export function windowHostRegistration(slot: number, relayUri: string) {
  return {
    connection: relayUri,
    label: `Window-${slot}`,
    sourceKey: `offload-window-${slot}`,
  };
}

export const windowMaterial = z
  .object({
    slot: windowSlot,
    serverId: z.string().min(1),
    relayUri: z.string().regex(relayHostPattern, "must be a relay:// URI"),
    offerUrl: z.string().startsWith("https://"),
    password: z.string().min(1),
  })
  .superRefine((entry, context) => {
    const hostName = `Window-${entry.slot}`;
    if (entry.serverId !== hostName) {
      context.addIssue({
        code: "custom",
        path: ["serverId"],
        message: `must be ${hostName}`,
      });
    }
    if (relayHostName(entry.relayUri) !== hostName) {
      context.addIssue({
        code: "custom",
        path: ["relayUri"],
        message: `must name ${hostName}`,
      });
    }
  });

export const windowMaterialList = z.array(windowMaterial).superRefine((entries, context) => {
  for (const slot of WINDOW_SLOTS) {
    if (entries.filter((entry) => entry.slot === slot).length !== 1) {
      context.addIssue({
        code: "custom",
        path: [],
        message: `must hold slot ${slot} exactly once`,
      });
    }
  }
  if (entries.length !== WINDOW_SLOTS.length) {
    context.addIssue({
      code: "custom",
      path: [],
      message: `must hold one entry for each of the ${WINDOW_SLOTS.length} slots`,
    });
  }
});

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
  ageSeconds: z.number().nullable(),
  booted: z.boolean().nullable(),
});

const windowSecretsStatus = z.object({
  slots: z.number(),
  importedAt: z.string().nullable(),
});

export const windowStatusRpc = defineRpc({
  name: "window.status",
  input: z.object({ directory: z.string() }),
  output: z.object({
    repo: z.string(),
    defaultBranch: z.string(),
    runs: z.array(windowRun),
    slots: z.array(windowSlotState),
    secrets: windowSecretsStatus,
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

export const windowSlotStopRpc = defineRpc({
  name: "window.slot.stop",
  input: z.object({ slot: windowSlot }),
  output: z.object({ cancelled: z.array(z.number()) }),
});

export const windowPairingRpc = defineRpc({
  name: "window.pairing",
  input: z.object({ slot: windowSlot }),
  output: z.object({ relayUri: z.string() }),
});

export const windowSecretsImportRpc = defineRpc({
  name: "window.secrets.import",
  input: z.object({ material: z.string() }),
  output: windowSecretsStatus,
});
