# claude-code-mods

Mods for [Claude Code](https://claude.com/claude-code), distributed as a plugin marketplace.

[中文说明](#中文说明)

## context-band

A band above the prompt, in the desktop app and the CLI, that updates after every turn:

- **5h / 7d** rate-limit usage and the time until each resets
- **in / out** tokens, **~t/s** output speed, **cache** tokens and hit rate
- **$** the session's cost at API prices, **ctx** how full the context window is

The band stays on one line. When some pills don't fit, a **+N** button at the end expands it to show every pill, and **Less** folds it back.

Hover the 5h or 7d pill for a one-line estimate of what that window is worth at API prices. The 📈 button opens two views of both windows:

- **Chart**: where the window ends at your pace (or when you hit the limit), your average spend rate beside the rate that lands on 100% at the reset, and a strip chart against the limit and last week
- **By model**: for each model, the tokens left if you use only that model (with bars to compare), and the tokens it has used

The band follows the app's light or dark theme; ◐ cycles auto, light and dark.

### Install

In Claude Code (CLI or desktop):

```
/plugin marketplace add EricJamie/claude-code-mods
/plugin install context-band@claude-code-mods
```

It loads in the next session.

### Commands

`/context-band auto|light|dark` theme · `hide` / `show` the band · `reset` the token counters

### How the estimates work

- A window runs from its reset time back 5 hours or 7 days.
- **$ at 100%** = what Claude Code spent in the window at API list prices ÷ the % of the window used. Under 5% used it is marked "(rough)".
- **Tokens left if one model does it all** = the dollars left in the window ÷ what a token costs on that model at your own mix of input, output and cache (your last 7 days, priced as if they had all gone to that model).
- Spend comes from the Claude Code transcripts on this machine; usage elsewhere (claude.ai, other machines) counts toward the % but not the $, so the estimates read low if you use those a lot. The estimates assume the limits weigh models by API price.

### Requirements and privacy

- `python3` (the estimator, `plugins/context-band/bin/api_estimate.py`)
- macOS for the automatic theme and the desktop usage history; elsewhere those fall back quietly
- Everything stays on your machine: the mod reads local files and makes no network calls. Its cache is `~/.cache/context-band/`.

### Updating prices

API prices live in `PRICES` in `bin/api_estimate.py`. A new model in a known family is priced like that family's current model until the table is updated.

### Development

```
claude plugin validate plugins/context-band
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/context-band
```

Mods are an early-access Claude Code feature; the test runner needs that variable.

---

## 中文说明

[Claude Code](https://claude.com/claude-code) 的插件（mod）集合，以插件市场的形式发布。

### context-band 状态栏

显示在输入框上方（桌面端和命令行都支持），每轮对话后自动更新：

- **5h / 7d**：5 小时和 7 天用量限额的使用比例，以及距离重置的时间
- **in / out**：输入、输出 token；**~t/s**：输出速度；**cache**：缓存 token 和命中率
- **$**：本次会话按 API 价格计算的花费；**ctx**：上下文窗口的使用比例

状态栏默认只占一行。放不下的指标会收进末尾的 **+N** 按钮，点击即可展开显示全部，点击 **Less** 收起。

鼠标悬停在 5h 或 7d 上，会显示该窗口按 API 价格折算的估值。点击 📈 打开两个视图：

- **Chart（图表）**：按当前速度到重置时会用到多少（或何时触顶）、目前的平均花费速度和刚好在重置时用满的速度，以及与额度线和上周对比的小图
- **By model（按模型）**：如果只用某个模型还能用多少 token（带对比条），以及该模型已用的 token

状态栏会自动跟随应用的浅色/深色主题；◐ 按钮可在自动、浅色、深色之间切换。

### 安装

在 Claude Code（命令行或桌面端）中运行：

```
/plugin marketplace add EricJamie/claude-code-mods
/plugin install context-band@claude-code-mods
```

下一个会话开始生效。

### 命令

`/context-band auto|light|dark` 切换主题 · `hide` / `show` 隐藏或显示 · `reset` 重置 token 计数

### 估算方法

- 窗口从重置时间往前推 5 小时或 7 天。
- **100% 估值** = 窗口内 Claude Code 按 API 价格的花费 ÷ 已用比例。已用不足 5% 时标注"(rough)"，表示还不准确。
- **只用某个模型还能用多少 token** = 窗口剩余金额 ÷ 该模型在你的使用习惯下每个 token 的价格（把你最近 7 天的请求全部按该模型重新计价）。
- 花费来自本机的 Claude Code 对话记录。在其他地方的使用（claude.ai、其他电脑）会占用额度，但不会计入金额，所以如果你经常用这些，估值会偏低。估算假设额度按 API 价格对不同模型加权。

### 依赖与隐私

- 需要 `python3`（估算脚本 `plugins/context-band/bin/api_estimate.py`）
- 自动主题和桌面端用量历史仅支持 macOS，其他系统会自动跳过
- 所有数据都留在本机：插件只读取本地文件，不联网。缓存位于 `~/.cache/context-band/`。

### 更新价格

API 价格写在 `bin/api_estimate.py` 的 `PRICES` 表里。同系列的新模型在价格表更新前，会按该系列当前模型的价格估算。

### 开发

```
claude plugin validate plugins/context-band
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/context-band
```

插件（mod）是 Claude Code 的早期功能，运行测试需要设置这个环境变量。
