// The main conversation's prompt cache: when the last request that read or wrote it started (an
// entry lives from the start of the request that last touched it; 0 before one) and how long an
// entry lives (1 hour or 5 minutes, null until the transcript has shown a cache write).
export type CacheTimerCache = {
  startedAt: number
  ttlMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      cache: CacheTimerCache
      tick: number
    }
  }
}
