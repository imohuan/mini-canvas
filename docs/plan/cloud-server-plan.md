# 计划：cloud-server 服务端 + 云端保存插件

日期：2026-09-14 · 分支：当前分支 · 状态：**待开工**

> 用户诉求（原话要点）：
> 1. **不扩展 `packages/mcp-server`**，另起一套 `packages/cloud-server`
> 2. `npx xxxx` 启动服务 → 自动起后台 → 通过后台**查看画布**
> 3. `packages/ui` **保持独立**，cloud-server **直接托管它打包输出的产物**
> 4. 数据源放 `.mini-canvas/kv/*.json`、`.mini-canvas/uploads/*`
> 5. 云端保存要做成**插件**（不直接改源码），插件以**打包后的外部 JS** 导入
> 6. 用户已批准在 `App.vue` 加"读插件清单"的代码（约 20 行）

---

## 〇、一句话目标

`npx mini-canvas serve` 起一个服务，同时提供：**KV 接口**（画布数据）、**文件上传**、
**静态托管 ui 构建产物**、**外部插件清单**。浏览器打开 `http://localhost:8865` 就是真画布，
画布数据全部落到服务器 `.mini-canvas/`，刷新不丢、换机器也在。

---

## 一、⚠️ 必须先解决的时序问题（决定插件怎么写）

### 事实

`createMiniCanvasHost` 的执行顺序：

```
121  const save = new SaveServiceImpl(); save.useAdapterForAll(opts.adapter)   // 宿主指定后端
206  await ctx.start()                                                        // 插件 apply
228  const saved = await save.get(GRAPH_KEY, 'canvas')                        // 才读画布恢复
```

### 问题

用户选的加载方式是 `onReady` → `manager.install({ url })`，这在**整个 boot 完成之后**。
此时：

- 画布**已经**从 localStorage 读完了（第 228 行）
- 插件再 `save.useAdapter('canvas', httpAdapter)` **只影响后续写入**
- **云端数据永远不会被读** → 做出来是"只写不读"的半残品

### 解法：插件自己做"云端优先恢复"

插件在 `apply` 里按序做三件事，**不依赖任何宿主时序**：

```ts
export function apply(ctx: Context) {
  const save = ctx.get<SaveServiceImpl>('save')
  const graph = ctx.get<GraphDocumentService>('graph')

  // ① 换后端（此后所有写都去云端）
  save.useAdapter('canvas', new HttpAdapter(base))
  save.useAdapter('resource', new HttpAdapter(base))

  // ② 从云端拉一次（此刻读的就是 HTTP 了）
  const cloud = await save.get<CanvasNode[]>(GRAPH_KEY, 'canvas')

  // ③ 云端有数据 → 覆盖本地恢复出来的那份（云端优先）；云端为空 → 把当前本地数据推上去（首次上云）
  if (cloud !== undefined) {
    graph.replaceAll(cloud, cloudEdges)
  } else {
    await save.set(GRAPH_KEY, graph.getNodes(), 'canvas'); await save.flush()
  }
}
```

**为什么这样对**：不赌宿主内部顺序，插件自带完整语义；`apply` 是异步的，
`pluginManager.install` 返回 Promise，用户那 20 行已经 `await` 了。

**副作用（要接受）**：安装瞬间画面会从"本地数据"闪一下变成"云端数据"。
这是"后装插件"的固有代价；若将来要消除，得走 `manifest` 冷启动路径（第 207 行，早于恢复）。

---

## 二、架构与数据流

```
npx mini-canvas serve --port 8865 --dir .mini-canvas
        │
        ├─ GET  /                    → 托管 packages/ui/dist（静态画布应用）
        ├─ GET  /plugin-manifest.json → 外部插件清单（ui 读它来决定加载谁）
        ├─ GET  /plugins/*.js        → 托管打包后的插件 UMD js
        ├─ GET|PUT|DELETE /api/kv/:type/:key  → 画布/配置/资源数据
        ├─ POST /api/files           → 上传字节，返回稳定 URL
        └─ GET  /uploads/*           → 读回上传的文件

浏览器 (ui/dist)
   ├─ 画布本体：静态托管来的
   ├─ 启动时 fetch /plugin-manifest.json
   │     └─ manager.install({ url: '/plugins/plugin-cloud-save.js' })
   └─ 该插件把 save 的 canvas/resource 域切成 HttpAdapter
         └─ 所有读写 → cloud-server → .mini-canvas/
```

### 磁盘布局

```
.mini-canvas/
  kv/
    canvas:graph.json          ← 节点数组（或 {nodes,edges} 信封）
    canvas:graph-edges.json    ← 边数组
    canvas:graph-viewport.json ← 视口
    config:*.json              ← 插件配置（可选上云）
  uploads/
    <sha256前16位>.png         ← 文件按内容哈希命名（天然去重）
```

---

## 三、包结构

### 1. `packages/cloud-server`（新库 · 服务端）

```
packages/cloud-server/
  package.json          # name:@mini-canvas/cloud-server, bin:{mini-canvas:./dist/cli.js}
  tsconfig.json         # 编译到 dist（Node ESM）
  src/
    cli.ts              # #!/usr/bin/env node：解析 serve --port --dir --ui
    server.ts           # createCloudServer(opts) → hono app + start/stop
    routes/
      kv.ts             # GET/PUT/DELETE /api/kv/:type/:key
      files.ts          # POST /api/files, GET /uploads/:name
      plugins.ts        # GET /plugin-manifest.json
    store/
      kvStore.ts        # 读写 .mini-canvas/kv/*.json（key 里的 : 换成文件名安全字符）
      fileStore.ts      # 写 .mini-canvas/uploads/<hash>.<ext>，内容哈希去重
    static.ts           # 托管 ui/dist + plugins/*/dist
  src/__tests__/        # kvStore / fileStore 单测（纯逻辑，不启服务）
```

### 2. `packages/plugins/plugin-cloud-save`（新插件 · 浏览器侧）

```
packages/plugins/plugin-cloud-save/
  package.json          # deps: canvas-data, canvas-base, kernel
  vite.config.ts        # lib UMD 单文件，external: vue + canvas-data + canvas-base
  src/
    cloudSavePlugin.ts  # apply(ctx)：换 adapter + 云端优先恢复（见 §一）
    httpAdapter.ts      # implements StorageAdapter：get/set/remove → /api/kv
    resourceUpload.ts   # 文件上传：blob → POST /api/files → 稳定 URL
    config.ts           # Config schema（服务地址、开关、上云哪些域）
  src/__tests__/        # httpAdapter 单测（假 fetch）
```

### 3. `packages/ui`（改动极小）

只在 `App.vue` 的 `onReady` 里加"读清单 → 装外部插件"（用户已批准的代码）。

---

## 四、接口契约（定死，不许各处自己发明）

### KV

```
GET    /api/kv/:type/:key     → 200 { value } | 404
PUT    /api/kv/:type/:key     → body: { value }  → 200 { ok: true }
DELETE /api/kv/:type/:key     → 200 { ok: true }
```

- `:type` ∈ `config | canvas | resource | shortcut`（与 `SaveType` 一致）
- `:key` 是 **SaveService 加过 type 前缀的物理 key**（如 `canvas:graph`），URL 编码
- 404 必须返回（不是 200 + null）——`HttpAdapter.get` 靠 404 判"从未保存过"，
  与 `createMiniCanvasHost` 的 `saved === undefined` 语义对齐（否则空图会重新长出 seed）

### 文件

```
POST /api/files    → body: 原始字节（Content-Type: 文件 MIME）
                   → 200 { id, url, size, mime }
GET  /uploads/:name → 文件字节（带长缓存头，因为按内容哈希命名，内容不会变）
```

`url` 是**相对路径**（`/uploads/<hash>.png`），天然适配"同源访问"，刷新后仍有效。

### 插件清单

```json
{
  "plugins": [
    { "id": "cloud-save", "url": "/plugins/plugin-cloud-save.js", "disabled": false }
  ]
}
```

清单由 cloud-server 扫描 `packages/plugins/*/dist/*.js` **生成**（不手写），
没有 dist 的插件不出现在清单里。

---

## 五、里程碑（每步可独立验证）

### M1 · KV 接口跑通

产出：`packages/cloud-server` 骨架 + `kvStore` + `/api/kv/*`。

**完成判据**：
1. `pnpm --filter @mini-canvas/cloud-server test` 的 kvStore 单测全绿
2. 起服务后，`curl -X PUT .../api/kv/canvas/graph -d '{"value":[1]}'` 返回 ok
3. `curl .../api/kv/canvas/graph` 读回 `[1]`；删掉 `.mini-canvas/kv/` 后读回 **404**（不是 null）
4. 磁盘上确实出现 `.mini-canvas/kv/canvas:graph.json`

### M2 · 文件上传

产出：`fileStore` + `POST /api/files` + `GET /uploads/:name`。

**完成判据**：
1. fileStore 单测全绿（含"同样内容上传两次只存一份、返回同一 url"）
2. curl 上传一张图 → 返回 `{ url: "/uploads/<hash>.png" }`
3. `curl <url>` 能取回原字节，且字节完全一致

### M3 · 托管 ui 产物 + 插件清单

产出：`static.ts` + `/plugin-manifest.json`。

**完成判据**：
1. `cd packages/ui && pnpm build` 后，起 cloud-server，浏览器打开 `http://localhost:8865` **看到真画布**
2. 画布能拖/连/删（与 `pnpm dev` 行为一致）
3. `curl /plugin-manifest.json` 列出有 dist 的插件；把某插件 dist 删掉后它从清单消失
4. 控制台零报错

### M4 · 云端保存插件

产出：`plugin-cloud-save`（HttpAdapter + 插件主体 + 单测 + UMD 打包）。

**完成判据**：
1. httpAdapter 单测全绿（假 fetch：get 的 404 → undefined；set/remove 路径与 body 正确）
2. 插件包 `tsc` 干净、`vite build` 出单文件 js
3. 用真 cloud-server 手测：装插件后建节点 → `.mini-canvas/kv/canvas:graph.json` 里出现该节点

### M5 · ui 接清单 + 端到端

产出：`App.vue` 加读清单逻辑（用户已批准）。

**完成判据**（浏览器实测，不只跑测试）：
1. 打开画布，控制台能看到插件已装（`ctx:plugin-installed` 或清单请求成功）
2. 建几个节点 + 连一条线 → **服务器 json 文件内容随之变化**
3. **换一个浏览器 profile（等同换机器）打开同一地址 → 画布完整恢复**（这条是"云端保存"的核心证据）
4. 上传一张图 → `.mini-canvas/uploads/` 出现文件、节点 `data.imageUrl` 指向 `/uploads/...`、**刷新后图片仍在**（对比现在 object URL 刷新即失效）

### M6 · npx 可执行

产出：`dist/cli.js` + package.json 的 `bin`/`files`。

**完成判据**：
1. `pnpm --filter @mini-canvas/cloud-server build` 出 `dist/`
2. `node packages/cloud-server/dist/cli.js serve --port 8865` 能起服务并打印访问地址
3. `npm pack` 产出的 tarball 含 `dist/`、不含 `src/`/`node_modules`
4. 本地模拟 npx：在一个空目录 `npm i <tarball>` 后 `npx mini-canvas serve` 能起（验证 bin 指向正确）

---

## 六、验证命令

```powershell
# 服务端
cd packages/cloud-server; node ./node_modules/vitest/vitest.mjs run
cd packages/cloud-server; node ../../node_modules/typescript/bin/tsc --noEmit
cd packages/cloud-server; node ./node_modules/typescript/bin/tsc   # 出 dist

# 插件
cd packages/plugins/plugin-cloud-save; node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-cloud-save; node ../../../../node_modules/typescript/bin/tsc --noEmit
cd packages/plugins/plugin-cloud-save; node ./node_modules/vite/bin/vite.js build

# 端到端（M5 核心证据）
cd packages/ui; node ./node_modules/vite/bin/vite.js build          # 出 ui/dist
cd packages/cloud-server; node ./dist/cli.js serve --port 8865
#   浏览器开 http://localhost:8865 → 建节点 → 看 .mini-canvas/kv/*.json 变化
#   换浏览器 profile 再开 → 画布应完整恢复
```

---

## 七、风险与注意

1. **时序问题已定方案**（§一）：插件自带"云端优先恢复"，不赌宿主顺序。
   代价是安装瞬间画面闪一下；要消除得改走 `manifest` 冷启动（另开任务）。
2. **`save.get` 的 404 语义必须守住**：别的地方已有"`undefined` 才是从未保存、`[]` 是保存了空图"的判定，
   云端 adapter 若把 404 变成 200+null，空画布会重新长出 seed（这个坑项目里踩过）。
3. **插件 UMD 的 external 必须与 ui 里加载的那份同源**：
   插件把 `vue` / `@mini-canvas/canvas-data` / `@mini-canvas/canvas-base` 设为 external，
   靠全局 `Vue` / `MiniCanvasCore` / `MiniCanvasBase` 注入。而 ui 是 ESM 打包、**不暴露这些全局**
   → **这是 M5 最可能翻车的地方**，需先验证：要么 ui 侧挂全局，要么插件改成 ESM 输出（不用 UMD）。
4. **不碰老版**：`src/`、`packages/canvas-core` 一律不动。
5. **单测不启真端口**：kvStore/fileStore 是纯逻辑，单测只测它们；HTTP 层用 curl/浏览器实测。

---

## 八、文件 owner（避免冲突）

| 区域 | 内容 |
|---|---|
| `packages/cloud-server/**` | 新建，本任务独占 |
| `packages/plugins/plugin-cloud-save/**` | 新建，本任务独占 |
| `packages/ui/src/App.vue` | 只加 onReady 里读清单那一段 |
| `packages/ui/package.json` | 可能加一个 build script（若原本没有） |
| 其余一切 | **不动** |

---

## 九、待用户确认（开工前）

1. **服务端口**：默认 8865 可以吗？（避开 ui dev 的 5288、mcp-server 的 8765）
2. **数据目录名**：`.mini-canvas/`（当前目录下）可以吗？要不要支持 `--dir` 指定？
3. **哪些域上云**：只 `canvas` + `resource`，还是连 `config`/`shortcut` 一起？
   （建议先 `canvas` + `resource`；`config` 上云会让设置面板也跟着走云端，可能不是你想要的）
4. **风险 3 的取舍**：插件打成 UMD（要 ui 暴露全局）还是 ESM（ui 用动态 import，无需全局）？
   我倾向 **ESM**——ui 本身就是 ESM，`manager.install({ url })` 内部走 `import()`，天然兼容。
