#!/usr/bin/env python3
"""context-band for Grok Build: a status line with the weekly usage limit, tokens in and out,
output speed, cached tokens and hit rate, the session's cost at API prices, and how full the
context window is.

Grok pipes the session's status JSON to this script on stdin and shows what it prints in the
status row (`[ui.status_line]`, `type = "command"`). Most figures come from that JSON. Two do not,
and are read from Grok's own log, ~/.grok/logs/unified.jsonl:

- output speed: the newest `shell.turn.inference_done` line for this session (`tokens_per_sec`);
- the weekly limit: the newest `billing: fetched credits config` line. Grok writes it only when it
  fetches its billing data, so it can be hours or days old; the band says how old when it is.

The log is internal and undocumented, so either figure can go missing in a later Grok, and the band
then leaves it out. It is read incrementally: each run reads only what was added since the last,
keeping its place and the figures it found in ~/.cache/context-band/grok-log.json.

Colours are the terminal's own 16 ANSI colours, so the band follows its light or dark theme.
"""
import json
import os
import sys
import tempfile
import time
from datetime import datetime

LOG = os.path.expanduser('~/.grok/logs/unified.jsonl')
STATE = os.path.expanduser('~/.cache/context-band/grok-log.json')
STALE_S = 6 * 3600  # a weekly reading older than this shows the day it was taken

RESET, BOLD, DIM = '\033[0m', '\033[1m', '\033[2m'
FG = {'red': 31, 'green': 32, 'yellow': 33, 'blue': 34, 'magenta': 35, 'cyan': 36, 'grey': 90}


def paint(text, color=None, bold=False, dim=False):
    codes = ([str(FG[color])] if color else []) + (['1'] if bold else []) + (['2'] if dim else [])
    return f"\033[{';'.join(codes)}m{text}{RESET}" if codes else text


def parse_ts(stamp):
    try:
        return datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def load_state():
    try:
        with open(STATE) as fh:
            state = json.load(fh)
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(STATE), suffix='.tmp')
    with os.fdopen(fd, 'w') as fh:
        json.dump(state, fh, separators=(',', ':'))
    os.replace(tmp, STATE)  # atomic, so sessions running at once never read half a file


def read_log(state):
    """Folds the lines added to the log since the last run into the state: each session's newest
    output speed, and the newest weekly-limit reading."""
    try:
        info = os.stat(LOG)
    except OSError:
        return state
    offset = state.get('offset', 0)
    if state.get('inode') != info.st_ino or offset > info.st_size:
        offset = 0  # a new or rotated log
    if offset == info.st_size:
        return state
    with open(LOG, 'rb') as fh:
        fh.seek(offset)
        data = fh.read()
    end = data.rfind(b'\n') + 1  # a line still being written waits for the next run
    speeds = state.get('speeds', {})
    for line in data[:end].split(b'\n'):
        if b'"shell.turn.inference_done"' in line:
            try:
                row = json.loads(line)
                tps = row['ctx'].get('tokens_per_sec')
                if row.get('sid') and isinstance(tps, (int, float)) and tps > 0:
                    speeds[row['sid']] = [parse_ts(row.get('ts')) or 0, tps]
            except (ValueError, KeyError, TypeError, AttributeError):
                pass
        elif b'billing: fetched credits config' in line:
            try:
                row = json.loads(line)
                config = row['ctx']['config']
                period = config.get('currentPeriod') or {}
                state['weekly'] = {'pct': float(config['creditUsagePercent']), 'end': parse_ts(period.get('end')),
                                   'at': parse_ts(row.get('ts')), 'tier': row['ctx'].get('subscriptionTier')}
            except (ValueError, KeyError, TypeError):
                pass
    state['speeds'] = dict(sorted(speeds.items(), key=lambda kv: kv[1][0])[-50:])
    state.update(inode=info.st_ino, offset=offset + end)
    return state


def fmt_tokens(n):
    """Three significant figures: 950, 4.20k, 31.4k, 550k, 1.20M."""
    for div, suffix in ((1e9, 'B'), (1e6, 'M'), (1e3, 'k')):
        if n >= div:
            x = n / div
            return f"{x:.2f}{suffix}" if x < 10 else f"{x:.1f}{suffix}" if x < 100 else f"{x:.0f}{suffix}"
    return str(round(n))


def fmt_left(seconds):
    minutes = max(0, int(-(-seconds // 60)))
    days, hours, mins = minutes // 1440, minutes % 1440 // 60, minutes % 60
    return f"{days}d{hours}h" if days else f"{hours}h{mins}m" if hours else f"{mins}m"


def level(pct):
    return 'red' if pct >= 85 else 'yellow' if pct >= 60 else None


class Item:
    """One figure in the band: a label, its value and an optional detail, and how readily it gives
    way when the row runs short (larger gives way first; the detail before the whole item)."""

    def __init__(self, icon, label, value, color, priority, sub=None, sub_priority=None, value_color=None, value_bold=False):
        self.icon, self.label, self.value, self.color = icon, label, value, color
        self.priority, self.sub, self.sub_priority = priority, sub, sub_priority
        self.value_color, self.value_bold = value_color, value_bold

    def width(self):
        parts = [p for p in (self.icon, self.label, self.value) if p]
        return len(' '.join(parts)) + (len(self.sub) + 3 if self.sub else 0)

    def render(self):
        head = ' '.join(paint(p, self.color) for p in (self.icon, self.label) if p)
        text = f"{head} {paint(self.value, self.value_color, self.value_bold)}" if head else paint(self.value, self.value_color, self.value_bold)
        return text + (paint(' │ ', 'grey') + paint(self.sub, dim=True) if self.sub else '')


def fit(items, columns, gap=3):
    """Keeps the band on one line: drops a detail, then a whole item, least important first."""
    items = list(items)
    total = lambda: sum(i.width() for i in items) + gap * max(0, len(items) - 1)
    while items and total() > columns:
        worst = max(((i.sub_priority, True, n) for n, i in enumerate(items) if i.sub and i.sub_priority is not None),
                    default=(-1, False, 0))
        whole = max(((i.priority, False, n) for n, i in enumerate(items)), default=(-1, False, 0))
        rank, is_sub, n = max(worst, whole)
        if is_sub:
            items[n].sub = None
        else:
            items.pop(n)
    return items


def band(payload, state, now):
    items = []
    weekly = state.get('weekly')
    if weekly and weekly.get('end') and weekly['end'] > now:
        old = weekly.get('at') and now - weekly['at'] > STALE_S
        sub = fmt_left(weekly['end'] - now) + (f" ({datetime.fromtimestamp(weekly['at']):%b %-d})" if old else '')
        items.append(Item('▦', '7d', f"{weekly['pct']:.0f}%", 'magenta', 4, sub, 6.5, level(weekly['pct']), True))
    ctx = payload.get('context_window') or {}
    use = ctx.get('session_usage') or {}
    if use:
        items.append(Item(None, 'in', fmt_tokens(use.get('input_tokens') or 0), 'red', 10))
        items.append(Item(None, 'out', fmt_tokens(use.get('output_tokens') or 0), 'green', 8))
    speed = (state.get('speeds') or {}).get(payload.get('session_id') or '')
    if speed:
        items.append(Item('ϟ', None, f"{round(speed[1])} t/s", 'cyan', 5.5))
    if use:
        cached = (use.get('cache_read_input_tokens') or 0) + (use.get('cache_creation_input_tokens') or 0)
        prompt = ctx.get('session_input_tokens') or ((use.get('input_tokens') or 0) + cached)
        hit = f"{round(100 * (use.get('cache_read_input_tokens') or 0) / prompt)}% hit" if prompt else None
        items.append(Item(None, 'cache', fmt_tokens(cached), 'blue', 9, hit, 18))
    cost = (payload.get('cost') or {}).get('total_cost_usd')
    if isinstance(cost, (int, float)):
        items.append(Item('$', None, f"${cost:.2f}", 'yellow', 5))
    pct = ctx.get('used_percentage')
    if isinstance(pct, (int, float)):
        sub = f"{fmt_tokens(ctx['context_tokens'])}/{fmt_tokens(ctx['context_window_size'])}" if ctx.get('context_tokens') is not None and ctx.get('context_window_size') else None
        items.append(Item('▤', 'ctx', f"{pct:.0f}%", 'grey', 2, sub, 15, level(pct), True))
    return items


def main():
    try:
        payload = json.loads(sys.stdin.read() or '{}')
    except ValueError:
        payload = {}
    state = load_state()
    before = (state.get('inode'), state.get('offset'))
    state = read_log(state)
    if (state.get('inode'), state.get('offset')) != before:
        try:
            save_state(state)
        except OSError:
            pass
    try:
        columns = int(os.environ.get('COLUMNS') or 120)
    except ValueError:
        columns = 120
    items = fit(band(payload, state, time.time()), columns)
    if items:
        print('   '.join(i.render() for i in items))


if __name__ == '__main__':
    main()
