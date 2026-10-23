import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const runCommand = promisify(execFile);

const OFFLOAD_REPOSITORY = "ilteoood/paseo-pi-actions";
const OFFLOAD_REF = "main";
const WINDOW_WORKFLOW = "window-loop.yml";
const WINDOW_BRANCH = "feature/window-1";
const STOP_SETTLE_ATTEMPTS = 15;
const STOP_SETTLE_DELAY_MS = 1000;

let dispatching = false;

interface WindowRun {
  runId: number;
  status: string;
  url: string;
  repo: string;
  startedAt: string;
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

function repoFromDisplayTitle(displayTitle: string): string {
  return displayTitle.split(" ").at(-1) ?? "";
}

async function listedRuns(): Promise<ListedRun[]> {
  const output = await gh([
    "run",
    "list",
    "--repo",
    OFFLOAD_REPOSITORY,
    "--workflow",
    WINDOW_WORKFLOW,
    "--limit",
    "20",
    "--json",
    "databaseId,status,url,displayTitle,createdAt",
  ]);
  return JSON.parse(output) as ListedRun[];
}

function toWindowRun(entry: ListedRun): WindowRun {
  return {
    runId: entry.databaseId,
    status: entry.status,
    url: entry.url,
    repo: repoFromDisplayTitle(entry.displayTitle),
    startedAt: entry.createdAt,
  };
}

async function activeRuns(): Promise<WindowRun[]> {
  const listed = await listedRuns();
  return listed.filter((entry) => entry.status !== "completed").map(toWindowRun);
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

export async function windowStatus(directory: string) {
  return {
    repo: await repositoryOf(directory),
    branch: WINDOW_BRANCH,
    runs: await activeRuns(),
  };
}

export async function startWindow(directory: string) {
  if (dispatching) {
    throw new Error("a dispatch is already in flight");
  }
  const repo = await repositoryOf(directory);
  const running = await activeRuns();
  const occupying = running[0];
  if (occupying) {
    throw new Error(
      `a window is already open for ${occupying.repo} at ${occupying.url}; tear it down first`,
    );
  }
  dispatching = true;
  try {
    await gh([
      "workflow",
      "run",
      WINDOW_WORKFLOW,
      "--repo",
      OFFLOAD_REPOSITORY,
      "--ref",
      OFFLOAD_REF,
      "-f",
      `target_repo=${repo}`,
    ]);
  } finally {
    dispatching = false;
  }
  return { branch: WINDOW_BRANCH };
}

export async function stopWindows() {
  const running = await activeRuns();
  await Promise.allSettled(
    running.map((entry) =>
      gh(["run", "cancel", String(entry.runId), "--repo", OFFLOAD_REPOSITORY]),
    ),
  );
  for (let attempt = 0; attempt < STOP_SETTLE_ATTEMPTS; attempt += 1) {
    if ((await activeRuns()).length === 0) {
      return { cancelled: running.map((entry) => entry.runId) };
    }
    await delay(STOP_SETTLE_DELAY_MS);
  }
  throw new Error("the window is still running after it was cancelled");
}
