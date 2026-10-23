import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const offloadSettings = defineSettings({
  id: "offload",
  scope: "host",
  version: 1,
  schema: z.object({
    repository: z
      .string()
      .trim()
      .regex(/^([^/\s]+\/[^/\s]+)?$/, "Enter an owner/repo")
      .default(""),
  }),
});
