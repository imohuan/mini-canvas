# 任务脚本（后台活怎么干）

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：后台活 = `task-scripts/` 目录里的 `.mjs` 文件；
**文件名 = 脚本名，文件里 export 的函数 = 能调的动作**。放进去即生效，不用重启后台。

> 脚本是**用户**写在服务器磁盘上的（AI 写不了那个文件）—— 这就是"自定义脚本"的含义。

## 一、脚本长什么样

```js
// <数据根>/task-scripts/scale.mjs
export async function run(width, ctx) {   // ctx 永远在最后一个参数
  ctx.log('收到 width=' + width)
  ctx.progress(0.5)
  if (ctx.signal.aborted) return          // 用户点了取消
  return { width }                        // 返回值 = 调用方的 result（要能 JSON 化）
}
```

- 干活用 Node 自带的 `spawn / fs / fetch`（比如 ffmpeg），**没有任何封装命令**。
- 目录约定（一条都不能松）：只认 `.mjs`；脚本名只允许 `[A-Za-z0-9_-]{1,64}`（**挡路径穿越**）；
  `_` / `.` 开头的文件与 `lib/` 子目录不进清单（但脚本自己可以 import 它们）。

## 二、ctx 里有什么

**只给信息与环境，不给命令** —— 若在这里替脚本封好命令，等于替它决定了"该怎么干活"，那它就只是填空、不是自定义脚本了。

### 信息（纯数据）

| 字段 | 说明 |
| --- | --- |
| `ctx.workspace` | 本次调用**专属空目录**，随便写，跑完自动删 |
| `ctx.dir` | 脚本自己所在目录（想 import 旁边的 `lib/` 用它） |
| `ctx.baseUrl` | **后台地址**（要回写画布 / 调画布接口时拼绝对地址用） |
| `ctx.dataRoot` | 数据根目录（兜底用） |
| `ctx.canvasId` / `ctx.nodeId` / `ctx.name` | 谁在问 / 正在跑哪个脚本 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `ctx.log(msg)` | 往实时通道写一行 |
| `ctx.progress(0..1)` | 报进度（界面能看到） |
| `ctx.signal` | `AbortSignal`，取消时 `aborted` |

### 三个助手

```js
await ctx.save(字节或字符串, "名字.ext"[, { slot, mime }])
ctx.file(地址或文件名)   // → 本地磁盘路径（喂给 ffmpeg 最快；认不出就原样返回）
ctx.temp("名字")         // → 工作目录里的路径（中间文件写这）
```

## 三、★ 产物落哪个字段（后台按扩展名自动判，不用管）

| `ctx.save(data, "a.xxx")` | 节点字段 | 值 |
| --- | --- | --- |
| `.png` / `.jpg` / `.webp` … | `imageUrl` | 地址 + `?v=时间戳` |
| `.mp4` / `.webm` / `.mov` | `videoUrl` | 地址 + `?v=时间戳` |
| `.mp3` / `.wav` / `.ogg` / `.m4a` | `audioUrl` | 地址 + `?v=时间戳` |
| `.txt` / `.md` / `.json` / `.csv` | `text` | **正文内容本身**（不是地址） |

> **这一节的现状是"后台任务脚本"这条路的写法**：它写的是**同源资源地址**（不是节点契约里的持久引用）。
> 节点数据的目标形态是**只存 `resourceId`**；这两条路目前并存，别把这里的地址照抄进节点的长期字段。

**四个坑**：

1. 下游（底栏素材区、图片对比、图片生成）是**按这四个字段名**认类型的 ——
   自己往 `imageUrl` 塞音频 → 下游当图读 → 裂图。
2. 只有落在**本节点自己的槽位**（不传 `opts.slot`）才写这些字段；显式存到别的槽位不算本节点的产物。
3. 槽位地址固定、内容会覆盖，所以字段里带 `?v=毫秒` 让下游重新取；
   **展示端去重要用干净 URL**（去掉 `?` 与 `#` 再比），否则同一文件被算成好几份。
4. 判类型**按地址扩展名**，别按字段名 —— 叫 `imageUrl` 的字段里可能装着 `.mp3`。

## 四、脚本自己的说明书：`export const docs`

脚本里**可以**（不是必须）导出 `docs` 对象，把每个函数的四件事说清：

```js
// <数据根>/task-scripts/scale.mjs
export const docs = {
  run: {
    what: "把图片缩放到指定宽度",
    args: [{ name: "width", type: "number", required: true, desc: "目标宽度（像素）" }],
    returns: "缩放后的图片地址",
    example: "canvas_fn_call({ script: 'scale', fn: 'run', argsJson: '[640]' })",
  },
}
export async function run(width, ctx) { /* ... */ }
```

这些说明会被 MCP 的 `canvas_fn_list` / `canvas_fn_info` 读出来，AI 才知道怎么调。

> `docs` 是**对象**不是函数，所以它不会混进"可调函数"清单。
> 完整样板见 `task-scripts/demo.mjs`（每一行都有注释）。

## 五、一个长任务的完整样子

```js
// <数据根>/task-scripts/tick.mjs —— 边跑边报进度，并且能被取消
export async function tick(count, ctx) {
  const total = Math.max(1, Math.min(60, Number(count) || 5))
  for (let i = 1; i <= total; i++) {
    if (ctx.signal?.aborted) {           // 用户点了取消 → 自己收摊
      ctx.log('收到取消，第 ' + i + ' 步停下')
      return { cancelled: true, done: i - 1 }
    }
    ctx.log('第 ' + i + '/' + total + ' 步')
    ctx.progress(i / total)
    await new Promise((r) => setTimeout(r, 250))
  }
  return { cancelled: false, done: total }
}
```

## 注意事项

1. **工作目录一次一清**：`ctx.workspace` 跑完 `rm -rf` —— 写中间文件都往它里面写，别写系统别处。
2. **跑在子进程里**：脚本挂掉不会带崩后台；但也别指望能拿到宿主内存里的东西。
3. **取消要自觉**：收到 `ctx.signal.aborted` 就收摊 —— 后台会杀进程树，但你自己收摊能保住已完成的部分。

