#!/bin/sh
# Generate a self-signed certificate for local HTTPS development.
#
# WebUSB and getUserMedia both require a secure context. `localhost` counts as
# one, but a phone reaching this machine over the LAN does not — so testing on
# a real device needs HTTPS even locally.
#
# Run from the repo root (or anywhere; paths are resolved relative to this
# script). openssl runs on the host, not in the container, because the dev
# image does not ship it.
#
#   sh web/scripts/gen-cert.sh
#
# The certificate is self-signed, so the browser will warn once. Accept it and
# the origin becomes a secure context, which is all WebUSB and the camera need.
#
# To cover the address your phone will actually use, pass it in:
#
#   SIFAR_CERT_IPS="192.168.1.42" sh web/scripts/gen-cert.sh
#
# Extra hostnames work the same way:
#
#   SIFAR_CERT_HOSTS="sifar.local" sh web/scripts/gen-cert.sh
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CERT_DIR="$SCRIPT_DIR/../certificates"
mkdir -p "$CERT_DIR"

KEY="$CERT_DIR/localhost-key.pem"
CRT="$CERT_DIR/localhost.pem"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found. Install it, or generate the pair elsewhere and place" >&2
  echo "localhost-key.pem and localhost.pem in $CERT_DIR" >&2
  exit 1
fi

# Every non-loopback IPv4 on this machine, so the cert covers however the
# device ends up routing here.
DETECTED_IPS=$(
  { ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; } \
    | grep -v '^127\.' | sort -u
)

ALT="DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:0.0.0.0,IP:::1"

for host in $SIFAR_CERT_HOSTS; do
  ALT="$ALT,DNS:$host"
done

for ip in $DETECTED_IPS $SIFAR_CERT_IPS; do
  ALT="$ALT,IP:$ip"
done

echo "Subject alternative names:"
echo "$ALT" | tr ',' '\n' | sed 's/^/  /'

openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$KEY" -out "$CRT" \
  -subj "/CN=localhost/O=Sifar local development" \
  -addext "subjectAltName=$ALT" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  >/dev/null 2>&1

# The private key must not be world-readable.
chmod 600 "$KEY"
chmod 644 "$CRT"

echo
echo "Wrote:"
echo "  $KEY"
echo "  $CRT"
echo
echo "certificates/ is gitignored — this key is never committed."
echo "Restart the dev server to pick it up: docker compose restart web"
