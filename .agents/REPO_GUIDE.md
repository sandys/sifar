# Sifar — guide for AI agents & humans

> Canonical shared agent context. `AGENTS.md` links to this file; the existing
> large `CLAUDE.md` points here rather than being replaced. Edit shared facts
> here, nowhere else. Reusable procedures live in `.agents/skills/`.

## What this is
Sifar bridges Solana dApps over WalletConnect v2 to a Trezor hardware wallet.
The current focus is a Next.js mobile web app using direct WebUSB with no
Trezor-hosted popup, iframe, or standalone Bridge; a React Native prototype
coexists under `mobile/`. Private keys never leave the device, and signing must
fail closed unless the requested signer and returned signature are verified.

## Commands
- Web setup/run (Docker only): `docker compose up --build -d`; open `http://localhost:3001/trezor-usb`.
- Web build: stop the dev service, run a clean one-off build, then restart: `docker compose stop web && docker compose run --rm -e DEBUG= web sh -lc 'find .next -mindepth 1 -delete 2>/dev/null || true; npm run build' && docker compose up -d web`.
- Web test all: `docker compose exec web npm test` — single unit file: `docker compose exec web npx vitest run lib/solanaOffchainMessage.test.ts`.
- Web lint/typecheck: `docker compose exec web node tests/lint-tests.js && docker compose exec web npm run lint && docker compose exec web npm run typecheck`.
- Web logs/stop: `docker compose logs -f web` / `docker compose down`.
- Mobile setup/test: `cd mobile && npm ci && npm test -- --ci --reporters=default --watchAll=false`.
- Mobile run: from `mobile/`, use `npm run android`, `npm run ios`, or `npm start` in a configured React Native environment.
- Mobile native setup/release: `cd mobile/ios && bundle exec pod install`; Android release: `cd mobile/android && ./gradlew assembleRelease`.
- Doc-sync hook (once per clone): `bash .agents/hooks/pre-commit --install`.

## Architecture
- `web/app/` is the Next.js App Router; `/trezor-usb` is the direct-WebUSB flow and `/api/solana` proxies JSON-RPC.
- `web/app/providers.tsx` wires WalletConnect events, Trezor UI events, console capture, and URL-state restoration.
- `web/components/` owns account, WalletConnect proposal/request, hardware prompt, QR-paste, and debug-terminal UI.
- `web/lib/trezorConnect.ts` is the Connect-like WebUSB client over `@trezor/transport`; `trezor.ts` is its application wrapper.
- `web/lib/trezorMessages.ts` patches the installed protobuf JSON with stable Solana OCMS v1 message definitions.
- `web/lib/signing.ts` validates WalletConnect requests, selects the matching enumerated hardware path, calls Trezor, and responds.
- `web/lib/solanaOffchainMessage.ts` and `solanaMessageSigning.ts` serialize OCMS v1 and verify returned bytes and Ed25519 signatures.
- `web/lib/store.ts` is Zustand UI/runtime state; `walletconnect.ts`, `solana.ts`, and `urlState.ts` own external/session data flows.
- `web/tests/lint-tests.js`, co-located Vitest files, and Playwright cover regressions; real WebUSB tests are opt-in and interactive.
- `mobile/` is the parallel React Native app (`src/`, `__tests__/`, `android/`, `ios/`); `.github/workflows/android.yml` installs Node 20 dependencies, tests, and builds its debug APK.

## Conventions
- Use TypeScript, 2-space indentation, function components, Zustand selectors, and browser-global guards in client components.
- Name components/services and types in `PascalCase`, hooks/functions/variables in `camelCase`, and constants in `UPPER_SNAKE_CASE`.
- Co-locate `*.test.ts(x)` where practical; add a custom guard to `web/tests/lint-tests.js` for recurring architectural regressions.
- For mobile services, aim for at least 80% coverage and prioritize malformed data, chain/signer confusion, disconnect, and lifecycle cases.
- Run custom lints, ESLint, typecheck, unit/full tests, and build before reporting web work complete.
- Use Conventional Commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`); the human decides when to commit.
- PRs should state platform impact and affirm no private-key storage, no transaction modification, hardware-only signing, and chain validation.

## Gotchas & environment notes
- WebUSB requires Chromium, a secure context/localhost, a user gesture for the chooser, and an unlocked device. WSL/Docker serves the site; the browser owns USB and physical confirmations. Do not invoke Windows host commands such as `powershell.exe` from this repo workflow.
- Use only `@trezor/transport` plus `@trezor/protobuf`. `@trezor/connect-web`, `connect.trezor.io`, popup flows, and standalone Trezor Bridge are intentionally excluded.
- Stable Core firmware `2.12.4+` implements OCMS v1: `SolanaSignMessage=906`, nested message field `4`, and `SolanaMessageSignature=907` with `signed_data` field `2`.
- Core `2.12.1`-`2.12.3` used incompatible OCMS v0 bytes field `2`; `missing required field message` from an OCMS v1 request means the displayed firmware version must be checked before debugging transport.
- The published protobuf package can lag firmware. Keep the immutable patch in `trezorMessages.ts`, and round-trip its request/response schema in tests.
- WalletConnect `solana_signMessage` supplies raw base58 bytes, while Trezor signs the OCMS v1 domain-separated envelope. Return and verify `signedMessage`; legacy raw-message-only dApps may reject it.
- Never double-hex protobuf byte fields: decoded Trezor signatures are already hex strings. Verify 64-byte signatures and exact firmware `signed_data` locally.
- Derive transaction/message signing paths from the requested signer and `solanaAccounts`; never sign from a merely selected/default path.
- Balance calls go through `/api/solana`; refresh accounts sequentially with spacing to avoid public-RPC 403/429 responses.
- Account addresses render eagerly while hardware enumeration continues; balance fetching must not block address discovery.
- The stated design is stateless, but current URL restoration uses `sessionStorage` and WalletConnect maintains SDK storage. Do not claim zero browser persistence until that implementation is removed or redesigned.
- Generate `web/package-lock.json` with the Node 20/npm 10 Docker toolchain; newer host npm can produce a lock that fails Docker `npm ci` on optional WASM packages.
- Do not run `next build` while the dev server is using the shared `.next` volume; concurrent writers can leave missing vendor chunks. Stop the service and clean the generated directory first.
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
- Never edit generated `mobile/src/services/hardware/trezor/protos/descriptor.json`; change vendored protos and run `npm run gen:trezor-descriptor`.
- Never discard unrelated worktree changes, run destructive Git commands, commit, push, or amend unless the human explicitly asks.
