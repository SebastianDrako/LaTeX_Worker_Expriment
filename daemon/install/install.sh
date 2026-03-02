#!/bin/bash
set -e

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: this script must be run as root (sudo bash install.sh)" >&2
    exit 1
fi

BINARY="./latex-daemon"
INSTALL_DIR="/usr/local/bin"
SERVICE_FILE="/etc/systemd/system/latex-daemon.service"

if [ ! -f "$BINARY" ]; then
    echo "Error: $BINARY not found. Run this script from the directory containing the binary." >&2
    exit 1
fi

install -m 755 "$BINARY" "$INSTALL_DIR/latex-daemon"

cat > "$SERVICE_FILE" << 'EOF'
[Unit]
Description=LaTeX Worker Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/latex-daemon
Restart=always
RestartSec=3
Environment=PORT=7878

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now latex-daemon
echo "latex-daemon installed and started on port 7878"
