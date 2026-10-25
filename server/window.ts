import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WINDOW_SLOTS } from "../shared/window.ts";

const runCommand = promisify(execFile);

const WINDOW_WORKFLOW = "window-loop.yml";

let dispatchTail: Promise<void> = Promise.resolve();

const reservations = new Map<number, SlotReservation>();

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

interface ListedRun {
  databaseId: number;
  status: string;
  url: string;
  displayTitle: string;
  createdAt: string;
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

function reconcileReservations(listed: ListedRun[]): void {
  const runs = listed.flatMap((entry) => {
    const run = toWindowRun(entry);
    return run ? [run] : [];
  });
  for (const [slot, reservation] of reservations) {
    const visible = runs.some(
      (run) =>
        run.slot === slot &&
        run.repo === reservation.repo &&
        Date.parse(run.startedAt) >= reservation.dispatchedAt - 5000,
    );
    if (visible) {
      reservations.delete(slot);
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
  reconcileReservations(listed);
  return activeRunsFromListings(listed);
}

function preferredRun(runs: readonly WindowRun[], slot: number): WindowRun | undefined {
  return (
    runs.find((run) => run.slot === slot && run.status === "in_progress") ??
    runs.find((run) => run.slot === slot && run.status !== "queued") ??
    runs.find((run) => run.slot === slot)
  );
}

function slotStates(
  runs: readonly WindowRun[],
  reservedSlots: ReadonlyMap<number, SlotReservation>,
) {
  return WINDOW_SLOTS.map((slot) => {
    const run = preferredRun(runs, slot);
    const reservation = reservedSlots.get(slot);
    return {
      slot,
      status: run?.status ?? (reservation ? "dispatching" : "free"),
      repo: run?.repo ?? reservation?.repo ?? "",
      runId: run?.runId ?? null,
      url: run?.url ?? null,
      startedAt: run?.startedAt ?? null,
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
    .map((state) => `Window ${state.slot} — ${state.repo || "unknown repository"}`)
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
  reconcileReservations(listed);
  const runs = activeRunsFromListings(listed);
  return {
    repo,
    defaultBranch: await targetDefaultBranch(directory, repo),
    runs,
    slots: slotStates(runs, reservations),
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
    reconcileReservations(listed);
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

export async function stopWindows(repository: string) {
  if (repository === "") {
    return { cancelled: [] };
  }
  const running = await activeRuns(repository);
  await Promise.allSettled(
    running.map((entry) => gh(["run", "cancel", String(entry.runId), "--repo", repository])),
  );
  return { cancelled: running.map((entry) => entry.runId) };
}
