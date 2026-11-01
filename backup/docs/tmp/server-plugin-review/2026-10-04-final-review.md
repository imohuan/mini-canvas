# 代码审查报告 — bffdbdde / 7e143672 / 4014b144

审查范围：d936e23b 之后的 3 个提交（后台插件系统 / 契约测试对齐+主题色豁免+类型修复 / 插件配色主题化等）。
审查方式：逐提交 git show/diff 阅读 + 定点验证（typecheck 与相关单测本地重跑，均通过）。审查过程未修改任何源码文件。

## 验证记录（本机复跑）

- `pnpm -C packages/canvas-render typecheck` ✅
- `pnpm -C packages/cloud-server typecheck` ✅
- cloud-server: serverPluginsRoute(6)、serverPluginLoader(6)、serverFrameworkOrder(3)、serverFrameworkIsolation(1)、pluginTakeover(3) ✅
- ui: themeColorHygiene(2)、stylesCompile(1)、externalPluginGlobals(2)、canvasToggles(12) ✅
- plugin-cloud-client manager: catalogTypes(10)、umdLoader(9)、pluginManagerService(11) ✅

## 重点修复核对结果

1. **PluginManagerPage.vue 反引号** ✅
   - 确认弹窗 `window.confirm(`「${row.entry.title || row.entry.id}」…`)`（PluginManagerPage.vue:43-47）模板字符串、插值与多行拼接均正确，typecheck + manager 测试通过。
2. **useFloating.ts Middleware 类型** ✅
   - `import type { Middleware, Placement }`（:2），`const arr: Middleware[]`（middlewareRef），align 支持 Ref 且缺省回落 `center`（alignRef 分支），原先 `unknown[]` 的类型缺口已闭合。
3. **CanvasHost.vue registryOf 与 .dispose** ✅
   - applyTheme 处 `h.ctx.registryOf<unknown>('node/shell')` 不再强转 `{ resolve }`（CanvasHost.vue:258）；订阅改传 `.dispose`（:1029），类型正确且回收语义不变。
4. **AxDropdown.vue align undefined** ✅
   - `effectiveAlign` 对 `align === 'auto' | undefined` 统一回落 `'center'`（AxDropdown.vue effectiveAlign computed）；theme-default 的 Dropdown.vue 同步改造一致。
5. **cursor-effect 颜色豁免标记位置** ✅（有措辞瑕疵，见 P2-3）
   - colorAssets.ts 为整文件豁免（themeColorHygiene.test.ts EXEMPT_FILES），素材是生成文件，整文件豁免合理；
   - CursorEffectOverlay.vue 样式段标记全部为 `/* 主题色白名单 */` 形式，无 `//` 段内标记；stylesCompile 的"假绿"回归测试存在且通过。

## 安全审查（后台插件系统）

- install 路由（routes/serverPlugins.ts）：`confirm !== true` → 400 ✅（前后端双侧拦截，各有测试）；`ID_RE = /^[A-Za-z0-9_-]{1,64}$/` 防路径穿越，`..` 不可构造 ✅；sha256 锚点为服务端信任源（trustedShaOf 现扫 pluginsDir 的 catalog），失败即拒 ✅（不可信来源/未知 id/哈希不符三条路径均有测试）；服务端不出网（code 由前端取回后 POST），SSRF 面收敛 ✅。
- pluginLoader.ts：只扫指定目录一层、不跟软链、跳 `_`/`.` 前缀，坏文件不炸服务 ✅。但本质是"目录可写 = 任意服务端代码执行"，信任边界仅存在于注释（见 P1-2）。
- 打包内联 kernel：bundle.mjs external 列表从 dependencies 派生并排除 `@mini-canvas/*`，private 工作区包内联、npm 包外链，策略正确且有 kernelInline 测试锁行为 ✅。

---

## 分级问题清单

### P0 阻断

（无）

### P1 应修

1. **多选/绘制框颜色配置为"死设置"——声明了但无消费点**
   - 位置：packages/plugins/plugin-multi-select/src/multiSelectConfig.ts:348-366（boxLight/boxDark 声明）、resolve 处 boxSelect 分支未读取颜色格（约 :461-475）、BoxSelectLayer.vue:119-124（颜色硬编码 `var(--ui-select-box, …)`）
   - 理由：设置面板出现「绘制框颜色（亮/暗）」两个 color 项，但没有任何代码把该值接到渲染——resolveMultiSelectFrameConfig 的 boxSelect 只有 lineStyle/lineWidth/fillOpacity；BoxSelectLayer 固定走 --ui-select-box token；全仓也无人把该配置写入 --ui-select-box。用户改色无效果，与本次"可清空回落主题色"目标直接冲突。建议：给 BoxSelectStyle 增加 color 字段并消费（空值回落 token），或先移除这两个死配置项。
2. **server-plugins 目录可写即任意服务端代码执行，缺少运行时观测面**
   - 位置：packages/cloud-server/src/serverFramework/pluginLoader.ts（信任边界只在文件头注释）、src/server.ts（装配段加载后无持久化提示）
   - 理由：install 路由约束齐全，但任何能写 `<data>/server-plugins` 的进程/用户，下次启动即获得服务端代码执行权，当前仅 console.warn 失败项。建议：启动日志显式列出已加载的外挂后台插件（数量+文件名），并在 GET /api/server-plugins 响应中带 loaded 状态，便于部署者审计。不阻塞合并，但应尽快收口。
3. **catalog KNOWN_GLOBALS 与 vite-plugin-lib HOST_GLOBALS 双源漂移**
   - 位置：packages/cloud-server/src/plugins/catalog.ts:64-72 vs packages/plugins/vite-plugin-lib.ts:33-43
   - 理由：catalog 的 KNOWN_GLOBALS 缺 `MiniCanvasKernel`（HOST_GLOBALS 有）；catalog 含 `THREE` 而 vite-plugin-lib 明确注释 three 不在表内（3D 插件为 builtin 不外装）。parseRequiresGlobals 在 catalog 侧探测 UMD 头 800 字符，漏 MiniCanvasKernel 会让清单 requiresGlobals 低报，前端 umdLoader 只能靠运行时兜底报错。建议两表收敛为单一事实源（复用 HOST_GLOBALS 或加守卫测试，参照 ui 侧 externalPluginGlobals 的做法）。
4. **registry.remove(key,id) 语义改为"整摞移除"，与同 id 多放置方叠层设计相互矛盾**
   - 位置：packages/kernel/src/registry/registry.ts（remove 方法，bffdbdde 引入叠层时一并修改）
   - 理由：叠层设计的其余部分（disposer/removeLayer 按 (source,entry) 认层、卸载只摘自己那层）实现正确，但公开 API `remove(key,id)` 会把该 id 下所有放置方的层一并删除并 emit 多条 removed。kernel 是公共 API，任何调用方按旧语义"删我放的那条"使用 remove 都会误伤他人。建议：remove 也改为按层摘除，或在类型/文档显著标注新语义，并补一条"remove 与 dispose 并存"的守卫测试。仓库内现有调用点已核对无误踩，故列 P1 而非 P0。

### P2 建议

1. **installAll / 首次自动安装静默绕过 serverConfirm**
   - 位置：packages/plugins/plugin-cloud-client/src/manager/pluginManagerService.ts（installAll 与 doRefresh 首次分支调用 install(id) 均未传 serverConfirm）
   - 理由：行为上"安全失败"（confirm 缺省 false → 后台半被后端 400 拒，仅记 serverError），但用户会看到"全部安装后后台未装"的静默半成品且无一次性确认流程。建议：installAll 检测到含 server 项时先弹一次汇总确认，再带 serverConfirm 逐个装。
2. **CORS 全开 `*` 与后台插件安装接口共存**
   - 位置：packages/cloud-server/src/server.ts（app.use('*', cors())）
   - 理由：origin 校验依赖客户端自报的 body.origin（可伪造），当前无鉴权，任何能访问端口的页面都能直接调 install API（confirm 攻击者自带即可）。与"本机自用、默认 127.0.0.1 绑定"的威胁模型一致，可接受；但建议在 docs/STATUS 或部署文档明示"服务不得暴露到局域网/公网"，或对 install 类接口改为校验 Origin/Referer 请求头而非 body 字段。
3. **cursor-effect 样式段豁免标记与"颜色行正上方"约定偶有错位**
   - 位置：packages/plugins/plugin-cursor-effect/src/CursorEffectOverlay.vue 样式段（.ce-frame 等块内个别标记与目标颜色行相隔 1 行）
   - 理由：themeColorHygiene 的识别逻辑只看"颜色行或其上一行"，当前能通过；但 docs/代码开发/主题与配色.md 约定"标记写在颜色行正上方"，错位会给后续维护者造成对号困扰。纯一致性问题。
4. **docs/STATUS.md 单提交体积过大（+979 行）**
   - 位置：docs/STATUS.md
   - 理由：指挥中心文档一次性堆积大量快照，后续 diff 噪声大。建议按"当前状态+归档链接"精简。

## 结论

**可合并（附跟进项）。** 无 P0 阻断；安全主链路（confirm / sha256 服务端锚点 / 路径穿越拒绝 / 加载器边界）实现完整且有测试锁定；任务指定的 5 处修复全部核对无误；本地 typecheck 与相关单测全部通过。P1-1（多选颜色死设置）与 P1-4（registry.remove 语义）建议合并后紧跟一个修复提交；P1-2 / P1-3 作为观测与收敛项排入下个迭代。核心节点件（plugin-theme-default components 六件）的行为契约未被破坏（BaseNode 仅小改，交互默认值变更已由 ui 侧回归测试覆盖）。
