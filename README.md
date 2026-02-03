# Sifar — Hardware Wallet Bridge for Solana

A stateless Next.js web app that connects Trezor hardware wallets to Solana dApps via WalletConnect v2. Uses direct WebUSB (no popup/iframe) for secure transaction signing.

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

# Build (requires restart after, conflicts with dev server)
docker compose exec web npx next build
docker compose restart web

# Full test suite (lint + playwright)
docker compose exec web npm test

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
│   ├── walletconnect.ts       # WC v2 wallet
│   ├── signing.ts             # Request → Trezor → Response
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
- **URL State Persistence**: Bookmark URLs restore accounts + modal state
- **Stateless**: No localStorage/cookies, session data in URL hash only
- **Multi-account**: Scan and manage multiple HD accounts

## Environment Variables

```bash
NEXT_PUBLIC_WC_PROJECT_ID    # WalletConnect Cloud project ID
SOLANA_RPC                   # Primary RPC endpoint
SOLANA_RPC_FALLBACKS         # Comma-separated fallback RPCs
```

## Browser Requirements

- Chrome/Edge (WebUSB support required)
- Trezor must be unlocked before connecting
- HTTPS required for WebUSB (dev server uses self-signed cert)

## Security Model

The app is "provably dumb":
- Cannot access private keys (hardware-only)
- Cannot modify transactions (pass-through signing)
- All signing requires physical device confirmation
- Transaction signer derived from TX, not UI state (prevents account mismatch)
