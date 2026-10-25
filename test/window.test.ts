import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  chooseSlot,
  reconcileReservations,
  repoFromRemote,
  slotStates,
  windowRunDetails,
  type ListedRun,
  type WindowRun,
} from "../server/window.ts";
import { importMaterial, parseMaterial, pairingString, secretsStatus } from "../server/secrets.ts";
import { type SlotState, windowRows } from "../client/windowRows.ts";
import type { PluginHostSummary } from "@getpaseo/plugin/client";
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

function listedRun(slot: number, repo: string, createdAt: string): ListedRun {
  return {
    databaseId: slot,
    status: "in_progress",
    url: `https://github.com/owner/repo/actions/runs/${slot}`,
    displayTitle: `window-${slot} ${repo}`,
    createdAt,
  };
}

function materialJson(): string {
  const entries = [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    serverId: `Window-${slot}`,
    relayUri: `relay://relay.paseo.sh:443/Window-${slot}?key=key-${slot}&ssl=true`,
    offerUrl: `https://app.paseo.sh/#offer=offer-${slot}`,
    password: "secret",
  }));
  return JSON.stringify(entries);
}

test("reads owner and repo from every remote form git accepts", () => {
  const remotes = [
    "https://github.com/ilteoood/paseo-pi-actions.git",
    "https://github.com/ilteoood/paseo-pi-actions",
    "https://github.com/ilteoood/paseo-pi-actions/",
    "git@github.com:ilteoood/paseo-pi-actions.git",
    "ssh://git@github.com:ilteoood/paseo-pi-actions.git",
    "https://x-access-token:token@github.com:ilteoood/paseo-pi-actions.git",
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

test("names the slot that is only starting in the busy message", () => {
  const reservations = new Map([[2, { repo: "owner/two", dispatchedAt: 0 }]]);
  const runs = [1, 3, 4, 5].map((slot) => windowRun(slot, `owner/repo-${slot}`));
  assert.throws(
    () => chooseSlot(runs, reservations),
    /Window 2 — owner\/two \(starting\)/,
  );
});

test("expires a reservation two minutes after the dispatch", () => {
  const reservations = new Map([[2, { repo: "owner/two", dispatchedAt: 1_000 }]]);
  const listed = [listedRun(2, "owner/other", "2026-10-25T00:00:00Z")];
  reconcileReservations(listed, reservations, 1_000 + 119_000);
  assert.equal(reservations.size, 1);
  reconcileReservations(listed, reservations, 1_000 + 120_000);
  assert.equal(reservations.size, 0);
});

test("matches a run that started before the dispatch, within the clock tolerance", () => {
  const dispatchedAt = Date.parse("2026-10-25T00:00:00Z");
  const within = new Map([[2, { repo: "owner/two", dispatchedAt }]]);
  reconcileReservations([listedRun(2, "owner/two", "2026-10-24T23:59:30Z")], within, dispatchedAt);
  assert.equal(within.size, 0);

  const outside = new Map([[2, { repo: "owner/two", dispatchedAt }]]);
  reconcileReservations([listedRun(2, "owner/two", "2026-10-24T23:58:30Z")], outside, dispatchedAt);
  assert.equal(outside.size, 1);
});

test("carries the age of the run and of the reservation", () => {
  const now = Date.parse("2026-10-25T00:10:00Z");
  const run = { ...windowRun(1, "owner/one"), startedAt: "2026-10-25T00:05:00Z" };
  const withRun = slotStates([run], new Map(), new Map(), now);
  assert.equal(withRun[0].ageSeconds, 300);
  assert.equal(withRun[0].booted, false);
  assert.equal(withRun[1].status, "free");
  assert.equal(withRun[1].ageSeconds, null);

  const reservations = new Map([[3, { repo: "owner/three", dispatchedAt: now - 45_000 }]]);
  const withReservation = slotStates([], reservations, new Map(), now);
  assert.equal(withReservation[2].status, "dispatching");
  assert.equal(withReservation[2].ageSeconds, 45);
  assert.equal(withReservation[2].booted, null);
});

test("carries the booted proxy of the run", () => {
  const run = windowRun(1, "owner/one");
  const states = slotStates([run], new Map(), new Map([[run.runId, true]]), Date.now());
  assert.equal(states[0].booted, true);
});

test("accepts a paste with one entry per slot", () => {
  const entries = parseMaterial(materialJson());
  assert.equal(entries.length, 5);
  assert.equal(entries[0].serverId, "Window-1");
  assert.equal(entries[4].slot, 5);
});

test("refuses a paste that is not JSON", () => {
  assert.throws(() => parseMaterial("not json"), /not JSON/);
});

test("refuses a paste that misses a slot", () => {
  const entries = JSON.parse(materialJson()) as unknown[];
  entries.pop();
  assert.throws(() => parseMaterial(JSON.stringify(entries)), /slot 5 exactly once/);
});

test("names the first failing field of a paste", () => {
  const entries = JSON.parse(materialJson()) as Record<string, unknown>[];
  entries[2].relayUri = "https://not-a-relay";
  assert.throws(
    () => parseMaterial(JSON.stringify(entries)),
    /slots\[2\.relayUri\] must be a relay:\/\/ URI/,
  );
});

test("refuses a paste whose slot carries another window's relay URI", () => {
  const entries = JSON.parse(materialJson()) as Record<string, unknown>[];
  entries[2].relayUri = "relay://relay.paseo.sh:443/Window-1?key=key-1&ssl=true";
  assert.throws(
    () => parseMaterial(JSON.stringify(entries)),
    /slots\[2\.relayUri\] must name Window-3/,
  );
});

test("refuses a paste whose slot names another window", () => {
  const entries = JSON.parse(materialJson()) as Record<string, unknown>[];
  entries[1].serverId = "Window-4";
  assert.throws(
    () => parseMaterial(JSON.stringify(entries)),
    /slots\[1\.serverId\] must be Window-2/,
  );
});

test("keeps the imported material at 0600 and hands out one pairing string", () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-offload-"));
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.deepEqual(secretsStatus(), { slots: 0, importedAt: null });
    assert.equal(importMaterial(materialJson()).slots, 5);
    const path = join(home, ".paseo", "plugin-settings", "paseo-offload", "offload-secrets.json");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(
      pairingString(3),
      "relay://relay.paseo.sh:443/Window-3?key=key-3&ssl=true&password=secret",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previous;
    }
  }
});

function slotState(overrides: Partial<SlotState> = {}): SlotState {
  return {
    slot: 1,
    status: "in_progress",
    repo: "owner/repo",
    runId: 7,
    url: "https://github.com/owner/repo/actions/runs/7",
    ageSeconds: 120,
    booted: true,
    ...overrides,
  };
}

function rowFor(
  slots: SlotState[],
  hosts: PluginHostSummary[] = [],
  materialImported = true,
  canSwitch = true,
) {
  return windowRows({
    slots,
    hosts,
    localHost: { id: "local", label: "This machine" },
    materialImported,
    canSwitch,
  })[1];
}

test("renders the local daemon row without actions", () => {
  const rows = windowRows({
    slots: [slotState()],
    hosts: [],
    localHost: { id: "local", label: "This machine" },
    materialImported: true,
    canSwitch: true,
  });
  assert.equal(rows[0].name, "This machine");
  assert.equal(rows[0].runStatus, "Local");
  assert.deepEqual(rows[0].actions, []);
});

test("an idle slot is free, has no host word and no actions", () => {
  const row = rowFor([slotState({ status: "free", runId: null, booted: null, ageSeconds: null })]);
  assert.equal(row.detail, "Window-1 · no active window");
  assert.equal(row.runStatus, "Free");
  assert.equal(row.hostStatus, null);
  assert.deepEqual(row.actions, []);
});

test("a starting slot is disabled for turn down and offers no connect", () => {
  const row = rowFor([slotState({ status: "dispatching", runId: null, booted: null })]);
  assert.equal(row.runStatus, "Starting");
  assert.equal(row.hostStatus, null);
  assert.equal(row.detail, "owner/repo · starting for 2m");
  assert.deepEqual(row.actions.map((action) => [action.kind, action.disabled]), [
    ["turn-down", true],
  ]);
});

test("an unpaired booted window offers the pair button", () => {
  const row = rowFor([slotState()]);
  assert.equal(row.runStatus, "Running");
  assert.equal(row.hostStatus, "Not paired");
  assert.equal(row.detail, "owner/repo · for 2m");
  assert.deepEqual(row.actions.map((action) => [action.kind, action.label, action.disabled]), [
    ["pair", "Pair Window 1", false],
    ["turn-down", "Turn down", false],
  ]);
});

test("an unpaired window that has not booted cannot pair", () => {
  const row = rowFor([slotState({ booted: false })]);
  assert.equal(row.hostStatus, "Not booted");
  assert.equal(row.actions[0]?.disabled, true);
});

test("a missing paste keeps the pair button disabled", () => {
  const row = rowFor([slotState()], [], false);
  assert.equal(row.actions[0]?.disabled, true);
});

test("an online host offers the switch and a connecting one does not", () => {
  const online = rowFor([slotState()], [{ serverId: "Window-1", label: "W1", status: "online" }]);
  assert.equal(online.hostStatus, "Paired");
  assert.deepEqual(online.actions.map((action) => [action.kind, action.disabled]), [
    ["switch", false],
    ["turn-down", false],
  ]);

  const connecting = rowFor([slotState()], [
    { serverId: "Window-1", label: "W1", status: "connecting" },
  ]);
  assert.equal(connecting.hostStatus, "Connecting");
  assert.deepEqual(connecting.actions.map((action) => [action.kind, action.disabled]), [
    ["switch", true],
    ["turn-down", false],
  ]);
});

test("a dead host entry reads offline", () => {
  const row = rowFor([slotState()], [{ serverId: "Window-1", label: "W1", status: "offline" }]);
  assert.equal(row.hostStatus, "Offline");
  assert.equal(row.actions[0]?.disabled, true);
});

test("a host without navigation offers no switch button", () => {
  const row = rowFor(
    [slotState()],
    [{ serverId: "Window-1", label: "W1", status: "online" }],
    true,
    false,
  );
  assert.deepEqual(row.actions.map((action) => action.kind), ["turn-down"]);
});
