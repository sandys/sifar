# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Project Overview

Sifar is a stateless Next.js web app that bridges Trezor hardware wallets to Solana dApps via WalletConnect v2. It uses direct WebUSB for device communication (no popup/iframe).

**Security Model**: The app is "provably dumb" — cannot access private keys, cannot modify transactions. All signing requires physical device confirmation.

## Development (Docker Only)

All commands MUST run through docker compose. Never run npm/node directly on the host.

```bash
# Start dev server
docker compose up -d

# Run lint tests (ALWAYS run before builds)
docker compose exec web node tests/lint-tests.js

# TypeScript check
docker compose exec web npx tsc --noEmit

# Build (run after lint passes, then restart dev server)
docker compose exec web npx next build
docker compose restart web

# Full test suite
docker compose exec web npm test

# Interactive shell
docker compose exec web sh

# View logs
docker compose logs -f web

# Restart / Stop
docker compose restart web
docker compose down
```

**Workflow**: `lint-tests.js` → `tsc --noEmit` → `next build` → `npm test`

## Code Structure

```
web/
├── app/                        # Next.js app router
│   ├── api/solana/route.ts    # RPC proxy with fallbacks
│   ├── providers.tsx          # WC + Trezor wiring + URL state restore
│   └── trezor-usb/            # Main WebUSB page
├── components/
│   ├── WalletConnectModal.tsx # Sessions + signing UI
│   ├── WalletDisplay.tsx      # Account list + balance display
│   └── TrezorPrompt.tsx       # PIN/passphrase/button prompts
├── lib/
│   ├── trezorConnect.ts       # WebUSB Trezor client
│   ├── walletconnect.ts       # WC v2 wallet setup
│   ├── signing.ts             # WC request → Trezor → response
│   ├── store.ts               # Zustand state (in-memory only)
│   └── urlState.ts            # URL hash state persistence
└── tests/
    └── lint-tests.js          # Custom project lints (READ THIS)
```

## Code Rules (Enforced by lint-tests.js)

These rules are automatically enforced. Violations fail the build.

### Zustand Store

```typescript
// BAD - causes render loops
useAppStore()

// GOOD - use selector
useAppStore((state) => state.someField)
```

### Client Components (Hydration)

Files with `'use client'` that use `window` or `navigator` MUST have guards:

```typescript
// Options: typeof check, useEffect, or useLayoutEffect
if (typeof window !== 'undefined') { ... }
// or wrap in useEffect
useEffect(() => { window.something }, [])
```

### Forbidden Imports

```typescript
// NEVER use - we use direct WebUSB, not hosted popup
import '@trezor/connect-web'  // ❌
'connect.trezor.io'           // ❌
```

### Solana RPC

```typescript
// BAD - bypasses proxy
new Connection(DEFAULT_SOLANA_RPC)

// GOOD - use proxy route
new Connection('/api/solana')
```

### Signing Account Mismatch (CRITICAL)

Never use `store.solanaDerivationPath` directly for signing. Extract signer from transaction:

```typescript
// BAD - may sign with wrong account
const path = store.solanaDerivationPath;
signSolanaTransaction(path, ...);

// GOOD - derive from transaction signer
const signerAddress = tx.message.staticAccountKeys[0].toBase58();
const matchingAccount = store.solanaAccounts.find(a => a.address === signerAddress);
signSolanaTransaction(matchingAccount.path, ...);
```

### Trezor Signature Format

`@trezor/protobuf` returns signatures as hex strings. Never double-encode:

```typescript
// BAD - double encoding (produces 256 chars instead of 128)
Buffer.from(response.message.signature).toString('hex')

// GOOD - use directly (already hex string, 128 chars = 64 bytes)
const signatureHex = response.message.signature;
```

### Required Patterns

| File | Must contain |
|------|-------------|
| `providers.tsx` | `__sifarConsolePatched` (console capture) |
| `lib/constants.ts` | `'/api/solana'` (default RPC) |
| `lib/trezorConnect.ts` | `ui-error`, `hadError`, `retriedAfterFeatures`, `signatureHex` |
| `components/TrezorPrompt.tsx` | `ui-error` |
| `lib/walletconnect.ts` | `buildApprovedNamespaces` |
| `lib/signing.ts` | `normalizeSignature`, `staticAccountKeys[0]`, `solanaAccounts.find` |
| `components/WalletConnectModal.tsx` | `solana_signMessage`, `Trezor Hardware Limitation` or `Not Supported` |
| `lib/store.ts` | `NEXT_PUBLIC_WC_PROJECT_ID`, `activeSessions:` |

### Forbidden Patterns

| File | Must NOT contain |
|------|------------------|
| `trezor-usb-client.tsx` | `Promise.all` with `getAllBalances` (causes 429s) |
| Pages | `TransactionPreview`, `SigningFlow` (signing is in modal) |
| `lib/signing.ts` | `sigBytes.length === 128` with `.slice()` |

### UI/UX Rules

- **No ghost buttons** for important actions (Disconnect should be visible)
- **No standalone headers** in pages — merge branding into functional components
- **Error displays** must have dismiss/retry actions
- **Filter UI** must show all options explicitly ("All | Connected", not just badge)
- **No redundant displays** (don't show address separately if accounts are listed)

### Branding

- Console logs: Use `[Sifar]` prefix, not `[Trezor]`
- No Arabic script characters — use Arabic-style fonts for Latin text only

## Security Requirements

1. Never store private keys or seed phrases
2. Never modify transactions (pass-through only)
3. Extract signer from transaction, don't trust UI state
4. Verify signatures locally before sending
5. Fail closed when uncertain

## File Dependencies

```
docker-compose.yml → runs web/scripts/dev.sh
web/scripts/dev.sh → runs npm ci if needed
web/next.config.js → CSP must allow verify.walletconnect.org, pulse.walletconnect.org
web/types/jsqr.d.ts → type shim required
```

## Key Libraries

- `@trezor/transport`, `@trezor/protobuf` — Direct WebUSB, no popup
- `@walletconnect/web3wallet` — WC v2 wallet
- `@solana/web3.js` — Transaction handling
- `zustand` — In-memory state only
- `jsqr` — QR code decoding from pasted images

## CLI Efficiency Guidelines

**Core Principle**: One CLI command > Multiple tool calls

### Essential Commands

1. **Pattern Search**: `rg -n "pattern" --glob '!node_modules/*'` instead of multiple Grep calls
2. **File Finding**: `fd filename` or `fd .ext directory` instead of Glob tool
3. **File Preview**: `bat -n filepath` for syntax-highlighted preview with line numbers
4. **Bulk Refactoring**: `rg -l "pattern" | xargs sed -i 's/old/new/g'` for mass replacements
5. **Project Structure**: `tree -L 2 directories` for quick overview
6. **JSON Inspection**: `jq '.key' file.json` for quick JSON parsing

### The Game-Changing Pattern

```bash
# Find files → Pipe to xargs → Apply sed transformation
rg -l "find_this" | xargs sed -i 's/replace_this/with_this/g'
```

This single pattern can replace dozens of Edit tool calls!

### Mental Note

Before reaching for Read/Edit/Glob tools, ask:
- Can `rg` find this pattern faster?
- Can `fd` locate these files quicker?
- Can `sed` fix all instances at once?
- Can `jq` extract this JSON data directly?

Prioritize CLI power tools for faster code discovery, bulk refactoring, efficient file operations, and better performance overall.
