import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionContextUsage, SessionCost } from 'claude-code'

import type {
  ContextBandApi,
  ContextBandApiWindow,
  ContextBandAppearance,
  ContextBandModelUse,
  ContextBandPriceKind,
  ContextBandStats,
  ContextBandTheme,
  ContextBandTurn,
  ContextBandUsage,
} from '../types'

const EMPTY: ContextBandStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }

const stats = atom({ plugin: 'context-band', key: 'stats' } as const, EMPTY)
const usage = atom({ plugin: 'context-band', key: 'usage' } as const, null)
const lastTurn = atom({ plugin: 'context-band', key: 'turn' } as const, null)
const now = atom({ plugin: 'context-band', key: 'now' } as const, 0)
const theme = atom({ plugin: 'context-band', key: 'theme' } as const, 'auto')
const DEFAULT_APPEARANCE: ContextBandAppearance = { isSystemDark: false, cli: 'auto', desktop: 'system' }
const appearance = atom({ plugin: 'context-band', key: 'appearance' } as const, DEFAULT_APPEARANCE)
const isHidden = atom({ plugin: 'context-band', key: 'isHidden' } as const, false)
const api = atom({ plugin: 'context-band', key: 'api' } as const, null)
const isChartOpen = atom({ plugin: 'context-band', key: 'isChartOpen' } as const, false)
const isRowExpanded = atom({ plugin: 'context-band', key: 'isRowExpanded' } as const, false)
const chartView = atom({ plugin: 'context-band', key: 'chartView' } as const, 'chart')

const THEMES: readonly ContextBandTheme[] = ['auto', 'light', 'dark']

type Tone = { bg: string; accent: string }
type ToneKey = 'fiveHour' | 'sevenDay' | 'input' | 'output' | 'speed' | 'cache' | 'cost' | 'ctx'
type Level = 'normal' | 'warn' | 'danger'
type Palette = {
  card: string
  text: string
  muted: string
  divider: string
  warn: string
  danger: string
  tones: Record<ToneKey, Tone>
  models: Record<'opus' | 'sonnet' | 'fable' | 'haiku' | 'other', string>
  // Opacities for the By model card's tinted answer column and its bar tracks.
  tint: number
  track: number
  // Opacity of the area under the Chart card's spend curve.
  area: number
}

const LIGHT: Palette = {
  card: '#FFFFFF',
  text: '#2B2B2B',
  muted: '#6E6E6E',
  divider: '#C4C4BE',
  warn: '#B7791F',
  danger: '#C53030',
  tones: {
    fiveHour: { bg: '#DCEFE6', accent: '#2E8B6A' },
    sevenDay: { bg: '#E5E0F8', accent: '#6D4AD6' },
    input: { bg: '#F6DCD6', accent: '#C2452F' },
    output: { bg: '#DDEFD8', accent: '#3C8B3A' },
    speed: { bg: '#D9EEF4', accent: '#2A8AA6' },
    cache: { bg: '#DEE3FA', accent: '#4A5BD4' },
    cost: { bg: '#F4EACB', accent: '#B07D12' },
    ctx: { bg: '#E3E5EA', accent: '#4B5563' },
  },
  models: { opus: '#D85A30', sonnet: '#1D9E75', fable: '#7F77DD', haiku: '#888780', other: '#B4B2A9' },
  tint: 0.1,
  track: 0.4,
  area: 0.14,
}

const DARK: Palette = {
  card: '#26272B',
  text: '#E6E6E6',
  muted: '#9A9A9A',
  divider: '#4A4A4A',
  warn: '#F0B429',
  danger: '#FF6B6B',
  tones: {
    fiveHour: { bg: '#183B2F', accent: '#5BD1A3' },
    sevenDay: { bg: '#2B2550', accent: '#A996FF' },
    input: { bg: '#46231D', accent: '#FF8C76' },
    output: { bg: '#1F3A1E', accent: '#7FD77B' },
    speed: { bg: '#14353F', accent: '#5BC6E4' },
    cache: { bg: '#232A55', accent: '#8F9CFF' },
    cost: { bg: '#3D331A', accent: '#E9B949' },
    ctx: { bg: '#2C2F35', accent: '#A3AAB6' },
  },
  models: { opus: '#F0997B', sonnet: '#5DCAA5', fable: '#AFA9EC', haiku: '#B4B2A9', other: '#888780' },
  tint: 0.16,
  track: 0.7,
  area: 0.22,
}

type IconName = 'gauge' | 'calendar' | 'bolt' | 'coin' | 'doc'

const ICON_PATHS: Record<IconName, string> = {
  gauge: '<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0"/><path d="M12 14l3.6-3.6"/><circle cx="12" cy="14" r="1.2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4M10 13h4l-2.2 4.5"/>',
  bolt: '<path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.3 0-2.3-.5-2.8-1.4M12 6.5V8M12 16v1.5"/>',
  doc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
}

const GLYPHS: Record<IconName, string> = {
  gauge: '◔',
  calendar: '▦',
  bolt: 'ϟ',
  coin: '$',
  doc: '▤',
}

const svgIcon = (name: IconName, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`

const fmtTokens = (n: number) =>
  n < 1000
    ? `${Math.round(n)}`
    : n < 1e6
      ? `${Number((n / 1e3).toFixed(1))}k`
      : n < 1e9
        ? `${Number((n / 1e6).toFixed(n < 1e8 ? 2 : 1))}M`
        : `${(n / 1e9).toFixed(2)}B`

const fmtPercent = (p: number) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`)

const fmtUsd = (v: number) =>
  v >= 1000 ? `$${String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`

const fmtLeft = (ms: number) => {
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const limitLabel = (kind: string) =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind.replace('seven_day_', '7d ').replace(/_/g, ' ')

const isFiveHour = (kind: string) => kind.startsWith('five_hour')

const toUsage = (u: { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[]; cost?: SessionCost }): ContextBandUsage => ({
  ctxPercent: u.context.percent ?? null,
  ctxTokens: u.context.tokens ?? null,
  ctxWindow: u.context.window,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null })),
  costUsd: u.cost?.usd ?? null,
})

async function refreshUsage($: EngineInterface) {
  try {
    const next = toUsage(await $.session.usage())
    if (JSON.stringify(await read($, usage)) !== JSON.stringify(next)) await update($, usage, () => next)
  } catch {}
}

async function refreshClock($: EngineInterface) {
  // Countdowns show minutes, so the band needs a new time once a minute, not every tick.
  const t = await $.clock.now()
  const minute = t - (t % 60_000)
  if ((await read($, now)) !== minute) await update($, now, () => minute)
}

const DESKTOP_CONFIG = 'Library/Application Support/Claude/config.json'

// "auto" follows the surface: Claude Code's theme setting on the terminal, the desktop app's
// own mode on desktop, and macOS's appearance when either of those is set to follow the system.
async function refreshAppearance($: EngineInterface) {
  const next: ContextBandAppearance = { ...DEFAULT_APPEARANCE }
  try {
    const { exitCode, stdout } = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 3000 })
    next.isSystemDark = exitCode === 0 && /dark/i.test(stdout)
  } catch {}
  try {
    const row = (await $.config.list()).find(r => r.key === 'theme')
    const value = String(row?.value ?? 'auto')
    next.cli = value.startsWith('dark') ? 'dark' : value.startsWith('light') ? 'light' : 'auto'
  } catch {}
  try {
    // plutil pulls the one key, so the plugin never reads the rest of that file.
    const home = await $.env.get('HOME')
    if (home) {
      const { exitCode, stdout } = await $.process.run(['plutil', '-extract', 'userThemeMode', 'raw', '-o', '-', `${home}/${DESKTOP_CONFIG}`], { timeoutMs: 3000 })
      const value = stdout.trim()
      if (exitCode === 0 && (value === 'dark' || value === 'light')) next.desktop = value
    }
  } catch {}
  if (JSON.stringify(await read($, appearance)) !== JSON.stringify(next)) await update($, appearance, () => next)
}

const resolveDark = (mode: ContextBandTheme, look: ContextBandAppearance, isTerminal: boolean) => {
  if (mode !== 'auto') return mode === 'dark'
  const pinned = isTerminal ? look.cli : look.desktop
  return pinned === 'dark' ? true : pinned === 'light' ? false : look.isSystemDark
}

async function setTheme($: EngineInterface, next: ContextBandTheme) {
  await update($, theme, () => next)
  await $.store.set('themeMode', next)
  if (next === 'auto') await refreshAppearance($)
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const nums = (v: unknown) => (Array.isArray(v) ? v.map(x => num(x)) : [])

// The estimator's JSON, taken field by field so a bad line never reaches the drawing.
function parseApi(stdout: string): ContextBandApi | null {
  try {
    const raw = JSON.parse(stdout) as { at?: unknown; windows?: unknown }
    if (!Array.isArray(raw.windows)) return null
    const windows = raw.windows.map((w: Record<string, unknown>): ContextBandApiWindow => ({
      kind: String(w.kind ?? ''),
      startAt: num(w.startAt),
      endAt: num(w.endAt),
      binMs: num(w.binMs, 1),
      bins: nums(w.bins),
      prevBins: nums(w.prevBins),
      spendUsd: num(w.spendUsd),
      pct: num(w.pct),
      prevSpendUsd: num(w.prevSpendUsd),
      prevPct: typeof w.prevPct === 'number' ? w.prevPct : null,
      rateUsd: typeof w.rateUsd === 'number' && w.rateUsd > 0 ? w.rateUsd : null,
      prevRateUsd: typeof w.prevRateUsd === 'number' && w.prevRateUsd > 0 ? w.prevRateUsd : null,
      basis: typeof w.basis === 'string' ? w.basis : null,
      byModel: Array.isArray(w.byModel)
        ? w.byModel.map((m: Record<string, unknown>): ContextBandModelUse => ({
            model: String(m.model ?? '?'),
            usd: num(m.usd),
            input: num(m.input),
            output: num(m.output),
            cacheRead: num(m.cacheRead),
            cacheWrite: num(m.cacheWrite),
          }))
        : [],
    }))
    const prices = (raw as { usdPerToken?: unknown }).usdPerToken
    const usdPerToken: Record<string, number> = {}
    if (prices && typeof prices === 'object') {
      for (const [model, value] of Object.entries(prices as Record<string, unknown>)) {
        if (typeof value === 'number' && value > 0) usdPerToken[model] = value
      }
    }
    const kinds = (raw as { prices?: unknown }).prices
    const priceKinds: Record<string, ContextBandPriceKind> = {}
    if (kinds && typeof kinds === 'object') {
      for (const [model, kind] of Object.entries(kinds as Record<string, unknown>)) {
        if (kind === 'list' || kind === 'learned' || kind === 'estimated') priceKinds[model] = kind
      }
    }
    return { at: num(raw.at), windows, usdPerToken, priceKinds }
  } catch {
    return null
  }
}

// The session's own tokens so far, as the estimator read them from its transcript.
function parseSession(stdout: string): ContextBandStats | null {
  try {
    const raw = (JSON.parse(stdout) as { session?: Record<string, unknown> }).session
    if (!raw || typeof raw !== 'object') return null
    return { input: num(raw.input), output: num(raw.output), cacheRead: num(raw.cacheRead), cacheWrite: num(raw.cacheWrite), requests: num(raw.requests) }
  } catch {
    return null
  }
}

// Under a few points of the window used, one point of rounding moves the estimate a lot.
const isRough = (w: ContextBandApiWindow) => (w.basis === 'previous window' ? (w.prevPct ?? 0) : w.pct) < 5

const roughMark = (w: ContextBandApiWindow) => (isRough(w) ? ' (rough)' : '')

const CARD_H = 188
// Where both views put their title and the line under it.
const TITLE_Y = 32
const SUBTITLE_Y = 52

const BOTH = '<style>.cbD{display:none}@media (prefers-color-scheme: dark){.cbL{display:none}.cbD{display:inline}}</style>'

// A desktop SVG in the palette the person pinned, or in both under "auto", where the renderer's
// own color scheme (the app's theme) chooses between them the moment it changes: no polling.
function themedSvg(width: number, height: number, attrs: string, mode: ContextBandTheme, draw: (p: Palette) => string) {
  const body = mode === 'auto' ? `${BOTH}<g class="cbL">${draw(LIGHT)}</g><g class="cbD">${draw(DARK)}</g>` : draw(mode === 'dark' ? DARK : LIGHT)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${attrs}>${body}</svg>`
}

// The strip's small chart's scale: the window's length, the time gone, and the spend so far.
function chartGeometry(w: ContextBandApiWindow, t: number) {
  const dur = Math.max(1, w.endAt - w.startAt)
  const elapsed = Math.min(dur, Math.max(0, t - w.startAt))
  const spend = w.bins.at(-1) ?? w.spendUsd
  return { dur, elapsed, spend }
}

// The frame both views share: the card, the window's estimate as its title, and the line under it.
function cardFrame(w: ContextBandApiWindow, pct: number, p: Palette, t: number, width: number) {
  const label = limitLabel(w.kind)
  const title = w.rateUsd ? `${label} window ≈ ${fmtUsd(w.rateUsd)} at API prices${roughMark(w)}` : `${label} window · not enough usage to estimate yet`
  const tokens = w.byModel.reduce((sum, m) => sum + tokensOf(m), 0)
  const pieces = [
    ...(w.basis === 'previous window' ? ['from the previous window'] : []),
    `used ${fmtPercent(pct)}`,
    fmtUsd(w.spendUsd),
    ...(tokens > 0 ? [`${fmtTokens(tokens)} tokens`] : []),
  ]
  // The reset time is in the Chart card's verdict row and on the 5h/7d pills, so not here.
  const detail = pieces.join(' · ')
  return (
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${CARD_H - 1}" rx="12" fill="${p.card}" stroke="${p.divider}"/>` +
    `<text x="16" y="${TITLE_Y}" font-size="14" font-weight="600" fill="${p.text}">${esc(title)}</text>` +
    `<text x="16" y="${SUBTITLE_Y}" font-size="11.5" fill="${p.muted}">${esc(detail)}</text>`
  )
}

// Rates in the Chart card: one decimal below $20, whole dollars above.
const fmtRate = (v: number) => (v < 20 ? `$${v.toFixed(1)}` : `$${String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`)

// Tokens to three significant figures.
const fmtTok3 = (n: number) => {
  for (const [div, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (n >= div) {
      const x = n / div
      return `${x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : x.toFixed(0)}${suffix}`
    }
  }
  return `${Math.round(n)}`
}

// "6d 8h", "2h 18m", "43m".
const fmtSpan = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes % 60}m`
}

// What a token costs on the newest Opus at your mix, for the Chart card's "≈ … Opus" figures.
const opusPrice = (usdPerToken: Record<string, number>) => {
  const key = Object.keys(usdPerToken).filter(m => m.startsWith('opus')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  return (key && usdPerToken[key]) || 0.367e-6
}

// What the Chart view says about one window, for the desktop card, the terminal table and the hover
// strips alike: where the window ends at this pace (or when it hits the limit), the average rate so
// far, the rate that lands on 100% at the reset, and the previous window at this point and its end.
function chartFacts(w: ContextBandApiWindow, t: number, usdPerToken: Record<string, number> = {}) {
  const win = Math.max(1, w.endAt - w.startAt)
  const el = Math.min(1, Math.max(0, (t - w.startAt) / win))
  const rate = w.rateUsd
  const spend = w.bins.at(-1) ?? w.spendUsd
  const pct = rate ? (spend / rate) * 100 : w.pct
  const isWeek = win > 24 * 3600_000
  const perMs = isWeek ? 86_400_000 : 3_600_000
  const per = isWeek ? '/day' : '/h'
  const elMs = el * win
  const leftMs = (1 - el) * win
  const avg = elMs > 0 ? spend / (elMs / perMs) : 0
  const budget = rate && leftMs > 0 ? Math.max(rate - spend, 0) / (leftMs / perMs) : null
  const early = el < 0.05 || spend <= 0 || !rate
  const rawPace = el > 0 ? pct / el : 0
  const over = !early && rawPace >= 100
  const tHit = over ? (el * 100) / pct : null
  const pace = Math.min(rawPace, 100)
  const opus = opusPrice(usdPerToken)
  // The previous window as % of its own limit against the share of the window gone.
  const prev: [number, number][] = []
  let prevNow: number | null = null
  let prevEnd: number | null = null
  if (w.prevBins.length > 0 && w.prevRateUsd) {
    const prevRate = w.prevRateUsd
    prev.push([0, 0], ...w.prevBins.map((v, i): [number, number] => [((i + 1) * w.binMs) / win, (v / prevRate) * 100]))
    prevEnd = prev.at(-1)?.[1] ?? null
    for (let i = 1; i < prev.length; i++) {
      const [t0, p0] = prev[i - 1]!
      const [t1, p1] = prev[i]!
      if (t0 <= el && el <= t1) {
        prevNow = t1 > t0 ? p0 + ((p1 - p0) * (el - t0)) / (t1 - t0) : p1
        break
      }
    }
  }
  return { win, el, rate, spend, pct, isWeek, per, elMs, leftMs, avg, budget, early, over, tHit, pace, opus, prev, prevNow, prevEnd }
}

type ChartFacts = ReturnType<typeof chartFacts>

// The verdict in words, as the Chart card's first row says it.
const verdictText = (f: ChartFacts) =>
  f.early
    ? f.spend <= 0
      ? 'No usage yet'
      : 'Too early to tell'
    : f.over && f.tHit !== null
      ? `Limit hit in ${fmtSpan((f.tHit - f.el) * f.win)}`
      : `On pace to finish at ${Math.round(f.pace)}%`

// The Chart card: what the By model table cannot show, which is time. A verdict (where the window
// ends at this pace, or when it runs out), the average rate so far beside the rate that lands on
// 100% at the reset, and a strip on a fixed 0–100% scale so the limit is the same top edge on every
// card. The headroom wedge between the pace line and the limit is what the answer row quantifies.
function chartBody(w: ContextBandApiWindow, p: Palette, t: number, width: number, usdPerToken: Record<string, number>) {
  const acc = p.tones[windowTone(w.kind)].accent
  const parts: string[] = [cardFrame(w, w.pct, p, t, width)]
  const L = 16
  const R = width - 16
  const tw = (text: string, size: number) => text.length * size * 0.55
  const { win, el, rate, spend, pct, isWeek, per, elMs, leftMs, avg, budget, early, over, tHit, pace, opus, prev, prevNow, prevEnd } = chartFacts(w, t, usdPerToken)
  const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
    parts.push(`<text x="${x.toFixed(1)}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`)

  // 1. The verdict, and the reset on the right; shorter phrasings when the two would touch.
  const resetIn = `reset in ${fmtSpan(leftMs)}`
  type Option = { spans: [string, string, boolean][]; right: string }
  let options: Option[]
  let rightColor = acc
  if (early) {
    options =
      spend <= 0
        ? [{ spans: [['No usage yet this window', p.text, false]], right: resetIn }, { spans: [['No usage yet', p.text, false]], right: resetIn }]
        : [{ spans: [['Too early to call a pace', p.text, false]], right: resetIn }, { spans: [['Too early to tell', p.text, false]], right: resetIn }]
  } else if (over && tHit !== null) {
    rightColor = p.danger
    const hit = fmtSpan((tHit - el) * win)
    const before = fmtSpan((1 - tHit) * win)
    options = [
      { spans: [['Limit hit in ', p.danger, false], [hit, p.danger, true]], right: `${before} before reset` },
      { spans: [['Limit in ', p.danger, false], [hit, p.danger, true]], right: `${before} before reset` },
      { spans: [['Limit in ', p.danger, false], [hit, p.danger, true]], right: `${before} early` },
    ]
  } else {
    const share = `${Math.round(pace)}%`
    options = [
      { spans: [['On pace to finish at ', p.text, false], [share, acc, true]], right: resetIn },
      { spans: [['Finishing at ', p.text, false], [share, acc, true]], right: resetIn },
    ]
  }
  const chosen =
    options.find(o => L + tw(o.spans.map(s => s[0]).join(''), 12) + 12 <= R - tw(o.right, 10.5)) ?? options[options.length - 1]!
  const spans = chosen.spans.map(([piece, color, bold]) => `<tspan fill="${color}"${bold ? ' font-weight="700"' : ''}>${esc(piece)}</tspan>`).join('')
  text(L, 78, 12, p.text, spans, ' font-weight="600"')
  text(R, 78, 10.5, rightColor, esc(chosen.right), ' font-weight="700" text-anchor="end"')
  parts.push(`<line x1="${L}" y1="84" x2="${R}" y2="84" stroke="${p.divider}" stroke-opacity="0.7" stroke-width="1"/>`)

  // 2. The average so far, and the answer: the rate that lands on 100% at the reset.
  const colA = R - 82
  parts.push(`<rect x="10" y="106" width="${width - 20}" height="20" rx="7" fill="${acc}" fill-opacity="${p.tint}"/>`)
  const a1 = elMs > 0 && avg > 0 ? `${fmtRate(avg)}${per}` : '—'
  const b1 = a1 !== '—' ? `≈ ${fmtTok3(avg / opus)} Opus` : ''
  const a2 = budget !== null ? `${fmtRate(budget)}${per}` : '—'
  const b2 = budget !== null ? `≈ ${fmtTok3(budget / opus)} Opus` : ''
  const longLabels = ['Average so far', over ? 'Slow down to' : 'Spend up to']
  const shortLabels = ['Average', over ? 'Slow to' : 'Up to']
  const fits = longLabels.every((label, i) => L + tw(label, 12) + 12 <= colA - tw(i === 0 ? a1 : a2, 13))
  const labels = fits ? longLabels : shortLabels
  const nums = ' style="font-variant-numeric: tabular-nums"'
  ;[
    { label: labels[0]!, a: a1, b: b1, y: 99, isAnswer: false },
    { label: labels[1]!, a: a2, b: b2, y: 119, isAnswer: true },
  ].forEach(row => {
    text(L, row.y, 12, p.text, esc(row.label))
    text(colA, row.y, 13, row.isAnswer && over ? p.danger : p.text, esc(row.a), `${row.isAnswer ? ' font-weight="700"' : ''} text-anchor="end"${nums}`)
    if (row.b) text(R, row.y, 10.5, p.muted, esc(row.b), ` text-anchor="end"${nums}`)
  })

  // 3. The strip: time from the last reset to the next, 0–100% of this window's limit.
  const yT = 134
  const yB = 161
  const pL = L
  const pR = R - 34
  const X = (f: number) => pL + f * (pR - pL)
  const Y = (v: number) => yB - (Math.min(Math.max(v, 0), 100) / 100) * (yB - yT)
  const pts = (seq: [number, number][]) => seq.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  parts.push(`<line x1="${pL}" y1="${yB}" x2="${pR}" y2="${yB}" stroke="${p.divider}" stroke-opacity="0.7" stroke-width="1"/>`)
  parts.push(`<line x1="${pL}" y1="${yT}" x2="${pR}" y2="${yT}" stroke="${p.danger}" stroke-opacity="0.75" stroke-width="1" stroke-dasharray="2 3"/>`)
  text(pR + 6, yT + 3.6, 10, p.danger, 'limit')
  if (prev.length > 0) {
    parts.push(`<polyline points="${pts(prev.map(([f, v]) => [X(f), Y(v)]))}" fill="none" stroke="${p.muted}" stroke-opacity="0.55" stroke-width="1.25" stroke-linejoin="round"/>`)
  }
  if (rate) {
    const nx = X(el)
    const ny = Y(pct)
    if (!early) {
      const wedge: [number, number][] = over && tHit !== null ? [[nx, ny], [X(tHit), yT], [pR, yT]] : [[nx, ny], [pR, Y(pace)], [pR, yT]]
      parts.push(`<polygon points="${pts(wedge)}" fill="${over ? p.danger : acc}" fill-opacity="${p.tint}"/>`)
    }
    parts.push(`<line x1="${nx.toFixed(1)}" y1="${ny.toFixed(1)}" x2="${pR}" y2="${yT}" stroke="${acc}" stroke-opacity="0.45" stroke-width="1"/>`)
    const cur: [number, number][] = [[X(0), Y(0)], ...w.bins.map((v, i): [number, number] => [X(Math.min((i + 1) * w.binMs, elMs) / win), Y((v / rate) * 100)])]
    parts.push(`<polygon points="${pts([...cur, [nx, yB], [pL, yB]])}" fill="${acc}" fill-opacity="${p.area}"/>`)
    parts.push(`<polyline points="${pts(cur)}" fill="none" stroke="${acc}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>`)
    if (!early) {
      if (over && tHit !== null) {
        const hx = X(tHit)
        parts.push(`<line x1="${nx.toFixed(1)}" y1="${ny.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${yT}" stroke="${p.danger}" stroke-width="1.6" stroke-dasharray="4 3"/>`)
        parts.push(`<circle cx="${hx.toFixed(1)}" cy="${yT}" r="3" fill="${p.danger}" stroke="${p.card}" stroke-width="1.5"/>`)
      } else {
        parts.push(`<line x1="${nx.toFixed(1)}" y1="${ny.toFixed(1)}" x2="${pR}" y2="${Y(pace).toFixed(1)}" stroke="${acc}" stroke-width="1.6" stroke-dasharray="4 3"/>`)
      }
    }
    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="3.25" fill="${acc}" stroke="${p.card}" stroke-width="1.5"/>`)
  }

  // 4. The previous window at this point and at its end, or a note that there is none.
  if (prevNow !== null && prevEnd !== null) {
    parts.push(`<line x1="${L}" y1="174.5" x2="${L + 12}" y2="174.5" stroke="${p.muted}" stroke-opacity="0.55" stroke-width="1.5" stroke-linecap="round"/>`)
    text(L + 18, CARD_H - 10, 10.5, p.muted, esc(`Last ${isWeek ? 'week' : 'window'}: ${Math.round(prevNow)}% by now, ${Math.round(prevEnd)}% at reset`))
  } else {
    text(L, CARD_H - 10, 10.5, p.muted, esc(`No previous ${limitLabel(w.kind)} window to compare`))
  }
  return parts.join('')
}

// `opus-5-5` as `Opus 5.5`.
const modelLabel = (model: string) => {
  const [family = model, ...version] = model.split('-')
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}${version.length > 0 ? ` ${version.join('.')}` : ''}`
}

const modelColor = (p: Palette, model: string) =>
  model.startsWith('opus') ? p.models.opus : model.startsWith('sonnet') ? p.models.sonnet : model.startsWith('fable') || model.startsWith('mythos') ? p.models.fable : model.startsWith('haiku') ? p.models.haiku : p.models.other

const TIERS = ['fable', 'mythos', 'opus', 'sonnet', 'haiku']

// Fable first, then Opus, Sonnet and Haiku; anything else after them.
const tierRank = (model: string) => {
  const i = TIERS.findIndex(tier => model.startsWith(tier))
  return i === -1 ? TIERS.length : i
}

const tokensOf = (m: ContextBandModelUse) => m.input + m.output + m.cacheRead + m.cacheWrite

// The dollars left in a window: its estimated total less what the % used has taken.
const usdLeft = (w: ContextBandApiWindow, pct: number) => (w.rateUsd ? w.rateUsd * Math.max(0, 100 - pct) / 100 : null)

// The tokens left in a window if every one went to `model`, at your own mix of input and cache.
const tokensLeft = (w: ContextBandApiWindow, pct: number, usdPerToken: Record<string, number>, model: string) => {
  const left = usdLeft(w, pct)
  const price = usdPerToken[model]
  return left !== null && price ? left / price : null
}

// The By model card: the frame both views share, then a labelled table. "If you use only…" heads
// the models, "tokens left" heads the answer column, tinted in the window's color so the eye lands
// there, and a bar per row scales those numbers against the largest. Tokens already used sit in a
// small grey column. The foot says why the numbers differ: the same dollars at each model's price.
function modelsBody(
  w: ContextBandApiWindow,
  pct: number,
  models: string[],
  usdPerToken: Record<string, number>,
  priceKinds: Record<string, ContextBandPriceKind>,
  p: Palette,
  t: number,
  width: number,
) {
  const tone = p.tones[windowTone(w.kind)]
  const nums = 'style="font-variant-numeric: tabular-nums"'
  const parts: string[] = [cardFrame(w, pct, p, t, width)]
  const usedR = width - 16
  const leftR = width - 66
  const columnX = width - 126
  const barX = 100
  const barW = Math.max(20, columnX - 10 - barX)
  // Every model gets a row: four at the usual spacing, five a little tighter, and past five the
  // last slot names the rest rather than leaving them out.
  const slots = Math.min(models.length, 5)
  const first = slots <= 4 ? 99 : 97
  const step = slots <= 4 ? 20 : 16
  const rows = models.length > 5 ? models.slice(0, 4) : models
  const rest = models.length > 5 ? models.slice(4) : []
  const lefts = rows.map(model => tokensLeft(w, pct, usdPerToken, model))
  const most = Math.max(0, ...lefts.map(v => v ?? 0))
  if (rows.length > 0) {
    const bottom = first + step * (rows.length - 1) + 7
    parts.push(`<rect x="${columnX}" y="65" width="66" height="${bottom - 65}" rx="7" fill="${tone.accent}" fill-opacity="${p.tint}"/>`)
  }
  parts.push(`<text x="16" y="78" font-size="11" font-weight="500" fill="${p.text}">If you use only…</text>`)
  parts.push(`<text x="${leftR}" y="78" font-size="10.5" font-weight="700" text-anchor="end" fill="${tone.accent}">tokens left</text>`)
  parts.push(`<text x="${usedR}" y="78" font-size="10.5" text-anchor="end" fill="${p.muted}">used</text>`)
  parts.push(`<line x1="16" y1="84" x2="${usedR}" y2="84" stroke="${p.divider}" stroke-opacity="0.7" stroke-width="1"/>`)
  if (models.length === 0) {
    parts.push(`<text x="16" y="102" font-size="12" fill="${p.muted}">No Claude Code usage this week yet</text>`)
  }
  rows.forEach((model, i) => {
    const y = first + i * step
    const color = modelColor(p, model)
    const used = w.byModel.find(m => m.model === model)
    const left = lefts[i] ?? null
    parts.push(`<circle cx="20" cy="${y - 4.2}" r="4" fill="${color}"/>`)
    parts.push(`<text x="30" y="${y}" font-size="12" fill="${p.text}">${esc(modelLabel(model))}</text>`)
    parts.push(`<rect x="${barX}" y="${y - 7.2}" width="${barW}" height="6" rx="3" fill="${p.divider}" fill-opacity="${p.track}"/>`)
    if (left !== null && most > 0) {
      parts.push(`<rect x="${barX}" y="${y - 7.2}" width="${Math.max(3, (barW * left) / most).toFixed(1)}" height="6" rx="3" fill="${color}"/>`)
    }
    const mark = priceKinds[model] === 'estimated' ? '≈ ' : ''
    parts.push(`<text x="${leftR}" y="${y}" font-size="13" font-weight="700" text-anchor="end" fill="${p.text}" ${nums}>${esc(left !== null ? `${mark}${fmtTokens(left)}` : '—')}</text>`)
    parts.push(`<text x="${usedR}" y="${y}" font-size="10.5" text-anchor="end" fill="${p.muted}" ${nums}>${esc(used ? fmtTokens(tokensOf(used)) : 'none')}</text>`)
  })
  if (rest.length > 0) {
    parts.push(`<text x="16" y="${first + 4 * step}" font-size="10.5" fill="${p.muted}">${esc(`+${rest.length} more: ${rest.map(modelLabel).join(', ')}`)}</text>`)
  }
  // A model whose price is borrowed from its family says so until its price is learned.
  const estimated = models.filter(model => priceKinds[model] === 'estimated').map(modelLabel)
  const left = usdLeft(w, pct)
  const foot =
    estimated.length > 0
      ? `≈ ${estimated.join(', ')}: price${estimated.length > 1 ? 's' : ''} estimated until learned`
      : left !== null
        ? `Same ${fmtUsd(left)} left, spent at each model’s price`
        : 'Not enough usage yet to estimate what is left'
  parts.push(`<text x="16" y="${CARD_H - 10}" font-size="10.5" fill="${p.muted}">${esc(foot)}</text>`)
  return parts.join('')
}

// The By model card's words, for its alt text.
const modelsLine = (w: ContextBandApiWindow, pct: number, models: string[], usdPerToken: Record<string, number>, priceKinds: Record<string, ContextBandPriceKind> = {}) => {
  const rows = models.map(model => {
    const used = w.byModel.find(m => m.model === model)
    const left = tokensLeft(w, pct, usdPerToken, model)
    const mark = priceKinds[model] === 'estimated' ? '≈ ' : ''
    return `${modelLabel(model)} ${used ? fmtTokens(tokensOf(used)) : '0'} used${left !== null ? `, ${mark}${fmtTokens(left)} left if only it` : ''}`
  })
  const left = usdLeft(w, pct)
  return `${limitLabel(w.kind)} window: ${rows.length > 0 ? rows.join(' · ') : 'no Claude Code usage yet'}${left !== null ? ` · ${fmtUsd(left)} left` : ''}`
}

const SANS = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif"`

const chartSvg = (w: ContextBandApiWindow, mode: ContextBandTheme, t: number, width: number, usdPerToken: Record<string, number>) =>
  themedSvg(width, CARD_H, SANS, mode, p => chartBody(w, p, t, width, usdPerToken))

const modelsSvg = (
  w: ContextBandApiWindow,
  pct: number,
  models: string[],
  usdPerToken: Record<string, number>,
  priceKinds: Record<string, ContextBandPriceKind>,
  mode: ContextBandTheme,
  t: number,
  width: number,
) => themedSvg(width, CARD_H, SANS, mode, p => modelsBody(w, pct, models, usdPerToken, priceKinds, p, t, width))

const MINI_W = 96
const MINI_H = 16

// The strip's small chart: this window's spend so far against the previous window's.
function miniChartBody(w: ContextBandApiWindow, p: Palette, t: number) {
  const tone = p.tones[windowTone(w.kind)]
  const { dur, elapsed, spend } = chartGeometry(w, t)
  const top = Math.max(...w.bins, ...w.prevBins, 1e-6)
  const sx = (ms: number) => 1 + (Math.min(dur, Math.max(0, ms)) / dur) * (MINI_W - 2)
  const sy = (usd: number) => MINI_H - 2 - (usd / top) * (MINI_H - 4)
  const line = (bins: number[], until: number) =>
    [`${sx(0).toFixed(1)},${sy(0).toFixed(1)}`]
      .concat(bins.map((v, i) => `${sx(Math.min((i + 1) * w.binMs, until)).toFixed(1)},${sy(v).toFixed(1)}`))
      .join(' ')
  const prev = w.prevBins.length > 0 ? `<polyline points="${line(w.prevBins, dur)}" fill="none" stroke="${p.muted}" stroke-opacity="0.6" stroke-width="1.2"/>` : ''
  return (
    `<line x1="1" x2="${MINI_W - 1}" y1="${MINI_H - 2}" y2="${MINI_H - 2}" stroke="${p.divider}" stroke-width="1"/>${prev}` +
    `<polyline points="${line(w.bins, elapsed)}" fill="none" stroke="${tone.accent}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<circle cx="${sx(elapsed).toFixed(1)}" cy="${sy(spend).toFixed(1)}" r="2.4" fill="${tone.accent}"/>`
  )
}

// One line about a window: the terminal's hover strip, and the alt text of the desktop's.
function chartLine(w: ContextBandApiWindow, t: number, usdPerToken: Record<string, number> = {}) {
  const f = chartFacts(w, t, usdPerToken)
  const head = w.rateUsd ? `${limitLabel(w.kind)} window ≈ ${fmtUsd(w.rateUsd)} at API prices${roughMark(w)}` : `${limitLabel(w.kind)} window: estimating`
  return [
    head,
    verdictText(f),
    ...(!f.early && f.budget !== null ? [`spend up to ${fmtRate(f.budget)}${f.per}`] : []),
    `reset in ${fmtSpan(f.leftMs)}`,
  ].join(' · ')
}

// The terminal's 📈 views are small tables: a header row, then one row per window, each column as
// wide as its widest cell, so the figures for 5h and 7d line up under one another.
type Seg = { text: string; color?: string; isBold?: boolean }
type Cell = Seg[]
const seg = (text: string, color?: string, isBold = false): Seg => ({ text, color, isBold })
const cellLen = (cell: Cell) => cell.reduce((n, s) => n + [...s.text].length, 0)
const COL_GAP = 3

function tableLines(rows: Cell[][]) {
  const widths: number[] = []
  rows.forEach(row => row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cellLen(cell)))))
  const total = widths.reduce((a, b) => a + b, 0) + COL_GAP * Math.max(0, widths.length - 1)
  const lines = rows.map(row =>
    row.flatMap((cell, i) => (i < row.length - 1 ? [...cell, seg(' '.repeat((widths[i] ?? 0) - cellLen(cell) + COL_GAP))] : cell)),
  )
  return { lines, total }
}

// The first layout that fits the width, richest first; the last one is cut at the edge if need be.
function fitTable(layouts: Cell[][][], columns: number) {
  const tables = layouts.map(tableLines)
  return (tables.find(table => table.total <= columns) ?? tables[tables.length - 1]!).lines
}

const BAR = 10

// The terminal Chart view: the Chart card's figures, one row per window. The bar is that card's
// strip in ten cells: the share of the limit used, then where this pace takes it by the reset.
function chartTable(windows: ContextBandApiWindow[], t: number, usdPerToken: Record<string, number>, p: Palette, columns: number) {
  type Layout = { reset: boolean; spendOpus: boolean; average: boolean; averageOpus: boolean; previous: 'full' | 'short' | 'none' }
  const facts = windows.map(w => ({ w, f: chartFacts(w, t, usdPerToken), acc: p.tones[windowTone(w.kind)].accent }))
  const build = (o: Layout): Cell[][] => {
    const header: Cell[] = [
      [seg('At API prices', p.muted)],
      [seg('At this pace', p.muted)],
      ...(o.reset ? [[seg('Reset in', p.muted)]] : []),
      [seg('Spend up to', p.muted)],
      ...(o.average ? [[seg('Average so far', p.muted)]] : []),
      ...(o.previous !== 'none' ? [[seg('Previous window', p.muted)]] : []),
    ]
    const rows = facts.map(({ w, f, acc }): Cell[] => {
      const label = limitLabel(w.kind)
      const used = Math.max(0, Math.min(BAR, Math.round((f.pct / 100) * BAR)))
      const reach = f.early ? used : f.over ? BAR : Math.max(used, Math.min(BAR, Math.round((f.pace / 100) * BAR)))
      const verdict = f.early
        ? seg(f.spend <= 0 ? 'no usage yet' : 'too early to tell', p.muted)
        : f.over && f.tHit !== null
          ? seg(`limit in ${fmtSpan((f.tHit - f.el) * f.win)}`, p.danger, true)
          : seg(`${Math.round(f.pace)}% at reset`, acc, true)
      const rate = (v: number, color: string, isBold: boolean, withOpus: boolean): Cell => [
        seg(`${fmtRate(v)}${f.per}`, color, isBold),
        ...(withOpus ? [seg(` ≈ ${fmtTok3(v / f.opus)} Opus`, p.muted)] : []),
      ]
      return [
        w.rateUsd ? [seg(`${label} ≈ ${fmtUsd(w.rateUsd)}`, acc, true), ...(isRough(w) ? [seg(' (rough)', p.muted)] : [])] : [seg(`${label} estimating`, p.muted)],
        [seg('█'.repeat(used), acc), seg('▒'.repeat(reach - used), f.over ? p.danger : acc), seg('░'.repeat(BAR - reach), p.divider), seg(' '), verdict],
        ...(o.reset ? [[seg(fmtSpan(f.leftMs), p.text)]] : []),
        !f.early && f.budget !== null ? rate(f.budget, f.over ? p.danger : p.text, true, o.spendOpus) : [seg('—', p.muted)],
        ...(o.average ? [f.avg > 0 ? rate(f.avg, p.text, false, o.averageOpus) : [seg('—', p.muted)]] : []),
        ...(o.previous !== 'none'
          ? [
              f.prevNow !== null && f.prevEnd !== null
                ? [seg(`${Math.round(f.prevNow)}% by now${o.previous === 'full' ? `, ${Math.round(f.prevEnd)}% at reset` : ''}`, p.muted)]
                : [seg('—', p.muted)],
            ]
          : []),
      ]
    })
    return [header, ...rows]
  }
  const layouts: Layout[] = [
    { reset: true, spendOpus: true, average: true, averageOpus: true, previous: 'full' },
    { reset: true, spendOpus: true, average: true, averageOpus: true, previous: 'short' },
    { reset: true, spendOpus: true, average: true, averageOpus: false, previous: 'short' },
    { reset: true, spendOpus: true, average: true, averageOpus: false, previous: 'none' },
    { reset: true, spendOpus: true, average: false, averageOpus: false, previous: 'none' },
    { reset: true, spendOpus: false, average: false, averageOpus: false, previous: 'none' },
    { reset: false, spendOpus: false, average: false, averageOpus: false, previous: 'none' },
  ]
  return fitTable(layouts.map(build), columns)
}

// The terminal By model view: a column per model, a row per window, each cell the tokens left in
// that window if you use only that model, then the tokens it has used there.
function modelsTable(
  windows: ContextBandApiWindow[],
  pctOf: (kind: string) => number,
  models: string[],
  usdPerToken: Record<string, number>,
  priceKinds: Record<string, ContextBandPriceKind>,
  p: Palette,
  columns: number,
) {
  const build = (shown: string[], withUsed: boolean): Cell[][] => {
    const more = models.length - shown.length
    const header: Cell[] = [
      [seg('If you use only…', p.muted)],
      ...shown.map(model => [seg(modelLabel(model), modelColor(p, model), true)]),
      ...(more > 0 ? [[seg(`+${more} more`, p.muted)]] : []),
    ]
    const rows = windows.map((w): Cell[] => {
      const pct = pctOf(w.kind)
      const left = usdLeft(w, pct)
      return [
        [seg(limitLabel(w.kind), p.tones[windowTone(w.kind)].accent, true), seg(left !== null ? ` ${fmtUsd(left)} left` : ' estimating', p.text)],
        ...shown.map((model): Cell => {
          const tokens = tokensLeft(w, pct, usdPerToken, model)
          const use = w.byModel.find(m => m.model === model)
          const mark = priceKinds[model] === 'estimated' ? '≈ ' : ''
          return [
            seg(tokens !== null ? `${mark}${fmtTokens(tokens)} left` : '—', p.text, true),
            ...(withUsed ? [seg(` · ${use ? `${fmtTokens(tokensOf(use))} used` : 'none used'}`, p.muted)] : []),
          ]
        }),
      ]
    })
    return [header, ...rows]
  }
  const layouts = [build(models, true), build(models, false)]
  for (let k = models.length - 1; k >= 1; k--) layouts.push(build(models.slice(0, k), false))
  const lines = models.length > 0 ? fitTable(layouts, columns) : [[seg('No Claude Code usage in these windows yet', p.muted)]]
  const estimated = models.filter(model => priceKinds[model] === 'estimated').map(modelLabel)
  return estimated.length > 0 ? [...lines, [seg(`≈ ${estimated.join(', ')}: price estimated until learned`, p.muted)]] : lines
}

type Pill = {
  id: string
  tone: ToneKey
  icon?: IconName
  label?: string
  labelIsAccent?: boolean
  value: string
  level?: Level
  isBold?: boolean
  sub?: string
  // Larger numbers give way first when the line runs out of room.
  priority: number
  subPriority?: number
  scope?: string
}

// Desktop pills are drawn as SVG at a fixed size: plugin Text takes the surface's own size and a
// one-cell gap, both larger than this band wants. Monospace, so every width is exact.
const PILL_H = 22
const PILL_FONT = 12
const CH = PILL_FONT * 0.6
const PILL_PAD = 6
const PILL_ICON = 13
const SP = 5
const PILL_GAP = 4
const MONO = `font-family="ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace" font-size="${PILL_FONT}"`
// The desktop's cell, in CSS pixels, as offsets and widths in cells are drawn there.
const CELL_PX = 7.7

const pillPx = (pill: Pill) =>
  PILL_PAD * 2 +
  (pill.icon ? PILL_ICON + SP : 0) +
  (pill.label ? pill.label.length * CH + SP : 0) +
  pill.value.length * CH +
  (pill.sub ? SP * 2 + 3 + pill.sub.length * CH : 0)

function pillBody(pill: Pill, p: Palette) {
  const width = Math.ceil(pillPx(pill))
  const tone = p.tones[pill.tone]
  const mid = PILL_H / 2
  const parts: string[] = [`<rect width="${width}" height="${PILL_H}" rx="7" fill="${tone.bg}"/>`]
  let x = PILL_PAD
  if (pill.icon) {
    parts.push(
      `<g transform="translate(${x} ${mid - PILL_ICON / 2}) scale(${PILL_ICON / 24})" fill="none" stroke="${tone.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[pill.icon]}</g>`,
    )
    x += PILL_ICON + SP
  }
  const text = (str: string, color: string, isBold = false) => {
    parts.push(`<text x="${x.toFixed(1)}" y="${mid}" dominant-baseline="central" fill="${color}"${isBold ? ' font-weight="700"' : ''}>${esc(str)}</text>`)
    x += str.length * CH
  }
  if (pill.label) {
    text(pill.label, pill.labelIsAccent ? tone.accent : p.muted)
    x += SP
  }
  text(pill.value, levelColor(p, pill.level), pill.isBold)
  if (pill.sub) {
    x += SP + 1
    parts.push(`<rect x="${x.toFixed(1)}" y="${mid - 5.5}" width="1" height="11" fill="${p.divider}"/>`)
    x += 2 + SP
    text(pill.sub, p.muted)
  }
  return parts.join('')
}

const pillSvg = (pill: Pill, mode: ContextBandTheme, below = 0) =>
  themedSvg(Math.ceil(pillPx(pill)) + PILL_GAP, PILL_H + below, MONO, mode, p => pillBody(pill, p))

// Cells the "+N" button takes when some pills sit behind it.
const MORE_CELLS = 4
// Room between wrapped rows of pills.
const ROW_SPACE = 5

const pillAlt = (pill: Pill) => [pill.label, pill.value, pill.sub].filter(Boolean).join(' ')

// The hover strip: one line over the pills to the right of the hovered one, the same height as
// them. It keeps what fits, in order of importance: the estimate, the verdict, the chart, the rest.
function stripBody(w: ContextBandApiWindow, pct: number, p: Palette, t: number, width: number) {
  const tone = p.tones[windowTone(w.kind)]
  const mid = PILL_H / 2
  const f = chartFacts(w, t)
  type Piece = { rank: number; px: number; draw: (x: number) => string }
  const text = (rank: number, str: string, color: string, isBold = false): Piece => ({
    rank,
    px: str.length * CH,
    draw: x => `<text x="${x.toFixed(1)}" y="${mid}" dominant-baseline="central" fill="${color}"${isBold ? ' font-weight="700"' : ''}>${esc(str)}</text>`,
  })
  const pieces: Piece[] = [
    text(0, `${limitLabel(w.kind)}`, tone.accent),
    text(0, w.rateUsd ? `≈ ${fmtUsd(w.rateUsd)}` : 'estimating', p.text, true),
    text(1, `at API prices${roughMark(w)}`, p.muted),
    ...(f.early ? [] : [text(2, verdictText(f), f.over ? p.danger : p.muted, f.over)]),
    { rank: 3, px: MINI_W, draw: x => `<g transform="translate(${x.toFixed(1)} ${mid - MINI_H / 2})">${miniChartBody(w, p, t)}</g>` },
    text(4, `${fmtUsd(w.spendUsd)} spent`, p.muted),
    ...(w.prevRateUsd ? [text(5, `previous ≈ ${fmtUsd(w.prevRateUsd)}`, p.muted)] : []),
  ]
  const room = width - PILL_PAD * 2
  const kept = new Set<Piece>()
  let used = 0
  for (const piece of [...pieces].sort((a, b) => a.rank - b.rank)) {
    const cost = piece.px + (kept.size > 0 ? SP + 4 : 0)
    if (used + cost > room && piece.rank > 0) continue
    kept.add(piece)
    used += cost
  }
  const parts: string[] = [`<rect x="0.5" y="0.5" width="${width - 1}" height="${PILL_H - 1}" rx="7" fill="${p.card}" stroke="${tone.accent}"/>`]
  let x = PILL_PAD
  for (const piece of pieces.filter(one => kept.has(one))) {
    parts.push(piece.draw(x))
    x += piece.px + SP + 4
  }
  return parts.join('')
}

const stripSvg = (w: ContextBandApiWindow, pct: number, mode: ContextBandTheme, t: number, width: number) =>
  themedSvg(width, PILL_H, MONO, mode, p => stripBody(w, pct, p, t, width))

const levelOf = (percent: number): Level => (percent >= 85 ? 'danger' : percent >= 60 ? 'warn' : 'normal')

const levelColor = (p: Palette, level: Level | undefined) => (level === 'danger' ? p.danger : level === 'warn' ? p.warn : p.text)

const windowTone = (kind: string): ToneKey => (isFiveHour(kind) ? 'fiveHour' : 'sevenDay')

const terminalWidth = (pill: Pill) =>
  2 + (pill.icon ? 2 : 0) + (pill.label ? pill.label.length + 1 : 0) + pill.value.length + (pill.sub ? pill.sub.length + 3 : 0)

// Keeps the band on one line: drops a detail, then a whole pill, least important first.
function fitPills(pills: Pill[], budget: number, widthOf: (pill: Pill) => number) {
  const list = [...pills]
  const total = () => list.reduce((sum, pill, i) => sum + widthOf(pill) + (i > 0 ? 1 : 0), 0)
  while (list.length > 0 && total() > budget) {
    let worst = { index: 0, isSub: false, rank: -1 }
    list.forEach((pill, index) => {
      if (pill.sub && pill.subPriority !== undefined && pill.subPriority > worst.rank) worst = { index, isSub: true, rank: pill.subPriority }
      if (pill.priority > worst.rank) worst = { index, isSub: false, rank: pill.priority }
    })
    const target = list[worst.index]
    if (!target) break
    if (worst.isSub) list[worst.index] = { ...target, sub: undefined }
    else list.splice(worst.index, 1)
  }
  return list
}

// Estimator runs and the band's last measured width: this module's own, started over by a reload.
const scan = { at: 0, isRunning: false, hasSeeded: false }
const layout = { surface: '', bodyColumns: 0, saved: '' }

// Each session's cost as Claude Code itself counts it, at current prices, kept so the estimator
// can learn the price of a model its table does not know (or has wrong): it sets that cost
// against the tokens each model used in the session.
const recorded = { usd: -1 }

type SessionCostRecord = { usd: number; since: number; at: number }

async function recordSessionCost($: EngineInterface, usd: number) {
  if (Math.abs(usd - recorded.usd) < 0.01) return
  recorded.usd = usd
  const id = await $.session.id()
  const since = (await $.session.usage()).startedAt
  const at = await $.clock.now()
  const stored = await $.store.get('sessionCosts')
  const costs: Record<string, SessionCostRecord> = stored && typeof stored === 'object' ? { ...(stored as Record<string, SessionCostRecord>) } : {}
  costs[id] = { usd, since, at }
  const newest = Object.entries(costs).sort((a, b) => b[1].at - a[1].at).slice(0, 80)
  await $.store.set('sessionCosts', Object.fromEntries(newest))
}

// Runs bin/api_estimate.py: the API-equivalent spend inside each rate-limit window.
async function scanApi($: EngineInterface, minGapMs: number) {
  const t = await $.clock.now()
  if (scan.isRunning || t - scan.at < minGapMs) return
  const limits = (await read($, usage))?.limits ?? []
  if (limits.length === 0) return
  scan.isRunning = true
  scan.at = t
  try {
    const stored = await $.store.get('sessionCosts')
    const sessionCosts =
      stored && typeof stored === 'object'
        ? Object.entries(stored as Record<string, SessionCostRecord>).map(([sessionId, c]) => ({ sessionId, usd: c.usd, since: c.since }))
        : []
    const sessionId = await $.session.id().catch(() => null)
    const arg = JSON.stringify({ now: t, windows: limits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })), sessionCosts, sessionId })
    const { exitCode, stdout } = await $.process.run(['python3', `${$.plugin.root}/bin/api_estimate.py`, arg], { timeoutMs: 60_000 })
    const parsed = exitCode === 0 ? parseApi(stdout) : null
    const current = await read($, api)
    if (parsed && JSON.stringify(current?.windows) !== JSON.stringify(parsed.windows)) await update($, api, () => parsed)
    // Loaded partway through a session (installed or reloaded mid-session), the band has counted
    // nothing yet: it starts from the tokens the transcript says the session has used. Only once
    // per load, so a reset of the counters stays a reset.
    if (parsed && !scan.hasSeeded) {
      scan.hasSeeded = true
      const seen = parseSession(stdout)
      if (seen && seen.requests > 0) await update($, stats, s => (s.requests === 0 ? seen : s))
    }
  } catch {
  } finally {
    scan.isRunning = false
  }
}

// Kept so the width estimate can be checked against what the surface reports.
async function saveLayout($: EngineInterface) {
  const seen = JSON.stringify({ surface: layout.surface, bodyColumns: layout.bodyColumns })
  if (seen === layout.saved || layout.bodyColumns === 0) return
  layout.saved = seen
  await $.store.set('layout', { surface: layout.surface, bodyColumns: layout.bodyColumns })
}

export const register: Register = on => {
  // Per-turn generation timing for the main loop, keyed by turnId.
  const speed = new Map<string, { tokens: number; ms: number }>()
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'context-band',
      description: 'Context band: theme auto|light|dark, hide, show, reset',
      argumentHint: '[auto|light|dark|hide|show|reset]',
      immediate: true,
    })
    // A new key, so a choice pinned by an earlier version ("theme") starts over on auto.
    const saved = await $.store.get('themeMode')
    if (typeof saved === 'string' && (THEMES as readonly string[]).includes(saved)) {
      await update($, theme, () => saved as ContextBandTheme)
    }
    await refreshAppearance($)
    await refreshClock($)
    await refreshUsage($)
    void scanApi($, 0)
    $.clock.every(30_000, () => {
      void refreshClock($)
      void read($, theme).then(mode => (mode === 'auto' ? refreshAppearance($) : undefined))
      void scanApi($, 2 * 60_000)
      void saveLayout($)
    })
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let firstAt = 0
    for await (const chunk of stream) {
      if (firstAt === 0) firstAt = await $.clock.now()
      yield chunk
    }
    const result = await stream.result
    try {
      const u = result.usage
      if (u) {
        await update($, stats, s => ({
          input: s.input + u.input_tokens,
          output: s.output + u.output_tokens,
          cacheRead: s.cacheRead + u.cache_read_input_tokens,
          cacheWrite: s.cacheWrite + u.cache_creation_input_tokens,
          requests: s.requests + 1,
        }))
        if (!e.agentId && firstAt > 0) {
          const ms = (await $.clock.now()) - firstAt
          const acc = speed.get(e.turnId) ?? { tokens: 0, ms: 0 }
          speed.set(e.turnId, { tokens: acc.tokens + u.output_tokens, ms: acc.ms + ms })
        }
      }
    } catch {}
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      const acc = speed.get(e.turnId)
      speed.delete(e.turnId)
      const turn: ContextBandTurn = {
        durationMs: e.durationMs,
        tps: acc && acc.ms > 250 && acc.tokens > 0 ? (acc.tokens * 1000) / acc.ms : null,
        model: e.usage?.model ?? null,
      }
      await update($, lastTurn, prev => (turn.tps === null && prev ? { ...turn, tps: prev.tps, model: turn.model ?? prev.model } : turn))
      await refreshClock($)
      await refreshUsage($)
    }
    return done
  })

  on('session.measure', async ($, e, next) => {
    const next_ = toUsage(e)
    if (JSON.stringify(await read($, usage)) !== JSON.stringify(next_)) await update($, usage, () => next_)
    if (e.cost) {
      try {
        await recordSessionCost($, e.cost.usd)
      } catch {}
    }
    // After each turn and each move of a limit: a warm scan reads only new transcript lines.
    void scanApi($, 15_000)
    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const done = await next(e)
    if ((await read($, theme)) === 'auto') await refreshAppearance($)
    return done
  })

  on('command.run', { command: 'context-band' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((THEMES as readonly string[]).includes(arg)) {
      await setTheme($, arg as ContextBandTheme)
      return { text: `Context band theme: ${arg}` }
    }
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: `Context band ${arg === 'hide' ? 'hidden' : 'shown'}` }
    }
    if (arg === 'reset') {
      await update($, stats, () => EMPTY)
      return { text: 'Context band token counters reset' }
    }
    const mode = await read($, theme)
    return { text: `Context band — theme: ${mode}. Usage: /context-band auto|light|dark|hide|show|reset` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const s = await read($, stats)
    const u = await read($, usage)
    const turn = await read($, lastTurn)
    if (s.requests === 0 && !u) return next(e)

    const mode = await read($, theme)
    const isTerminal = e.surface === 'terminal'
    const p = resolveDark(mode, await read($, appearance), isTerminal) ? DARK : LIGHT
    const t = (await read($, now)) || (await $.clock.now())
    const apiState = await read($, api)
    const estimates = apiState?.windows ?? []
    const usdPerToken = apiState?.usdPerToken ?? {}
    const priceKinds = apiState?.priceKinds ?? {}
    // The models every By model card lists: those used in any window, in tier order so rows keep
    // their places as costs move, the newest version first within a family.
    const used = new Set(estimates.flatMap(w => w.byModel.map(m => m.model)))
    const models = [...used].sort((a, b) => tierRank(a) - tierRank(b) || b.localeCompare(a, undefined, { numeric: true }))
    layout.surface = e.surface
    layout.bodyColumns = e.props.bodyColumns

    const pills: Pill[] = []
    for (const limit of u?.limits ?? []) {
      const isWeek = !isFiveHour(limit.kind)
      const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
      pills.push({
        id: `limit-${limit.kind}`,
        tone: windowTone(limit.kind),
        icon: isWeek ? 'calendar' : 'gauge',
        label: limitLabel(limit.kind),
        value: fmtPercent(limit.percentUsed),
        level: levelOf(limit.percentUsed),
        isBold: true,
        sub: Number.isFinite(resetsAt) ? fmtLeft(resetsAt - t) : undefined,
        priority: isWeek ? 4 : 3,
        subPriority: isWeek ? 6.5 : 6,
        scope: estimates.some(w => w.kind === limit.kind) ? `cb-${limit.kind}` : undefined,
      })
    }
    if (s.requests > 0) {
      pills.push({ id: 'in', tone: 'input', label: 'in', labelIsAccent: true, value: fmtTok3(s.input), priority: 10 })
      pills.push({ id: 'out', tone: 'output', label: 'out', labelIsAccent: true, value: fmtTok3(s.output), priority: 8 })
    }
    if (turn?.tps) {
      pills.push({ id: 'speed', tone: 'speed', icon: 'bolt', value: `${Math.round(turn.tps)} t/s`, priority: 5.5 })
    }
    if (s.requests > 0) {
      const cached = s.cacheRead + s.cacheWrite
      const prompt = s.input + cached
      pills.push({
        id: 'cache',
        tone: 'cache',
        label: 'cache',
        labelIsAccent: true,
        value: fmtTok3(cached),
        sub: prompt > 0 ? `${Math.round((s.cacheRead / prompt) * 100)}% hit` : undefined,
        priority: 9,
        subPriority: 18,
      })
    }
    if (u?.costUsd !== null && u?.costUsd !== undefined) {
      pills.push({ id: 'cost', tone: 'cost', icon: 'coin', value: `$${u.costUsd.toFixed(2)}`, priority: 5 })
    }
    if (u?.ctxPercent !== null && u?.ctxPercent !== undefined) {
      pills.push({
        id: 'ctx',
        tone: 'ctx',
        icon: 'doc',
        label: 'ctx',
        value: `${Math.round(u.ctxPercent)}%`,
        level: levelOf(u.ctxPercent),
        isBold: true,
        sub: u.ctxTokens !== null ? `${fmtTokens(u.ctxTokens)}/${fmtTokens(u.ctxWindow)}` : undefined,
        priority: 2,
        subPriority: 15,
      })
    }

    const themeGlyph = mode === 'auto' ? '◐' : mode === 'light' ? '☀' : '☾'
    const cycleTheme = () => setTheme($, THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length] ?? 'auto')
    const toggleChart = () => update($, isChartOpen, open => !open)
    const isOpen = await read($, isChartOpen)
    const view = await read($, chartView)
    const switchView = () => update($, chartView, current => (current === 'chart' ? 'models' : 'chart'))
    const columns = e.props.bodyColumns > 0 ? e.props.bodyColumns : 100
    const pctOf = (kind: string) => u?.limits.find(l => l.kind === kind)?.percentUsed ?? 0
    const estimateOf = (pill: Pill) => estimates.find(w => `cb-${w.kind}` === pill.scope)
    const toneOf = (w: ContextBandApiWindow) => p.tones[windowTone(w.kind)]
    const toneFor = (pill: Pill) => p.tones[pill.tone]
    const isTerminalSurface = e.surface === 'terminal'
    // Terminal widths are cells; desktop widths are the SVG pills' pixels.
    const widthOf = isTerminalSurface ? terminalWidth : (pill: Pill) => (pillPx(pill) + PILL_GAP) / CELL_PX
    // The desktop row holds only 📈 beside the pills (◐ sits in the chart panel); the terminal row
    // holds both, and room for the view switch while the charts are open.
    const buttonCells = isTerminalSurface ? (estimates.length > 0 ? 6 : 3) + (isOpen ? 10 : 0) : estimates.length > 0 ? 3 : 0
    const budget = columns - buttonCells
    const fitWidth = isTerminalSurface ? widthOf : (pill: Pill) => widthOf(pill) - 1
    const fitsAll = fitPills(pills, budget, fitWidth)
    // A whole pill never disappears: when one does not fit, a "+N" button expands the band onto as
    // many lines as it needs, and folds it back to one. A trimmed detail alone (a reset countdown,
    // a hit rate) does not call for the button, whose own room would cost a pill its place.
    const isCut = fitsAll.length < pills.length
    const isExpanded = (await read($, isRowExpanded)) && isCut
    const shown = isExpanded ? pills : isCut ? fitPills(pills, budget - MORE_CELLS, fitWidth) : fitsAll
    const hiddenCount = pills.length - shown.length
    const moreLabel = isExpanded ? 'Less' : `+${hiddenCount}`
    const toggleRow = () => update($, isRowExpanded, open => !open)
    // Where each pill ends, so a strip opens just right of the pill under the pointer and never
    // covers it: covering it would end the hover that shows the strip.
    const ends = new Map<string, number>()
    shown.reduce((x, pill, i) => {
      const end = x + (isTerminalSurface && i > 0 ? 1 : 0) + widthOf(pill)
      ends.set(pill.id, end)
      return end
    }, 0)
    // The hover strips assume one line, so the expanded band goes without them.
    const strips = (isExpanded ? [] : shown).flatMap(pill => {
      const w = estimateOf(pill)
      if (!pill.scope || !w) return []
      const left = Math.ceil(ends.get(pill.id) ?? 0) + 1
      return [{ scope: pill.scope, w, left, width: Math.max(20, columns - left - 1) }]
    })

    if (isTerminalSurface) {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" width={columns}>
          {isOpen && estimates.length > 0
            ? (view === 'models' ? modelsTable(estimates, pctOf, models, usdPerToken, priceKinds, p, columns) : chartTable(estimates, t, usdPerToken, p, columns)).map(line => (
                <Text wrap="truncate">
                  {line.map(s => (
                    <Text {...(s.color ? { color: s.color } : {})} {...(s.isBold ? { bold: true } : {})}>
                      {s.text}
                    </Text>
                  ))}
                </Text>
              ))
            : null}
          <Box flexDirection="row" flexWrap={isExpanded ? 'wrap' : 'nowrap'} columnGap={1} overflow="hidden">
            {shown.map(pill => (
              <Box key={pill.id} flexDirection="row" flexShrink={0} {...(pill.scope ? { hover: { scope: pill.scope } } : {})}>
                <Text backgroundColor={toneFor(pill).bg} color={toneFor(pill).accent}>
                  {' '}
                  {pill.icon ? `${GLYPHS[pill.icon]} ` : ''}
                </Text>
                {pill.label ? (
                  <Text backgroundColor={toneFor(pill).bg} color={pill.labelIsAccent ? toneFor(pill).accent : p.muted}>
                    {pill.label}{' '}
                  </Text>
                ) : null}
                <Text backgroundColor={toneFor(pill).bg} color={levelColor(p, pill.level)} bold={pill.isBold}>
                  {pill.value}
                </Text>
                {pill.sub ? (
                  <Text backgroundColor={toneFor(pill).bg} color={p.divider}>
                    {' │ '}
                  </Text>
                ) : null}
                {pill.sub ? (
                  <Text backgroundColor={toneFor(pill).bg} color={p.muted}>
                    {pill.sub}
                  </Text>
                ) : null}
                <Text backgroundColor={toneFor(pill).bg}> </Text>
              </Box>
            ))}
            {isCut ? <Button key="more" label={moreLabel} plain dimColor onPress={toggleRow} /> : null}
            <Button key="theme" label={themeGlyph} plain dimColor onPress={cycleTheme} />
            {estimates.length > 0 ? <Button key="chart" label="📈" plain dimColor onPress={toggleChart} /> : null}
            {isOpen && estimates.length > 0 ? <Button key="view" label={view === 'chart' ? 'By model' : 'Chart'} plain dimColor onPress={switchView} /> : null}
            {strips.map(strip => (
              <Box position="absolute" top={0} left={strip.left} width={strip.width} display="none" hover={{ scope: strip.scope, display: 'flex' }}>
                <Text backgroundColor={toneOf(strip.w).bg} color={p.text} wrap="truncate">
                  {` ${chartLine(strip.w, t, usdPerToken)} `}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const { Box, Button, Svg } = $.ui.resolve(e)
    // The view switch stands in a column beside the cards, so the cards leave it room.
    const switchPx = 96
    const cardWidth = Math.max(260, Math.min(440, Math.floor((columns * CELL_PX - 12 - switchPx) / Math.max(1, estimates.length))))
    return (
      <Box flexDirection="column">
        {isOpen && estimates.length > 0 ? (
          <Box flexDirection="row" gap={1} marginBottom={1}>
            {estimates.map(w => (
              <Svg
                source={view === 'models' ? modelsSvg(w, pctOf(w.kind), models, usdPerToken, priceKinds, mode, t, cardWidth) : chartSvg(w, mode, t, cardWidth, usdPerToken)}
                alt={
                  view === 'models'
                    ? modelsLine(w, pctOf(w.kind), models, usdPerToken, priceKinds)
                    : w.rateUsd
                      ? `${limitLabel(w.kind)} window ≈ ${fmtUsd(w.rateUsd)} at API prices`
                      : `${limitLabel(w.kind)} window: estimating`
                }
                width={cardWidth}
                height={CARD_H}
              />
            ))}
            <Box flexDirection="column" gap={1} flexShrink={0}>
              <Button key="view-chart" label="Chart" variant={view === 'chart' ? 'primary' : 'secondary'} onPress={() => update($, chartView, () => 'chart')} />
              <Button key="view-models" label="By model" variant={view === 'models' ? 'primary' : 'secondary'} onPress={() => update($, chartView, () => 'models')} />
              <Button key="theme" label={themeGlyph} plain dimColor onPress={cycleTheme} />
            </Box>
          </Box>
        ) : null}
        <Box flexDirection="row" flexWrap={isExpanded ? 'wrap' : 'nowrap'} alignItems="center" overflow="hidden">
          {shown.map(pill => (
            <Box key={pill.id} flexShrink={0} {...(pill.scope ? { hover: { scope: pill.scope } } : {})}>
              <Svg
                source={pillSvg(pill, mode, isExpanded ? ROW_SPACE : 0)}
                alt={pillAlt(pill)}
                width={Math.ceil(pillPx(pill)) + PILL_GAP}
                height={PILL_H + (isExpanded ? ROW_SPACE : 0)}
              />
            </Box>
          ))}
          {isCut ? <Button key="more" label={moreLabel} plain dimColor onPress={toggleRow} /> : null}
          {estimates.length > 0 ? <Button key="chart" label="📈" plain dimColor onPress={toggleChart} /> : null}
          {strips.map(strip => {
            const width = Math.floor(strip.width * CELL_PX)
            return (
              <Box position="absolute" top={0} left={strip.left} width={strip.width} display="none" hover={{ scope: strip.scope, display: 'flex' }}>
                <Svg source={stripSvg(strip.w, pctOf(strip.w.kind), mode, t, width)} alt={chartLine(strip.w, t, usdPerToken)} width={width} height={PILL_H} />
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
