import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WINDOW_SLOTS } from "../shared/window.ts";
import { secretsStatus } from "./secrets.ts";

const runCommand = promisify(execFile);

const WINDOW_WORKFLOW = "window-loop.yml";
const RESERVATION_TTL_MS = 2 * 60 * 1000;
const RUN_MATCH_TOLERANCE_MS = 60 * 1000;
const DAEMON_STEP = "Wait for the daemon";

let dispatchTail: Promise<void> = Promise.resolve();

const reservations = new Map<number, SlotReservation>();
const bootedRuns = new Map<number, boolean>();

export interface WindowRun {
  runId: number;
  status: string;
  url: string;
  repo: string;
  slot: number;
  startedAt: string;
}

export interface SlotReservation {
  repo: string;
  dispatchedAt: number;
}

export interface ListedRun {
  databaseId: number;
  status: string;
  url: string;
  displayTitle: string;
  createdAt: string;
}

interface RunStep {
  name: string;
  conclusion: string | null;
}

async function gh(argumentsList: string[]): Promise<string> {
  const { stdout } = await runCommand("gh", argumentsList, { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
export function repoFromRemote(remote: string): string {
  const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote);
  if (!match?.[1]) {
    throw new Error(`${remote} is not a GitHub remote`);
  }
  return match[1];
}

export function windowRunDetails(displayTitle: string): { slot: number; repo: string } | null {
  const match = /^window-([1-5])\s+(.+)$/.exec(displayTitle);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { slot: Number(match[1]), repo: match[2] };
}

function toWindowRun(entry: ListedRun): WindowRun | null {
  const details = windowRunDetails(entry.displayTitle);
  if (!details) {
    return null;
  }
  return {
    runId: entry.databaseId,
    status: entry.status,
    url: entry.url,
    repo: details.repo,
    slot: details.slot,
    startedAt: entry.createdAt,
  };
}

async function listedRuns(repository: string): Promise<ListedRun[]> {
  const output = await gh([
    "run",
    "list",
    "--repo",
    repository,
    "--workflow",
    WINDOW_WORKFLOW,
    "--limit",
    "100",
    "--json",
    "databaseId,status,url,displayTitle,createdAt",
  ]);
  return JSON.parse(output) as ListedRun[];
}

export function reconcileReservations(
  listed: ListedRun[],
  reservedSlots: Map<number, SlotReservation>,
  now: number = Date.now(),
): void {
  const runs = listed.flatMap((entry) => {
    const run = toWindowRun(entry);
    return run ? [run] : [];
  });
  for (const [slot, reservation] of reservedSlots) {
    if (now - reservation.dispatchedAt >= RESERVATION_TTL_MS) {
      reservedSlots.delete(slot);
      continue;
    }
    const visible = runs.some(
      (run) =>
        run.slot === slot &&
        run.repo === reservation.repo &&
        Date.parse(run.startedAt) >= reservation.dispatchedAt - RUN_MATCH_TOLERANCE_MS,
    );
    if (visible) {
      reservedSlots.delete(slot);
    }
  }
}

function activeRunsFromListings(listed: ListedRun[]): WindowRun[] {
  const runs: WindowRun[] = [];
  for (const entry of listed) {
    if (entry.status === "completed") {
      continue;
    }
    const run = toWindowRun(entry);
    if (run) {
      runs.push(run);
    }
  }
  return runs;
}

async function activeRuns(repository: string): Promise<WindowRun[]> {
  const listed = await listedRuns(repository);
  reconcileReservations(listed, reservations);
  return activeRunsFromListings(listed);
}

function preferredRun(runs: readonly WindowRun[], slot: number): WindowRun | undefined {
  return (
    runs.find((run) => run.slot === slot && run.status === "in_progress") ??
    runs.find((run) => run.slot === slot && run.status !== "queued") ??
    runs.find((run) => run.slot === slot)
  );
}

async function stepConclusion(repository: string, runId: number, step: string): Promise<string | null> {
  let output: string;
  try {
    output = await gh(["run", "view", String(runId), "--repo", repository, "--json", "jobs"]);
  } catch {
    return null;
  }
  let parsed: { jobs?: { steps?: RunStep[] }[] };
  try {
    parsed = JSON.parse(output) as { jobs?: { steps?: RunStep[] }[] };
  } catch {
    return null;
  }
  for (const job of parsed.jobs ?? []) {
    for (const candidate of job.steps ?? []) {
      if (candidate.name === step) {
        return candidate.conclusion;
      }
    }
  }
  return null;
}

async function daemonBooted(repository: string, run: WindowRun): Promise<boolean> {
  const cached = bootedRuns.get(run.runId);
  if (cached !== undefined) {
    return cached;
  }
  const booted = (await stepConclusion(repository, run.runId, DAEMON_STEP)) === "success";
  if (booted) {
    bootedRuns.set(run.runId, true);
  }
  return booted;
}

async function bootedStates(
  repository: string,
  runs: readonly WindowRun[],
): Promise<Map<number, boolean>> {
  const answers = await Promise.all(runs.map((run) => daemonBooted(repository, run)));
  const states = new Map<number, boolean>();
  runs.forEach((run, index) => states.set(run.runId, answers[index] ?? false));
  for (const runId of bootedRuns.keys()) {
    if (!runs.some((run) => run.runId === runId)) {
      bootedRuns.delete(runId);
    }
  }
  return states;
}

function ageOf(
  now: number,
  run: WindowRun | undefined,
  reservation: SlotReservation | undefined,
): number | null {
  if (run) {
    return Math.max(0, Math.floor((now - Date.parse(run.startedAt)) / 1000));
  }
  if (reservation) {
    return Math.max(0, Math.floor((now - reservation.dispatchedAt) / 1000));
  }
  return null;
}

export function slotStates(
  runs: readonly WindowRun[],
  reservedSlots: ReadonlyMap<number, SlotReservation>,
  booted: ReadonlyMap<number, boolean> = new Map(),
  now: number = Date.now(),
) {
  return WINDOW_SLOTS.map((slot) => {
    const run = preferredRun(runs, slot);
    const reservation = reservedSlots.get(slot);
    const ageSeconds = ageOf(now, run, reservation);
    return {
      slot,
      status: run?.status ?? (reservation ? "dispatching" : "free"),
      repo: run?.repo ?? reservation?.repo ?? "",
      runId: run?.runId ?? null,
      url: run?.url ?? null,
      startedAt: run?.startedAt ?? null,
      ageSeconds,
      booted: run ? (booted.get(run.runId) ?? false) : null,
    };
  });
}

export function chooseSlot(
  runs: readonly WindowRun[],
  reservedSlots: ReadonlyMap<number, SlotReservation> = new Map<number, SlotReservation>(),
): number {
  const states = slotStates(runs, reservedSlots);
  const free = states.find((state) => state.status === "free");
  if (free) {
    return free.slot;
  }
  const busy = states
    .map((state) => {
      const marker = state.status === "dispatching" ? " (starting)" : "";
      return `Window ${state.slot} — ${state.repo || "unknown repository"}${marker}`;
    })
    .join(", ");
  throw new Error(`all five window slots are busy: ${busy}`);
}

async function repositoryOf(directory: string): Promise<string> {
  const { stdout } = await runCommand("git", [
    "-C",
    directory,
    "config",
    "--get",
    "remote.origin.url",
  ]);
  return repoFromRemote(stdout.trim());
}

async function repositoryDefaultBranch(repository: string): Promise<string> {
  return gh([
    "repo",
    "view",
    repository,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
}

async function targetDefaultBranch(directory: string, repo: string): Promise<string> {
  try {
    const { stdout } = await runCommand("git", [
      "-C",
      directory,
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    return stdout.trim().replace(/^origin\//, "");
  } catch {
    return repositoryDefaultBranch(repo);
  }
}

async function serializeDispatch<T>(operation: () => Promise<T>): Promise<T> {
  const previousDispatch = dispatchTail;
  let releaseDispatch = () => {};
  dispatchTail = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  await previousDispatch;
  try {
    return await operation();
  } finally {
    releaseDispatch();
  }
}

export async function windowStatus(directory: string, repository: string) {
  const repo = await repositoryOf(directory);
  const listed = repository === "" ? [] : await listedRuns(repository);
  reconcileReservations(listed, reservations);
  const runs = activeRunsFromListings(listed);
  const booted = await bootedStates(repository, runs);
  return {
    repo,
    defaultBranch: await targetDefaultBranch(directory, repo),
    runs,
    slots: slotStates(runs, reservations, booted),
    secrets: secretsStatus(),
  };
}

export async function startWindow(directory: string, repository: string) {
  return serializeDispatch(async () => {
    if (repository === "") {
      throw new Error("set the offload repository in the plugin settings");
    }
    const repo = await repositoryOf(directory);
    const workflowRef = await repositoryDefaultBranch(repository);
    const listed = await listedRuns(repository);
    reconcileReservations(listed, reservations);
    const runs = activeRunsFromListings(listed);
    const slot = chooseSlot(runs, reservations);
    reservations.set(slot, { repo, dispatchedAt: Date.now() });
    try {
      await gh([
        "workflow",
        "run",
        WINDOW_WORKFLOW,
        "--repo",
        repository,
        "--ref",
        workflowRef,
        "-f",
        `target_repo=${repo}`,
        "-f",
        `slot=${slot}`,
      ]);
    } catch (error) {
      reservations.delete(slot);
      throw error;
    }
    return {
      branch: `feature/window-${slot}`,
      slot,
      hostEntry: `Window-${slot}`,
    };
  });
}

async function cancelRuns(
  repository: string,
  matches: (run: WindowRun) => boolean,
): Promise<number[]> {
  const running = (await activeRuns(repository)).filter(matches);
  const answers = await Promise.allSettled(
    running.map((entry) => gh(["run", "cancel", String(entry.runId), "--repo", repository])),
  );
  return running.flatMap((entry, index) =>
    answers[index]?.status === "fulfilled" ? [entry.runId] : [],
  );
}

export async function stopWindows(repository: string) {
  if (repository === "") {
    return { cancelled: [] };
  }
  return { cancelled: await cancelRuns(repository, () => true) };
}

export async function stopSlot(repository: string, slot: number) {
  if (repository === "") {
    throw new Error("set the offload repository in the plugin settings");
  }
  return { cancelled: await cancelRuns(repository, (run) => run.slot === slot) };
}
