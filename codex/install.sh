#!/bin/sh
# Installs context-band for Codex: copies the Stop hook to ~/.codex/context-band/ and registers it
# in ~/.codex/hooks.json (backed up first). Run it again after pulling changes. Then approve the
# hook once in Codex (`/hooks`), which asks you to trust new hooks before they run.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dest="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$dest/context-band"
cp "$here/context_band_hook.py" "$dest/context-band/context_band_hook.py"
chmod +x "$dest/context-band/context_band_hook.py"
[ -f "$dest/hooks.json" ] && cp -p "$dest/hooks.json" "$dest/hooks.json.bak-context-band"
python3 - "$dest/hooks.json" "$dest/context-band/context_band_hook.py" <<'PY'
import json, os, sys
path, script = sys.argv[1], sys.argv[2]
d = json.load(open(path)) if os.path.exists(path) else {}
stop = d.setdefault('hooks', {}).setdefault('Stop', [])
cmd = f"python3 '{script}'"
if not any(h.get('command') == cmd for group in stop for h in group.get('hooks', [])):
    stop.append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 20}]})
json.dump(d, open(path, 'w'), indent=2)
PY
echo "Installed $dest/context-band/context_band_hook.py and registered it as a Stop hook."
echo "Open Codex and approve it with /hooks."
