import assert from "node:assert/strict";
import { test } from "node:test";
import { repoFromRemote } from "../server/window.ts";

test("reads owner and repo from every remote form git accepts", () => {
  const remotes = [
    "https://github.com/ilteoood/paseo-pi-actions.git",
    "https://github.com/ilteoood/paseo-pi-actions",
    "https://github.com/ilteoood/paseo-pi-actions/",
    "git@github.com:ilteoood/paseo-pi-actions.git",
    "ssh://git@github.com/ilteoood/paseo-pi-actions.git",
    "https://x-access-token:token@github.com/ilteoood/paseo-pi-actions.git",
  ];
  for (const remote of remotes) {
    assert.equal(repoFromRemote(remote), "ilteoood/paseo-pi-actions", remote);
  }
});

test("refuses a remote that is not GitHub", () => {
  assert.throws(() => repoFromRemote("git@gitlab.com:ilteoood/paseo.git"), /not a GitHub remote/);
});
