import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheTimerCache } from '../types'

// Claude Code caches the conversation so far, so each message reads it back instead of sending it
// again. A cache entry lives a fixed time (1 hour or 5 minutes) from the start of the last request
// that read or wrote it, and every request restarts that time; once it lapses, the next message
// writes the whole context to the cache again, at the write price. This counts down to that lapse
// in the prompt footer, before the model name.

const EMPTY: CacheTimerCache = { startedAt: 0, ttlMs: null }
const cache = atom({ plugin: 'cache-timer', key: 'cache' } as const, EMPTY)
// The second the countdown last moved: written each second while it runs, so the footer redraws.
const tick = atom({ plugin: 'cache-timer', key: 'tick' } as const, 0)

// Mid tones, so they read on light and dark footers alike.
const COLORS = { label: '#8A8A8A', warm: '#3E9E6E', warn: '#D08A1E', danger: '#D64545', expired: '#8A8A8A' }

// How often the lifetime is read again once known: it follows the plan, so it rarely changes.
const RECHECK_MS = 10 * 60_000
const lookup = { at: 0, isRunning: false }

// Reads the lifetime from the session's transcript (bin/cache_ttl.py): the newest cache write says.
async function readTtl($: EngineInterface) {
  const t = await $.clock.now()
  const known = (await read($, cache)).ttlMs
  if (lookup.isRunning || (known !== null && t - lookup.at < RECHECK_MS)) return
  lookup.isRunning = true
  lookup.at = t
  try {
    const id = await $.session.id()
    const { exitCode, stdout } = await $.process.run(['python3', `${$.plugin.root}/bin/cache_ttl.py`, id], { timeoutMs: 20_000 })
    const ttlMs = exitCode === 0 ? Number(stdout.trim()) : NaN
    if (ttlMs > 0) await update($, cache, c => (c.ttlMs === ttlMs ? c : { ...c, ttlMs }))
  } catch {
  } finally {
    lookup.isRunning = false
  }
}

// Seconds while the countdown runs; once the entry has expired (and the footer has said so) the
// ticking stops until the next request starts another.
async function tickTimer($: EngineInterface) {
  const c = await read($, cache)
  if (!c.startedAt || !c.ttlMs) return
  const t = await $.clock.now()
  if (t > c.startedAt + c.ttlMs + 2000) return
  const second = t - (t % 1000)
  if ((await read($, tick)) !== second) await update($, tick, () => second)
}

// "59:41", "07:05" for 1-hour entries (two-digit minutes, so the footer keeps its width); "4:59" for 5 minutes.
const fmtClock = (ms: number, ttlMs: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = String(Math.floor(seconds / 60))
  return `${ttlMs >= 600_000 ? minutes.padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`
}

// Green while warm, orange in the last sixth of the entry's life (10 minutes of an hour), red in
// the last thirtieth (2 minutes), grey once expired.
const colorOf = (leftMs: number, ttlMs: number) =>
  leftMs <= 0 ? COLORS.expired : leftMs <= ttlMs / 30 ? COLORS.danger : leftMs <= ttlMs / 6 ? COLORS.warn : COLORS.warm

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(1000, () => void tickTimer($))
    // A resumed session already has cache writes to read the lifetime from.
    void readTtl($)
    return started
  })

  // The main conversation's requests: when each starts, and whether it read or wrote the cache.
  on('turn.step', async function* ($, e, next) {
    const startedAt = e.agentId ? 0 : await $.clock.now()
    const stream = next(e)
    for await (const chunk of stream) yield chunk
    const result = await stream.result
    try {
      const u = result.usage
      if (startedAt > 0 && u && (u.cache_read_input_tokens > 0 || u.cache_creation_input_tokens > 0)) {
        await update($, cache, c => (startedAt > c.startedAt ? { ...c, startedAt } : c))
      }
    } catch {}
    return result
  })

  // By the end of a turn its cache writes are in the transcript.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) void readTtl($)
    return done
  })

  // After /clear the new conversation has no cache entry of its own yet.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, cache, c => ({ ...c, startedAt: 0 }))
    return next(e)
  })

  // The footer's mode labels, then the countdown.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await read($, tick)
    const c = await read($, cache)
    if (!c.startedAt || !c.ttlMs) return next(e)
    const leftMs = c.startedAt + c.ttlMs - (await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {e.props.modes.length > 0 ? <Text dimColor>{`${e.props.modes.join(' & ')} · `}</Text> : null}
        <Text color={COLORS.label}>cache </Text>
        <Text color={colorOf(leftMs, c.ttlMs)} bold={leftMs > 0}>
          {leftMs > 0 ? fmtClock(leftMs, c.ttlMs) : 'expired'}
        </Text>
      </Box>
    )
  })
}
