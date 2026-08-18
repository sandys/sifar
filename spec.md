# Technical Specification: Vault Bridge V1 (Stateless Web Wallet)

## 1. Executive Summary

### 1.1 Project Overview
Build a **Next.js mobile web app** that acts as a WalletConnect v2 wallet. The user opens a dApp (e.g., jup.ag) on desktop, scans a WalletConnect QR code with the mobile site in Chrome on Android, and signs Solana transactions on a **Trezor hardware wallet via direct WebUSB** (USB‑OTG) using `@trezor/transport` + protobuf message handling (no Trezor-hosted iframe/popup).

### 1.2 Core Security Principle
The app is **stateless and “provably dumb.”** It stores nothing (no localStorage, cookies, IndexedDB, or session persistence) and never touches private keys. All signing happens on the Trezor device.

### 1.3 Target Platform
- **Primary**: Android + Chrome only (WebUSB required)
- **Not supported**: iOS (no WebUSB), Android Firefox/Samsung Internet (no WebUSB)

## 2. Architecture Overview

```
Desktop dApp (jup.ag) ── WalletConnect ──> Vault Bridge (mobile web)
                                         │
                                         └─ WebUSB ──> Trezor device
```

- **WalletConnect v2 wallet** on the phone
- **No extension / no native app / no storage**
- **Hardware-only signing**

## 3. Technical Requirements

### 3.1 Core Dependencies
- Next.js 14+ (App Router)
- Tailwind CSS
 - @trezor/transport (WebUSB)
 - @trezor/protobuf (messages.json)
- @walletconnect/core + @walletconnect/web3wallet
- @solana/web3.js v1 + @solana/spl-token
- jsqr (QR decoding from pasted images)
- zustand (no persist middleware)
- bs58

### 3.2 Critical Browser Constraints
- **WebUSB only works in Chromium browsers; Chrome is recommended**
- **Trezor Suite web + WebUSB is only supported in Chrome (including Android)**
- **Camera + WebUSB require HTTPS** (or localhost)

## 4. WalletConnect v2 Implementation

### 4.1 Required Methods
- `solana_signTransaction`
- `solana_signAllTransactions`
- `solana_signMessage`
- `solana_signAndSendTransaction`

### 4.2 Session Flow
1. dApp shows QR
2. Vault Bridge scans QR and explains that pairing is not signing
3. User starts the WalletConnect pairing
4. Vault Bridge shows the requested address, chains, and methods; user approves the session
5. dApp sends signing requests
6. Vault Bridge clearly labels the request as signing (and broadcasting when applicable), shows what is shared, then prompts Trezor
7. Trezor signs and returns signature

## 5. Trezor Integration (Direct WebUSB)

- Use `@trezor/transport` with **WebUsbTransport** and protobuf `messages.json`.
- Call `navigator.usb.requestDevice()` on user gesture to select the Trezor.
- Manage sessions with `transport.init()` → `transport.listen()` → `enumerate()` → `acquire()`.
- Implement the full **UI flow** in‑app:
  - `PinMatrixRequest` → show PIN matrix → `PinMatrixAck`
  - `PassphraseRequest` → browser entry or explicit no-passphrase; offer on-device entry only when `Capability_PassphraseEntry` is present → `PassphraseAck`
  - `ButtonRequest` → show “Confirm on device” → `ButtonAck`
- Preserve the firmware `Features.session_id` in memory and send it on later `Initialize` calls so firmware controls PIN/passphrase lifetime. Do not lock after normal reads, address confirmations, or signatures.
- Explicit Disconnect sends `EndSession`, then `LockDevice`, and disposes WebUSB. It clears the in-memory firmware session ID.
- Support legacy `_on_device` and deprecated passphrase-state acknowledgement handshakes without persisting or logging their state.
- No Trezor-hosted iframe/popup is used anywhere.

### 5.1 Stable Solana Off-Chain Message Signing

- Target stable Trezor Core firmware `2.12.4+` and the OCMS v1 protocol.
- Extend the bundled protobuf JSON locally with the stable firmware schema:
  - `SolanaSignMessage` wire ID `906`; `message` is a required `SolanaOffchainMessageV1` at field `4`.
  - `SolanaMessageSignature` wire ID `907`; response contains `signature` and `signed_data`.
- Decode WalletConnect `solana_signMessage.params.message` as base58 and require valid UTF-8 text.
- Require `params.pubkey` to match the WalletConnect session address and an account/path enumerated from the connected Trezor.
- Reconstruct canonical OCMS v1 bytes locally, compare them byte-for-byte with firmware `signed_data`, and verify the Ed25519 signature before responding.
- Do not use transaction signing or software/session keys as a message-signing fallback.
- Return `signature` plus `signedMessage` and `messageVersion: 1` extension fields. Warn that legacy dApps which verify only the raw WalletConnect message are not OCMS-compatible.

## 6. Stateless Design (Mandatory)

The app **must not** store any state across page reloads. No persistence APIs:
- localStorage
- sessionStorage
- cookies
- IndexedDB
- service-worker caching

Every visit begins fresh:
1. Connect Trezor
2. Fetch address + balances
3. Scan QR
4. Sign
5. Close tab = everything gone

**Current implementation gap:** URL-state restoration still passes temporary
hints through `sessionStorage`, and the WalletConnect SDK maintains its own
storage. V1 does not satisfy this section until both persistence paths are
removed or replaced with a truly in-memory flow.

## 7. Project Structure (web/)

```
web/
├── app/
│   ├── api/
│   │   ├── health/route.ts
│   │   ├── runtime-config/route.ts
│   │   └── solana/route.ts
│   ├── layout.tsx
│   ├── page.tsx
│   ├── trezor-usb/
│   │   ├── page.tsx
│   │   └── trezor-usb-client.tsx
│   ├── globals.css
│   └── providers.tsx
├── components/
│   ├── ActionDisclosure.tsx
│   ├── WalletConnectModal.tsx
│   ├── WalletDisplay.tsx
│   ├── TrezorPrompt.tsx
│   ├── ProposalSheet.tsx
│   ├── SigningSheet.tsx
│   ├── TransactionSummary.tsx
│   ├── DebugPanel.tsx
│   ├── LoadingOverlay.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       └── Sheet.tsx
├── lib/
│   ├── actionDisclosure.ts
│   ├── deviceSession.ts
│   ├── trezor.ts
│   ├── trezorConnect.ts
│   ├── trezorSession.ts
│   ├── trezorMessages.ts
│   ├── walletconnect.ts
│   ├── solana.ts
│   ├── solanaOffchainMessage.ts
│   ├── solanaMessageSigning.ts
│   ├── signing.ts
│   ├── store.ts
│   └── constants.ts
├── public/
│   └── icons/
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## 8. Security Requirements

- **Never store keys or seeds**
- **Never modify transactions**
- **Always fail closed** on unknown methods
- **Disclose every consequential step before its CTA**: connect/re-scan, first-time account verification, WalletConnect pairing, session approval, and every signing request
- Each disclosure must explicitly say **Not signing**, **Will sign**, or **Will sign and broadcast**, what happens, what is shared, and what continuing means
- Address discovery is silent; the newly selected account is displayed and physically verified once per attached/re-scanned session before it can be shared
- Do not force host-side PIN/passphrase gates between operations; follow firmware authentication and always require the device's physical signing confirmation

## 9. Error Handling

| Scenario | User Message | Recovery |
|----------|--------------|----------|
| No WebUSB | Use Chrome on Android | Link to Chrome |
| No camera permission | Allow camera access | Retry |
| Trezor not detected | Connect via USB‑OTG | Retry |
| PIN required | Show PIN matrix | Submit |
| Passphrase required | Explain wallet selection | Browser entry, no passphrase, or capability-gated on-device entry |
| User cancels prompt | “Cancelled” | Return to connect |
| WC pairing fails | QR expired | Rescan |
| Signing rejected | Rejected on device | Return to home |
| Broadcast fails | Network error | Retry |

## 10. Development Commands (web/)

- Install deps: `npm ci`
- Dev: `npm run dev` (uses `next dev --experimental-https`)
- Build: `npm run build`
- Start: `npm run start`
- Typecheck: `npm run typecheck`

## 10.1 Trezor Bridge Deprecation (Policy)

- **Standalone Trezor Bridge is deprecated** and should not be installed for this project.
- The only supported transport in production is **WebUSB** (Chrome/Chromium).
- If a developer previously installed standalone Bridge, remove it to avoid conflicts.

## 11. Environment Variables

```
NEXT_PUBLIC_WC_PROJECT_ID=your_project_id
NEXT_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
```

## 12. Known Limitations (V1)

1. Android + Chrome only
2. WebUSB requires a manual device chooser prompt on first connect
3. Custom UI must handle firmware-driven PIN/passphrase/confirm flows and resume the in-memory firmware session
4. One selected account per WalletConnect session; enumerate supported Trezor account paths eagerly
5. Static token registry
6. No EVM support in V1
7. No persistence by design
8. WalletConnect raw-message verification is not equivalent to OCMS v1 domain-separated signing; legacy dApps may reject message signatures

## 13. Success Criteria

- Can connect to jup.ag via WalletConnect
- Shows correct Solana address + balances
- Receives signing requests
- Signs on Trezor and returns signature
- No persisted data across refresh
