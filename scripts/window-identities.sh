#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
identities="$root/.secrets/window-identities"
output="$root/.secrets/offload-secrets.json"

if [ -z "${PASEO_PASSWORD:-}" ]; then
  read -rs -p "Daemon password, the same value as the PASEO_PASSWORD secret: " PASEO_PASSWORD
  echo
fi

slots=(1 2 3 4 5)

for slot in "${slots[@]}"; do
  identity="$identities/slot-$slot"
  home="$identities/.home-$slot"
  rm -rf "$home"
  mkdir -p "$home" "$identity" && chmod 700 "$home" "$identity"
  PASEO_SERVER_ID="Window-$slot" paseo daemon pair --relay --home "$home" --json > "$home/pair.json"
  cp "$home/server-id" "$home/daemon-keypair.json" "$identity/"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$home/pair.json" > "$identity/offer.url"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["connectionUri"])' "$home/pair.json" > "$identity/relay-uri"
  chmod 600 "$identity"/*
  rm -rf "$home"
done

PASEO_PASSWORD="$PASEO_PASSWORD" python3 - "$identities" "$output" "${slots[@]}" <<'PY'
import json
import os
import sys

identities, output, *slots = sys.argv[1:]
password = os.environ["PASEO_PASSWORD"]
entries = []
for slot in (int(value) for value in slots):
    directory = os.path.join(identities, f"slot-{slot}")
    with open(os.path.join(directory, "relay-uri")) as handle:
        relay_uri = handle.read().strip()
    with open(os.path.join(directory, "offer.url")) as handle:
        offer_url = handle.read().strip()
    entries.append(
        {
            "slot": slot,
            "serverId": f"Window-{slot}",
            "relayUri": relay_uri,
            "offerUrl": offer_url,
            "password": password,
        }
    )
with open(output, "w") as handle:
    json.dump(entries, handle)
    handle.write("\n")
PY
chmod 600 "$output"

echo "$output"
