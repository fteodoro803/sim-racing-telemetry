#!/bin/bash
# Double-click launcher for macOS: runs the bridge without opening a terminal by hand
# and asks for the PS4's IP address instead of making the user type a command line.
#
# 1. Move to this script's own folder, so it finds bridge.py regardless of where it was launched from.
# 2. Check Python 3 is available; there's nothing else to install (README "Run it").
# 3. Ask for the PS4's IP, remembering the last one used in a local, gitignored file.
# 4. Run the bridge, then keep the window open so any error stays visible after it exits.
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is required but wasn't found on this Mac."
    echo "Install it from https://python.org, then double-click this file again."
    read -r -p "Press Enter to close..."
    exit 1
fi

IP_FILE=".bridge-ip"
SAVED_IP=""
[ -f "$IP_FILE" ] && SAVED_IP=$(cat "$IP_FILE")

echo "GT7 Telemetry Bridge"
echo "--------------------"
if [ -n "$SAVED_IP" ]; then
    read -r -p "PS4 IP address [$SAVED_IP]: " IP
    IP="${IP:-$SAVED_IP}"
else
    read -r -p "PS4 IP address (Settings > Network > View Connection Status): " IP
fi

if [ -z "$IP" ]; then
    echo "No IP address entered."
    read -r -p "Press Enter to close..."
    exit 1
fi

echo "$IP" > "$IP_FILE"

python3 bridge.py --ps4-ip "$IP"

echo
read -r -p "The bridge stopped. Press Enter to close this window..."
