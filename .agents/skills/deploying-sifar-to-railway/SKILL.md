---
name: deploying-sifar-to-railway
description: >-
  Deploy and verify Sifar on its linked Railway service. Use when asked to
  "deploy Sifar", "ship to Railway", "check the Railway deployment", or debug
  a Railway build, health check, runtime WalletConnect configuration, or
  production startup failure. Covers local gates, the standalone image,
  runtime variables, terminal deployment status, public smoke tests, and logs.
---

# Deploying Sifar to Railway

## When to use

Use this for production deployment or Railway-specific diagnosis from the Sifar
repository root. Also load the shared `use-railway` skill before platform
mutations and follow its current CLI telemetry and context rules. Do not use
this procedure for the local Docker Compose development server.

## Workflow

1. Confirm the working directory and linked target without exposing variables:

   ```bash
   git rev-parse --show-toplevel
   railway status --json
   ```

2. Run the required repository gates:

   ```bash
   docker compose exec -T web node tests/lint-tests.js
   docker compose exec -T web npm run lint
   docker compose exec -T web npm run typecheck
   docker compose exec -T web npm test
   ```

3. Build the same root image Railway uses, then verify its health, public
   runtime config, page response, and non-root UID:

   ```bash
   docker build -t sifar-railway-smoke .
   cid=$(docker run -d --rm -e PORT=8080 \
     -e WALLETCONNECT_PROJECT_ID=runtime-smoke-project \
     -p 127.0.0.1::8080 sifar-railway-smoke)
   port=$(docker port "$cid" 8080/tcp | sed 's/.*://')
   curl --fail "http://127.0.0.1:$port/api/health"
   curl --fail "http://127.0.0.1:$port/api/runtime-config"
   curl --fail "http://127.0.0.1:$port/trezor-usb" >/dev/null
   test "$(docker exec "$cid" id -u)" = 1001
   docker rm -f "$cid"
   ```

4. Ensure the service has `WALLETCONNECT_PROJECT_ID`. If it is missing, set the
   user-provided public ID without triggering an intermediate deploy:

   ```bash
   railway variable set "WALLETCONNECT_PROJECT_ID=<project-id>" --skip-deploys
   ```

   Never expose `SOLANA_RPC` or `SOLANA_RPC_FALLBACKS` through
   `/api/runtime-config`; they remain server-only even when they contain no key.

5. Deploy the repository root and record the deployment ID:

   ```bash
   railway up --detach
   railway deployment list --json
   ```

   Poll until the new deployment reaches terminal `SUCCESS`. A successful
   upload or image build is not a successful deployment.

6. Resolve the service domain, then smoke-test the deployed origin:

   ```bash
   railway domain list --json
   curl --fail "https://<domain>/api/health"
   curl --fail "https://<domain>/api/runtime-config"
   curl --fail "https://<domain>/trezor-usb" >/dev/null
   railway logs
   ```

   Check only that `walletConnectProjectId` is nonempty; do not print its value
   into a report. Search deployment logs for startup errors and HTTP responses
   at or above 400 before declaring the rollout healthy.

## Failure modes

- If `/api/runtime-config` returns a null project ID, set the runtime
  `WALLETCONNECT_PROJECT_ID`; do not solve this by baking a `NEXT_PUBLIC_` value
  into the image.
- If the health check fails, inspect build and deployment logs before retrying.
  Do not repeatedly redeploy unchanged code.
- If production reports missing Next chunks, rebuild from the root standalone
  Dockerfile. Do not share the development server's `.next` directory with a
  production build.
- If the page works but WebUSB is unavailable, verify Chromium and HTTPS. The
  Railway server cannot access USB; the user's browser owns the device.
- If any response or log includes a full RPC URL, stop and remove it: provider
  URLs can contain API keys and only hostnames are safe to report.

## Done when

- All local lint, typecheck, test, image, and container smoke checks pass.
- The latest Railway deployment is terminal `SUCCESS`.
- The public health, runtime-config, and `/trezor-usb` checks pass over HTTPS.
- Runtime logs contain no startup or HTTP error responses.
