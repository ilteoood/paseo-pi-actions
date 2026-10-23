import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const runCommand = promisify(execFile);

const WINDOW_WORKFLOW = "window-loop.yml";

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

async function listedRuns(repository: string): Promise<ListedRun[]> {
  const output = await gh([
    "run",
    "list",
    "--repo",
    repository,
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

async function activeRuns(repository: string): Promise<WindowRun[]> {
  const listed = await listedRuns(repository);
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

async function defaultBranchOf(directory: string, repo: string): Promise<string> {
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
    return gh(["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  }
}

export async function windowStatus(directory: string, repository: string) {
  const repo = await repositoryOf(directory);
  return {
    repo,
    branch: await defaultBranchOf(directory, repo),
    runs: repository === "" ? [] : await activeRuns(repository),
  };
}

export async function startWindow(directory: string, repository: string) {
  if (repository === "") {
    throw new Error("set the offload repository in the plugin settings");
  }
  if (dispatching) {
    throw new Error("a dispatch is already in flight");
  }
  const repo = await repositoryOf(directory);
  const branch = await defaultBranchOf(directory, repo);
  const running = await activeRuns(repository);
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
      repository,
      "--ref",
      branch,
      "-f",
      `target_repo=${repo}`,
    ]);
  } finally {
    dispatching = false;
  }
  return { branch };
}

export async function stopWindows(repository: string) {
  if (repository === "") {
    return { cancelled: [] };
  }
  const running = await activeRuns(repository);
  await Promise.allSettled(
    running.map((entry) => gh(["run", "cancel", String(entry.runId), "--repo", repository])),
  );
  for (let attempt = 0; attempt < STOP_SETTLE_ATTEMPTS; attempt += 1) {
    if ((await activeRuns(repository)).length === 0) {
      return { cancelled: running.map((entry) => entry.runId) };
    }
    await delay(STOP_SETTLE_DELAY_MS);
  }
  throw new Error("the window is still running after it was cancelled");
}
