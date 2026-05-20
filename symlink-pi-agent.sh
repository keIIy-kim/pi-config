#!/bin/bash
# symlink-pi-agent.sh: dotfiles → ~/.pi/agent symlink 생성
# 주의: 먼저 backup 끝난 후 실행

set -euo pipefail

DOTFILES="$HOME/.config/pi/agent"
AGENT="$HOME/.pi/agent"

echo "Creating symlinks from $DOTFILES to $AGENT..."

symlink_item() {
    local name="$1"
    local src="$DOTFILES/$name"
    local dst="$AGENT/$name"

    if [ -L "$dst" ]; then
        echo "SKIP $name: already symlink"
        return 0
    fi

    if [ -e "$dst" ] || [ -L "$dst" ]; then
        echo "MOVE $name -> $name.bak"
        mv "$dst" "$dst.bak"
    fi

    echo "LINK $name"
    ln -s "$src" "$dst"
}

# 안전한 항목만
symlink_item "extensions"
symlink_item "skills"
symlink_item "themes"
symlink_item "prompts"
symlink_item "APPEND_SYSTEM.md"
symlink_item "settings.json"
symlink_item "models.json"

echo "Done. Check with: ls -la $AGENT"
