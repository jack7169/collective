#!/bin/bash
set -e

# Create data directories (DB, logs, cache all in /data for persistence)
mkdir -p /data/logs /data/cache /data/scan_output

# Handle PUID/PGID for Unraid
PUID=${PUID:-99}
PGID=${PGID:-100}

if [ "$PUID" != "0" ]; then
    # Create group if needed (ignore errors if GID exists)
    getent group "$PGID" >/dev/null 2>&1 || addgroup --gid "$PGID" collective 2>/dev/null || true
    # Create user if needed
    if ! id -u "$PUID" >/dev/null 2>&1; then
        GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
        adduser --uid "$PUID" --ingroup "${GROUP_NAME:-users}" --disabled-password --gecos "" collective 2>/dev/null || true
    fi
    chown -R "$PUID:$PGID" /data
fi

exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
