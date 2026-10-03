#!/usr/bin/env python3
"""Estimate what each rate-limit window is worth at API list prices.

Sums the API-equivalent cost of every Claude Code message (from the token usage
the transcripts record) inside each window, and reads the window's % used over
time from the desktop app's plan-usage history when it exists. Prints one JSON
object on stdout.

Argument: one JSON string {"now": ms, "windows": [{"kind", "pct", "resetsAt"}]}.

The figures are account-wide, not per conversation, so every Claude Code session
shares one cache: transcripts only grow, so each file is read from where the
last run stopped, and a run after the first parses only the new lines.
"""
import glob
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime

HOUR = 3600_000
WEEK = 7 * 24 * HOUR
SCAN_DAYS = 15
PROJECTS = os.path.expanduser('~/.claude/projects')
HISTORY = os.path.expanduser('~/Library/Application Support/Claude/plan-usage-history.json')
CACHE = os.path.expanduser('~/.cache/context-band/scan.json')
CACHE_VERSION = 4

# USD per million tokens: input, output, cache read. Cache writes bill 1.25x
# input (5-minute TTL) or 2x input (1-hour TTL); fast mode bills 2x.
PRICES = {
    'claude-fable-5-1': (10, 50, 0.25),
    'claude-mythos-5-1': (10, 50, 0.25),
    'claude-fable-5': (10, 50, 1.00),
    'claude-mythos-5': (10, 50, 1.00),
    'claude-opus-5-5': (4, 20, 0.20),
    'claude-opus-5': (5, 25, 0.50),
    'claude-opus-4-8': (5, 25, 0.50),
    'claude-opus-4-7': (5, 25, 0.50),
    'claude-opus-4-6': (5, 25, 0.50),
    'claude-sonnet-5-5': (2, 10, 0.20),
    'claude-sonnet-5': (2, 10, 0.20),
    'claude-sonnet-4-6': (3, 15, 0.30),
    'claude-haiku-4-5': (1, 5, 0.10),
}
FAMILY = {'fable': 'claude-fable-5-1', 'mythos': 'claude-mythos-5-1', 'opus': 'claude-opus-5-5',
          'sonnet': 'claude-sonnet-5-5', 'haiku': 'claude-haiku-4-5'}
# What a model of a family the table has never seen is priced as, until its price is learned.
BASE = 'claude-opus-5-5'


def price_for(model):
    """(input, output, cache read) per million tokens, and how they were found: "list" when the
    table has this model, "family" when it is priced as its family's current model (a newer
    Opus as Opus 5.5), "unknown" when the family is new too and it is priced as BASE."""
    name = re.sub(r'\[.*\]$', '', model or '')
    name = re.sub(r'-\d{8}$', '', name)
    if name in PRICES:
        return PRICES[name], 'list'
    for family, key in FAMILY.items():
        if family in name:
            return PRICES[key], 'family'
    return PRICES[BASE], 'unknown'


def message_cost(usage, model):
    inp, out, read = price_for(model)[0]
    created = usage.get('cache_creation') or {}
    write_5m = created.get('ephemeral_5m_input_tokens')
    write_1h = created.get('ephemeral_1h_input_tokens')
    if write_5m is None and write_1h is None:
        write_5m, write_1h = usage.get('cache_creation_input_tokens') or 0, 0
    cost = ((usage.get('input_tokens') or 0) * inp
            + (usage.get('output_tokens') or 0) * out
            + (usage.get('cache_read_input_tokens') or 0) * read
            + (write_5m or 0) * inp * 1.25
            + (write_1h or 0) * inp * 2) / 1e6
    return cost * 2 if usage.get('speed') == 'fast' else cost


def parse_ms(stamp):
    try:
        return int(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
    except (ValueError, AttributeError):
        return None


def model_name(model):
    """`claude-opus-5-5-20260101` as `opus-5-5`: the version, without the vendor or the date."""
    return re.sub(r'-\d{8}$', '', re.sub(r'\[.*\]$', '', model or '')).replace('claude-', '')


def parse_lines(data, events):
    """Appends [t, cost, id, model, input, output, cache read, cache write, of which 1-hour writes,
    session id] for each assistant message with usage in a run of JSONL lines; cost is at the
    table's price, which learn_scales corrects for models whose price the table has wrong."""
    for line in data.split(b'\n'):
        if b'"usage"' not in line or b'"assistant"' not in line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        message = row.get('message')
        if not isinstance(message, dict) or not isinstance(message.get('usage'), dict):
            continue
        t = parse_ms(row.get('timestamp') or '')
        cost = message_cost(message['usage'], message.get('model'))
        if t is not None and cost > 0:
            usage = message['usage']
            events.append([t, round(cost, 6), f"{message.get('id')}|{row.get('requestId')}", model_name(message.get('model')),
                           usage.get('input_tokens') or 0, usage.get('output_tokens') or 0,
                           usage.get('cache_read_input_tokens') or 0, usage.get('cache_creation_input_tokens') or 0,
                           (usage.get('cache_creation') or {}).get('ephemeral_1h_input_tokens') or 0,
                           row.get('sessionId') or ''])


def read_file(path, cached):
    """Events of one transcript, reusing the cached part when the file only grew since."""
    size = os.path.getsize(path)
    offset, events = 0, []
    if cached and cached.get('offset', 0) <= size and cached.get('head') is not None:
        with open(path, 'rb') as fh:
            if fh.read(len(cached['head'].encode('latin-1'))).decode('latin-1') == cached['head']:
                offset, events = cached['offset'], list(cached['events'])
    if offset == size:
        return cached
    with open(path, 'rb') as fh:
        fh.seek(offset)
        data = fh.read()
    end = data.rfind(b'\n') + 1  # a line still being written waits for the next run
    parse_lines(data[:end], events)
    with open(path, 'rb') as fh:
        head = fh.read(256).decode('latin-1')
    return {'offset': offset + end, 'head': head, 'events': events}


def load_cache():
    try:
        with open(CACHE) as fh:
            cache = json.load(fh)
        return cache if cache.get('version') == CACHE_VERSION else {}
    except (OSError, ValueError):
        return {}


def save_cache(files):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(CACHE), suffix='.tmp')
    with os.fdopen(fd, 'w') as fh:
        json.dump({'version': CACHE_VERSION, 'files': files}, fh, separators=(',', ':'))
    os.replace(tmp, CACHE)  # atomic, so sessions running at once never read half a file


def scan_spend(now):
    since = now - SCAN_DAYS * 24 * HOUR
    cached = load_cache().get('files') or {}
    files = {}
    reparsed = 0
    for path in glob.glob(os.path.join(PROJECTS, '**', '*.jsonl'), recursive=True):
        try:
            if os.path.getmtime(path) * 1000 < since:
                continue
            entry = read_file(path, cached.get(path))
        except OSError:
            continue
        if entry is not cached.get(path):
            reparsed += 1
        entry['events'] = [e for e in entry['events'] if e[0] >= since]
        files[path] = entry
    if reparsed or set(files) != set(cached):
        save_cache(files)
    seen = set()
    events = []
    for entry in files.values():
        for t, cost, key, *rest in entry['events']:
            if key not in seen:
                seen.add(key)
                events.append((t, cost, *rest))
    events.sort()
    return events, files, reparsed


def usd_per_token(events, now, scales):
    """What a token costs on each model at your own mix: the last seven days' messages (their
    input, output, cache reads and writes) priced as if every one had gone to that model.

    So "how many tokens are left" can be answered per model: the dollars left in a window over
    this. Most of the mix is cache reads, which is why it comes out far below the input price."""
    recent = [e for e in events if e[0] >= now - WEEK] or events
    tokens = sum(tin + tout + read + write for _t, _c, _m, tin, tout, read, write, _w, _s in recent)
    if tokens == 0:
        return {}
    rates = {}
    for model in sorted({e[2] for e in events}):
        usd = sum(
            message_cost({'input_tokens': tin, 'output_tokens': tout, 'cache_read_input_tokens': read,
                          'cache_creation': {'ephemeral_5m_input_tokens': write - w1h, 'ephemeral_1h_input_tokens': w1h}},
                         'claude-' + model)
            for _t, _c, _m, tin, tout, read, write, w1h, _s in recent)
        rates[model] = usd / tokens * scales.get(model, 1.0)
    return rates


def learn_scales(events, session_costs):
    """How far each model's table price is from what Claude Code itself charged, learned from
    sessions whose cost the band recorded (Claude Code's own figure, at current prices).

    Each recorded session's cost should equal the sum over models of (table cost of that model's
    messages in the session) x (that model's scale). Solved by least squares, one model at a time
    until it settles. A model the table prices exactly keeps scale 1 unless the evidence is strong
    and says otherwise (a price change); a model priced from its family or as BASE takes the
    learned scale as soon as there is a little evidence, and is "estimated" until then.

    Returns ({model: scale}, {model: "list" | "learned" | "estimated"})."""
    table = {}
    for t, cost, model, *_rest, session in events:
        record = session_costs.get(session)
        if record and t >= record.get('since', 0) - 60_000:
            table.setdefault(session, {}).setdefault(model, 0.0)
            table[session][model] += cost
    sessions = []
    for session, per_model in table.items():
        total = sum(per_model.values())
        charged = session_costs[session]['usd']
        if total > 0.05 and 0.25 <= charged / total <= 4:
            sessions.append((charged, per_model))
    models = {model for _, per_model in sessions for model in per_model}
    scale = {model: 1.0 for model in models}
    for _ in range(30):
        for model in models:
            num = den = 0.0
            for charged, per_model in sessions:
                if model in per_model:
                    rest = sum(scale[m] * v for m, v in per_model.items() if m != model)
                    num += per_model[model] * (charged - rest)
                    den += per_model[model] ** 2
            if den > 0:
                scale[model] = min(4.0, max(0.25, num / den))
    evidence = {model: sum(per_model.get(model, 0.0) for _, per_model in sessions) for model in models}
    applied, kinds = {}, {}
    for model in sorted({e[2] for e in events}):
        kind = price_for('claude-' + model)[1]
        learned, seen = scale.get(model, 1.0), evidence.get(model, 0.0)
        if kind == 'list':
            if seen >= 5 and abs(learned - 1) > 0.1:
                applied[model], kinds[model] = learned, 'learned'
            else:
                applied[model], kinds[model] = 1.0, 'list'
        elif seen >= 0.5:
            applied[model], kinds[model] = learned, 'learned'
        else:
            applied[model], kinds[model] = 1.0, 'estimated'
    return applied, kinds


def load_history():
    try:
        with open(HISTORY) as fh:
            samples = json.load(fh).get('samples') or []
    except (OSError, ValueError):
        return []
    if not samples:
        return []
    org = samples[-1].get('org')
    return [s for s in samples if s.get('org') == org and isinstance(s.get('u'), dict)]


def spend_between(events, start, end):
    return sum(e[1] for e in events if start <= e[0] < end)


def by_model(events, start, end):
    """API cost and tokens per model inside [start, end), most expensive first."""
    totals = {}
    for t, cost, model, tin, tout, read, write, _write_1h, _session in events:
        if start <= t < end:
            row = totals.setdefault(model, {'model': model, 'usd': 0.0, 'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0})
            row['usd'] += cost
            row['input'] += tin
            row['output'] += tout
            row['cacheRead'] += read
            row['cacheWrite'] += write
    rows = sorted(totals.values(), key=lambda r: -r['usd'])
    for row in rows:
        row['usd'] = round(row['usd'], 4)
    return rows


def cumulative(events, start, bin_ms, bins, until):
    out = []
    total = 0.0
    i = 0
    relevant = [(e[0], e[1]) for e in events if start <= e[0] < start + bin_ms * bins]
    for b in range(bins):
        edge = start + bin_ms * (b + 1)
        if start + bin_ms * b > until:
            break
        while i < len(relevant) and relevant[i][0] < min(edge, until):
            total += relevant[i][1]
            i += 1
        out.append(round(total, 4))
    return out


def estimate(window, events, history, now):
    kind = window.get('kind') or ''
    duration = 5 * HOUR if kind.startswith('five_hour') else WEEK
    field = 'fh' if kind.startswith('five_hour') else 'sd' if kind == 'seven_day' else None
    resets = parse_ms(window.get('resetsAt') or '')
    end = resets if resets else now
    start = end - duration
    bins = 30 if duration == 5 * HOUR else 56
    bin_ms = duration // bins
    pct = float(window.get('pct') or 0)
    spend = spend_between(events, start, now)

    prev_start = start - duration
    prev_spend = spend_between(events, prev_start, start)
    prev_pct = None
    if field:
        values = [s['u'].get(field) for s in history if prev_start <= s.get('t', 0) < start]
        values = [v for v in values if isinstance(v, (int, float))]
        prev_pct = max(values) if values else None

    # The window runs from its reset time back one duration; its own spend over its own %
    # is the estimate. Just after a reset, too little is used to divide by, so the previous
    # window stands in until 2% of this one is.
    prev_rate = prev_spend / prev_pct * 100 if prev_pct and prev_pct >= 2 and prev_spend > 0 else None
    rate, basis = None, None
    if pct >= 2 and spend > 0:
        rate, basis = spend / pct * 100, 'this window'
    elif prev_rate:
        rate, basis = prev_rate, 'previous window'

    return {
        'kind': kind,
        'startAt': start,
        'endAt': end,
        'binMs': bin_ms,
        'bins': cumulative(events, start, bin_ms, bins, now),
        'prevBins': cumulative(events, prev_start, bin_ms, bins, start) if prev_spend > 0 else [],
        'spendUsd': round(spend, 4),
        'pct': pct,
        'prevSpendUsd': round(prev_spend, 4),
        'prevPct': prev_pct,
        'rateUsd': round(rate, 2) if rate else None,
        'prevRateUsd': round(prev_rate, 2) if prev_rate else None,
        'basis': basis,
        'byModel': by_model(events, start, now),
    }


def session_info(events, files, session_id, scales):
    """One session's tokens and requests, so a band loaded partway through a session (a plugin
    installed or reloaded mid-session) starts from what the session has already used; and its main
    conversation's prompt cache: how long an entry lives (Claude Code writes 1-hour entries for the
    main conversation on some plans and 5-minute ones on others; subagents write 5-minute ones) and
    what writing and reading it costs at the model the conversation last used."""
    rows = [e for e in events if session_id and e[8] == session_id]
    info = {'input': sum(e[3] for e in rows), 'output': sum(e[4] for e in rows), 'cacheRead': sum(e[5] for e in rows),
            'cacheWrite': sum(e[6] for e in rows), 'requests': len(rows)}
    main = next((entry for path, entry in files.items() if session_id and os.path.basename(path) == f'{session_id}.jsonl'), None)
    writes = [e for e in (main or {}).get('events', []) if e[7] > 0]
    if writes:
        last = max(writes, key=lambda e: e[0])
        model, is_hour = last[3], last[8] > 0
        inp, _out, read = price_for('claude-' + model)[0]
        scale = scales.get(model, 1.0)
        info.update(cacheTtlMs=HOUR if is_hour else 5 * 60_000, cacheModel=model,
                    cacheWriteUsdPerMTok=round(inp * (2 if is_hour else 1.25) * scale, 4), cacheReadUsdPerMTok=round(read * scale, 4))
    return info


def main():
    began = time.time()
    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    now = int(args.get('now') or time.time() * 1000)
    events, scanned, reparsed = scan_spend(now)
    session_costs = {c['sessionId']: c for c in args.get('sessionCosts') or [] if c.get('sessionId') and c.get('usd')}
    scales, kinds = learn_scales(events, session_costs)
    events = [(e[0], e[1] * scales.get(e[2], 1.0), *e[2:]) for e in events]
    history = load_history()
    windows = [estimate(w, events, history, now) for w in args.get('windows') or []]
    print(json.dumps({'at': now, 'windows': windows, 'usdPerToken': usd_per_token(events, now, scales), 'prices': kinds,
                      'scales': {m: round(v, 3) for m, v in scales.items() if v != 1.0}, 'files': len(scanned), 'reparsed': reparsed, 'messages': len(events),
                      'hasHistory': bool(history), 'session': session_info(events, scanned, args.get('sessionId'), scales),
                      'ms': int((time.time() - began) * 1000)}))


if __name__ == '__main__':
    main()
