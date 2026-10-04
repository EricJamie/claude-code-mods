# context-band for Codex

[中文](#中文)

Codex has no way for a third party to draw in its UI: the CLI's status line takes only built-in items (no script, openai/codex#17827), and the desktop app (`ChatGPT.app`, bundle `com.openai.codex`) has no extension surface at all. So the Codex version is configuration: the built-in items closest to the band.

Add to `~/.codex/config.toml`:

```toml
[tui]
status_line = ["model-with-reasoning", "five-hour-limit", "weekly-limit", "context-used", "total-input-tokens", "total-output-tokens"]
```

The CLI's footer then shows the model and reasoning effort, how much of the 5-hour and weekly limits is left, context used, and tokens in and out. `/statusline` in the CLI edits the same list.

In the desktop app, `[desktop] show-context-window-usage = true` puts a context meter in the composer; the rate limits are in the composer menu.

## One line after each reply

What the built-in items cannot show (output speed, cached tokens and hit rate, reset countdowns, and what the weekly limit is worth at API prices) comes as a Stop hook that adds one line under each reply, in the CLI and the desktop app:

```
↳ Hook · 94 t/s · cache 4.71M (95% hit) · 5h 4% (resets in 4h40m) · week 1% (resets in 6d10h) · week ≈ $29 · 42.8M tokens at API prices (rough)
```

```sh
codex/install.sh
```

copies `context_band_hook.py` to `~/.codex/context-band/` and registers it in `~/.codex/hooks.json`. Then approve it once in Codex with `/hooks`. The line is Chinese by default; add `CONTEXT_BAND_LANG=en` before `python3` in the hook's command for English. Needs `python3`.

- The line is for you only: a Stop hook's message reaches the model only when the hook blocks the turn, which this one never does.
- Output speed is output tokens (reasoning included) over the time from each request's input to its response, so it includes the wait for the first token; it is left out under 50 output tokens.
- The weekly estimate prices every response of the current weekly window at OpenAI's API list prices for its model (`PRICES` in the script; a model it does not list, such as the hidden `codex-auto-review`, is priced as GPT-6.1-Sol) and divides by the share of the limit used. Codex reports that share in whole percents, so under 5% the estimate is marked rough. It reads low if ChatGPT usage outside Codex counts toward the same limit.
- It reads the rollout files under `~/.codex/sessions` incrementally (its place is kept in `~/.cache/context-band/codex-scan.json`), so a run takes a few hundredths of a second.

---

## 中文

Codex 不允许第三方在它的界面里画东西：命令行的状态行只能从内置选项里选（不能接脚本，见 openai/codex#17827），桌面版（`ChatGPT.app`）完全没有扩展接口。所以 Codex 版就是一段配置，用最接近状态栏的内置选项。

在 `~/.codex/config.toml` 里加上面那段 `[tui]`。命令行底部会显示：模型和推理强度、5 小时和每周额度剩余、上下文占用、输入/输出 token。在命令行里用 `/statusline` 也能改这个列表。

桌面版里，`[desktop] show-context-window-usage = true` 会在输入框里显示上下文用量，额度在输入框的菜单里能看到。

### 每次回复后的一行统计

内置选项显示不了的（输出速度、缓存和命中率、重置倒计时、周额度按 API 价格的预估），用一个 Stop hook 在每次回复下方加一行，命令行和桌面版都能看到：

```
↳ Hook · 94 t/s · 缓存 4.71M（命中 95%） · 5h 4%（4h40m 后重置） · 周 1%（6d10h 后重置） · 周限 ≈ $29 · 42.8M tokens（粗估）
```

运行 `codex/install.sh`（复制脚本到 `~/.codex/context-band/`，并在 `~/.codex/hooks.json` 里注册），然后在 Codex 里用 `/hooks` 确认信任一次。默认中文，在 hook 命令的 `python3` 前加 `CONTEXT_BAND_LANG=en` 改成英文。需要 `python3`。

- 这行字只给你看：Stop hook 的消息只有在它要求继续对话时才会发给模型，这个 hook 从不这样做。
- 输出速度 = 输出 token（含推理）÷ 从请求发出到回复结束的时间，包含等待首个 token 的时间；输出不足 50 token 时不显示。
- 周限预估：把本周窗口内每次请求按该模型的 OpenAI API 价格计价（脚本里的 `PRICES`；没列出的模型，比如隐藏的 `codex-auto-review`，按 GPT-6.1-Sol 算），再除以已用比例。Codex 给的比例是整数，所以不到 5% 时标"粗估"。如果 ChatGPT 里的使用也算进同一个额度，预估会偏低。
- 增量读取 `~/.codex/sessions` 下的会话记录，每次只要零点几秒。
