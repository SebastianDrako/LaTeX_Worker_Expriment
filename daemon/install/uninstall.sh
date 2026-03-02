#!/bin/bash
set -e

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: this script must be run as root (sudo bash uninstall.sh)" >&2
    exit 1
fi

systemctl stop latex-daemon || true
systemctl disable latex-daemon || true
rm -f /etc/systemd/system/latex-daemon.service
systemctl daemon-reload
rm -f /usr/local/bin/latex-daemon
echo "latex-daemon removed"
