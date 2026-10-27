# 插件调试协议（作者自实现监听，平台只收格式）

> 这份文档是**契约**：插件怎么构建、用什么库、脚本怎么写，全由作者自己定；
> 平台只规定**上报格式**。照着发这几种 HTTP 请求，调试页就能看到状态。
>
> 一句话：**构建自由，上报统一。**

---

## 0. 为什么要两份东西

调试时段需要回答两个**互相独立**的问题：

| 问题 | 数据来源 | 说明 |
|---|---|---|
| 这个插件**装进画布了吗** | 画布内核的插件表 | 只看唯一插件名（`miniCanvas.pluginName`） |
| 这个插件的 **watch 还活着吗** | 本协议的心跳 | 关掉监听不代表要卸载插件 |

这两件事必须分开显示。只看「已安装」就下结论，就会出现「界面一切正常、改代码毫无反应」。

---

## 1. 两份上报

### 1.1 产物记录（构建成功后发一次）

```
PUT /api/kv/config/plugin-watch:<插件名>
Content-Type: application/json

{ "value": {
    "t": 1760000000000,
    "front":  "http://127.0.0.1:8865/plugins/plugin-demo/plugin-demo.js",
    "server": "D:\\work\\demo\\dist\\server.js"
} }
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `t` | 否 | 上报时间（毫秒）。只用于展示，不用于判断先后 |
| `front` | **是**（否则画布无法重装） | 浏览器能直接请求的地址：`http(s)://…` 绝对地址，或 `/` 开头的同源路径 |
| `server` | 否 | 后台产物在**后台那台机器**上的绝对路径；跨机器时不要带 |

构建失败**不要发**这一条 —— 半成品不进画布。

### 1.2 心跳（watch 活着时定期发）

```
POST /api/plugin-presence/heartbeat
Content-Type: application/json

{ "name": "demo",
  "instance": "pid-4821-9f3a",
  "state": "watching",
  "front": "http://127.0.0.1:8865/plugins/plugin-demo/plugin-demo.js",
  "server": "D:\\work\\demo\\dist\\server.js",
  "message": ""
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 插件唯一名（`[A-Za-z0-9_.-]`，1-64 位） |
| `instance` | 是 | 当前 watch **进程**的唯一 id（1-128 位）。用来区分同一插件跑了两个 watch |
| `state` | 是 | 见下一节 |
| `front` / `server` | 否 | 同产物记录；带上后调试页显示最新地址 |
| `message` | 否 | 失败时的原因（最多 500 字），只用于显示 |

**节奏**：启动立刻发一次；之后每 **10 秒**发一次，**构建期间也照发**（否则长构建会被误判掉线）。

### 1.3 告别（正常退出）

```
POST /api/plugin-presence/leave
{ "name": "demo", "instance": "pid-4821-9f3a" }
```

或者发 `state: "stopped"` 的心跳，效果相同。告别是**幂等**的，没记录也回 `ok`。

---

## 2. 状态取值

| `state` | 什么时候发 | 调试页显示 |
|---|---|---|
| `watching` | 正常盯文件 | 监听中 |
| `building` | 正在构建（心跳不能停） | 构建中 |
| `paused` | 进程活着、但监听开关被关掉 | 已暂停 |
| `failed` | 最近一次构建失败（带 `message`） | 构建失败 |
| `stopped` | 正常退出（等价于 leave） | 已停止 |

### 2.1 服务端怎么判

| 条件 | 判定 |
|---|---|
| 心跳距今 ≤ **30 秒** | 按 `state` 显示为在线类状态 |
| 心跳距今 > **30 秒** | **失联（stale）** —— 插件**不卸载**，只是标出来 |
| 超过 **10 分钟**没心跳 | 从在场表里清掉（防止无限增长） |
| 收到 leave / `stopped` | 立刻从在场表消失 |
| 后台重启 / 从没收到心跳 | **未知** —— 不能当作在线 |

> 「失联」不等于「插件没了」。休眠、长构建、调试器卡住都会造成超时；
> 平台**只标记、不卸载**，卸载永远由人点。

---

## 3. 最简实现（任意构建工具都能用）

不需要装任何包，两个函数即可：

```js
const BACKEND = 'http://127.0.0.1:8865'
const NAME = 'demo'                       // = package.json 的 miniCanvas.pluginName
const INSTANCE = process.pid + '-' + Math.random().toString(36).slice(2, 8)

const beat = (state, extra = {}) =>
  fetch(BACKEND + '/api/plugin-presence/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAME, instance: INSTANCE, state, ...extra }),
  }).catch(() => {})                     // 后台没开：静默，不打断构建

beat('watching')
const timer = setInterval(() => beat('watching'), 10_000)

// 构建成功
await fetch(BACKEND + '/api/kv/config/plugin-watch:' + encodeURIComponent(NAME), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ value: { t: Date.now(), front: 'http://127.0.0.1:8865/plugins/plugin-demo/plugin-demo.js' } }),
})

// 退出
process.on('SIGINT', async () => {
  clearInterval(timer)
  await fetch(BACKEND + '/api/plugin-presence/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAME, instance: INSTANCE }),
  }).catch(() => {})
  process.exit(0)
})
```

长构建时把 `state` 改成 `building`，失败时发 `failed` 并带 `message`，监听被关掉时发 `paused`。

---

## 4. 调试页怎么读

**接口**：

```
GET /api/plugin-presence
{ "ok": true, "staleAfterMs": 30000, "now": 1760000000000,
  "plugins": [
    { "name": "demo", "instance": "pid-1", "state": "watching",
      "front": "…", "lastSeenAt": 1760000000000, "ageMs": 2000,
      "stale": false, "instances": 1, "multiple": false }
  ] }
```

**变化通知**：状态变化时后台会往现有的 KV 长连接写一个 key：

```
key = plugin-presence
value = { t: 时间戳, name: 'demo' }
```

页面收到就重新拉一次快照。**不要依赖推送不漏**：页面从后台切回前台时会再对账一次。

**列**：插件 / 已安装（内核）/ 监听（心跳）/ 上报地址 / 最后心跳 / 操作。
同一插件出现 `instances > 1` 时显示「多实例」，提醒作者两个 watch 在抢构建。

---

## 5. 边界

- 在场接口只对**本机回环**开放：后台监听 `127.0.0.1 / localhost / ::1` 时自动开启，
  无需任何配置；监听 `0.0.0.0` / 局域网地址（部署场景）默认关闭。
  环境变量可覆盖：`MINI_CANVAS_DEBUG_PRESENCE=1` 强制开（反代回环场景），
  `=0` 强制关。接口内部还有一层 Host 校验，非回环请求一律 403。
- 只存内存：心跳不写磁盘，服务重启后从「未知」开始。
- 超时**只标记，不卸载**。
- 心跳时间以**服务端收到的时间**为准，不信任上报方的时间戳。
- 旧版 watch（只发产物记录、没有心跳）显示「未上报心跳」，不是「已停止」。
