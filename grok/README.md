# context-band for Grok Build

[中文](#中文)

A status line for [Grok Build](https://x.ai/build) with the weekly usage limit, tokens in and out, output speed, cached tokens and hit rate, the session's cost at API prices, and how full the context window is:

```
▦ 7d 12% │ 4d6h   in 84.2k   out 12.3k   ϟ 71 t/s   cache 1.20M │ 93% hit   $ $1.84   ▤ ctx 22% │ 56.3k/256k
```

It stays on one line: when the row is narrow it drops a detail, then a whole figure, least important first. Colours are the terminal's own 16 ANSI colours, so it follows a light or dark theme.

## Install

```sh
grok/install.sh
```

copies the script to `~/.grok/statusline/`. Then add to `~/.grok/config.toml` and restart Grok (it reads this at startup):

```toml
[ui.status_line]
type = "command"
command = "~/.grok/statusline/context_band.py"
refresh_interval = 60
```

Needs `python3`. Run `install.sh` again after pulling changes.

## Where the figures come from

- Tokens, cache, cost and context: the status JSON Grok pipes to the script. Grok sends new figures only when a turn ends, so while a turn runs (and through a new session's first turn) the band sums the session's requests from Grok's log instead and takes the context from the newest request, so they move with each request. The cost still updates at the end of each turn.
- Output speed and the weekly limit: Grok's own log, `~/.grok/logs/unified.jsonl`, read incrementally (the script keeps its place in `~/.cache/context-band/grok-log.json`). The log is internal and undocumented, so a later Grok can change it; the band then leaves those figures out.
- The weekly limit is written to that log only when Grok fetches its billing data, so it can be old. When the reading is over 6 hours old the band shows the day it was taken, and it hides the figure once that week has reset. Grok has no 5-hour window.
- The cost is what the session would cost at API prices; on a subscription it is not a charge.

---

## 中文

给 Grok Build 用的状态行，显示周额度、输入/输出 token、输出速度、缓存 token 和命中率、按 API 价格计算的花费，以及上下文占用。只占一行，窄的时候先省略次要信息；颜色用终端自带的 16 色，自动跟随浅色/深色主题。

### 安装

运行 `grok/install.sh`（把脚本复制到 `~/.grok/statusline/`），然后在 `~/.grok/config.toml` 里加上面那段 `[ui.status_line]`，重启 Grok 生效。需要 `python3`；拉取更新后再运行一次 `install.sh`。

### 数据来源

- token、缓存、花费、上下文：来自 Grok 传给脚本的状态数据。Grok 只在每轮回复结束时更新这些数字，所以回复进行中（包括新会话的第一轮）改从日志里累计本会话每次请求的 token，上下文取最近一次请求的大小，每次请求都会更新。花费还是每轮结束才更新。
- 输出速度和周额度：来自 Grok 自己的日志 `~/.grok/logs/unified.jsonl`（增量读取）。这个日志是内部格式，以后的 Grok 可能会改，到时状态栏会自动不显示这两项。
- 周额度只在 Grok 拉取账单数据时才写进日志，所以可能是旧数据：超过 6 小时会标出是哪天的数据，这一周重置后就不再显示。Grok 没有 5 小时窗口。
- 花费是按 API 价格折算的，订阅用户并不会被扣这笔钱。
