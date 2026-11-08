# icon 可用的图标名

`icon` 写成名字时，能认出下面这些平台 key（来自 `modelBrandIcons.ts` 的
`MODEL_BRAND_ICONS`，共 31 个）。也可以直接写中文名或关键字，走同一张规则表模糊匹配。

| key | 平台 |
| --- | --- |
| `deepseek` | DeepSeek |
| `openai` | OpenAI（含 ChatGPT / GPT Image） |
| `claude` | Claude |
| `gemini` | Gemini |
| `doubao` | 豆包 |
| `qwen` | 通义千问 |
| `zhipu` | 智谱 |
| `kimi` | Kimi |
| `grok` | Grok |
| `minimax` | MiniMax |
| `hunyuan` | 腾讯混元 |
| `wenxin` | 文心一言 |
| `stepfun` | 阶跃星辰 |
| `yi` | 零一万物 |
| `mistral` | Mistral |
| `kling` | 可灵 |
| `hailuo` | 海螺 |
| `runway` | Runway |
| `pika` | Pika |
| `sora` | Sora |
| `vidu` | Vidu |
| `pixverse` | PixVerse |
| `luma` | Luma |
| `jimeng` | 即梦 |
| `seedance` | Seedance |
| `veo` | Veo |
| `dola` | Dola |
| `volcengine` | 火山引擎 |
| `moonshot` | Moonshot |
| `midjourney` | Midjourney |
| `custom` | 自建网关（兜底那一格） |

## 匹配规则

1. 先按**字面**命中 key（大小写不敏感，前后空白忽略）：`icon: 'SeedAnce'` 就是 `seedance`。
2. 命不中再走关键字表，所以 `icon: '火山引擎'`、`icon: '可灵'`、`icon: '豆包'` 都能认。
3. 都认不出就当没写 `icon`，退回「按动作标题猜平台」。
4. `icon: 'custom'` 是**有效值**，表示要用自建网关那一格图标，不会当成「认不出」。

## 什么时候用哪种写法

| 想做的事 | 写法 |
| --- | --- |
| 用某个平台的官方图标 | `icon: 'seedance'` |
| 用自己画的图 | `icon: '<svg viewBox="0 0 24 24">…</svg>'` |
| 用一张 PNG | `icon: 'data:image/png;base64,…'` |
| 什么都指定，让标题决定 | 不写 `icon` |

SVG 必须有 `viewBox`（或宽高），否则底栏按原始像素画会溢出。
带 `<script>`、`<foreignObject>`、`on*=`、`javascript:` 的 SVG 会被拒绝，
回落到标题猜测 —— 这是安全兜底，不是 bug。

