# 完整样板精读：plugin-showcase

**一句话定位**：`packages/plugins/plugin-showcase/src/server.ts` 是官方给的后台插件样板 —— 一个文件演示全部五种能力段（meta 2 条 + routes 6 条 + store 4 条 + jobs 3 条 + mcp 2 条 + agent 3 条）。这篇逐段精读它，每段讲「演示什么 + 关键代码 + 怎么验证」。读完你就能照它写自己的第一个后台插件。

## 这篇能让你做什么

- 看懂一个真实后台插件的完整结构（不是玩具片段）；
- 掌握每个能力段的实战写法与验证命令（curl 一条条打）；
- 照抄改写，做出你自己的第一个后台插件。

## 完整代码

源文件：`packages/plugins/plugin-showcase/src/server.ts`（约 240 行）。构建脚本 `scripts/build-server.mjs` 用 esbuild 把它打成**自包含单文件** `dist/server.js`（`@mini-canvas/kernel` 打进产物、`hono` 保持 external —— data: URL 加载没有依赖解析，这是硬要求）。发布为 npm 包 `mini-canvas-plugin-showcase`，`package.json` 的 `miniCanvas` 段声明 `server: { entry: "dist/server.js" }`。

下面逐段讲。所有代码块第一行标「文件：」的都是真实源码（有删节）；想看全量直接打开源文件。

## 每一步在干什么

### 第 0 段 · 插件骨架与模块级状态

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

const PLUGIN_NAME = 'showcase'
const STARTED_AT = new Date().toISOString();      // ① 记下插件被装载的时刻

const state = {                                    // ② 内存态：重启即失（这本身是演示点）
  heartbeat: null as null | { cancel(): void; intervalMs: number },
  agentMwActive: false,
  mcpRegistered: false,
};

export const name = PLUGIN_NAME;                   // ③ 插件唯一名

export function apply(ctx) {                       // ④ 五种能力的注册全部在这里同步完成
  // ……后面每段……
}
```

- ① `STARTED_AT` 写进 `/api/showcase/meta` 的响应，面板能看出插件是几点装的。
- ② **内存态与持久态的对照**是整个样板的隐藏主线：`state` 重启就丢，`ctx.store` 落盘永存 —— 正好演示两种生命周期。
- ③④ 与前端插件同构：`name` + `apply(ctx)`，同一颗内核。

### 第 1 段 · meta 组（2 条）：插件自描述与端点索引

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

ctx.routes.get('/api/showcase/meta', (c) =>
  c.json({
    ok: true, demo: 'meta',
    name: PLUGIN_NAME, title: '插件展示',
    description: '演示 routes/store/jobs/mcp/agent 五个后台能力的示例插件',
    version: '1.0.0', startedAt: STARTED_AT,
    capabilities: GROUPS,                          // ['meta','routes','store','jobs','mcp','agent']
  }),
)

// 端点索引：前端在线测试台的唯一布局依据（面板不写死端点，加端点只改这里）
ctx.routes.get('/api/showcase/endpoints', (c) =>
  c.json({ ok: true, demo: 'meta', groups: [
    { id: 'routes', label: '路由注册', description: 'ctx.routes.get/post/put/delete —— 后台新增接口 = 装一个插件',
      endpoints: [
        { method: 'GET', path: '/api/showcase/hello' },
        { method: 'POST', path: '/api/showcase/echo' },
        { method: 'GET', path: '/api/showcase/todos' },
        // ……store / jobs / mcp / agent 各组同构……
      ] },
  ]}),
)
```

- **演示能力**：`ctx.routes.get` 最基础用法 + 「端点索引动态下发」的设计 —— 前端测试面板按 `/endpoints` 的返回画界面，插件加端点不用改面板。
- **验证**：`curl http://127.0.0.1:8865/api/showcase/meta`。

### 第 2 段 · routes 组（6 条）：todos CRUD 全链

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

const todos = new Map();                            // 内存态对照（与 store 的持久对照）
let todoSeq = 0;

ctx.routes.get('/api/showcase/hello', (c) =>
  c.json({
    ok: true, demo: 'routes',
    message: '你好，这是 showcase 插件的第一个路由',
    plugins: listRegisteredPluginNames(ctx),        // ① 自省：当前已登记的外挂插件名
    at: new Date().toISOString(),
  }),
)

ctx.routes.post('/api/showcase/echo', async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null) return c.json({ ok: false, error: 'body 不是 JSON 对象' }, 400);
  return c.json({ ok: true, echoed: body });
});

ctx.routes.get('/api/showcase/todos', (c) =>
  c.json({ ok: true, todos: [...todos.values()], total: todos.size }));

ctx.routes.post('/api/showcase/todos', async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (typeof body?.title !== 'string' || !body.title.trim()) return c.json({ ok: false, error: '需要非空 title 字符串' }, 400);
  todoSeq += 1;
  const todo = { id: 't' + todoSeq, title: body.title.trim(), done: false };
  todos.set(todo.id, todo);
  return c.json({ ok: true, todo }, 201);           // 201 Created
});

ctx.routes.put('/api/showcase/todos/:id', async (c) => {   // ② 路径参数用 :id
  const todo = todos.get(c.req.param('id'));
  if (!todo) return c.json({ ok: false, error: 'todo 不存在' }, 404);
  const body = await c.req.json().catch(() => undefined);
  if (typeof body?.title === 'string' && body.title.trim()) todo.title = body.title.trim();
  if (typeof body?.done === 'boolean') todo.done = body.done;
  return c.json({ ok: true, todo });
});

ctx.routes.delete('/api/showcase/todos/:id', (c) => {
  if (!todos.delete(c.req.param('id'))) return c.json({ ok: false, error: 'todo 不存在' }, 404);
  return c.json({ ok: true, deleted: true });
});
```

- **演示能力**：get/post/put/delete 全链；`c.req.param('id')` 取路径参数；`c.req.json().catch(...)` 容错读 body。
- ① `listRegisteredPluginNames` 从 `ctx.tryGet('serverPluginsLoaded')` 拿当前外挂插件名数组 —— 热装的插件也会出现在这里（快照是「活的」，见热装篇）。
- **验证**：

```bash
curl http://127.0.0.1:8865/api/showcase/hello
curl -X POST http://127.0.0.1:8865/api/showcase/todos -H "Content-Type: application/json" -d "{\"title\":\"买牛奶\"}"
curl http://127.0.0.1:8865/api/showcase/todos
```

### 第 3 段 · store 组（4 条）：插件私有 KV

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

const notes = ctx.store.namespace('notes');        // ① 取私有命名空间

ctx.routes.get('/api/showcase/store/notes', async (c) => {
  const keys = await notes.keys();
  return c.json({ ok: true, keys, total: keys.length });
});

ctx.routes.put('/api/showcase/store/notes/:key', async (c) => {
  const value = await c.req.json().catch(() => undefined);
  if (value === undefined) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400);
  await notes.set(c.req.param('key'), value);       // ② 写盘：原子写，跨重启保留
  return c.json({ ok: true, key: c.req.param('key'), value });
});

ctx.routes.get('/api/showcase/store/notes/:key', async (c) => {
  const value = await notes.get(c.req.param('key'));
  if (value === undefined) return c.json({ ok: false, error: '键不存在' }, 404);
  return c.json({ ok: true, key: c.req.param('key'), value });
});

ctx.routes.delete('/api/showcase/store/notes/:key', async (c) => {
  const deleted = await notes.delete(c.req.param('key'));
  if (!deleted) return c.json({ ok: false, error: '键不存在' }, 404);
  return c.json({ ok: true, deleted: true });
});
```

- **演示能力**：`namespace(name)` → `get/set/delete/keys` 四件套。数据落 `<数据根>/plugin-data/notes.json`，**跨重启保留**；插件卸载时整个文件被清（不欠谁的债）。
- ② 与 routes 组的内存 `todos` 正好构成对照：todos 重启就空，notes 重启还在。
- **验证**：写一个键 → 重启服务 → 再读，值还在：

```bash
curl -X PUT http://127.0.0.1:8865/api/showcase/store/notes/greeting -H "Content-Type: application/json" -d "\"你好\""
# 重启服务后：
curl http://127.0.0.1:8865/api/showcase/store/notes/greeting
```

### 第 4 段 · jobs 组（3 条）：心跳定时器 + store 账本

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

const jobs = ctx.jobs;

ctx.routes.post('/api/showcase/jobs/heartbeat', async (c) => {
  if (state.heartbeat) return c.json({ ok: false, error: 'showcase/already-running（先 DELETE 再启动）' }, 409);
  const body = (await c.req.json().catch(() => ({})));
  const intervalMs = typeof body.intervalMs === 'number' && body.intervalMs > 0 ? body.intervalMs : 5000;
  const handle = jobs.every(intervalMs, () => {      // ① 每 intervalMs 跑一次
    void (async () => {
      const hb = await readHeartbeat();              // ② 从 store 读旧账
      const tick = hb.ticks + 1;
      const at = new Date().toISOString();
      const recent = [...hb.recent, { at, tick }].slice(-20);   // 只留最近 20 条
      await notes.set('heartbeat', { ticks: tick, lastTickAt: at, recent });
    })();
  });
  state.heartbeat = { cancel: handle.cancel, intervalMs };     // ③ 内存里记住句柄，好停
  return c.json({ ok: true, running: true, intervalMs });
});

ctx.routes.get('/api/showcase/jobs/heartbeat', async (c) => { /* 读账本返回 ticks / recent */ });
ctx.routes.delete('/api/showcase/jobs/heartbeat', (c) => {
  if (!state.heartbeat) return c.json({ ok: false, error: 'showcase/not-running' }, 404);
  state.heartbeat.cancel();                          // ④ 手动停（handle.cancel 幂等）
  state.heartbeat = null;
  return c.json({ ok: true, running: false });
});
```

- **演示能力**：`jobs.every(intervalMs, fn)` + 返回句柄的 `cancel()`。内存定时器（`state.heartbeat`）重启即失，但 store 里的账本（ticks / recent）跨重启保留 —— POST 启动不清零旧计数，新 tick 续着旧值累加。两种生命周期同屏对照。
- ②③ 定时器回调是异步的（写 store），所以包一层 `void (async () => ...)()`；框架对抛错的回调只记日志不炸定时器。
- **验证**：POST 启动 → 等几秒 → GET 看 ticks 增长 → DELETE 停：

```bash
curl -X POST http://127.0.0.1:8865/api/showcase/jobs/heartbeat -H "Content-Type: application/json" -d "{\"intervalMs\":2000}"
curl http://127.0.0.1:8865/api/showcase/jobs/heartbeat
curl -X DELETE http://127.0.0.1:8865/api/showcase/jobs/heartbeat
```

### 第 5 段 · mcp 组（2 条）：给 AI 注册一个加法工具

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

ctx.routes.post('/api/showcase/mcp/tools', (c) => {
  if (state.mcpRegistered) return c.json({ ok: false, error: 'showcase/already-registered' }, 409);
  ctx.mcp.tool({
    name: 'showcase.add',                           // ① 工具名：插件名.动作，防撞名
    description: '把两个数相加（showcase 插件注册的演示工具）',   // ② 写好这句 AI 才知道何时用
    input: { a: 'number', b: 'number' },            // ③ 参数简表
    required: ['a', 'b'],
    handler: (args) => ({ sum: args.a + args.b, demo: 'mcp' }),   // ④ 返回可 JSON 化的值
  });
  state.mcpRegistered = true;
  return c.json({ ok: true, registered: true, tool: 'showcase.add' });
});

ctx.routes.get('/api/showcase/mcp/tools', (c) =>
  c.json({ ok: true, registered: state.mcpRegistered, tool: 'showcase.add' }));
```

- **演示能力**：`ctx.mcp.tool(def)` 的完整形状。工具登记进注册场（`server/mcp-tool`），MCP server 每请求现读注册场 —— 注册后把 `http://127.0.0.1:8865/mcp` 配给 AI 客户端，工具清单里就会出现 `showcase.add`；卸载插件即摘。
- ③ 简表只支持 `string / number / boolean` 三种类型（外挂插件引不了 zod，框架负责翻译成 MCP SDK 的 schema）。
- **验证**：POST 注册 → `npx mini-canvas-cloud list-tools` 或在 AI 客户端里看到 `showcase.add`；也可以直接在 MCP 会话里调它。

### 第 6 段 · agent 组（3 条）：pre-turn 中间件

```ts
// 文件：packages/plugins/plugin-showcase/src/server.ts（节选）

ctx.routes.post('/api/showcase/agent/middleware', (c) => {
  if (state.agentMwActive) return c.json({ ok: false, error: 'showcase/already-registered' }, 409);
  ctx.agent.use(async (_turn, next) => {             // ① 每次对话轮次进模型前经过这里
    const r = await next();                          // ② 放行（demo 不改写，只演示链路）
    return r;
  });
  state.agentMwActive = true;
  return c.json({ ok: true, registered: true });
});

ctx.routes.get('/api/showcase/agent/middleware', (c) =>
  c.json({ ok: true, registered: state.agentMwActive }));

ctx.routes.delete('/api/showcase/agent/middleware', (c) => {
  if (!state.agentMwActive) return c.json({ ok: false, error: 'showcase/not-found' }, 404);
  state.agentMwActive = false;                       // ③ 置 inactive（跳过加工）
  return c.json({ ok: true, unregistered: true });
});
```

- **演示能力**：`ctx.agent.use(mw)` 注册 pre-turn 中间件（在 Agent `runtime.run` 之前跑，可以改写 `turn.input` 或 `{ blocked: true }` 拦截）。
- ③ 样板的语义定稿：DELETE = 置 inactive 跳过加工；注册场条目仍在，**卸载插件才真正摘除**。真实改写例子见 server-plugins 篇的 agent 段。
- **验证**：POST 注册后，在画布 Agent 里发一条消息（请求会穿过这个中间件）；GET 看注册态；DELETE 置停。

### 第 7 段 · 怎么把它跑起来

三条路任选：

1. **NPM 安装**（最省事）：画布网页 → 插件管理 → 搜索 `mini-canvas-plugin-showcase` → 安装（有后台半时确认一次「以服务端权限运行」）。装完即时生效。
2. **仓库构建 + 手工放文件**：`pnpm -C packages/plugins/plugin-showcase build` 产出 `dist/server.js`，复制进 `<数据根>/server-plugins/`，重启服务。
3. **HTTP 热装**：把 `dist/server.js` 的文本作为 `code`、清单里的 sha256、`confirm: true` POST 到 `/api/server-plugins/install`（见热装篇）。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 骨架 name + apply | `packages/plugins/plugin-showcase/src/server.ts` | `export const name = 'showcase'`；`apply(ctx)` 内同步注册全部路由 |
| meta 2 条 | 同上 meta 组 | `/api/showcase/meta`（自描述）与 `/endpoints`（端点索引，前端面板布局依据） |
| routes 6 条 | 同上 routes 组 | hello / echo / todos CRUD（内存 Map），`c.req.param` 取路径参数 |
| 自省 serverPluginsLoaded | 同上 `listRegisteredPluginNames` | `ctx.tryGet('serverPluginsLoaded')`，热装热卸实时增删的活数组 |
| store 4 条 | 同上 store 组 | `ctx.store.namespace('notes')` → get/set/delete/keys；落 `plugin-data/notes.json`，卸载即清 |
| jobs 3 条 | 同上 jobs 组 | `jobs.every` 心跳；句柄 `cancel()`；账本存 store，重启不清零 |
| mcp 2 条 | 同上 mcp 组 | `ctx.mcp.tool({ name: 'showcase.add', input: { a,b }, required, handler })` |
| agent 3 条 | 同上 agent 组 | `ctx.agent.use` 注册 / 查询 / 置停；DELETE 置 inactive 不摘注册场 |
| 单文件打包 | `packages/plugins/plugin-showcase/scripts/build-server.mjs` | esbuild bundle，`external: ['hono']`，产物 `dist/server.js` |
| NPM 包声明 | `packages/plugins/plugin-showcase/package.json` | `miniCanvas.server.entry = "dist/server.js"`；发布名 `mini-canvas-plugin-showcase` |

## 常见坑

1. **以为 echo 必须是 JSON**：`POST /api/showcase/echo` 的 body 必须是 JSON 对象（数组都不行），否则 400。这是样板刻意演示的入参校验。
2. **心跳 409**：POST 启动第二次会撞 `showcase/already-running` —— 先 DELETE 再启动。句柄存在内存 `state.heartbeat`，重启服务后它就是 null（可以重新 POST），但 store 账本的 ticks 会接着旧值累加，这是设计而非 bug。
3. **MCP 工具重复注册 409**：`state.mcpRegistered` 防重入。真被 409 挡住时说明已经注册过了 —— GET 确认状态即可，别在一个进程里重复 POST。
4. **agent 中间件 DELETE 后以为没了**：置 inactive 只是「跳过加工」，注册场条目还在（这是附录 A 定稿的语义）。要真正摘除，卸载插件。
5. **改完 src 不重新构建就验证**：跑在服务里的是 `dist/server.js`（构建产物），改 `src/server.ts` 后必须 `pnpm -C packages/plugins/plugin-showcase build` 再重装，否则你调试的是旧代码。
