import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseSlot,
  repoFromRemote,
  windowRunDetails,
  type WindowRun,
} from "../server/window.ts";
import { offloadSettings } from "../shared/settings.ts";

function windowRun(slot: number, repo: string): WindowRun {
  return {
    runId: slot,
    status: "in_progress",
    url: `https://github.com/owner/repo/actions/runs/${slot}`,
    repo,
    slot,
    startedAt: "2026-10-24T00:00:00Z",
  };
}

test("reads owner and repo from every remote form git accepts", () => {
  const remotes = [
    "https://github.com/ilteoood/paseo-pi-actions.git",
    "https://github.com/ilteoood/paseo-pi-actions",
    "https://github.com/ilteoood/paseo-pi-actions/",
    "git@github.com:ilteoood/paseo-pi-actions.git",
    "ssh://git@github.com:ilteoood/paseo-pi-actions.git",
    "https://x-access-token:token@github.com/ilteoood/paseo-pi-actions.git",
  ];
  for (const remote of remotes) {
    assert.equal(repoFromRemote(remote), "ilteoood/paseo-pi-actions", remote);
  }
});

test("refuses a remote that is not GitHub", () => {
  assert.throws(() => repoFromRemote("git@gitlab.com:ilteoood/paseo.git"), /not a GitHub remote/);
});

test("accepts an owner/repo or an empty offload repository", () => {
  assert.deepEqual(offloadSettings.schema.parse({}), { repository: "" });
  assert.deepEqual(offloadSettings.schema.parse({ repository: " ilteoood/harness " }), {
    repository: "ilteoood/harness",
  });
  assert.throws(() => offloadSettings.schema.parse({ repository: "ilteoood" }));
});

test("reads the slot and repository from a window run title", () => {
  assert.deepEqual(windowRunDetails("window-3 owner/repo"), { slot: 3, repo: "owner/repo" });
  assert.equal(windowRunDetails("window-6 owner/repo"), null);
  assert.equal(windowRunDetails("owner/repo"), null);
});

test("picks the first free slot", () => {
  assert.equal(chooseSlot([windowRun(1, "owner/one"), windowRun(3, "owner/three")]), 2);
});

test("does not reuse a slot reserved by a simultaneous dispatch", () => {
  const reservations = new Map([[2, { repo: "owner/two", dispatchedAt: 0 }]]);
  assert.equal(chooseSlot([], reservations), 1);
  assert.equal(chooseSlot([windowRun(1, "owner/one")], reservations), 3);
});

test("refuses a full pool and names every busy slot and repository", () => {
  const runs = [1, 2, 3, 4, 5].map((slot) => windowRun(slot, `owner/repo-${slot}`));
  assert.throws(
    () => chooseSlot(runs),
    /all five window slots are busy: Window 1 — owner\/repo-1, Window 2 — owner\/repo-2, Window 3 — owner\/repo-3, Window 4 — owner\/repo-4, Window 5 — owner\/repo-5/,
  );
});
