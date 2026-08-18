---
name: testing-trezor-webusb
description: >-
  Test and debug Sifar's direct Trezor WebUSB flow, stable Solana OCMS v1
  signing, Docker startup, account discovery, and physical-device failures.
  Use when asked to "test the Trezor", "verify physical signing", "debug
  WebUSB", "fix the Docker app", or investigate transport, passphrase,
  protobuf, signature-verification, or browser chooser errors.
---

# Testing Trezor WebUSB

## When to use
Use for Sifar's browser-to-device path and stable-firmware message signing.
Do not use this procedure to add Trezor Connect's hosted iframe/popup, Trezor
Bridge, or a software signing fallback; those violate this repo's architecture.

## Workflow
1. From the repo root, inspect current changes with `git status --short`. Do not
   discard unrelated files or commit unless the human asks.
2. Run the static checks in the Docker service:

   ```bash
   docker compose up --build -d
   docker compose exec web node tests/lint-tests.js
   docker compose exec web npm run lint
   docker compose exec web npm run typecheck
   docker compose exec web npm test
   docker compose stop web
   docker compose run --rm -e DEBUG= web sh -lc \
     'find .next -mindepth 1 -delete 2>/dev/null || true; npm run build'
   docker compose up -d web
   ```

3. Confirm the application is healthy before involving USB:

   ```bash
   docker compose ps
   # -k because local HTTPS uses a self-signed certificate. The server serves
   # HTTPS when web/certificates/ holds a key pair and HTTP otherwise, never both.
   curl -kfsS https://localhost:3001/trezor-usb >/dev/null || \
     curl -fsS http://localhost:3001/trezor-usb >/dev/null
   docker compose logs --tail=200 web
   ```

4. Remember the environment boundary: Docker and WSL serve JavaScript, while
   the Chromium browser owns WebUSB. Absence of `/dev/bus/usb` in WSL is not a
   failure. Do not invoke Windows host commands such as `powershell.exe`; device
   selection and confirmation are verified through the browser UI and Sifar
   debug terminal.

5. Ask the human to unlock the latest-stable Core device, open
   `localhost:3001/trezor-usb` in Chrome/Edge, click **Connect Trezor**,
   review the **Not signing** account-discovery disclosure, select the device
   in Chrome's chooser, and complete any PIN/passphrase prompt firmware asks
   for. WebUSB permission and physical confirmations cannot be bypassed. Normal
   operations should then reuse the in-memory firmware session; repeated
   host-forced passphrase gates are a regression.
6. Verify addresses appear eagerly while enumeration continues. Balance/RPC
   errors are separate from hardware derivation and must display per-account
   failure without hiding valid addresses.
7. To test on a phone (Android Chrome + USB-OTG), two things must be true and
   both fail silently. Everything here changes the human's machine, not the
   repo, so `git checkout` does not undo any of it — always tell them how to
   reverse what they turned on, and offer the teardown when testing ends.

   **a. Secure context.** `navigator.usb` and `getUserMedia` refuse to run over
   plain HTTP on anything but `localhost`.

   ```bash
   # enable
   SIFAR_CERT_IPS="<phone-facing IP>" sh web/scripts/gen-cert.sh
   docker compose restart web

   # disable — returns the server to HTTP
   rm -rf web/certificates/*.pem
   docker compose restart web
   ```

   `scripts/dev.sh` switches on HTTPS whenever `web/certificates/` holds a key
   pair. openssl runs on the host because the dev image ships none, and the
   directory is gitignored so the key is never committed. Send the human to the
   **https://** URL and have them accept the warning once. Chrome stores that
   exception per origin; clearing it is Chrome site-data, not something the
   repo controls.

   **b. LAN ingress on WSL2.** In NAT mode Windows forwards `localhost` only,
   so LAN clients cannot reach the dev server at all. Two options, one or the
   other, never both.

   Do not make the human substitute placeholders. Run this and paste the
   output — it fills in the live WSL address, port and certificate state:

   ```bash
   sh web/scripts/lan-access.sh <their LAN IP>
   ```

   It prints enable, verify, disable, and the after-a-reboot re-add. Those
   commands need Administrator rights, so this is the one place where the
   "no Windows host commands" rule above means *hand them over*, not run them.
   Full prose lives in "Testing on a phone" in `README.md`.

   Option A, port proxy — needs an inbound firewall rule as well, and must be
   redone whenever WSL restarts and takes a new IP:

   ```powershell
   # enable (elevated); target comes from `ip -4 -o addr show eth0`
   netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=<WSL_IP>
   netsh advfirewall firewall add rule name="Sifar dev 3001" dir=in action=allow protocol=TCP localport=3001 profile=private

   # inspect
   netsh interface portproxy show v4tov4

   # disable
   netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
   netsh advfirewall firewall delete rule name="Sifar dev 3001"
   ```

   Option B, mirrored networking — permanent, no port proxy, no drifting IP;
   needs Windows 11 22H2+ and WSL 2.0.0+. Enable by adding
   `networkingMode=mirrored` under `[wsl2]` in `%USERPROFILE%\.wslconfig` then
   `wsl --shutdown`; disable by deleting that line (or setting `nat`) and
   shutting down again. Remove any Option A proxy first, and regenerate the
   certificate afterwards because the addresses change.

8. Select an unconfirmed account and verify that its disclosure shows the full
   address/path before the Trezor displays it. Click **Open WalletConnect**, then
   paste a fresh `wc:` URI or QR. Verify the pairing disclosure says **Not
   signing**, the proposal disclosure names the address/chains/methods, and the
   request disclosure says **Will sign** (or **Will sign and broadcast**).
   Trigger `solana_signMessage`, use its disclosure CTA, inspect the message
   on-device, and confirm physically. Require the debug terminal to report local
   OCMS byte and Ed25519 verification before the response is sent.
9. If it fails, copy the debug terminal with its Copy button. Trace the sequence
   through `[Sifar] Call`, response type, UI request/response, returned
   `signed_data`, and local verification. Never log the entered passphrase.
10. For protocol regressions, run the focused tests and inspect these files:

   ```bash
   docker compose exec web npx vitest run \
     lib/trezorMessages.test.ts \
     lib/trezorSession.test.ts \
     lib/actionDisclosure.test.ts \
     lib/solanaOffchainMessage.test.ts \
     lib/solanaMessageSigning.test.ts \
     lib/walletConnectSolanaMessage.test.ts \
     lib/walletconnect.test.ts \
     lib/walletConnectUri.test.ts
   ```

   - `web/lib/trezorMessages.ts`: firmware protobuf IDs and fields.
   - `web/lib/trezorConnect.ts`: direct calls and UI response loop.
   - `web/lib/solanaOffchainMessage.ts`: canonical OCMS v1 bytes.
   - `web/lib/solanaMessageSigning.ts`: exact `signed_data` and Ed25519 checks.
   - `web/lib/signing.ts`: WalletConnect/session/account binding.

## Failure modes
- `requestDevice: No device selected` means the chooser was cancelled or no
  unlocked device was selectable. Reconnect/unlock, then invoke it again from a
  fresh user click; do not call `requestDevice()` automatically.
- An expired WalletConnect URI must fail before SDK pairing. Generate a fresh
  QR in the dApp; never log or persist the URI because it contains `symKey`.
- A stale `_next` chunk or `ChunkLoadError` after a build means the dev output
  volume and browser page disagree. Restart the service and hard-refresh; if it
  persists, remove only generated Compose volumes with `docker compose down -v`
  and rebuild.
- Docker `npm ci` errors mentioning missing `@emnapi/*` packages mean the lock
  was generated by an incompatible host npm. Regenerate it with Node 20/npm 10:

  ```bash
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$PWD/web:/app" -w /app node:20-bookworm-slim \
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund
  ```

- `Unexpected response: Features` can occur when firmware resets workflow
  state. The Connect-like loop retries once; repeated Features responses require
  release/reconnect rather than treating them as a signature. `Initialize` and
  `GetFeatures` are exempt because `Features` is their correct reply — if this
  error appears on every connect, that exemption has regressed.
- `missing required field message` on `SolanaSignMessage` is the OCMS v0/v1
  protobuf boundary: Core `2.12.1`-`2.12.3` required bytes field `2`, while
  `2.12.4+` requires nested v1 field `4`. Check the firmware shown by Sifar;
  do not guess from the updater saying the device is current.
- A blank UI while the device waits on a PIN/passphrase prompt ("nothing
  happens until I click Connect again") means the prompt was emitted and then
  cleared. Look for `ui-close_window` immediately after `ui-request_passphrase`
  in the debug log, or a duplicate transport from an unmemoized init.
- PIN/passphrase appearing after every read or signature means the host has
  discarded `Features.session_id` or restored per-operation locking. Resume the
  opaque ID through `Initialize`; only explicit Disconnect may send
  `EndSession` + `LockDevice`. Never log the ID, passphrase, or passphrase length.
- An on-device passphrase button on unsupported hardware means capability
  detection regressed. Gate it on `Capability_PassphraseEntry`; a legacy
  `PassphraseRequest._on_device=true` is an immediate empty ack, not a browser
  choice. Browser entry and **Use No Passphrase** remain explicit alternatives.
- `Forbidden key path` during address enumeration marks unsupported path range;
  it must stop background enumeration without replacing an active signing UI
  with an error prompt.
- `ERR_CONNECTION_REFUSED` from a phone while the desktop works is WSL2 NAT, not
  the app: WSL forwards `localhost` from Windows but not LAN clients. The Windows
  portproxy **and** an inbound firewall rule are both required; the portproxy
  alone is still dropped. WSL's IP is reassigned on restart, so a portproxy that
  worked yesterday now points at nothing — re-read `ip -4 -o addr show eth0`.
  `networkingMode=mirrored` in `.wslconfig` removes the whole class of problem.
- A host VPN client is the other common cause of an unreachable dev server; most
  capture or block LAN traffic.
- A certificate warning with no "Proceed" option means the address is missing
  from the certificate; re-run `gen-cert.sh` with it in `SIFAR_CERT_IPS`.
- A port proxy that worked before a reboot now points at a dead address: WSL
  takes a new IP each restart. Re-run `web/scripts/lan-access.sh` and give the
  human its "AFTER A WSL RESTART" block, which deletes before re-adding.
- A firewall rule added with `profile=private` does nothing if Windows has that
  network classified as Public. Either the human sets it to Private, or the rule
  is re-added without the profile filter.
- Leaving a port proxy and an open firewall port behind after testing is the
  most common loose end. Offer the teardown in `README.md` ("Turning it all
  off") when the session ends, and confirm with
  `netsh interface portproxy show v4tov4`.
- A phone showing the "Sifar needs a secure connection" screen reached the server
  but over plain HTTP. Generate a certificate and use the `https://` URL — the
  server stops answering HTTP once one exists, so an `http://` URL looks dead
  rather than redirecting.
- `openssl: not found` inside the container is expected; `gen-cert.sh` is a host
  script. Do not add openssl to the dev image for this.
- Solana RPC 403/429/502 failures do not invalidate hardware addresses. Keep RPC
  behind `/api/solana`, space balance refreshes, and allow individual retries.
- A valid OCMS v1 signature can still be rejected by a dApp that verifies the
  raw WalletConnect message. Check `signedMessage` compatibility before blaming
  WebUSB or firmware.

## Done when
- Docker is healthy and `/trezor-usb` returns HTTP 200.
- Lint, typecheck, full tests, focused OCMS tests, and build pass.
- The intended hardware address/path is displayed from the physical device.
- Every consequential pre-action disclosure states signing status, data shared,
  effect, and agreement before its CTA.
- A real WalletConnect message request receives physical OCMS v1 confirmation,
  exact expected bytes, and a locally verified Ed25519 signature.
- Any remaining WalletConnect incompatibility is identified separately from
  transport, firmware, and signature correctness.
