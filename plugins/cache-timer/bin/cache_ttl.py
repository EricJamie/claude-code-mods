#!/usr/bin/env python3
"""Prints how long one Claude Code session's main-conversation prompt cache entries live, in
milliseconds: 3600000 for 1-hour entries, 300000 for 5-minute ones. Claude Code writes 1-hour
entries for the main conversation on some plans and 5-minute ones on others, so it is read from
the newest cache write in the session's transcript, scanning back from the end. Prints nothing
when the session has written none yet.

Argument: the session id.
"""
import glob
import json
import os
import sys

CHUNK = 1 << 20
CONFIG = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')


def lines_backwards(path):
    """The file's complete lines, last first, read a chunk at a time from the end."""
    with open(path, 'rb') as fh:
        fh.seek(0, os.SEEK_END)
        pos = fh.tell()
        rest = b''
        while pos > 0:
            step = min(CHUNK, pos)
            pos -= step
            fh.seek(pos)
            parts = (fh.read(step) + rest).split(b'\n')
            rest = parts.pop(0)
            yield from reversed(parts)
        if rest:
            yield rest


def ttl_ms(path):
    for line in lines_backwards(path):
        if b'"cache_creation"' not in line:
            continue
        try:
            created = json.loads(line)['message']['usage']['cache_creation'] or {}
        except (ValueError, KeyError, TypeError):
            continue
        if (created.get('ephemeral_1h_input_tokens') or 0) > 0:
            return 3_600_000
        if (created.get('ephemeral_5m_input_tokens') or 0) > 0:
            return 300_000
    return None


def main():
    session_id = sys.argv[1] if len(sys.argv) > 1 else ''
    paths = glob.glob(os.path.join(CONFIG, 'projects', '*', f'{session_id}.jsonl')) if session_id else []
    if paths:
        found = ttl_ms(max(paths, key=os.path.getmtime))
        if found:
            print(found)


if __name__ == '__main__':
    main()
