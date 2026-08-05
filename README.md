# Sifar — Hardware Wallet Bridge for Solana

A Next.js web app that connects Trezor hardware wallets to Solana dApps via WalletConnect v2. It uses direct WebUSB (no popup/iframe) for hardware transaction and Solana off-chain message signing.

## Quick Start (Docker)

```bash
docker compose up -d
```

Open http://localhost:3001

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

## Architecture

```
web/
├── app/
│   ├── api/solana/route.ts    # RPC proxy with fallbacks
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Main WalletConnect page
│   ├── providers.tsx          # WC + Trezor event wiring + URL state restore
│   ├── trezor-usb/            # Direct WebUSB page
│   └── trezor-test/           # Test harness
├── components/
│   ├── WalletConnectModal.tsx # Session + signing UI
│   ├── WalletDisplay.tsx      # Account list + pagination
│   ├── TrezorPrompt.tsx       # PIN/passphrase prompts
│   ├── DebugPanel.tsx         # Console capture
│   └── ui/                    # Primitives
├── lib/
│   ├── trezorConnect.ts       # WebUSB Trezor client
│   ├── trezorMessages.ts      # Stable-firmware protobuf definitions
│   ├── walletconnect.ts       # WC v2 wallet
│   ├── signing.ts             # Request → Trezor → Response
│   ├── solanaOffchainMessage.ts # Canonical OCMS v1 codec
│   ├── solanaMessageSigning.ts  # signed_data + Ed25519 verification
│   ├── walletConnectSolanaMessage.ts # WC signer/message validation
│   ├── solana.ts              # Balance/token queries
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
NEXT_PUBLIC_WC_PROJECT_ID    # WalletConnect Cloud project ID
SOLANA_RPC                   # Primary RPC endpoint
SOLANA_RPC_FALLBACKS         # Comma-separated fallback RPCs
```

## Browser Requirements

- Chrome/Edge (WebUSB support required)
- Trezor must be unlocked before connecting
- Current stable Core firmware (`2.12.4+`) is required for OCMS v1 message signing
- HTTPS required for WebUSB outside localhost; Docker development uses Chrome's localhost secure-context exception

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
