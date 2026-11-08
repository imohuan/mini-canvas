# icon 可用的图标名

## 先看这里：你不用记，问后台就行

图标清单有接口，直接查：

```
GET http://127.0.0.1:<端口>/api/agent/icons
```

```json
{ "ok": true, "count": 31,
  "platforms": [
    { "key": "volcengine", "name": "火山引擎", "aliases": ["火山引擎", "火山", "Volcengine"] }
  ] }
```

三个接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/agent/icons` | 全部平台：key、展示名、能认的别名 |
| `GET /api/agent/icons/:hint` | 查一个写法到底认不认得出 |
| `GET /api/agent/icons.svg` | 带完整 SVG 的清单，想直接复用图形时看它 |

单条查询最实用 —— 它走的就是 `icon` 字段那条判定：

```
GET /api/agent/icons/火山引擎
→ { "ok": true, "hint": "火山引擎", "matched": true, "key": "volcengine", "name": "火山引擎" }

GET /api/agent/icons/zzz
→ { "ok": true, "hint": "zzz", "matched": false, "key": "", "name": "" }
```

认不出回 `matched: false` 而不是 404 —— 「这个写法认不出」是个正常答案。
所以你可以先在接口里试一个写法，确认能认再写进 provider，不用改文件重启试。

下面的表格是同一份清单的快照，方便离线看。

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

注意这张表既有**平台 key**，也有**中文别名**。两栏不是二选一：
`icon: 'volcengine'` 和 `icon: '火山引擎'` 都能认出同一个图标，随便用哪个。
上表「平台」那一列只是给人看的展示名，真正能写的是 **key 和别名**（`aliases`）。

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

