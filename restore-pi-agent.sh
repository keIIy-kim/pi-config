#!/bin/bash
# restore-pi-agent.sh: .bak 파일로부터 복구

set -euo pipefail

AGENT="$HOME/.pi/agent"

echo "Restoring from .bak files..."

restore_item() {
    local name="$1"
    local bak="$AGENT/$name.bak"
    local dst="$AGENT/$name"

    if [ -L "$dst" ]; then
        echo "REMOVE symlink $name"
        rm "$dst"
    elif [ -e "$dst" ]; then
        echo "REMOVE $name (non-bak original)"
        rm -rf "$dst"
    fi

    if [ -e "$bak" ]; then
        echo "RESTORE $name from .bak"
        mv "$bak" "$dst"
    else
        echo "WARN: no .bak for $name"
    fi
}

restore_item "extensions"
restore_item "skills"
restore_item "themes"
restore_item "prompts"
restore_item "APPEND_SYSTEM.md"
restore_item "settings.json"
restore_item "models.json"

echo "Done. Check with: ls -la $AGENT"
