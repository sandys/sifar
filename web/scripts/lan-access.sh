#!/bin/sh
# Print ready-to-paste Windows commands for reaching this WSL2 dev server from
# a phone on the LAN, with the current addresses already substituted in.
#
# WSL2 in NAT mode forwards `localhost` from Windows but not connections from
# other devices, so a phone cannot reach the dev server until Windows forwards
# the port. Those commands need Administrator rights, so they cannot be run
# from here — this prints them filled in, ready to paste.
#
#   sh web/scripts/lan-access.sh                  # detect everything it can
#   sh web/scripts/lan-access.sh 192.168.68.109   # also print the phone URL
#
# The WSL address changes on every restart, which silently breaks a previously
# working port proxy. Re-run this after a reboot to get the current values.
set -e

PORT="${SIFAR_PORT:-3001}"
LAN_IP="${1:-$SIFAR_LAN_IP}"
RULE="Sifar dev $PORT"

WSL_IP=$(ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -z "$WSL_IP" ]; then
  echo "Could not determine the WSL address from eth0." >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ls "$SCRIPT_DIR/../certificates"/*.pem >/dev/null 2>&1; then
  SCHEME=https
  TLS="present — server is serving HTTPS"
else
  SCHEME=http
  TLS="MISSING — run: sh web/scripts/gen-cert.sh"
fi

cat <<EOF
WSL address : $WSL_IP   (changes on every WSL restart)
Port        : $PORT
Certificate : $TLS
EOF

if [ -n "$LAN_IP" ]; then
  echo "Phone URL   : $SCHEME://$LAN_IP:$PORT/trezor-usb"
else
  cat <<'EOF'
Phone URL   : unknown — pass your Windows LAN IP to print it:
                sh web/scripts/lan-access.sh 192.168.1.42
              Find it on Windows with: Get-NetIPAddress -AddressFamily IPv4
              (the Preferred one on your Wi-Fi/Ethernet adapter)
EOF
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────
ENABLE — run in an ELEVATED PowerShell (Run as Administrator)
──────────────────────────────────────────────────────────────────────
netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP
netsh advfirewall firewall add rule name="$RULE" dir=in action=allow protocol=TCP localport=$PORT profile=private

Both are required: the port proxy alone is still dropped inbound.

If Windows classifies your network as Public rather than Private, the rule
above will not apply. Either set the network to Private, or re-run that second
command without \`profile=private\` (which opens the port on every profile).

VERIFY
──────────────────────────────────────────────────────────────────────
netsh interface portproxy show v4tov4

DISABLE — elevated PowerShell, when you are done testing
──────────────────────────────────────────────────────────────────────
netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0
netsh advfirewall firewall delete rule name="$RULE"
netsh interface portproxy show v4tov4

Then, back in WSL, to return the dev server to plain HTTP:
    rm -rf web/certificates/*.pem && docker compose restart web

AFTER A WSL RESTART — the proxy now points at a stale address
──────────────────────────────────────────────────────────────────────
netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0
netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP

(The firewall rule survives; only the proxy target moves. To stop doing this
every reboot, use mirrored networking — see README.md.)
EOF
