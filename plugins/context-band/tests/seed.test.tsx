import { test, expect, mock } from 'claude-code/testing'

// A band loaded partway through a session (installed, or brought in by /reload-plugins) has counted
// no turns: it starts from the tokens the session's transcript says it used. Its own file, so the
// module starts fresh and has not seeded yet.
test('a band loaded mid-session starts from the session’s tokens', async ($, on) => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  const clock = mock.clock(on, { now })
  mock.store(on)
  on('session.id', () => ({ value: 'session-1' }) as never)
  on('session.measure', (_$, e) => ({ changed: [...e.changed] }) as never)
  let asked = ''
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'python3') asked = e.argv[2] ?? ''
    const session = { input: 4_200, output: 312_000, cacheRead: 41_000_000, cacheWrite: 900_000, requests: 57 }
    return { value: { exitCode: 0, stdout: JSON.stringify({ at: now, windows: [], usdPerToken: {}, session }), stderr: '' } } as never
  })
  await $.session.measure({
    context: { tokens: 49_900, window: 1_000_000, percent: 5 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 66, resetsAt: new Date(now + 36 * 60_000).toISOString() }],
    cost: { usd: 0.52 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  await clock.advance(0)
  expect(JSON.parse(asked).sessionId).toBe('session-1')
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160, scroll: { offset: 0, bodyRows: 20, totalRows: 0 }, view: {} } as never })
  expect(JSON.stringify(await ui.find({ key: 'in' }))).toContain('4.20k')
  expect(JSON.stringify(await ui.find({ key: 'out' }))).toContain('312k')
  expect(JSON.stringify(await ui.find({ key: 'cache' }))).toContain('41.9M')
  await ui.unmount()
})
