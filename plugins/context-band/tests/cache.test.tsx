import { test, expect, mock } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160, scroll: { offset: 0, bodyRows: 20, totalRows: 0 }, view: {} } as never

// The cache pill counts down the main conversation's 1-hour cache entry from the start of the last
// request, turns orange in its last 10 minutes, says "expired" after, and its strip prices both.
test('the cache pill counts down to when the prompt cache lapses', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.id', () => ({ value: 'session-1' }) as never)
  on('session.measure', (_$, e) => ({ changed: [...e.changed] }) as never)
  on('process.run', (_$, e) => {
    const session = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, cacheTtlMs: 3_600_000, cacheModel: 'opus-5-5', cacheWriteUsdPerMTok: 8, cacheReadUsdPerMTok: 0.2 }
    return { value: { exitCode: e.argv[0] === 'python3' ? 0 : 1, stdout: e.argv[0] === 'python3' ? JSON.stringify({ at: NOW, windows: [], usdPerToken: {}, session }) : '', stderr: '' } } as never
  })
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    await clock.advance(4000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hi',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 300, cache_read_input_tokens: 170_000, cache_creation_input_tokens: 7_700, model: 'claude-opus-5-5' },
    } as never
  })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
  for await (const _ of step) void _
  await step.result
  await $.session.measure({
    context: { tokens: 177_700, window: 1_000_000, percent: 18 },
    rateLimits: [],
    cost: { usd: 0.4 },
    changed: ['context', 'cost'],
  } as never)
  await clock.advance(0)

  const pill = async () => {
    const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', component: 'AbovePrompt', props })
    const drawn = JSON.stringify(await ui.find({ key: 'cache' }))
    const whole = JSON.stringify(await ui.find({ type: 'Box' }))
    await ui.unmount()
    return { drawn, whole }
  }
  // The request started at NOW and took 4s: 59:56 left.
  expect((await pill()).drawn).toContain('59:56')
  await clock.advance(50 * 60_000)
  const late = await pill()
  expect(late.drawn).toContain('09:56')
  expect(late.whole).toContain('warm: next message ≈ $0.04')
  expect(late.whole).toContain('after expiry ≈ $1.42')
  await clock.advance(10 * 60_000)
  const gone = await pill()
  expect(gone.drawn).toContain('expired')
  expect(gone.whole).toContain('next message re-caches 177.7k ≈ $1.42')
})
