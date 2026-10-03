export type ContextBandStats = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
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
export type ContextBandApi = { at: number; windows: ContextBandApiWindow[]; usdPerToken: Record<string, number> }

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
    }
  }
}
