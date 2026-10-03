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

let lastEstimatorArg: { sessionCosts?: unknown[] } = {}

async function seed($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], startAt = NOW, estimate: unknown = ESTIMATE) {
  const clock = mock.clock(on, { now: startAt })
  mock.store(on)
  on('session.measure', (_$, e) => ({ changed: [...e.changed] }))
  on('process.run', (_$, e) =>
    (e.argv[0] === 'python3' && (lastEstimatorArg = JSON.parse(e.argv[2] ?? '{}')), {
      value: {
        exitCode: e.argv[0] === 'python3' ? 0 : 1,
        stdout: e.argv[0] === 'python3' ? JSON.stringify(estimate) : '',
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

// The terminal's 📈 table: each line above the row of pills, as the text it shows.
const textOf = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(textOf).join('')
const tableLines = async (ui: Mounted) =>
  (((await ui.find({ type: 'Box' })) as unknown as { children: { type: string }[] }).children ?? []).filter(child => child.type === 'Text').map(textOf)

test('band draws on one line on terminal and desktop', async ($, on) => {
  await seed($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = (await $.ui.mount({ plugin: 'context-band', surface, component: 'AbovePrompt', props: props(200) })) as unknown as Mounted & { press: (a: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
    expect(await says(ui, surface, 'limit-seven_day', '6%')).toBe(true)
    expect(await says(ui, surface, 'limit-seven_day', '6d11h')).toBe(true)
    expect(await says(ui, surface, 'limit-five_hour', '4h44m')).toBe(true)
    expect(await says(ui, surface, 'cost', '$3.26')).toBe(true)
    expect(await says(ui, surface, 'ctx', '18%')).toBe(true)
    // ◐ sits in the row on the terminal and in the chart panel on desktop.
    if (surface === 'desktop') await ui.press({ key: 'chart' })
    await ui.press({ key: 'theme' })
    if (surface === 'desktop') await ui.press({ key: 'chart' })
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
    expect(await ui.find({ key: 'speed' })).toBeDefined()
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
    if (surface === 'desktop') {
      expect(drawn).toContain('Opus 5.5 56.17M used, 2.88B left if only it')
      expect(drawn).toContain('Sonnet 5.5 165.4M used, 3.76B left if only it')
      expect(drawn).toContain('Fable 5.1 4.81M used, 1.57B left if only it')
      expect(drawn).toContain('$1,062 left')
    } else {
      // A column per model under "If you use only…", the 7d row under it.
      const [header, row] = await tableLines(ui)
      expect(header).toContain('If you use only…')
      expect(row).toContain('7d $1,062 left')
      for (const [model, left, used] of [['Opus 5.5', '2.88B left', '56.17M used'], ['Sonnet 5.5', '3.76B left', '165.4M used'], ['Fable 5.1', '1.57B left', '4.81M used']]) {
        expect(row!.indexOf(left!)).toBe(header!.indexOf(model!))
        expect(row).toContain(`${left} · ${used}`)
      }
    }
    await ui.press({ key: surface === 'desktop' ? 'view-chart' : 'view' })
    await ui.press({ key: 'chart' })
    await ui.unmount()
  }
})

test('the terminal Chart view says what the desktop card says, in columns', async ($, on) => {
  await seed($, on, NOW + 4 * H)
  const ui = (await $.ui.mount({ plugin: 'context-band', surface: 'terminal', component: 'AbovePrompt', props: props(200) })) as unknown as Mounted & {
    press: (a: { key: string }) => Promise<unknown>
    unmount: () => Promise<void>
  }
  await ui.press({ key: 'chart' })
  const [header, row] = await tableLines(ui)
  // 17h into a 168h week with 6% used: 59% at the reset; $1,061.57 over the 151h left is $169 a day.
  expect(row).toContain('7d ≈ $1,129')
  expect(row).toContain('59% at reset')
  expect(row).toContain('$169/day ≈ ')
  expect(row).toContain('5% by now, 47% at reset')
  for (const [title, value] of [['At this pace', '█'], ['Spend up to', '$169/day'], ['Average so far', '$96/day'], ['Previous window', '5% by now']]) {
    expect(row!.indexOf(value!)).toBe(header!.indexOf(title!))
  }
  // Narrow, it keeps the verdict and the rate to spend, and lets the rest go.
  await ui.unmount()
  const narrow = (await $.ui.mount({ plugin: 'context-band', surface: 'terminal', component: 'AbovePrompt', props: props(60) })) as unknown as Mounted & { unmount: () => Promise<void> }
  const [, slim] = await tableLines(narrow)
  expect(slim).toContain('59% at reset')
  expect(slim).toContain('$169/day')
  expect(slim).not.toContain('by now')
  expect(slim!.trimEnd().length).toBeLessThanOrEqual(60)
  await narrow.unmount()
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

test('pills that do not fit sit behind +N and come back when the band expands', async ($, on) => {
  await seed($, on)
  const all = ['limit-five_hour', 'limit-seven_day', 'in', 'out', 'speed', 'cache', 'cost', 'ctx']
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface, component: 'AbovePrompt', props: props(60) })
    const more = await ui.find({ key: 'more' })
    expect(String(more?.props.label)).toMatch(/^\+\d+$/)
    const missing = []
    for (const key of all) if (!(await ui.find({ key }))) missing.push(key)
    expect(missing.length).toBe(Number(String(more?.props.label).slice(1)))
    await ui.press({ key: 'more' })
    for (const key of all) expect(await ui.find({ key })).toBeDefined()
    expect(String((await ui.find({ key: 'more' }))?.props.label)).toBe('Less')
    await ui.press({ key: 'more' })
    expect(await ui.find({ key: missing[0]! })).toBeUndefined()
    await ui.unmount()
  }
})

test('at a 95-column desktop band with real figures, every pill fits with no +N', async ($, on) => {
  await seed($, on)
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', component: 'AbovePrompt', props: props(95) })
  for (const key of ['limit-five_hour', 'limit-seven_day', 'in', 'out', 'speed', 'cache', 'cost', 'ctx']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  expect(await ui.find({ key: 'theme' })).toBeUndefined()
  await ui.press({ key: 'chart' })
  expect(await ui.find({ key: 'theme' })).toBeDefined()
  await ui.unmount()
})

test('every model gets a row or a mention, and an estimated price is marked', async ($, on) => {
  on('session.id', () => ({ value: 'session-1' }) as never)
  const base = ESTIMATE.windows[0]!
  const use = (model: string, usd: number) => ({ model, usd, input: 100, output: 1000, cacheRead: 1_000_000, cacheWrite: 10_000 })
  const six = {
    ...ESTIMATE,
    windows: [{ ...base, byModel: [use('fable-5-5', 9), use('fable-5-1', 8), use('opus-6', 7), use('opus-5-5', 6), use('sonnet-5-5', 5), use('haiku-4-5', 1)] }],
    usdPerToken: { 'fable-5-5': 0.7e-6, 'fable-5-1': 0.676e-6, 'opus-6': 0.5e-6, 'opus-5-5': 0.368e-6, 'sonnet-5-5': 0.282e-6, 'haiku-4-5': 0.141e-6 },
    prices: { 'fable-5-5': 'learned', 'fable-5-1': 'list', 'opus-6': 'estimated', 'opus-5-5': 'list', 'sonnet-5-5': 'list', 'haiku-4-5': 'list' },
  }
  await seed($, on, NOW + 6 * H, six)
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
  await ui.press({ key: 'chart' })
  await ui.press({ key: 'view-models' })
  const drawn = JSON.stringify(await ui.find({ type: 'Box' }))
  // Newest first within a family, every model named, Opus 6 marked as estimated.
  expect(drawn).toContain('Fable 5.5')
  expect(drawn).toContain('Haiku 4.5')
  expect(drawn).toContain('+2 more: Sonnet 5.5, Haiku 4.5')
  expect(drawn).toContain('≈ Opus 6: price estimated until learned')
  expect(drawn.indexOf('Fable 5.5')).toBeLessThan(drawn.indexOf('Fable 5.1'))
  await ui.unmount()
  // The session's own cost reached the estimator, for it to learn prices from.
  expect(Array.isArray(lastEstimatorArg.sessionCosts)).toBe(true)
})
