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

What the built-in items cannot show: reset countdowns, cached tokens and hit rate, output speed, and cost (except on Enterprise). Codex writes all of these to `~/.codex/sessions/**/*.jsonl` (`token_count` events), so a tool outside Codex, such as a menu-bar app or a tmux segment, could show them.

---

## 中文

Codex 不允许第三方在它的界面里画东西：命令行的状态行只能从内置选项里选（不能接脚本，见 openai/codex#17827），桌面版（`ChatGPT.app`）完全没有扩展接口。所以 Codex 版就是一段配置，用最接近状态栏的内置选项。

在 `~/.codex/config.toml` 里加上面那段 `[tui]`。命令行底部会显示：模型和推理强度、5 小时和每周额度剩余、上下文占用、输入/输出 token。在命令行里用 `/statusline` 也能改这个列表。

桌面版里，`[desktop] show-context-window-usage = true` 会在输入框里显示上下文用量，额度在输入框的菜单里能看到。

内置选项做不到的：重置倒计时、缓存 token 和命中率、输出速度、花费（企业版除外）。这些数据 Codex 都写在 `~/.codex/sessions/**/*.jsonl` 里，以后可以用 Codex 之外的工具（比如菜单栏小工具）显示。
