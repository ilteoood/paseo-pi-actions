# paseo-pi-actions

Run [pi](https://github.com/earendil-works/pi-coding-agent) inside a throwaway GitHub Actions job and steer it live from the [Paseo](https://paseo.sh) app.

A **window** is a GitHub Actions job that clones your repository, restores one pre-paired Paseo daemon identity, boots the daemon, and then waits for you. You steer it from the app, on the desktop or on the phone, and the work lands on a branch in your repository.

This repository holds two things:

| Path | What it is |
| --- | --- |
| `plugin/` | the Paseo plugin ("Offload window") that dispatches and tears down windows |
| `.github/workflows/window-loop.yml` | the window job itself |

The plugin runs on your **daemon machine**. The job runs on a **GitHub-hosted runner**. Your **target repository** carries no offload files at all: the clone happens on the runner.

## How a window works

1. You open the **Offload window** panel of a workspace, or press ⌘K and pick *Offload a window for this repo*.
2. The plugin reads the target repository from the workspace's `origin` remote and the **offload repository** from its settings, then picks a free slot among `1..5`.
3. It dispatches `window-loop.yml` in the offload repository with `gh workflow run`.
4. The job clones the target repository, restores the slot's daemon identity from repository secrets, runs your harness (which boots `paseo daemon run`), registers the clone as a Paseo project, and idles.
5. The daemon dials the Paseo relay, the app shows a `Window-<slot>` host entry, and you steer the window.
6. *Tear down all windows* cancels the window runs of the offload repository, every target repository among them.

A slot is a fixed identity: slot `n` always boots as `Window-n`. Five slots means five simultaneous windows. A sixth dispatch is refused by name, and a dispatch onto a busy slot queues behind it, because the workflow serializes each slot through the concurrency group `paseo-window-<slot>`.

## What you need

| Requirement | Notes |
| --- | --- |
| The [Paseo](https://paseo.sh) app and CLI | the plugin declares `paseo >= 0.12.0`, and the window installs the latest CLI itself |
| `git` and `gh` on the daemon machine | the plugin shells out to both; `gh` must be authenticated with a token that can dispatch workflows, read the default branch and cancel runs in the offload repository |
| A GitHub account with a fine-grained token for your target repositories | `Contents: read and write` to clone and push, `Pull requests: read` for the daemon's PR polling |
| A static model API key | `OPENCODE_API_KEY` for OpenCode Zen, or another provider key your harness supports. It must be a static key: an OAuth credential that rotates on refresh dies inside the job |
| A public offload repository | public machinery means free GitHub-hosted runners, and the run logs are world-readable, so no secret may ever be printed into a log |

## Set up your fork

Your fork is the **offload repository**: it holds `window-loop.yml` and the secrets the job reads.

### 1. Fork the repository

```bash
gh repo fork ilteoood/paseo-pi-actions --clone
cd paseo-pi-actions
```

Enable Actions on the fork, and keep `.github/workflows/window-loop.yml` on its default branch. The plugin dispatches the workflow by name on the default branch, so the file has to be there.

### 2. Point the job at your own harness

The job fetches the agent's instructions and its boot script from the upstream author's personal harness:

```bash
curl -fsSL https://raw.githubusercontent.com/ilteoood/harness/main/AGENTS.md \
  -o "$HOME/.pi/agent/AGENTS.md"
curl -fsSL https://raw.githubusercontent.com/ilteoood/harness/main/pi-agent.sh \
  -o "$RUNNER_TEMP/pi-agent.sh"
```

Replace both URLs with your own. The script has to run `paseo daemon` on a line of its own: the job greps for that line and fails loudly when it is gone, because the harness is what boots the daemon now. The upstream script also installs that author's personal pi packages; yours should carry your own.

While you are in the file, change this:

| Line | Change it to |
| --- | --- |
| `pi install npm:opencode-zen-oauth@1.2.11` | your provider's package, or drop it and use a provider pi already ships |

The install line above it stays as it is: `npm i -g --ignore-scripts @getpaseo/cli@latest @earendil-works/pi-coding-agent@latest` always takes the latest release of both, so a breaking release upstream can break a window. The run's log tail has the versions it booted.

### 3. Generate the five window identities

Each slot needs its own daemon identity: a server id and a keypair. Generate them once, locally, in a scratch home per slot. `PASEO_SERVER_ID` pins the id, which is what makes the app show `Window-1` through `Window-5`. Run this from the repository root.

```bash
for slot in 1 2 3 4 5; do
  identity="$PWD/.secrets/window-identities/slot-$slot"
  home="$PWD/.secrets/window-identities/.home-$slot"
  mkdir -p "$home" "$identity" && chmod 700 "$home" "$identity"
  PASEO_SERVER_ID="Window-$slot" paseo daemon pair --relay --home "$home" --json > "$home/pair.json"
  cp "$home/server-id" "$home/daemon-keypair.json" "$identity/"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$home/pair.json" > "$identity/offer.url"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["connectionUri"])' "$home/pair.json" > "$identity/relay-uri"
  chmod 600 "$identity"/*
  rm -rf "$home"
done
```

The result is a local copy per slot:

```
.secrets/window-identities/slot-1/server-id          # Window-1
.secrets/window-identities/slot-1/daemon-keypair.json # the private half, never leaves your machine
.secrets/window-identities/slot-1/offer.url           # the pairing offer, a secret
.secrets/window-identities/slot-1/relay-uri           # the same offer in relay form
```

`.secrets/` is gitignored, so the private key material cannot be committed. Keep the whole directory: the offer is derived from the identity, and it is what pairs your phone.

Pair the app with each slot: open Paseo on the phone, **Settings → Add host → Paste pairing link**, and paste the `offer.url` of that slot. The app only keeps a host entry while a daemon holding that identity is live, so pair slot `n` the first time window `n` boots, or boot a daemon from that slot's copy on demand. The job pins the container hostname to `Window-<slot>`, so the entry carries that name.

The phone also needs the daemon password, the same value as the `PASEO_PASSWORD` secret. From Paseo 0.13.0 the relay refuses a client that sends no password, and the window's daemon has one, so enter it in the host entry.

### 4. Upload the secrets to the fork

The job reads everything from the offload repository's secrets. There are ten identity secrets, one pair per slot, plus the token, the model key and the daemon password. Run this from the repository root, with `TARGET_REPO_TOKEN`, `OPENCODE_API_KEY` and `PASEO_PASSWORD` exported.

```bash
OFFLOAD_REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

for slot in 1 2 3 4 5; do
  dir=".secrets/window-identities/slot-$slot"
  gh secret set "PASEO_SERVER_ID_B64_$slot" --repo "$OFFLOAD_REPO" --body "$(base64 < "$dir/server-id" | tr -d '\n')"
  gh secret set "PASEO_DAEMON_KEYPAIR_B64_$slot" --repo "$OFFLOAD_REPO" --body "$(base64 < "$dir/daemon-keypair.json" | tr -d '\n')"
done

gh secret set TARGET_REPO_TOKEN --repo "$OFFLOAD_REPO" --body "$TARGET_REPO_TOKEN"
gh secret set OPENCODE_API_KEY --repo "$OFFLOAD_REPO" --body "$OPENCODE_API_KEY"
gh secret set PASEO_PASSWORD --repo "$OFFLOAD_REPO" --body "$PASEO_PASSWORD"
```

| Secret | What it is |
| --- | --- |
| `PASEO_SERVER_ID_B64_1` … `PASEO_SERVER_ID_B64_5` | base64 of each slot's `server-id` |
| `PASEO_DAEMON_KEYPAIR_B64_1` … `PASEO_DAEMON_KEYPAIR_B64_5` | base64 of each slot's `daemon-keypair.json` |
| `TARGET_REPO_TOKEN` | the token that clones and pushes your target repositories, and the daemon's `GH_TOKEN` |
| `OPENCODE_API_KEY` | the model credential, a static key |
| `MINIMAX_API_KEY` | optional, a second provider |
| `PASEO_PASSWORD` | the daemon password, it gates the relay path on newer Paseo versions |

A repository secret can be overwritten but never read back. Keep the local copy from step 3, it is the only way to restore a secret you no longer have.

### 5. Install the plugin on the daemon machine

Plugins are trusted, unsandboxed code: the backend half runs on the daemon host with access to your files, processes and credentials. The plugin needs `git` and `gh`, and it reads and writes GitHub on your behalf. Install it only if that is what you want.

```bash
paseo plugin install github:<you>/paseo-pi-actions:plugin
```

or, from a local checkout:

```bash
paseo plugin install /absolute/path/to/paseo-pi-actions/plugin
```

The daemon refuses to load plugins until the global switch is on. `paseo daemon status --json` prints the daemon home; check that home's `config.json` for `"pluginsEnabled": true`, or flip it in **Settings → Plugins → Enable plugins** on the daemon machine, then:

```bash
paseo reload
paseo plugin ls          # the plugin has to reach "running"
paseo plugin logs paseo-offload
```

The plugin's runtime dependencies (`zod`, `react`, `react-native`, `@tanstack/react-query`) come from Paseo itself, so there is nothing to install next to it. The `devDependencies` are only needed to typecheck the source.

### 6. Point the plugin at the offload repository

In the app: **Settings → Plugins → Offload window**, set **Offload repository** to `owner/repo` of your fork. The plugin dispatches `window-loop.yml` there, reads its run list to decide which slots are busy, and cancels its runs when you tear down.

### 7. Authenticate `gh` on the daemon machine

The plugin calls `gh workflow run`, `gh run list`, `gh run cancel` and `gh repo view` without passing a token, so it uses the ambient `GH_TOKEN` or `gh`'s own stored credentials.

```bash
gh auth login
gh auth status
```

That token needs `Actions: write` on the offload repository. It is a different token from `TARGET_REPO_TOKEN`: the first one dispatches, the second one clones and pushes.

### 8. Open a window

In the app, open a workspace of the repository you want to work on, then **Offload window → Open a window for this repo**, or press ⌘K → *Offload a window for this repo*.

You can also dispatch by hand, which is the fastest way to check the wiring:

```bash
gh workflow run window-loop.yml --repo <you>/paseo-pi-actions \
  -f target_repo=<you>/<target> -f slot=1
```

## What the window does to your repository

- Clones it with `TARGET_REPO_TOKEN`.
- Checks out `feature/window-<slot>`, creating it when it is missing.
- Installs a `post-commit` hook that pushes that branch after every commit. The hook refuses to push the default branch.
- Runs the daemon's `gh` against that token, so the app can poll pull requests. The credential has to be in the daemon's environment, which is why the job exports `GH_TOKEN` to the harness rather than only to the job.
- Authors the commits with the git identity the harness set up. This repository does not bake one in.

Nothing else survives the job. GitHub-hosted runners are destroyed when the job ends, without a shutdown hook, so only what the agent pushed is left behind. Steer the window to wrap up and push before the job ends.

## Knobs

| Knob | Where | Effect |
| --- | --- | --- |
| Slot count | `WINDOW_SLOTS` in `plugin/shared/window.ts`, the slot `choice` in `window-loop.yml`, the run-title regex in `plugin/server/window.ts`, and the secret names `..._<n>` | how many windows can run at once. Every slot is an identity you generate, store and pair, so keep the count small |
| Window lifetime | `sleep 5400` in the *Steering window* step | how long the job idles before it ends. GitHub-hosted runners stop at 6 hours per job |
| Provider | the `pi install` line and the `*_API_KEY` secrets | which model the window's agent runs on |
| Harness | the two `curl` URLs | the agent's instructions and its boot script |

## Security

- **A pairing offer is a bearer credential.** It carries the daemon's public key, and anyone holding it can drive that daemon: a terminal, the target token, the model key, the private identity key. Treat `offer.url` and `relay-uri` like passwords. They belong in your local copy and in your phone, never in an issue, a run log, an artifact or a dispatch input.
- **A credential-less relay client used to be admitted as owner.** Paseo 0.13.0 dropped that compat shim: the relay now refuses a client that sends no password. The job installs the latest CLI and the window's daemon runs with `PASEO_PASSWORD`, so the phone has to present the same password.
- **Run logs of a public repository are world-readable.** The job never prints the offer, and it fails the run when the restored keypair does not match the keypair schema, so a broken secret surfaces immediately instead of booting an unpaired daemon.
- **Rotate, do not repair.** A leaked token or a leaked identity is replaced by overwriting the secret and generating a new identity. There is no revocation surface for a paired identity.
- **The target token is the blast radius.** Its repository allowlist is the only thing that decides which repositories a window can write to, so scope it to the repositories you want a window to touch.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `set the offload repository in the plugin settings` | the plugin setting is empty | Settings → Plugins → Offload window |
| `all five window slots are busy: Window 1 — owner/repo, ...` | every slot holds a run | tear the windows down, or cancel the run that holds a slot |
| `window slot N has no stored daemon identity` | the slot's two secrets are missing | upload both, see step 4 |
| `the restored daemon keypair does not match the daemon keypair schema` | the keypair secret is corrupted or truncated | re-upload it from the local copy |
| `slot N booted on a fresh keypair; its paired offer no longer matches` | the keypair secret does not match the paired offer | re-upload the keypair, then pair the slot again |
| `the harness script no longer boots the daemon` | the harness script lost its `paseo daemon run` line | put it back |
| `the relay never connected` | the daemon never reached the relay | check the daemon log tail in the run, and that `PASEO_PASSWORD` is set |
| `the daemon never started` | the harness died before booting Paseo | the run's daemon log tail has the harness output |
| `<remote> is not a GitHub remote` | the workspace's `origin` is not a GitHub URL | the plugin only supports GitHub remotes |
| the window is invisible in the app | the phone never paired that slot | paste that slot's `offer.url` into the app |

## Repository layout

```
.github/workflows/window-loop.yml   the window job, the file your fork dispatches
.github/workflows/plugin.yml        typecheck and tests for the plugin
plugin/paseo-plugin.json            the plugin manifest, its id and its Paseo requirement
plugin/index.server.ts              the daemon-side RPC handlers
plugin/server/window.ts             slot picking, the gh dispatch, the teardown
plugin/index.client.tsx             the panel, the settings screen, the command center item
plugin/client/window.tsx            the workspace panel
plugin/client/settings.tsx          the settings screen
plugin/shared/window.ts             the RPC contracts and WINDOW_SLOTS
plugin/shared/settings.ts           the settings schema
plugin/test/window.test.ts          the tests
```

## Development

```bash
cd plugin
npm ci
npm run typecheck
npm test
```

`.github/workflows/plugin.yml` runs the same two commands on every push and pull request that touches `plugin/`. It needs no secrets.

## License

There is no `LICENSE` file in this repository yet, so treat the code as all rights reserved until the author adds one. The window runs other people's code on your machine and on GitHub's runners, so read the harness and the provider packages you point it at, and their licenses, before you trust them with a repository.
