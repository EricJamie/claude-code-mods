#!/usr/bin/env python3
"""context-band for Codex: one line after each reply with what Codex's own status line cannot
show: output speed, cached tokens and hit rate, how much of the 5-hour and weekly limits is used
with their reset countdowns, and what the weekly limit is worth at API prices.

Codex runs it as a Stop hook (~/.codex/hooks.json) when a turn ends, in the CLI and the desktop app
alike, and shows its `systemMessage` under the reply (`↳ Hook · …` in the CLI). The message is for
you only: a Stop hook's text reaches the model only when the hook blocks, which this one never does.

Where the figures come from, all local:
- the session's rollout file (`transcript_path`): this turn's `token_usage_record`s (tokens per
  response) and the newest `token_count` (session totals and the rate limits);
- every rollout under ~/.codex/sessions and ~/.codex/archived_sessions from the last 8 days, for the
  weekly estimate: each response priced at OpenAI's API list prices for its model, summed over the
  current weekly window, and divided by the share of the limit used. Read incrementally; the scan
  keeps its place in ~/.cache/context-band/codex-scan.json.

Output speed is output tokens (reasoning included) over the time from the request's input to the
response's end, so it includes the wait for the first token. The weekly estimate assumes the limit
weighs models by API price, and reads low if ChatGPT usage outside Codex counts toward the same
limit. Under 5% used it is marked rough.

Set CONTEXT_BAND_LANG=en in the hook's command for English, and CONTEXT_BAND_DEBUG=<file> to log each
run's input and output there.
"""
import glob
import json
import os
import sys
import tempfile
import time
from datetime import datetime

CODEX = os.environ.get('CODEX_HOME') or os.path.expanduser('~/.codex')
CACHE = os.path.expanduser('~/.cache/context-band/codex-scan.json')
CACHE_VERSION = 1
SCAN_DAYS = 8
WEEK_MIN = 7 * 24 * 60

# USD per million tokens: input, cached input, output (OpenAI API list prices, standard tier, short
# context; Codex's context window is under the 272K long-context line). From
# https://developers.openai.com/api/docs/pricing, 2026-10-04.
PRICES = {
    'gpt-6.1-sol': (2.00, 0.10, 10.00),
    'gpt-6-astra': (10.00, 1.00, 50.00),
    'gpt-6-sol': (2.00, 0.20, 10.00),
    'gpt-6-luna': (0.10, 0.01, 0.50),
    'gpt-5.6-sol': (4.00, 0.40, 20.00),
    'gpt-5.5': (5.00, 0.50, 30.00),
    'gpt-5.4-mini': (0.75, 0.075, 4.50),
    'gpt-5.4-nano': (0.20, 0.02, 1.25),
    'gpt-5.3-codex': (1.75, 0.175, 14.00),
    'gpt-5-mini': (0.25, 0.025, 2.00),
    'gpt-5-nano': (0.05, 0.005, 0.40),
}
# A model the table does not list (such as the hidden codex-auto-review) is priced as Codex's
# default workhorse.
FALLBACK = 'gpt-6.1-sol'

ZH = os.environ.get('CONTEXT_BAND_LANG', 'zh').lower() != 'en'
INPUT_TYPES = {'function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'tool_search_output'}


def parse_ts(stamp):
    try:
        return datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def cost(model, inp, cached, out):
    p_in, p_cached, p_out = PRICES.get(model) or PRICES[FALLBACK]
    return (max(0, inp - cached) * p_in + cached * p_cached + out * p_out) / 1e6


def read_lines(path):
    with open(path, 'rb') as fh:
        for line in fh:
            if b'"token_usage_record"' in line or b'"token_count"' in line or b'"turn_context"' in line \
                    or b'"response_item"' in line or b'"task_started"' in line:
                yield line


def this_turn(path, turn_id):
    """This turn's responses (output tokens and how long each took, input and cached tokens), and
    the newest token_count in the file."""
    responses, latest, last_input = [], None, None
    for raw in read_lines(path):
        try:
            row = json.loads(raw)
        except ValueError:
            continue
        kind, payload, ts = row.get('type'), row.get('payload') or {}, parse_ts(row.get('timestamp'))
        if kind == 'response_item':
            ptype = payload.get('type')
            if ptype in INPUT_TYPES or (ptype == 'message' and payload.get('role') in ('user', 'developer')):
                last_input = ts
        elif kind == 'event_msg' and payload.get('type') == 'task_started':
            last_input = ts
        elif kind == 'event_msg' and payload.get('type') == 'token_count':
            latest = payload
        elif kind == 'token_usage_record':
            usage = payload.get('usage') or {}
            if payload.get('turn_id') == turn_id or (turn_id is None):
                took = ts - last_input if ts and last_input and ts > last_input else None
                responses.append((usage.get('input_tokens') or 0, usage.get('cached_input_tokens') or 0,
                                  usage.get('output_tokens') or 0, took))
            last_input = ts  # the next response's input starts after this one
    return responses, latest


def load_cache():
    try:
        with open(CACHE) as fh:
            cache = json.load(fh)
        return cache if cache.get('version') == CACHE_VERSION else {'version': CACHE_VERSION, 'files': {}}
    except (OSError, ValueError):
        return {'version': CACHE_VERSION, 'files': {}}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(CACHE), suffix='.tmp')
    with os.fdopen(fd, 'w') as fh:
        json.dump(cache, fh, separators=(',', ':'))
    os.replace(tmp, CACHE)  # atomic, so sessions ending at once never read half a file


def scan_responses(now):
    """Every response of the last SCAN_DAYS days: [time, response id, model, input, cached, output],
    reading only what each rollout gained since the last run."""
    since = now - SCAN_DAYS * 86400
    cache = load_cache()
    old, files, changed = cache.get('files', {}), {}, False
    paths = glob.glob(os.path.join(CODEX, 'sessions', '**', 'rollout-*.jsonl'), recursive=True) + \
        glob.glob(os.path.join(CODEX, 'archived_sessions', '**', 'rollout-*.jsonl'), recursive=True)
    for path in paths:
        try:
            info = os.stat(path)
        except OSError:
            continue
        if info.st_mtime < since:
            continue
        entry = old.get(path)
        if not entry or entry.get('offset', 0) > info.st_size:
            entry = {'offset': 0, 'models': {}, 'rows': []}
        if entry['offset'] < info.st_size:
            with open(path, 'rb') as fh:
                fh.seek(entry['offset'])
                data = fh.read()
            end = data.rfind(b'\n') + 1  # a line still being written waits for the next run
            for raw in data[:end].split(b'\n'):
                if b'"turn_context"' in raw:
                    try:
                        payload = json.loads(raw)['payload']
                        if payload.get('turn_id') and payload.get('model'):
                            entry['models'][payload['turn_id']] = payload['model']
                    except (ValueError, KeyError, TypeError):
                        pass
                elif b'"token_usage_record"' in raw:
                    try:
                        row = json.loads(raw)
                        payload, usage = row['payload'], row['payload'].get('usage') or {}
                        entry['rows'].append([parse_ts(row.get('timestamp')) or 0, payload.get('response_id'),
                                              entry['models'].get(payload.get('turn_id')), usage.get('input_tokens') or 0,
                                              usage.get('cached_input_tokens') or 0, usage.get('output_tokens') or 0])
                    except (ValueError, KeyError, TypeError):
                        pass
            entry['offset'] += end
            changed = True
        entry['rows'] = [r for r in entry['rows'] if r[0] >= since]
        files[path] = entry
    if changed or set(files) != set(old):
        try:
            save_cache({'version': CACHE_VERSION, 'files': files})
        except OSError:
            pass
    seen, rows = set(), []
    for entry in files.values():
        for r in entry['rows']:
            if r[1] and r[1] in seen:
                continue
            seen.add(r[1])
            rows.append(r)
    return rows


def fmt_tokens(n):
    for div, suffix in ((1e9, 'B'), (1e6, 'M'), (1e3, 'k')):
        if n >= div:
            x = n / div
            return f"{x:.2f}{suffix}" if x < 10 else f"{x:.1f}{suffix}" if x < 100 else f"{x:.0f}{suffix}"
    return str(round(n))


def fmt_usd(v):
    return f"${v:,.0f}" if v >= 100 else f"${v:.2f}"


def fmt_left(seconds):
    minutes = max(0, int(-(-seconds // 60)))
    days, hours, mins = minutes // 1440, minutes % 1440 // 60, minutes % 60
    return f"{days}d{hours}h" if days else f"{hours}h{mins}m" if hours else f"{mins}m"


def window(limits, minutes, now):
    """The rate-limit window of that length, unless it has reset since the reading (its figures
    then describe a window that is over)."""
    for key in ('primary', 'secondary'):
        w = (limits or {}).get(key)
        if isinstance(w, dict) and w.get('window_minutes') == minutes:
            return w if not w.get('resets_at') or w['resets_at'] > now else None
    return None


def main():
    try:
        hook = json.loads(sys.stdin.read() or '{}')
    except ValueError:
        hook = {}
    path = hook.get('transcript_path')
    if not path or not os.path.exists(path):
        return
    now = time.time()
    responses, latest = this_turn(path, hook.get('turn_id'))
    parts = []

    out_tokens = sum(r[2] for r in responses)
    took = sum(r[3] for r in responses if r[3])
    if out_tokens >= 50 and took > 0:
        parts.append(f"{round(out_tokens / took)} t/s")

    info = (latest or {}).get('info') or {}
    total = info.get('total_token_usage') or {}
    if total.get('input_tokens'):
        hit = round(100 * (total.get('cached_input_tokens') or 0) / total['input_tokens'])
        cached = fmt_tokens(total.get('cached_input_tokens') or 0)
        parts.append(f"缓存 {cached}（命中 {hit}%）" if ZH else f"cache {cached} ({hit}% hit)")

    limits = (latest or {}).get('rate_limits') or {}
    for minutes, zh_label, en_label in ((300, '5h', '5h'), (WEEK_MIN, '周', 'week')):
        w = window(limits, minutes, now)
        if not w or w.get('used_percent') is None:
            continue
        pct = round(w['used_percent'])
        left = fmt_left(w['resets_at'] - now) if w.get('resets_at') else None
        if ZH:
            parts.append(f"{zh_label} {pct}%" + (f"（{left} 后重置）" if left else ''))
        else:
            parts.append(f"{en_label} {pct}%" + (f" (resets in {left})" if left else ''))

    week = window(limits, WEEK_MIN, now)
    if week and week.get('resets_at') and (week.get('used_percent') or 0) >= 1:
        start = week['resets_at'] - WEEK_MIN * 60
        spend = tokens = 0
        for t, _rid, model, inp, cached, out in scan_responses(now):
            if start <= t <= now:
                spend += cost(model, inp, cached, out)
                tokens += inp + out
        if spend > 0:
            share = week['used_percent'] / 100
            rough = week['used_percent'] < 5
            if ZH:
                parts.append(f"周限 ≈ {fmt_usd(spend / share)} · {fmt_tokens(tokens / share)} tokens" + ('（粗估）' if rough else ''))
            else:
                parts.append(f"week ≈ {fmt_usd(spend / share)} · {fmt_tokens(tokens / share)} tokens at API prices" + (' (rough)' if rough else ''))

    message = json.dumps({'systemMessage': ' · '.join(parts)}, ensure_ascii=False) if parts else ''
    if os.environ.get('CONTEXT_BAND_DEBUG'):
        with open(os.environ['CONTEXT_BAND_DEBUG'], 'a') as fh:
            fh.write(json.dumps({'at': now, 'input': {k: hook.get(k) for k in ('hook_event_name', 'session_id', 'turn_id', 'transcript_path', 'model')},
                                 'output': message}, ensure_ascii=False) + '\n')
    if message:
        print(message)


if __name__ == '__main__':
    main()
