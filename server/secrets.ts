import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type z } from "zod";
import { windowMaterial, windowMaterialList } from "../shared/window.ts";

const PLUGIN_ID = "paseo-offload";

export type WindowMaterial = z.infer<typeof windowMaterial>;

export interface SecretsStatus {
  slots: number;
  importedAt: string | null;
}

interface PersistedMaterial {
  importedAt: string;
  entries: WindowMaterial[];
}

function materialPath(): string {
  return join(homedir(), ".paseo", "plugin-settings", PLUGIN_ID, "offload-secrets.json");
}

function firstIssue(parsed: z.ZodError): Error {
  const issue = parsed.issues[0];
  const path = [String(issue?.path[0] ?? ""), ...(issue?.path.slice(1) ?? [])]
    .filter((segment) => segment !== "")
    .join(".");
  return new Error(`the window identities are malformed: slots[${path}] ${issue?.message ?? ""}`);
}

export function parseMaterial(paste: string): WindowMaterial[] {
  let value: unknown;
  try {
    value = JSON.parse(paste);
  } catch {
    throw new Error("the pasted window identities are not JSON");
  }
  const parsed = windowMaterialList.safeParse(value);
  if (!parsed.success) {
    throw firstIssue(parsed.error);
  }
  return parsed.data;
}

function readPersisted(): PersistedMaterial | null {
  let raw: string;
  try {
    raw = readFileSync(materialPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedMaterial>;
    const entries = windowMaterialList.parse(parsed.entries);
    return { importedAt: parsed.importedAt ?? "", entries };
  } catch {
    return null;
  }
}

export function secretsStatus(): SecretsStatus {
  const persisted = readPersisted();
  if (!persisted) {
    return { slots: 0, importedAt: null };
  }
  return { slots: persisted.entries.length, importedAt: persisted.importedAt || null };
}

export function importMaterial(paste: string): SecretsStatus {
  const entries = parseMaterial(paste);
  const importedAt = new Date().toISOString();
  const path = materialPath();
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, `${JSON.stringify({ importedAt, entries }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  return { slots: entries.length, importedAt };
}

function uriWithPassword(relayUri: string, password: string): string {
  try {
    const uri = new URL(relayUri);
    uri.searchParams.set("password", password);
    return uri.toString();
  } catch {
    throw new Error("the stored relay URI is not a URL");
  }
}

export function pairingString(slot: number): string {
  const entry = readPersisted()?.entries.find((candidate) => candidate.slot === slot);
  if (!entry) {
    throw new Error("the window identities are not imported");
  }
  return uriWithPassword(entry.relayUri, entry.password);
}
