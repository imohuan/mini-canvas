# 平台配置与启停

**一句话定位**：后台的每个平台（provider）都能在「设置 → 集成 → 平台」里看到、开关、填配置、删掉，不用改文件也不用重启。

## 这个功能能做到什么

打开画布右上角的设置，进入「集成 → 平台」，你会看到一张表：

- 每个平台一行：名字、文件名、动作数、启停开关、配置、删除；
- 关掉开关 = 该平台的动作立刻从底栏消失，文件还在；再打开就回来；
- 「配置」按平台声明的字段自动画出表单，一个平台可以存多个账号；
- 「删除」会删掉 `providers/` 里的文件，并记住「别再装回来」；
- 「强制刷新」= 立刻重扫目录，等价于启动时那一遍。

内置平台（例如 Agent 对话）没有文件，右边只显示「内置」，不给配也不给删。

## 启停与删除改的是什么

启停、删除、账号配置都记在 `<数据根>/providers-config.json`。配置值用**平铺的点分隔 key**，
相同前缀的 key 天然共用一份值：

```json
{
  "config": {
    "token01.baseUrl": "https://token01.net",
    "token01.apiKey.[0]": "sk-第一个号",
    "token01.apiKey.[1]": "sk-第二个号"
  },
  "platforms": {
    "token01": {
      "accounts": [
        { "id": "main", "name": "主号", "default": true },
        { "id": "backup", "name": "备用" }
      ],
      "title": "Token01 中转站",
      "description": "New API 中转站"
    }
  },
  "defaults": { "图片": "web2api:doubao-image-seedream45" }
}
```

- `pid.field` = 平台通用，所有账号共用一份；
- `pid.field.[n]` = 第 n 个账号；读的时候把同前缀的 `[n]` 聚成数组，某个账号没写就沿用通用值；
- `platforms[pid].accounts` = 账号清单（名字、默认号）；
- `defaults` = 按生成类型存的默认模型（全局，不分平台）。

旧结构（`files[文件名].accounts`）仍然能读；新结构优先。

旧版（v2，只有账号）的结构长这样，仅供参考：

```json
{
  "version": 2,
  "disabledFiles": ["web2api-video.js"],
  "deletedFiles": ["my-old-provider.js"],
  "files": {
    "token01.js": {
      "accounts": [{ "id": "main", "name": "默认", "values": { "baseUrl": "https://token01.net" } }]
    }
  }
}
```

key 是**文件名**而不是平台 id：装载器要先知道文件才能 import，配置注入发生在执行之前。
所以同一个平台做多账号，是在这里加同文件的多个 `accounts`，不是复制文件。

`deletedFiles` 里的名字，重启时不会再从随包自带的默认平台里补回来。

## 平台怎么声明配置项

平台自己的名字、介绍、图标与 `id` / `config` 同级直接写：

```js
// 文件：<数据根>/providers/token01.js
const provider = {
  id: 'token01',
  title: 'Token01 中转站',
  description: 'New API 中转站，提供文本 / 图片 / 音频 / 视频',
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">…</svg>',
  config: [ /* 见下 */ ],
}
```

`icon` 支持 SVG 字符串、`data:image/...;base64,...`、或图标名；没写就用平台名首字母兜底。
它既显示在平台管理列表，也作为该平台模型的**兜底图标**（动作图标、品牌图标都认不出时用它）。

平台停用后仍能显示名字/介绍/图标 —— 后台会把这些信息快照进配置，停用时不再读文件。

平台文件里写 `export const config`：

```js
// 文件：<数据根>/providers/my-provider.js
export const config = [
  { key: 'baseUrl', label: '服务地址', type: 'string', default: 'http://localhost:8033',
    description: '留空 = 用默认地址。' },
  { key: 'apiKey', label: 'API Key', type: 'secret', description: '开了鉴权才需要。' },
  { key: 'mode', label: '模式', type: 'select', default: 'fast',
    options: [{ label: '快速', value: 'fast' }, { label: '精细', value: 'slow' }] },
]
```

`type` 六选一：`string` / `text` / `number` / `boolean` / `select` / `secret`。
设置页按这个数组画控件，平台作者不用写任何前端代码。

## 平台怎么读到填进去的值

装载器会在你的源码前注入常量 `__mcProviderConfig`：

```js
const cfg = typeof __mcProviderConfig === 'undefined' ? null : __mcProviderConfig
const values = (cfg && cfg.byId[accountId]) || cfg?.values || {}
const baseUrl = values.baseUrl || 'http://localhost:8033'
```

| 字段 | 含义 |
| --- | --- |
| `cfg.accounts` | 全部账号 `[{ id, name?, values }]` |
| `cfg.values` | 第一个账号的 values（单账号最常用） |
| `cfg.byId` | `{ 账号id → values }` |

没配过时是空结构（不是 undefined），所以 `?.` + `||` 兜底就够了。

## 多账号怎么用

一个平台常有好几个号（几个中转站、几把 key）。在设置里点「添加账号」，每个账号一个 id、
一份字段值；底栏选动作时可以按账号 id 选，平台从 `input.values.__accountId` 拿到是谁，
再用 `cfg.byId[accountId]` 取对应那套配置。

账号 id 不能重复、不能空 —— 它是选号的键，重复了就会选错人，所以保存前会被拦下。

## 密钥怎么保存

`secret` 类型的值只存在服务端的 `providers-config.json` 里；接口返回给界面的是掩码
（例如 `sk-1…7890`）。把掩码原样保存回去 = 没改，服务端保留原值；只有输入一串新值才会覆盖。

## 接口一览

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/providers` | 平台清单（含声明字段、启停、掩码后的账号值） |
| POST | `/api/providers/reload` | 强制重扫目录 |
| POST | `/api/providers/:file/enable` | 启用 |
| POST | `/api/providers/:file/disable` | 停用 |
| DELETE | `/api/providers/:file` | 删文件（内置平台回 404） |
| PUT | `/api/providers/:file/config` | 整体替换该文件的账号清单 |

写接口要管理令牌；`GET /api/providers` 与 `/api/actions` 同级，不要令牌。

## 注意事项

- 内置平台（没有文件的那种）既不能配也不能删，接口会明确报错，不会假装成功。
- 停用只改配置，不动文件；删除才真删文件，且不能再从默认包里补回来。
- 改了账号配置会立刻重载平台，正在跑的任务不受影响，但新下单会读到新值。
- 开发模式（`pnpm -C packages/ui dev`）下，实时通道 `/api/kv/events` 由独立插件转发，
  不走 vite 内置代理 —— 内置代理转发这条长响应会卡住响应头，页面进度就不动了。
