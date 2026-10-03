import { test, expect, mock } from 'claude-code/testing'

const NOW = Date.parse('2026-10-03T12:00:00Z')

// The engine's own footer, beneath the plugin: the mode labels, joined.
type On = Parameters<Parameters<typeof test>[1]>[1]
const engineFooter = (on: On) =>
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })

// The footer counts down the main conversation's 1-hour cache entry from the start of the last
// request, keeps the session's mode labels before it, and says "expired" once it has lapsed.
test('the footer counts down to when the prompt cache expires', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineFooter(on)
  on('session.id', () => ({ value: 'session-1' }) as never)
  let asked: readonly string[] = []
  on('process.run', (_$, e) => {
    asked = e.argv
    return { value: { exitCode: 0, stdout: '3600000\n', stderr: '' } } as never
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
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }) as never)

  const footer = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, component: 'SessionMode', props: { modes: ['focus'] } as never })
    const drawn = JSON.stringify(await ui.find({ type: 'Box' }) ?? null)
    await ui.unmount()
    return drawn
  }
  // Nothing to count before a request.
  expect(await footer('terminal')).not.toContain('cache')

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)
  for await (const _ of step) void _
  await step.result
  await $.turn.complete({ answer: 'hi', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: null } as never)
  await clock.advance(0)
  expect(asked[2]).toBe('session-1')

  // The request started at NOW and took 4s: 59:56 left.
  for (const surface of ['terminal', 'desktop'] as const) {
    const drawn = await footer(surface)
    expect(drawn).toContain('59:56')
    expect(drawn).toContain('focus')
  }
  await clock.advance(50 * 60_000)
  expect(await footer('desktop')).toContain('09:56')
  await clock.advance(10 * 60_000)
  expect(await footer('terminal')).toContain('expired')
})

// A subagent's requests read and write their own cache entries, not the conversation's.
test('subagent requests do not restart the count', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineFooter(on)
  on('session.id', () => ({ value: 'session-2' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '300000', stderr: '' } }) as never)
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'hi' } as never
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hi',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' },
    } as never
  })
  const step = $.turn.step({ turnId: 'a1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'agent-1' } as never)
  for await (const _ of step) void _
  await step.result
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } as never })
  expect(JSON.stringify(await ui.find({ type: 'Box' }) ?? null)).not.toContain('cache')
  await ui.unmount()
})
