# Sifar — Hardware Wallet Bridge for Solana

A Next.js web app that connects Trezor hardware wallets to Solana dApps via WalletConnect v2. It uses direct WebUSB (no popup/iframe) for hardware transaction and Solana off-chain message signing.

## Quick Start (Docker)

```bash
docker compose up -d
```

Open http://localhost:3001 — or **https**://localhost:3001 if you have generated a
local certificate (see [Testing on a phone](#testing-on-a-phone)). The dev server
serves HTTPS whenever `web/certificates/` contains a key pair, and plain HTTP
otherwise; it does not serve both.

View logs:
```bash
docker compose logs -f web
```

## Development Commands

All commands run through docker compose:

```bash
# Start dev server
docker compose up -d

# Lint tests (custom project-specific lints)
docker compose exec web node tests/lint-tests.js

# TypeScript check
docker compose exec web npx tsc --noEmit

# Build without racing the dev server's shared .next volume
docker compose stop web
docker compose run --rm -e DEBUG= web sh -lc \
  'find .next -mindepth 1 -delete 2>/dev/null || true; npm run build'
docker compose up -d web

# Full test suite (regression lints + Vitest + Playwright)
docker compose exec web npm test

# Stable-firmware protocol unit tests
docker compose exec web npm run test:unit

# Interactive shell
docker compose exec web sh

# View logs
docker compose logs -f web

# Restart
docker compose restart web

# Stop
docker compose down
```

## Railway Deployment

Railway deploys the repository root. `Dockerfile` builds `web/` as a Next.js
standalone server, and `railway.json` selects that image, enables the V2 runtime,
and gates rollout on `/api/health`.

The repository is already linked to the Railway service. Set the public
WalletConnect project ID as a service variable, then deploy from the repository
root:

```bash
railway variable set "WALLETCONNECT_PROJECT_ID=<project-id>" --skip-deploys
railway up --detach
railway logs
```

Railway supplies `PORT` and HTTPS. The image listens on `0.0.0.0` and reads
`WALLETCONNECT_PROJECT_ID` at runtime through `/api/runtime-config`, so changing
the variable does not require baking it into a browser bundle. That endpoint
returns only the public WalletConnect ID; `SOLANA_RPC` and
`SOLANA_RPC_FALLBACKS` remain server-only.

Build and smoke-test the production image locally when changing deploy files:

```bash
docker build -t sifar-railway-smoke .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e WALLETCONNECT_PROJECT_ID=test-project-id \
  sifar-railway-smoke
curl --fail http://localhost:8080/api/health
```

## Architecture

```
Dockerfile                       # Multi-stage standalone production image
railway.json                     # Railway build, health, and restart policy
web/
├── app/
│   ├── api/health/route.ts    # Railway deployment health check
│   ├── api/runtime-config/route.ts # Public runtime WC config
│   ├── api/solana/route.ts    # RPC proxy with fallbacks
│   ├── layout.tsx             # Root layout
│   ├── providers.tsx          # WC + Trezor event wiring + URL state restore
│   └── trezor-usb/            # Direct WebUSB page (/ redirects here)
├── components/
│   ├── WalletConnectModal.tsx # Session + signing UI
│   ├── WalletDisplay.tsx      # Account list + pagination
│   ├── TrezorPrompt.tsx       # PIN/passphrase prompts
│   ├── DebugPanel.tsx         # Console capture
│   └── ui/                    # Primitives
├── lib/
│   ├── trezorConnect.ts       # WebUSB Trezor client
│   ├── deviceSession.ts       # FIFO device-operation arbiter and lifecycle state
│   ├── trezorMessages.ts      # Stable-firmware protobuf definitions
│   ├── walletconnect.ts       # WC v2 wallet
│   ├── signing.ts             # Request → Trezor → Response
│   ├── solanaOffchainMessage.ts # Canonical OCMS v1 codec
│   ├── solanaMessageSigning.ts  # signed_data + Ed25519 verification
│   ├── walletConnectSolanaMessage.ts # WC signer/message validation
│   ├── solana.ts              # Balance/token queries
│   ├── publicRuntimeConfig.ts # Browser runtime config loader
│   ├── store.ts               # Zustand state
│   ├── urlState.ts            # URL hash persistence
│   └── hooks/useUrlState.ts   # URL state hook
└── tests/
    ├── lint-tests.js          # Custom lint rules
    └── trezor-e2e.spec.ts     # Playwright tests
```

## Key Features

- **Direct WebUSB**: No Trezor popup/iframe, direct device communication
- **WalletConnect v2**: Connect any WC-compatible dApp
- **Stable OCMS v1**: Solana messages are confirmed and signed on current stable Core firmware
- **Fail-closed verification**: Firmware `signed_data` and Ed25519 signatures are checked locally before a WalletConnect response
- **URL State Restoration**: Bookmark URLs restore accounts + modal state
- **Persistence gap tracked**: URL restoration currently uses transient `sessionStorage`, while WalletConnect maintains SDK storage
- **Multi-account**: Scan and manage multiple HD accounts

## Stable Trezor Message Signing

The supported baseline is stable Trezor Core firmware `2.12.4+`. The app patches the installed protobuf schema with the firmware definitions for:

- `SolanaSignMessage` (`906`) with `SolanaOffchainMessageV1` in field `4`
- `SolanaMessageSignature` (`907`) with `signature` and `signed_data`

The browser reconstructs the canonical OCMS v1 bytes, requires the WalletConnect signer to match an enumerated hardware account, asks Trezor to sign, compares the returned `signed_data` byte-for-byte, and verifies the Ed25519 signature locally. There is no software/session-key fallback.

WalletConnect currently defines `solana_signMessage` as signing its raw base58-decoded message. OCMS v1 signs a domain-separated envelope instead. The response therefore includes the standard `signature` plus `signedMessage` and `messageVersion` extension fields. Legacy dApps that verify only the raw message may reject an otherwise valid hardware signature.

After connecting a device at `/trezor-usb`, click **Open WalletConnect** (or an
account), paste a fresh WalletConnect QR/URI, approve the proposal, and trigger
the dApp's message request. The pairing URI is a secret connection credential;
it is validated and expiry-checked but is not itself signed. Hardware
confirmation begins only after the dApp sends a signing request.

## Environment Variables

```bash
WALLETCONNECT_PROJECT_ID     # Public WC project ID; preferred on Railway
NEXT_PUBLIC_WC_PROJECT_ID    # Build/dev fallback for the same public ID
SOLANA_RPC                   # Server-only primary RPC endpoint
SOLANA_RPC_FALLBACKS         # Server-only comma-separated fallback RPCs
```

## Browser Requirements

- Chrome/Edge (WebUSB support required)
- Trezor must be unlocked before connecting
- Current stable Core firmware (`2.12.4+`) is required for OCMS v1 message signing
- WebUSB and the camera both require a secure context. `localhost` qualifies on its own; any other address needs HTTPS (see [Testing on a phone](#testing-on-a-phone))
- iOS and iPadOS expose no WebUSB to any browser — they all share Apple's engine, so signing is impossible there. The app detects this and explains it rather than failing at the first click

## Testing on a phone

Android Chrome with the Trezor on a USB-OTG cable is the target device. Two
things must be true, and both fail silently otherwise: the page must be a
secure context, and — on WSL2 — Windows must forward the port into the VM.

Each step below has a matching **turn it off** step. Everything here changes
your machine, not the repo, so none of it is undone by `git checkout`. When you
are finished testing, work through [Turning it all off](#turning-it-all-off).

### 1. HTTPS

`navigator.usb` and `getUserMedia` only run in a secure context. `localhost`
counts as one; `192.168.x.x` does not.

**Enable.** Generate a self-signed certificate covering the address the phone
will use:

```bash
SIFAR_CERT_IPS="192.168.1.42" sh web/scripts/gen-cert.sh
docker compose restart web
```

The script adds this machine's own interfaces automatically alongside anything
in `SIFAR_CERT_IPS`; extra hostnames go in `SIFAR_CERT_HOSTS`. Output lands in
`web/certificates/`, which is gitignored — the private key is never committed.
`web/scripts/dev.sh` picks it up and switches to HTTPS.

On the phone, open the **https://** URL and accept the one-time "not private"
warning (Advanced → Proceed). The origin is then a secure context. Use
`https://`: once a certificate exists the server stops answering plain HTTP, so
an `http://` URL looks like a dead connection rather than redirecting.

**Disable.** Delete the key pair and restart; the server returns to HTTP.

```bash
rm -rf web/certificates/*.pem
docker compose restart web
```

Chrome remembers the certificate exception per origin. To clear it: Android
Settings → Apps → Chrome → Storage → clear site data, or visit the site and use
the padlock → Site settings → Reset permissions.

### 2. Reaching WSL2 from the LAN

Skip this section entirely if you are not on WSL2.

For the commands with your current addresses already filled in — including the
teardown and the post-reboot fix — run:

```bash
sh web/scripts/lan-access.sh 192.168.1.42   # your Windows LAN IP
```

The rest of this section explains what those commands do.

In its default NAT mode WSL2 forwards `localhost` from Windows but **not**
connections from other devices, so the phone cannot reach the dev server at
all. Pick one of the two options below — you do not need both.

#### Option A — port proxy (works today, needs redoing after each restart)

**Enable.** Get the Linux IP, then run both commands in an **elevated**
PowerShell:

```bash
ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1
```

```powershell
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=<WSL_IP>
netsh advfirewall firewall add rule name="Sifar dev 3001" dir=in action=allow protocol=TCP localport=3001 profile=private
```

Both are required. The portproxy alone is still dropped inbound by Windows
Firewall. `profile=private` keeps the port closed on networks marked Public —
but that also means the rule does nothing if Windows has classified the network
you are on as Public. Either change it to Private, or re-add the rule without
`profile=private`, which opens the port on every profile.

Check what is currently configured:

```powershell
netsh interface portproxy show v4tov4
netsh advfirewall firewall show rule name="Sifar dev 3001"
```

**Disable.** Elevated PowerShell:

```powershell
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
netsh advfirewall firewall delete rule name="Sifar dev 3001"
```

WSL2 is assigned a new IP on every restart, so after a reboot the proxy points
at nothing and the phone silently fails again. Delete and re-add it with the
new IP, or use Option B.

#### Option B — mirrored networking (permanent, no port proxy)

Requires Windows 11 22H2+ and WSL 2.0.0+. WSL shares the Windows network
interfaces instead of NAT-ing, so a `0.0.0.0` bind is reachable at the LAN
address directly and the IP stops drifting.

**Enable.** Create or edit `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then, from PowerShell:

```powershell
wsl --shutdown
```

Reopen your WSL terminal. Remove any Option A port proxy first — it is
unnecessary here and only adds a stale path to debug. You may still need the
firewall rule from Option A. Because the interface addresses change, regenerate
the certificate afterwards:

```bash
SIFAR_CERT_IPS="<new lan ip>" sh web/scripts/gen-cert.sh
docker compose restart web
```

**Disable.** Delete the `networkingMode` line from `%USERPROFILE%\.wslconfig`
(or set `networkingMode=nat`), then `wsl --shutdown` and reopen. If the file
contains nothing else, deleting it restores every default.

### Turning it all off

After testing, in order:

```bash
# 1. Back to HTTP
rm -rf web/certificates/*.pem
docker compose restart web
```

```powershell
# 2. Elevated PowerShell — remove the forward and the opened port
netsh interface portproxy delete v4tov4 listenport=3001 listenaddress=0.0.0.0
netsh advfirewall firewall delete rule name="Sifar dev 3001"

# 3. Only if you enabled Option B: drop networkingMode from %USERPROFILE%\.wslconfig
wsl --shutdown
```

Then confirm nothing is left listening:

```powershell
netsh interface portproxy show v4tov4
```

### If the phone still cannot connect

- **Connection refused / timeout, desktop fine** — Windows is not forwarding.
  Re-check the port proxy target against the *current* WSL IP.
- **"Sifar needs a secure connection"** — you reached the server over plain
  HTTP. Generate a certificate and use the `https://` URL.
- **Nothing reachable at all** — a host VPN client. Most capture or block LAN
  traffic; disconnect it and retry.
- **Certificate warning will not let you proceed** — the address is not in the
  certificate. Re-run `gen-cert.sh` with the phone-facing IP in
  `SIFAR_CERT_IPS`.

## Security Model

The app is "provably dumb":
- Cannot access private keys (hardware-only)
- Cannot modify transactions (pass-through signing)
- All signing requires physical device confirmation
- Transaction signer derived from TX, not UI state (prevents account mismatch)
- Message signer must match both the WalletConnect session and an enumerated Trezor path
- Firmware-returned message bytes and signatures are verified before responding

The intended V1 design has no persistence across reloads. The current URL-state
restoration path still uses transient `sessionStorage`, and WalletConnect uses
its SDK storage, so the zero-persistence acceptance criterion is not yet met.
