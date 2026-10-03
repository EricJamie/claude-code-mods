export type ContextBandStats = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
}

// The main conversation's prompt cache: when the last request that read or wrote it started (an
// entry lives from the start of the request that last touched it), how long it lives, and what
// writing and reading it costs at API prices. startedAt is 0 before a request; the rest null until
// the transcript has shown them.
export type ContextBandCache = {
  startedAt: number
  ttlMs: number | null
  writeUsdPerMTok: number | null
  readUsdPerMTok: number | null
}

export type ContextBandLimit = { kind: string; percentUsed: number; resetsAt: string | null }

export type ContextBandUsage = {
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number
  limits: ContextBandLimit[]
  costUsd: number | null
}

export type ContextBandTurn = { durationMs: number; tps: number | null; model: string | null }

export type ContextBandTheme = 'auto' | 'light' | 'dark'

// What "auto" resolves from: macOS, Claude Code's theme setting (terminal) and the desktop app's own mode.
export type ContextBandAppearance = { isSystemDark: boolean; cli: 'dark' | 'light' | 'auto'; desktop: 'dark' | 'light' | 'system' }

// One model's share of a window: its API cost and its tokens, as the transcripts record them.
export type ContextBandModelUse = {
  model: string
  usd: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ContextBandChartView = 'chart' | 'models'

// What a rate-limit window is worth at API list prices, from bin/api_estimate.py.
export type ContextBandApiWindow = {
  kind: string
  startAt: number
  endAt: number
  binMs: number
  bins: number[]
  prevBins: number[]
  spendUsd: number
  pct: number
  prevSpendUsd: number
  prevPct: number | null
  rateUsd: number | null
  prevRateUsd: number | null
  basis: string | null
  byModel: ContextBandModelUse[]
}

// `usdPerToken`: what a token costs on each model at your own mix of input, output and cache, so
// the dollars left in a window convert to the tokens left if you used only that model.
// How each model's price was found: the table has it ("list"), it was learned from Claude Code's
// own session costs ("learned"), or it is borrowed from its family until learned ("estimated").
export type ContextBandPriceKind = 'list' | 'learned' | 'estimated'

export type ContextBandApi = {
  at: number
  windows: ContextBandApiWindow[]
  usdPerToken: Record<string, number>
  priceKinds: Record<string, ContextBandPriceKind>
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': {
      stats: ContextBandStats
      usage: ContextBandUsage | null
      turn: ContextBandTurn | null
      now: number
      theme: ContextBandTheme
      appearance: ContextBandAppearance
      isHidden: boolean
      api: ContextBandApi | null
      isChartOpen: boolean
      chartView: ContextBandChartView
      isRowExpanded: boolean
      cache: ContextBandCache
      tick: number
    }
  }
}
