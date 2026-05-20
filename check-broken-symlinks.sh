#!/bin/bash
# check-broken-symlinks.sh: 깨진 symlink 감지

AGENT="$HOME/.pi/agent"

echo "Checking broken symlinks in $AGENT..."

broken=$(find "$AGENT" -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null)

if [ -z "$broken" ]; then
    echo "OK: no broken symlinks"
    exit 0
else
    echo "BROKEN SYMLINKS FOUND:"
    echo "$broken" | while IFS= read -r p; do
        printf "  %s -> %s\n" "$(basename "$p")" "$(readlink "$p")"
    done
    exit 1
fi
