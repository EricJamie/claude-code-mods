#!/bin/sh
# Copies the Grok Build status line into ~/.grok/statusline/. Run it again after pulling changes.
# Then point Grok at it in ~/.grok/config.toml (read at startup, so restart Grok afterwards):
#
#   [ui.status_line]
#   type = "command"
#   command = "~/.grok/statusline/context_band.py"
#   refresh_interval = 60
set -e
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.grok/statusline"
cp "$here/context_band.py" "$HOME/.grok/statusline/context_band.py"
chmod +x "$HOME/.grok/statusline/context_band.py"
echo "Installed $HOME/.grok/statusline/context_band.py"
