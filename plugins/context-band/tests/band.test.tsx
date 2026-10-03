import { test, expect, mock } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const H = 3600_000

const props = (bodyColumns: number) =>
  ({
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 20, totalRows: 0 },
    view: {},
  }) as never

const ESTIMATE = {
  at: NOW,
  windows: [
    {
      kind: 'seven_day',
      startAt: NOW - 13 * H,
      endAt: NOW + (6 * 24 + 11) * H,
      binMs: 3 * H,
      bins: [10, 25, 40, 55, 67.76],
      prevBins: Array.from({ length: 56 }, (_, i) => (i + 1) * 8.27),
      spendUsd: 67.76,
      pct: 6,
      prevSpendUsd: 463.19,
      prevPct: 47,
      rateUsd: 1129.33,
      prevRateUsd: 985.5,
      basis: 'this window',
      byModel: [
        { model: 'sonnet-5-5', usd: 39.92, input: 558, output: 23150, cacheRead: 162571891, cacheWrite: 2851361 },
        { model: 'opus-5-5', usd: 27.49, input: 336, output: 249208, cacheRead: 54195060, cacheWrite: 1725480 },
        { model: 'fable-5-1', usd: 7.89, input: 598, output: 285, cacheRead: 4266990, cacheWrite: 544552 },
      ],
    },
  ],
  usdPerToken: { 'sonnet-5-5': 0.282e-6, 'opus-5-5': 0.368e-6, 'fable-5-1': 0.676e-6 },
}

async function seed($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], startAt = NOW) {
  const clock = mock.clock(on, { now: startAt })
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: [...e.changed] }))
  on('process.run', (_$, e) =>
    ({
      value: {
        exitCode: e.argv[0] === 'python3' ? 0 : 1,
        stdout: e.argv[0] === 'python3' ? JSON.stringify(ESTIMATE) : '',
        stderr: '',
      },
    }) as never,
  )
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    await clock.advance(4000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hi',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 50_000, model: 'claude-opus-5-5' },
    } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }) as never)
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
  for await (const _ of step) void _
  await step.result
  await $.turn.complete({ answer: 'hi', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } } as never)

  await $.session.measure({
    context: { tokens: 177_700, window: 1_000_000, percent: 18 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 2, resetsAt: new Date(NOW + (4 * 60 + 44) * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 6, resetsAt: new Date(NOW + (6 * 24 + 11) * H).toISOString() },
    ],
    cost: { usd: 3.26 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  await clock.advance(0)
}

// Desktop pills are SVG: what they say is in each one's alt text.
type Mounted = { find: (q: { key?: string; type?: string; text?: string | RegExp }) => Promise<{ children: unknown[]; props: Record<string, unknown> } | undefined> }
const says = async (ui: Mounted, surface: 'terminal' | 'desktop', key: string, text: string) =>
  surface === 'terminal'
    ? (await ui.find({ key }))?.children !== undefined && JSON.stringify((await ui.find({ key }))?.children).includes(text)
    : JSON.stringify((await ui.find({ key }))?.children ?? '').includes(text)

test('band draws on one line on terminal and desktop', async ($, on) => {
  await seed($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = (await $.ui.mount({ plugin: 'context-band', surface, component: 'AbovePrompt', props: props(200) })) as unknown as Mounted & { press: (a: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
    expect(await says(ui, surface, 'limit-seven_day', '6%')).toBe(true)
    expect(await says(ui, surface, 'limit-seven_day', '6d11h')).toBe(true)
    expect(await says(ui, surface, 'limit-five_hour', '4h44m')).toBe(true)
    expect(await says(ui, surface, 'cost', '$3.26')).toBe(true)
    expect(await says(ui, surface, 'ctx', '18%')).toBe(true)
    await ui.press({ key: 'theme' })
    await ui.press({ key: 'chart' })
    await ui.unmount()
  }
})

test('a narrow band keeps the core figures and t/s, and drops the extras first', async ($, on) => {
  await seed($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = (await $.ui.mount({ plugin: 'context-band', surface, component: 'AbovePrompt', props: props(70) })) as unknown as Mounted & { unmount: () => Promise<void> }
    expect(await ui.find({ key: 'ctx' })).toBeDefined()
    expect(await ui.find({ key: 'cost' })).toBeDefined()
    expect(await ui.find({ key: 'speed' })).toBeDefined()
    expect(await ui.find({ key: 'model' })).toBeUndefined()
    expect(await ui.find({ key: 'turn' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the 7d pill has a hover strip with the estimate', async ($, on) => {
  // A later start than the other tests, so the estimator's throttle lets this run through.
  await seed($, on, NOW + 2 * H)
  const desktop = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
  const all = JSON.stringify(await desktop.find({ type: 'Box' }))
  expect(all).toContain('7d window ≈ $1,129')
  expect(all).toContain('previous ≈ $986')
  await desktop.unmount()
  const terminal = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(JSON.stringify(await terminal.find({ type: 'Box' }))).toContain('7d window ≈ $1,129')
  await terminal.unmount()
})

test('the By model view lists each model with the tokens it used and the tokens left', async ($, on) => {
  await seed($, on, NOW + 4 * H)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = (await $.ui.mount({ plugin: 'context-band', surface, component: 'AbovePrompt', props: props(200) })) as unknown as Mounted & {
      press: (a: { key: string }) => Promise<unknown>
      unmount: () => Promise<void>
    }
    await ui.press({ key: 'chart' })
    await ui.press({ key: surface === 'desktop' ? 'view-models' : 'view' })
    const drawn = JSON.stringify(await ui.find({ type: 'Box' }))
    // 7d: $1,129.33 at 100%, 6% used, so $1,061.57 left; at $0.368 per million tokens on Opus 5.5
    // that is 2.88B tokens if only Opus.
    expect(drawn).toContain('Opus 5.5 56.17M used, 2.88B left if only it')
    expect(drawn).toContain('Sonnet 5.5 165.4M used, 3.76B left if only it')
    expect(drawn).toContain('Fable 5.1 4.81M used, 1.57B left if only it')
    expect(drawn).toContain('$1,062 left')
    await ui.press({ key: surface === 'desktop' ? 'view-chart' : 'view' })
    await ui.press({ key: 'chart' })
    await ui.unmount()
  }
})

test('when space runs short, cache outlasts in', async ($, on) => {
  await seed($, on)
  let competed = false
  for (let columns = 60; columns <= 120; columns++) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', component: 'AbovePrompt', props: props(columns) })
    const hasIn = (await ui.find({ key: 'in' })) !== undefined
    const hasCache = (await ui.find({ key: 'cache' })) !== undefined
    if (hasIn !== hasCache) {
      competed = true
      expect(hasCache).toBe(true)
    }
    await ui.unmount()
  }
  expect(competed).toBe(true)
})
