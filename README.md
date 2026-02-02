# Vault Bridge V1 — WebUSB Trezor Wallet Bridge

This repo contains a Next.js web app that talks to a Trezor over **direct WebUSB** (no popup/iframe), scans WalletConnect QR codes, and signs Solana transactions on hardware. It is **stateless** by design: no localStorage, no cookies, no persistence.

## Quick start (Docker dev)

```bash
docker compose up -d
```

Open:
```
http://localhost:3001/trezor-usb
```

Logs:
```
docker compose logs -f web
```

## WebUSB flow (manual)

1. Connect Trezor via USB.
2. Unlock device.
3. Click **Connect + List**.
4. Approve WebUSB prompt.
5. Confirm prompts on device.
6. Accounts + balances appear.

## Code structure (web/)

```
web/
├── app/
│   ├── api/solana/route.ts      # Server-side RPC proxy + fallback
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Main WC flow page
│   ├── providers.tsx            # WC + Trezor UI event wiring
│   ├── trezor-usb/              # Direct WebUSB page
│   └── trezor-test/             # Test harness page
├── components/
│   ├── TrezorPrompt.tsx         # PIN/passphrase/button prompts
│   ├── WalletDisplay.tsx        # Accounts + balances + pagination
│   ├── DebugPanel.tsx           # CLI-style console capture + copy
│   ├── Scanner.tsx              # QR scanner
│   └── ui/                      # UI primitives
├── lib/
│   ├── trezorConnect.ts         # Connect-like client over WebUSB
│   ├── trezor.ts                # Trezor helpers (Solana)
│   ├── solana.ts                # Balance/token fetch w/ proxy
│   ├── signing.ts               # WC request -> Trezor sign -> response
│   ├── walletconnect.ts         # WC v2 wallet wiring
│   └── store.ts                 # Zustand in-memory state
└── tests/                        # E2E and fixtures
```

## Solana RPC proxy

The browser uses `/api/solana` (same-origin). The server-side proxy forwards JSON-RPC to:

- `https://api.mainnet.solana.com`
- `https://api.mainnet-beta.solana.com`

Set your own:

```
SOLANA_RPC=https://your-rpc
SOLANA_RPC_FALLBACKS=https://fallback-1,https://fallback-2
```

## Trezor account scanning

Accounts are scanned in batches and paginated in the UI. The scanner stops after a gap of empty accounts (standard wallet gap-limit behavior) or a safety maximum to prevent infinite scanning.

## Notes

- **Chrome required** for WebUSB.
- **Device must be unlocked** before connecting.
- WalletConnect is optional for `/trezor-usb`; it is skipped unless `NEXT_PUBLIC_WC_PROJECT_ID` is set.
