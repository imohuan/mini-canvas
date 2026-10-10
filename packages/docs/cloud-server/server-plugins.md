# 后台插件系统：五种能力段

**一句话定位**：后台插件 = 往 cloud-server 里插一块新能力的一小段 JS。它和前端插件共用同一颗内核，区别只在：拿到的 `ctx` 上多出 **routes / store / jobs / mcp / agent** 五个「插座」——这就是五种能力段。本篇是这一组的核心篇，其余各篇都从它展开。

## 这篇能让你做什么

读完并照抄本篇的最小例子，你能：

- 写出一个合法的后台插件文件（自包含单文件 `.js`），丢进插件目录就能被加载；
- 知道五种能力段各自「管什么、怎么写、什么时候用」；
- 看懂宿主是怎么把插件接进服务的（加载 → 注册 → 回收），以及信任边界在哪。

## 插件长什么样

一个后台插件 = **导出 `name` 和 `apply(ctx)` 的普通 JS 对象**，与前端插件同一形状（都来自 `@mini-canvas/kernel` 的 `PluginModule`）。判定函数 `isValidServerPlugin` 的要求就是这两条：`name` 是非空字符串，`apply` 或旧式 `setup` 是函数。

```js
// 文件：<数据根>/server-plugins/my-first.js
// 格式：自包含单文件（无 import 依赖），被 pluginLoader 用 data: URL import 加载
// 作用：往后台加一条 GET /api/my-first/hello

export const name = 'my-first'        // ① 插件唯一名（路由归属、卸载回收都认它）

export function apply(ctx) {          // ② 装载时被调一次；ctx 就是能力台
  ctx.routes.get('/api/my-first/hello', (c) =>
    c.json({ ok: true, message: '你好，这是我的第一个后台接口' }),
  )
}
```

- ① `name` 全后台唯一；重复名登记失败（宿主只记一条日志，服务照常起）。
- ② `apply` 里注册的一切——路由、定时器、私有存储、MCP 工具——都挂在**这个插件自己的作用域**上，卸载时自动回收（同一颗内核保证）。
- 硬依赖写法与前端一致：模块级 `export const inject = ['服务名']`，缺了内核让插件停在 PENDING，不会带病启动。

### 为什么要「自包含单文件」

加载器读文件文本后用 `import('data:text/javascript,...')` 装进来，而不是按路径 import。原因在 `pluginLoader.ts` 注释里写得很直白：在打包器或测试运行器里，路径形式的动态 import 会被改写或拦下；data: URL 形态在 Node 与浏览器两边都稳定。代价是 data: URL **没有基准目录**，解析不了相对 import —— 所以插件必须把所有代码写进一个文件（仓库里的样板插件用 esbuild 打包成单文件 `dist/server.js`，依赖只 external 宿主一定有的 `hono`）。

## 五种能力段（各配一段最小可抄代码）

下面每段都从仓库样板 `packages/plugins/plugin-showcase/src/server.ts` 抄改而来，能独立成立。

### ① routes —— 加 HTTP 接口

```js
// 文件：<数据根>/server-plugins/demo-routes.js

export const name = 'demo-routes'

export function apply(ctx) {
  ctx.routes.get('/api/demo/todos', (c) => c.json({ ok: true, todos: [] }));       // 查
  ctx.routes.post('/api/demo/todos', async (c) => {                                // 增
    const body = await c.req.json().catch(() => undefined);
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return c.json({ ok: false, error: '需要非空 title' }, 400);
    }
    return c.json({ ok: true, todo: { title: body.title.trim(), done: false } }, 201);
  });
  ctx.routes.put('/api/demo/todos/:id', (c) => c.json({ ok: true, id: c.req.param('id') }));    // 改
  ctx.routes.delete('/api/demo/todos/:id', (c) => c.json({ ok: true, deleted: true }));          // 删
}
```

- 可用方法：`get` / `post` / `put` / `patch` / `delete` / `all`（所有方法都收）/ `use`（挂中间件）/ `mount`（挂整个 Hono 子应用）/ `adopt`（把子应用路由逐条摊平进来）。
- 路由条目登记进内核注册场（`server/route`），条目 id = 插件名 —— 卸载插件，这条路由自动消失。

### ② store —— 插件私有持久化

```js
// 文件：<数据根>/server-plugins/demo-store.js

export const name = 'demo-store'

export function apply(ctx) {
  const notes = ctx.store.namespace('notes');          // ① 一个插件一个命名空间

  ctx.routes.get('/api/demo/note/:key', async (c) => {
    const v = await notes.get(c.req.param('key'));     // ② 读自己的私有 KV
    if (v === undefined) return c.json({ ok: false, error: '键不存在' }, 404);
    return c.json({ ok: true, value: v });
  });

  ctx.routes.put('/api/demo/note/:key', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400);
    await notes.set(c.req.param('key'), body);         // ③ 写盘（原子写，跨重启保留）
    return c.json({ ok: true });
  });
}
```

- ① 命名空间名只允许字母数字下划线连字符点，1–64 位（防路径穿越）；文件落在 `<数据根>/plugin-data/<命名空间名>.json`。
- ②③ 命名空间上有 `get` / `set` / `delete` / `keys` / `clear` 五个方法；插件**卸载时整个命名空间文件被清掉**（框架在插件作用域挂了清理副作用），不欠谁的债。

### ③ jobs —— 定时 / 延时 / 事件订阅

```js
// 文件：<数据根>/server-plugins/demo-jobs.js

export const name = 'demo-jobs'

export function apply(ctx) {
  ctx.jobs.every(60000, () => {                       // ① 每 60 秒跑一次（首次等一个周期）
    console.log('[demo-jobs] 心跳', new Date().toISOString());
  });

  ctx.jobs.once(5000, () => {                          // ② 5 秒后跑一次
    console.log('[demo-jobs] 启动 5 秒后的延时任务');
  });

  ctx.jobs.on('ctx:plugin-installed', (payload) => {  // ③ 有插件被热装时收到事件
    console.log('[demo-jobs] 有插件装上来了', payload);
  });
}
```

- ① `every(intervalMs, fn)` 返回带 `cancel()` 的句柄，想提前停就调它；插件卸载时定时器统一清掉，不会留下「幽灵定时器」。
- ② `once(delayMs, fn)` 延时跑一次；`soon(fn)` 下一拍就跑。间隔最小 50ms（框架会把过小的值抬到 50，防死循环打满 CPU）。
- ③ 这是**进程内**轻量调度：进程重启任务就没了。要跨重启的正式任务用任务系统（`/api/jobs`），别在这里硬扛。

### ④ mcp —— 给 AI 加一个可调工具

```js
// 文件：<数据根>/server-plugins/demo-mcp.js

export const name = 'demo-mcp'

export function apply(ctx) {
  ctx.mcp.tool({
    name: 'demo.add',                                  // ① 工具名，建议「插件名.动作」防撞名
    description: '把两个数相加',                        // ② 给 AI 看的说明（写好它，AI 才知道何时用）
    input: { a: 'number', b: 'number' },               // ③ 参数简表：参数名 → 类型
    required: ['a', 'b'],                              // ④ 必填参数
    handler: (args) => ({ sum: args.a + args.b }),     // ⑤ 执行体：返回可 JSON 化的值
  });
}
```

- ① 参数不用 zod：外挂插件是 data: URL 装的单文件，引不了依赖。框架收 `string | number | boolean` 的简表，再翻译成 MCP SDK 认识的 schema。
- ② 工具登记进注册场（`server/mcp-tool`），卸载即摘；MCP server 是每请求现读注册场的，所以集合永远是最新的。
- ③ 验证方法：服务开着时把 `http://127.0.0.1:8865/mcp` 配进 AI 客户端，工具清单里会出现 `demo.add`。

### ⑤ agent —— 拦截 / 改写 AI 对话轮次

```js
// 文件：<数据根>/server-plugins/demo-agent.js

export const name = 'demo-agent'

export function apply(ctx) {
  ctx.agent.use(async (turn, next) => {                // ① 每次对话轮次进模型前经过这里
    if (turn.input.text.includes('内部资料')) {        // ② 想拦就别调 next()
      return { blocked: true, response: { ok: false, error: '包含敏感词，已拦截' } };
    }
    turn.input.text = '【已审查】' + turn.input.text;  // ③ 想改就改 turn.input
    return next();                                     // ④ 放行，交给下一个中间件
  }, { order: 10 });                                   // ⑤ order 小者在外层
}
```

- ① 中间件插在 Agent `runtime.run` **之前**（pre-turn）：拿到的 `turn` 里有 `canvasId`、`input.text`、`abortSignal`；返回 `{ blocked: true, response }` 就不进模型。
- ② 不调 `next()` = 拦截；`next()` 放行，洋葱式执行。空链零开销（没有中间件时直接原样进模型）。
- ③ `order` 小者在外层（先执行、后收尾），与前端注册场规则一致。
- ④ `ctx.agent.systemPrompt(text)` 追加系统提示；`ctx.agent.tool(def)` 注册工具（落点与 `ctx.mcp.tool` 同一张表）。

## 宿主怎么把插件接进来（加载 → 注册 → 回收）

```text
启动时                                    运行期（热装）
────────                                  ────────
loadServerPluginsFromDir(目录)            POST /api/server-plugins/install
  扫一层 .js（跳过 _ 和 . 开头）           校验 confirm + sha256 + id 白名单
  每个文件 → data: URL import              落盘 + hotInstall(现读该文件装进内核)
        ↓                                        ↓
ctx.plugin(模块) 登记                      ctx.installPlugin(模块)
        ↓                                        ↓
ctx.start() → apply(ctx) 逐个跑           路由立即生效（catch-all 代理现查注册场）
        ↓                                        ↓
flushRoutes()：注册场里已有 path             ↓ 卸载（POST /uninstall）
一次性翻成 Hono 代理 handler             ctx.uninstallPlugin(名) → 路由/定时器/存储
                                                  全部随作用域回收
```

- 启动装载在 `server.ts` 里做：先 `loadServerPluginsFromDir`，再逐个 `host.ctx.plugin(mod)`，必须在 `start()` 前登记（路由代理是 start 时一次性 flush 的）。
- 单文件失败不影响其它：坏文件记一条 failure 日志，服务照常起。

### 安全边界（照 pluginLoader.ts 注释原样转述）

扫目录 `import()` 等于**把任意 JS 当服务端代码执行**，边界五条：

1. 只扫显式给的那个目录（默认 `<数据根>/server-plugins`）；
2. **不跟随软链**（只认 `isFile()` 的真文件）；
3. **不递归子目录**（一层，看得清）；
4. 跳过 `_` / `.` 开头的文件（`_draft.js`、`.hidden.js` 不会被加载）；
5. 单个文件失败不影响其它（记 failure，服务照常起）。

所以「谁能往 server-plugins 目录写文件」= 信任边界 —— 与「谁能改服务器代码」完全等价。运行期经 HTTP 装插件的路由还额外要求 `confirm: true`、可信 sha256、id 白名单（详见热装篇）。

## 每一步在干什么

- **`name` 与 `apply` 缺一不可**：`isValidServerPlugin` 只认这两条（`setup` 是旧式等价写法）。provider（平台提供方）有自己的目录和加载器，放错目录会得到一条指路报错，不会静默装上。
- **能力段挂在 ctx 上、归属挂在插件名上**：`capabilityLayer.ts` 为每个插件作用域各建一套注册器（routes/agent/store/jobs/mcp），注册时条目 id 写「谁放的」，卸载才摘得干净。
- **注册场是核心机制**：五种段里除了 store 直接落文件，其余都登记进内核注册场（路由 `server/route`、MCP 工具 `server/mcp-tool`、Agent 中间件 `server/agent-mw`）。注册场按插入序返回条目 —— 同 method + 同 path 时**先注册者优先**，先装的那个赢。
- **启动顺序是硬约束**：插件必须在 `ctx.start()` 之前登记（路由代理 start 时一次性 flush）；运行期新装插件的路由靠 catch-all 兜底代理命中（详见热装篇）。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 插件形状 `{ name, inject?, apply(ctx) }` | `packages/cloud-server/src/serverFramework/pluginLoader.ts` | `isValidServerPlugin(v)`：name 非空字符串 + apply/setup 是函数 |
| data: URL import、必须单文件 | 同上文件头注释 | `import('data:text/javascript,' + encodeURIComponent(text))`；注释解释打包/测试运行器里路径 import 会被改写 |
| 五能力段类型声明 | `packages/cloud-server/src/serverFramework/capabilityTypes.ts` | `declare module '@mini-canvas/kernel'` 给 PluginCapabilities 补 routes/agent/store/jobs/mcp |
| 每作用域一套注册器 | `packages/cloud-server/src/serverFramework/capabilityLayer.ts` | `buildSegments(ctx, scopeName)` 逐段 `createXxxRegistrar(ctx, scopeName)` |
| routes 方法集 | `packages/cloud-server/src/serverFramework/routes.ts` | `RouteRegistrar`：get/post/put/patch/delete/all/use/mount/adopt |
| store 命名空间五方法 | `packages/cloud-server/src/serverFramework/store.ts` | `namespace(name)` → get/set/delete/keys/clear；文件 `<root>/plugin-data/<ns>.json`；卸载即清 |
| jobs 四方法 | `packages/cloud-server/src/serverFramework/jobs.ts` | `every/once/soon/on`，最小间隔 50ms，卸载统一清定时器 |
| mcp 工具简表 | `packages/cloud-server/src/serverFramework/mcp.ts` | `McpToolDef { name, description, input?, required?, handler }`，input 值限 string/number/boolean |
| agent 中间件 | `packages/cloud-server/src/serverFramework/agent.ts` | `AgentMiddleware(turn, next)`，blocked 短路，order 小者在外层；另有 systemPrompt/tool |
| 启动扫描 + 登记 + 失败不拖垮服务 | `packages/cloud-server/src/server.ts`（③.5 段） | `loadServerPluginsFromDir` → `host.ctx.plugin(mod)`，failure 逐条 warn |
| 信任边界 = 目录可写 | `pluginLoader.ts` 文件头 | 「谁能往这个目录写文件」就是信任边界 —— 与「谁能改服务器代码」等价 |

## 常见坑

1. **写了 import 别的文件**：data: URL 没有基准目录，相对 import 解析不了，插件直接装载失败。要复用代码就打进一个文件（esbuild bundle），或者复制进去。
2. **在 apply 外面（模块顶层）注册路由**：模块顶层执行时 ctx 还不存在。所有注册必须写在 `apply(ctx)` 里、且同步完成 —— 异步等回来再注册的路由在启动装载场景下没有代理，会 404。
3. **指望卸载后 store 数据还在**：私有存储是「卸载即清」的刻意设计。想留底就在卸载前自己导出，或写到 `/api/kv` 的公共域（但那是宿主的公共存储，别塞私货）。
4. **MCP 工具名不带插件前缀**：`add` 这种通用名容易和内置或别的插件撞名（注册场按 name 为 key）。统一 `插件名.动作` 形式，如 `showcase.add`。
5. **把 provider 当后台插件装**：provider（平台提供方）有自己的目录与加载器（providers/load.ts）。把它的文件丢进 server-plugins 会收到一条指路报错（错误信息里写明「要放到 providers 目录」），不会被当成后台插件。
6. **同 path 的路由谁生效分不清**：注册场按插入序取第一条 —— 先注册者优先。想让你的路由赢，要么先装你的插件，要么换一个不冲突的 path。
