# Sifar — guide for AI agents & humans

> Canonical shared agent context. `AGENTS.md` links to this file; the existing
> large `CLAUDE.md` points here rather than being replaced. Edit shared facts
> here, nowhere else. Reusable procedures live in `.agents/skills/`.

## What this is
Sifar bridges Solana dApps over WalletConnect v2 to a Trezor hardware wallet.
It is a Next.js web app using direct WebUSB with no Trezor-hosted popup,
iframe, or standalone Bridge. `web/` is the whole product. Private keys never
leave the device, and signing must fail closed unless the requested signer and
returned signature are verified.

## Commands
- Web setup/run (Docker only): `docker compose up --build -d`; open `http://localhost:3001/trezor-usb`.
- Web build: stop the dev service, run a clean one-off build, then restart: `docker compose stop web && docker compose run --rm -e DEBUG= web sh -lc 'find .next -mindepth 1 -delete 2>/dev/null || true; npm run build' && docker compose up -d web`.
- Web test all: `docker compose exec web npm test` — single unit file: `docker compose exec web npx vitest run lib/solanaOffchainMessage.test.ts`.
- Web lint/typecheck: `docker compose exec web node tests/lint-tests.js && docker compose exec web npm run lint && docker compose exec web npm run typecheck`.
- Web logs/stop: `docker compose logs -f web` / `docker compose down`.
- Production image: `docker build -t sifar-railway-smoke .`; deploy the linked service with `railway up --detach`, then inspect `railway logs`.
- Local HTTPS (needed to test on a phone): `SIFAR_CERT_IPS="<lan ip>" sh web/scripts/gen-cert.sh && docker compose restart web`. openssl runs on the host; the dev image has none.
- Doc-sync hook (once per clone): `bash .agents/hooks/pre-commit --install`.

## Architecture
- `web/app/` is the Next.js App Router; `/trezor-usb` is the direct-WebUSB flow and `/api/solana` proxies JSON-RPC.
- Root `Dockerfile` emits a non-root Next standalone image; `railway.json` owns Railway's Dockerfile build, V2 runtime, `/api/health` gate, and restart policy.
- `/api/runtime-config` exposes only the public WalletConnect project ID at runtime; RPC endpoints and credentials stay server-side.
- `web/app/providers.tsx` wires WalletConnect events, Trezor UI events, console capture, and URL-state restoration.
- `web/components/` owns account, action-disclosure, WalletConnect proposal/request, hardware prompt, QR-paste, and debug-terminal UI.
- `web/lib/trezorConnect.ts` is the Connect-like WebUSB client over `@trezor/transport`; `trezor.ts` is its application wrapper.
- `web/lib/deviceSession.ts` is the arbiter: one FIFO runner (`runDeviceOperation`) through which every logical device op flows, plus observable device state. Normal ops share firmware auth; only `shutdownDeviceSession` ends and locks.
- `web/lib/trezorMessages.ts` patches the installed protobuf JSON with stable Solana OCMS v1 message definitions.
- `web/lib/signing.ts` validates WalletConnect requests, selects the matching enumerated hardware path, calls Trezor, and responds.
- `web/lib/solanaOffchainMessage.ts` and `solanaMessageSigning.ts` serialize OCMS v1 and verify returned bytes and Ed25519 signatures.
- `web/lib/store.ts` is Zustand UI/runtime state; `walletconnect.ts`, `solana.ts`, and `urlState.ts` own external/session data flows.
- `web/tests/lint-tests.js`, co-located Vitest files, and Playwright cover regressions; real WebUSB tests are opt-in and interactive.
- `/trezor-usb` is the only flow; `/` redirects to it. There is no CI workflow.

## Conventions
- Use TypeScript, 2-space indentation, function components, Zustand selectors, and browser-global guards in client components.
- Name components/services and types in `PascalCase`, hooks/functions/variables in `camelCase`, and constants in `UPPER_SNAKE_CASE`.
- Co-locate `*.test.ts(x)` where practical; add a custom guard to `web/tests/lint-tests.js` for recurring architectural regressions.
- Run custom lints, ESLint, typecheck, unit/full tests, and build before reporting web work complete.
- Use Conventional Commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`); the human decides when to commit.
- PRs should affirm no private-key storage, no transaction modification, hardware-only signing, and chain validation.

## Gotchas & environment notes
- `scripts/dev.sh` serves HTTPS when `web/certificates/` holds a key pair and plain HTTP otherwise — never both, so an `http://` URL looks dead once a certificate exists. `web/certificates/` is gitignored; never commit the key.
- WebUSB *and* `getUserMedia` need a secure context. `localhost` qualifies; a LAN address does not, so phone testing requires the certificate above plus accepting the self-signed warning once.
- On WSL2 in NAT mode, LAN clients cannot reach the dev server at all: Windows forwards `localhost` only. It needs an elevated `netsh` portproxy *and* an inbound firewall rule, and WSL's IP changes on every restart. `networkingMode=mirrored` in `.wslconfig` avoids both. Hand these commands to the human rather than running Windows binaries.
- WebUSB requires Chromium, a secure context/localhost, a user gesture for the chooser, and an unlocked device. WSL/Docker serves the site; the browser owns USB and physical confirmations. Do not invoke Windows host commands such as `powershell.exe` from this repo workflow.
- Use only `@trezor/transport` plus `@trezor/protobuf`. `@trezor/connect-web`, `connect.trezor.io`, popup flows, and standalone Trezor Bridge are intentionally excluded.
- Stable Core firmware `2.12.4+` implements OCMS v1: `SolanaSignMessage=906`, nested message field `4`, and `SolanaMessageSignature=907` with `signed_data` field `2`.
- Core `2.12.1`-`2.12.3` used incompatible OCMS v0 bytes field `2`; `missing required field message` from an OCMS v1 request means the displayed firmware version must be checked before debugging transport.
- The published protobuf package can lag firmware. Keep the immutable patch in `trezorMessages.ts`, and round-trip its request/response schema in tests.
- `@trezor/protobuf` rewrites typographic quotes (`‘` `’`) to ASCII in every string field, so the device would sign different bytes than requested. Reject such messages up front rather than normalizing them.
- `Initialize` answers with `Features` by design; treating that as an interrupted call re-sends `Initialize` and raises a spurious `Unexpected response: Features`.
- `ensureSession` runs again after every transport-session drop (auto-lock, another tab stealing the device, `cancel()`), but the transport outlives all of them. Pair each `deviceEvents.on` with a `deviceEvents.off` through the single `deviceEventBinding`, or listeners accumulate one per re-acquire for the lifetime of the tab.
- A specific device-failure prompt must survive the generic handler. `ui-invalid_pin` (Failure code 7) sets `specificUiEmitted`, which suppresses both the catch-all `ui-error` and the `ui-close_window` in `finally`; without it the reason was overwritten, and during enumeration dismissed entirely.
- Memoize the in-flight promise for every lazy singleton (`initTrezor`, `TrezorConnect.init`, `initWalletConnect`). A boolean set after the awaits lets concurrent callers each build a transport/wallet, and the loser keeps listening while the winner is used.
- `ui-close_window` must not fire while a prompt is pending: enumeration queues many calls, and one completing would dismiss a live PIN/passphrase dialog while the device still waits for the answer, blanking the UI until the next Connect.
- Preserve `Features.session_id` only in memory and pass it back to `Initialize`; this reuses firmware's cached seed so repeated operations do not invent PIN/passphrase gates. Browser passphrase entry is primary, `Use No Passphrase` is explicit, and on-device entry appears only with `Capability_PassphraseEntry`; legacy `_on_device` and passphrase-state handshakes still need acknowledgements. Never log passphrase values, lengths, or session IDs.
- Every logical device operation goes through `runDeviceOperation`; never call the device directly from a component. Enumeration is `exclusive:false` (preemptible), signing and address-confirm are `exclusive:true` (they preempt a running scan). Do not restore per-operation locking: explicit Disconnect alone sends `EndSession` + `LockDevice` and disposes transport.
- Never call `runDeviceOperation` from inside another op's fn: single-flight FIFO deadlocks. Fire-and-forget reads inside an op (e.g. `getTrezorDeviceInfo` during enumeration) stay raw calls, serialized by the wire queue.
- `requestWebUSBDevice()` must be the first await in the Connect click and must never be wrapped in an op — Chrome needs it inside the user-activation window.
- Connect/re-scan, first-time account verification, WalletConnect pairing, session approval, and every signing request show an action disclosure before their CTA. It must say whether signing occurs, what happens, what is shared, and what continuing means; balance refresh, ping, and navigation do not need one.
- WalletConnect `solana_signMessage` supplies raw base58 bytes, while Trezor signs the OCMS v1 domain-separated envelope. Return and verify `signedMessage`; legacy raw-message-only dApps may reject it.
- Every WalletConnect request must end in a response or a rejection. Clear `pendingRequest` in `finally`, reject on signing failure, and clean up on `session_delete`/`session_request_expire`, or the dApp hangs until expiry.
- Only one request may be staged at a time. `setPendingRequest` overwrites, so `handleSessionRequest` rejects a newcomer with `WC_ERROR_REQUEST_PENDING` (`-32002`) while one is awaiting approval; without that the staged request vanished from the UI while its dApp stayed blocked on an id nothing would answer.
- Error codes returned to dApps must describe what happened. `4001` means the user declined; a broadcast failure after signing uses `WC_ERROR_TRANSACTION_FAILED` (`-32003`) because the user approved and the transaction may still confirm. When signing code answers the dApp itself, it throws `RequestAnsweredError` so the UI catch-all does not overwrite that response with `4001`.
- `ProposalSheet` must only reject a proposal when `approveSession` itself failed. A throw in the local bookkeeping after approval used to reject an already-approved session, leaving a live session absent from the store and impossible to disconnect.
- Register WC event handlers via `onWalletConnectReady`, not inside a one-shot init: the wallet is also created lazily by `pairWithDApp` when a Project ID is entered at runtime, and a wallet with no listeners silently swallows every proposal.
- Session topics and pairing topics are separate keychains; ping the one the topic belongs to. The store can also outlive an SDK session, so disconnect must tolerate a missing session and still drop it locally, or the row can never be cleared.
- Never double-hex protobuf byte fields: decoded Trezor signatures are already hex strings. Verify 64-byte signatures and exact firmware `signed_data` locally.
- Resolve signing paths from the transaction/message itself and require the signer to equal the requesting session's approved address; never sign from a selected/default path, and never look the signer up across all enumerated accounts. `signing.ts` centralizes this in `resolveTransactionSigner`; `lint-tests.js` enforces it per function, not per file.
- A locally computed signature check must gate the response: `VersionedTransaction.addSignature`/`serialize` verify nothing, so an unverified signature would otherwise reach the dApp.
- Balance calls go through `/api/solana`; refresh accounts sequentially with spacing to avoid public-RPC 403/429 responses. Provider URLs carry API keys, so both the proxy and the client helper in `solana.ts` must log the host only (`safeLabel`), never the URL — console output is captured into the in-app debug log users are invited to paste. A re-scan must supersede the previous refresh loop via the generation ref, or two loops halve the effective spacing.
- WebUSB *and* `getUserMedia` need a secure context, and `QrScanner` releases the camera when the tab hides. Pair that with a `paused` state and a resume path: `stop()` leaves the video element mounted, so without it the user returned to a black frame with a live-looking reticle and no way to recover.
- Railway uses runtime `WALLETCONNECT_PROJECT_ID`; do not require a build-time `NEXT_PUBLIC_` value or expose `SOLANA_RPC` through `/api/runtime-config`.
- `api.mainnet-beta.solana.com` is the public mainnet endpoint; `api.mainnet.solana.com` does not resolve and must not be listed as a fallback.
- Account addresses render eagerly while hardware enumeration continues; balance fetching must not block address discovery.
- The stated design is stateless, but current URL restoration uses `sessionStorage` and WalletConnect maintains SDK storage. Do not claim zero browser persistence until that implementation is removed or redesigned.
- Generate `web/package-lock.json` with the Node 20/npm 10 Docker toolchain; newer host npm can produce a lock that fails Docker `npm ci` on optional WASM packages.
- Do not run `next build` while the dev server is using the shared `.next` volume; concurrent writers can leave missing vendor chunks. Stop the service and clean the generated directory first.
- While the Compose service is running, host `web/.next/` and `web/node_modules/` are live mountpoints for named volumes. Delete them only after `docker compose down -v`; removing either directory from under a running container makes its volume inaccessible.
- `npm test` skips the real-Trezor Playwright case unless explicitly enabled; physical WebUSB verification still requires chooser and device interaction.

## Working rules for agents
- Immediately before **every commit**, and right after any substantial change
  (build/deps/CI/schema files, a new top-level directory, new or renamed
  commands, ~300+ changed lines): run the `syncing-docs-before-commit` skill
  and stage the `.agents/` updates with that commit. The pre-commit hook
  blocks substantial commits that skip this.
- At the end of any session where you solved something non-obvious: run the
  `capturing-session-knowledge` skill.
- Invoke skills with `/skill-name` (Claude Code) or `$skill-name` (Codex);
  Gemini CLI picks them up by description.

## Boundaries
- Never store or log seeds, private keys, passphrases, WalletConnect symmetric keys, RPC credentials, or customer data.
- Never add software/session-key signing fallback, modify a dApp transaction, bypass chain/signer validation, or respond before local verification.
- Never add a Trezor-hosted UI or non-WebUSB transport to the web flow without explicit architectural approval.
- Never discard unrelated worktree changes, run destructive Git commands, commit, push, or amend unless the human explicitly asks.
