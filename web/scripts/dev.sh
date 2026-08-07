#!/bin/sh
set -e

if [ ! -d node_modules ] || \
   [ ! -f node_modules/jsqr/package.json ] || \
   [ ! -f node_modules/vitest/package.json ]; then
  npm ci
fi

KEY=certificates/localhost-key.pem
CRT=certificates/localhost.pem

# Serve HTTPS when a local certificate is present.
#
# This is not cosmetic: WebUSB and getUserMedia only run in a secure context.
# `localhost` qualifies on its own, but a phone reaching this machine over the
# LAN does not — so device testing needs TLS even in development.
#
# Generate the pair on the host (the dev image has no openssl):
#   SIFAR_CERT_IPS="<your LAN ip>" sh web/scripts/gen-cert.sh
if [ -f "$KEY" ] && [ -f "$CRT" ]; then
  echo "[dev] HTTPS enabled (certificates/localhost.pem)"
  exec npx next dev \
    --hostname 0.0.0.0 --port 3001 \
    --experimental-https \
    --experimental-https-key "$KEY" \
    --experimental-https-cert "$CRT"
fi

echo "[dev] No certificate found — serving HTTP."
echo "[dev] WebUSB and the camera will only work via localhost."
echo "[dev] For phone testing run: sh web/scripts/gen-cert.sh"
exec npx next dev --hostname 0.0.0.0 --port 3001
