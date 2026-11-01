# canvas-render / canvas-core-v2 / plugins 全量审查记录

日期：2026-09-08
范围：packages/canvas-core-v2、packages/canvas-render、packages/plugins 及包配置。
目标：记录当前代码真实存在的问题，并列出下一轮应补的 API。本文重新检索了代码，并对关键问题做了最小运行复现。

## 验证结果

（原始基线：core-v2 25 文件 250 测试、render 17 文件 127 测试。）

**修复完成后实测（2026-09-08 收尾）**：
- canvas-core-v2：34 个测试文件、311 个测试通过；typecheck 通过。
- canvas-render：18 个测试文件、144 个测试通过；typecheck 通过。
- 插件：20 个插件包全部有可执行测试并通过（align-arrange 16、canvas-commands/canvas-export/node-image/node-text 装配 smoke 补齐）；20 包 typecheck 通过。
- 已知边界仍存在（非本次修复范围）：浏览器行为、刷新恢复（object URL）、多宿主 UI、热卸载极端场景、插件发布包依赖外部装填。

## 结论

分层方向是对的：core-v2 生产代码基本不依赖 Vue，render 通过适配器接 VueFlow，插件通过 Context/registry/slots 接入。但数据写入没有统一事务边界，Context 类型和运行时对象不一致，端口 API 与实际实现不一致，render 仍大量使用全局 DOM 查询。因此目前适合开发期 demo，不适合把插件当作可独立发布、可换渲染后端的稳定平台。

## 严重问题（优先修）

### P0-1：插件直接改节点/边，但没有统一保存入口，刷新会丢数据

- 证据：plugin-node-text、plugin-node-image、group、align-arrange、auto-layout、multi-select、clipboard、file-drop、edge-cutting、context-menu 都直接改 nodeStore/edgeStore。
- 保存却只在少数路径手写。plugin-auto-save 只调用 save.flush()，不会把当前 nodeStore/edgeStore 快照写入 SaveService。
- 结果：分组、自动布局、多选拖动、文件拖入、剪贴板粘贴/剪切、边切割、右键删边等操作在刷新后可能恢复旧图。
- 修复：core 提供唯一 Graph/Document 事务，统一执行变更、history、selection 清理、edge prune、保存快照和变更通知。

### P0-2：历史操作和拖动操作没有统一落盘

- CanvasHost.onNodeDragStop 直接 updateNodes 并保存，但没有 history.withRecord，普通节点拖动不能撤销。
- command:undo/redo 只恢复内存快照，没有保存；撤销后刷新可能回到撤销前。
- 很多插件用 withRecord，却不保存恢复后的图。
- 修复：History 接入文档事务或提供 afterRestore/changed 事件，由唯一持久化桥落盘；拖动结束统一包 history。

### P0-3：删除节点不会保证边、父子关系和选中态一致

- NodeStore.removeNode 只删节点，不清边、不清子节点 parentId、不清 Selection。
- CanvasHost、canvas-commands、node-image 等路径逐个调用 removeNode；删除 group 或 image 节点可留下悬挂 parentId/edge。
- render 只暂时过滤悬挂边，持久化仍可能保存它们。
- 修复：提供 graph.removeNodes(ids)，原子完成级联删边、解除子节点父引用和 selection prune。

### P0-4：文本内容组件运行时读取不存在的 ctx.text

- plugin-node-text/src/TextContent.vue 使用 useCanvasRender().ctx 后 return ctx.text。
- 服务属性 Proxy 只存在于插件 apply 收到的 PluginScope；CanvasRenderContext.ctx 是根 Context，根 Context 没有属性 Proxy。
- 最小复现：根 Context 注入 text 后，ctx.text 仍是 undefined，只有 ctx.get('text') 能取到。
- 结果：双击文本编辑会报 undefined.editText。
- 修复：组件使用 ctx.get('text')；或提供严格类型的 ContentContext。

### P0-5：同一节点对不同端口的边会互相覆盖

- EdgeStore.edgeStoreId(source,target) 只包含节点 id，Map key 不含 sourceHandle/targetHandle。
- 最小复现：a/out1 到 b/in1 后再加 a/out2 到 b/in2，最终只有第二条边。
- 修复：边 id 至少包含 source、sourceHandle、target、targetHandle，或允许调用者提供稳定 id；重复判断也按四元组执行。

### P0-6：端口 API 宣称可扩展，连接校验和渲染仍只支持固定 source/target

- connection.toCanonicalConnection 只接受 handle 值恰好为 source/target；自定义端口会被判 bad-orientation。
- validateConnection 固定查 inputs 中 port='target'，容量也只按目标节点，不按目标端口计数。
- theme-default/BaseNode.vue 硬编码两个 MovingHandle：左 target、右 source。
- CanvasHost 的渲染边 DTO 丢弃 sourceHandle/targetHandle。
- 修复：定义统一 PortRegistry/PortLayout，校验、EdgeStore、渲染 DTO、BaseNode 全部使用同一端口模型。

### P0-7：CustomEdge 的删除绕过 core edgeStore

- plugin-theme-default/src/components/edge/CustomEdge.vue 调 useVueFlow().removeEdges([props.id])。
- 它没有调用 edgeStore、命令或 history；CanvasHost 的受控 edges 下一次同步可能把边重新画回来，持久化也不会变化。
- 修复：边组件只发删除请求或执行 command:delete-edge，真正删除走 Graph/edgeStore 事务。

### P0-8：空画布无法持久化

- createMiniCanvasHost 只有 restoreNodes.length > 0 才恢复；保存 graph=[] 会再次走 seedDefault。
- 最小复现已确认：保存空数组后再次 boot，seed 节点重新出现。
- 修复：区分“无存储记录”和“已存储空图”，使用 saved !== undefined 作为恢复判定。

## 高风险架构问题

### P1-1：ctx.get 运行时语义与 API 文档相反

- 文档写缺服务应抛错；Context.get 实际直接返回 services.get，缺失返回 undefined，但类型声明为非可选 T。
- 插件装配错误会延迟成 undefined.xxx，诊断困难。
- 修复：拆成 get（缺失抛结构化错误）和 tryGet（返回 undefined），或明确全局可选并修正类型。

### P1-2：根 Context 的 effect 不会在 stop 回收

- Context.effect 把清理登记到 rootScope；Context.stop 只 dispose 插件 fiber，没有 rootScope.dispose。
- 宿主/根代码注册的监听、计时器、watcher 会跨 stop/restart 泄漏。
- 修复：stop dispose root scope；restart 重建 root scope。

### P1-3：异步 disposer 没有被 Context/Host 等待

- Fiber.dispose 支持异步清理，但 Context.stop、uninstallPlugin、CanvasHost.stop 都直接丢弃 promise。
- 热卸后旧插件可能仍在清理；页面关闭时最后一批异步保存也可能未完成。
- 修复：提供 async stop/uninstall/host.stop，并让调用方可以 await。

### P1-4：配置 key 是全局平面命名，插件之间会互相覆盖

- declareConfigIntoStore 直接用裸 key 登记到单个 SettingsStore。
- 第二个插件使用同 key 时不会 define，而是 store.set 改写第一个插件的值和 scope；卸载也无法正确清理。
- 修复：使用 pluginName:key，或让 SettingsStore 以 scope+key 为主键。

### P1-5：设置值没有自动持久化，主题设置只在特定 demo 有效

- SettingsStore.set 只改内存并通知；SettingsSchemaField 只调用 set。
- theme-default 的 config 没有把 settings 映射到 render 外观，真正 binder 在 packages/ui/src/App.vue。
- 换宿主后设置可能不保存，也不改变画布外观。
- 修复：SettingsService 接 SaveService；主题插件订阅自身设置并更新统一 theme state。

### P1-6：热卸主题后 render 可能继续使用旧组件

- CanvasHost.applyTheme 只有槽位存在时才赋值，槽位为空时不清空 nodeTypes、edgeTypes、backgroundComp、connectionLineComp。
- 卸载主题后 VueFlow 可能继续持有已卸载的组件句柄。
- 修复：每次 apply 先完整重置再填充，并订阅 registry 变更。

### P1-7：manifest 的 id 没参与身份管理，disabled 项不进入诊断

- PluginManifestEntry.id 只在类型和注释中存在；applyManifest 实际按 source.name 覆盖。
- id 与 name 不一致时不会按文档替换；disabled 项直接跳过，list/diagnose 看不到登记状态。
- 修复：manifest id 与运行时实例名分开建表，记录 disabled/failed/pending。

### P1-8：NodeRegistry 贡献栈 API 已有，但能力层和 BaseNode 不消费

- registerContribution/nodeSegmentStack 已实现并有测试。
- ctx.nodes 没有 contribution 注册入口，BaseNode 仍用 resolveSegment 只取一个组件。
- 结果是开放节点段槽 API 对插件不可用。
- 修复：增加 ctx.nodes.contribute 并让 BaseNode 消费 segment stack，或删除未兑现 API。

### P1-9：节点类型热卸载没有 orphan policy

- 插件卸载会注销 node type/registry，但存量节点仍在 NodeStore。
- render 移除该 type 后存量节点无组件，仍可能被保存、选中、布局。
- 修复：卸载前拒绝、转 unknown placeholder，或提供迁移策略。

### P1-10：核心对象把可变内部引用直接暴露给插件

- NodeStore.getNodes/getNode、EdgeStore.getEdges/getEdge 返回内部对象；replaceAll 也直接保存调用者对象。
- Selection.ids/edgeIds 返回内部 Set，运行时可被强转修改。
- 任意插件可绕过 update/notify/history/save 改数据。
- 修复：返回 readonly/deep clone 快照；写入时 clone/校验；只允许受控 patch。

### P1-11：NodeStore/EdgeStore 不校验 id、引用和父子环

- addNodes/replaceAll 遇重复 id 直接覆盖。
- parentId 可指向不存在节点、自己或形成环；EdgeStore 不验证 source/target 存在，也不强制 canonical/唯一端点。
- 修复：store 层输入校验并返回结构化错误。

### P1-12：多实例页面会被全局 DOM 查询串线

- CanvasSurface、CanvasHost、canvas-export、edge-cutting 使用 document.querySelector('.vue-flow...')。
- 页面有两个 CanvasHost 时，量测、坐标、导出、切边可能命中第一个画布。
- 修复：每个 CanvasSurface 持有自己的 root/pane/renderer ref，插件只访问实例范围 DOM handle。

### P1-13：ResizeObserver/MutationObserver 没有 SSR/headless 守卫

- useNodeMeasure 在 setup 直接 new ResizeObserver、new MutationObserver。
- SSR 或无 DOM 渲染会直接抛错。
- 修复：不可用时返回 no-op handle，挂载后再创建 observer。

### P1-14：文件拖入把 object URL 当成持久化资源

- plugin-file-drop 用 URL.createObjectURL(file) 写入 data.imageUrl，然后节点图被保存。
- object URL 只在当前文档有效，刷新图片失效；删除节点/关闭宿主也没有统一 revoke。
- 修复：ResourceService 持久化资源 id 和释放；或标记 session-only 且不写入 canvas 存储。

### P1-15：插件包元数据与真实运行时依赖不一致

- plugin-node-text、plugin-group、plugin-multi-select 等源码运行时 import canvas-render，但 package.json 多数只放 devDependency，没有 peerDependency。
- 单独发布/消费插件时不会保证 render 包存在。
- 修复：运行时 import 放 dependencies 或 peerDependencies；仅 type import 才可放 devDependency；增加每包 build smoke test。

### P1-16：动态外部插件加载和 window 暴露没有安全/生命周期边界

- PluginManager 支持 URL、任意 JS 文本和 data URL import；exposeToWindow 把安装/卸载权限放到全局对象。
- 拿到 window 的代码即可执行任意插件并读写整图；CanvasHost 卸载也不会删除旧 window API。
- 修复：来源白名单/签名/权限声明；window API 绑定实例 token 并在卸载时清理。

## 中等问题

### P2-1：设置、slot、主题注册表没有统一变更信号

SlotHost/SettingsHost 主要监听插件安装/卸载。运行期 slots.remove、theme occupant 替换、schema 变化不会自动刷新；SettingsStore 也没有 schema change 订阅。

### P2-2：group/auto-layout/multi-select 直接写入没有保存边界，嵌套组分支仍写绝对坐标

group.reparentIfInside/ungroupIfLeft 直接 update；auto-layout 对 groupNode.parentId 计算了 parentAbs 但未使用，仍写绝对位置。启用嵌套 group 时坐标会错。

### P2-3：搜索浮层只取打开瞬间的节点快照

node-find.openOverlay 把 getNodes 一次性传入，不订阅增删/改名；浮层打开期间结果过期。

### P2-4：clipboard 使用模块静态共享数据

ClipboardServiceImpl.shared/pasteCount 是进程级 static，不同画布/项目会互相串剪贴板。建议默认按 Context 隔离，另提供系统剪贴板 provider。

### P2-5：部分边操作漏发持久化和 selection 清理

context-menu:delete-edge、edge-cutting、clipboard paste/cut 等直接改 EdgeStore，没有统一保存；边删除也不总是 removeEdge selection。

### P2-6：store listener 异常会冒泡到写操作

NodeStore、EdgeStore、Selection 的 notify 没隔离 listener 异常；坏订阅者可能让“数据已改但调用者收到异常”。EventBus 却吞异常，两套语义不一致。

### P2-7：core-v2 package.json 仍声明未使用的 Vue/VueFlow/Pinia runtime dependencies

package.json dependencies 含 @vue-flow/core、pinia、vue；core-v2 生产源码基本纯 TS。会增加安装体积并破坏核心包边界。

### P2-8：主题默认值和 render 默认值有两套来源

plugin-theme-default 的 DEFAULT_THEME_EDGE/HANDLE/DEBUG 与 canvas-render 的 DEFAULT_EDGE_VISUAL/HANDLE/DEBUG 已有差异（深灰虚线 vs 蓝色动效线）。只有 packages/ui binder 在映射。

### P2-9：节点类型注册不是原子操作

registerNodeType 先注册 NodeStore 再注册 NodeRegistry，后一步失败不会回滚；nodes.register + factory 也分多步。

### P2-10：node/edge store 不自动维护 selection 和持久化状态

selection 清理、save.set、history.withRecord 分散在宿主和插件。新增插件漏一步就会产生漂移，需要写模型收口。

## 测试盲区

- 没有真实浏览器 DOM 测试覆盖 CustomEdge 删除、文本编辑、ResizeObserver、多宿主、object URL、全局选择器。
- 没有“保存空图后 seed 不应复活”、多 handle 边、配置 key 冲突、配置持久化、热卸主题、撤销后刷新测试。
- 没有 manifest id 与 source.name 不一致、disabled 诊断、外部插件权限测试。

## 建议补充的 API（按优先级）

### A. 必须补：Graph/Document 事务 API

建议 core 提供唯一写入口：snapshot、transaction(reason, fn)、addNode、updateNodes、removeNodes、addEdge、removeEdges、replace、subscribe。事务统一负责合法性校验、history、selection prune、edge prune、保存快照和变更事件。

### B. 必须补：端口和边身份 API

补充 edgeId(source, sourceHandle, target, targetHandle)；按端口查找/计数/capacity/accepts 校验；Edge DTO 保留 handles；BaseNode 按端口声明渲染。

### C. 必须补：严格 Context API

拆 get/tryGet；提供 async stop/uninstall/host.stop；回收 root scope；不要把 PluginScope 属性 Proxy 冒充根 Context；为 content 提供单独 ContentContext。

### D. 必须补：配置/设置 API

使用 scope+key 命名空间；schema change 订阅；SaveService 持久化；读取默认值/当前值/脏状态；theme 到 render 状态的统一绑定。

### E. 必须补：registry 变更和节点段贡献 API

NodeRegistry/ThemeRegistry/SlotRegistry subscribe；ctx.nodes.contribute；BaseNode 消费 segment stack；热卸节点类型前提供 orphan policy。

### F. 必须补：render instance API

CanvasRenderInstance 持有 root/pane/renderer DOM；坐标、量测、导出、切边只接受该实例；禁止全局 querySelector 找画布。

### G. 应补：资源、快捷键和菜单

ResourceService 管理 Blob/object URL；ShortcutRegistry 支持冲突检测、remap、持久化；MenuRegistry 支持 pane/node/edge、type 过滤、visible/when/order；全局 toolbar/panel 使用标准 slots 或 registry。

### H. 应补：诊断和安全边界

让 manager.diagnose 有宿主事件/状态出口；记录 disabled/failed/pending；外部插件增加来源白名单、权限声明、版本/完整性校验；window 暴露 API 支持实例 token 和卸载清理。

## 建议执行顺序

1. Graph/Document 事务，先修保存、历史、删除级联和 selection 漂移。
2. 边身份和端口模型，补全 Edge DTO 的 handle 字段。
3. 修复 ctx.text、Context get 语义、root/async 生命周期。
4. 修复空图恢复、配置命名空间/持久化、主题默认值单一来源。
5. 收口 render 实例 DOM，补真实浏览器集成测试。
6. 最后再做 menu/shortcut/resource/toolbar 扩展 API。

## 修复进度（2026-09-08）

第一阶段已完成。已修复以下可复现问题，并补充对应测试：

- P0-4：plugin-node-text/TextContent.vue 改用 ctx.get('text')，不再读运行时为 undefined 的 ctx.text。
- P0-8：createMiniCanvasHost 区分“从未保存”与“已保存空图”，空数组不再触发 seedDefault。
- capacity:1：validateConnection 对显式声明 inputs 的目标执行容量约束，capacity:1 与 limit:single 满额拒绝；未声明 inputs 的类型保持不限条数。新增 capacity 用例。
- 拖动与撤销落盘：onNodeDragStop 包 history.withRecord；command undo/redo 在恢复后调 persist() 重新落盘，使内存与持久化一致。
- 主题热卸残留：applyTheme 每次先清空 nodeTypes/edgeTypes 再填充。
- 删除级联：plugin-node-image 的 ImageService.removeNode 现在连带清相连边与选中态、包一次 history，并同步落盘 graph/graph-edges。新增 fullchain 用例验证“删带边节点后边与选中一起清、undo 后一起恢复”。
- CustomEdge 删除走内核：双击删除不再用 useVueFlow().removeEdges 绕过数据源；优先执行 command:delete-edge（含历史+落盘），宿主未装 canvas-commands 时退化为直接 edgeStore.removeEdge + 落盘。主题热卸后旧组件句柄会随 store 同步移除。

相关 core、render、插件测试与类型检查均通过（render 130、core 253、插件全绿）。

尚未开始：第二阶段 GraphDocument 唯一写入口与迁移策略、第三阶段多端口/资源/快捷键/菜单/远程插件/安全边界。删除级联在插件层已收敛，但各插件仍各自调用 nodeStore/edgeStore/history/save，第二阶段应把该模式提升为 Graph 事务。

## 第二阶段进度（2026-09-08 续）

已实现并接入 GraphDocument 唯一写入口：
- core-v2 新增 services/graphDocument.ts，统一“节点/边变更 + 历史 + 选中维护 + 提交落盘”；同步提交，宿主可在任意时刻 flush。
- createMiniCanvasHost 注入 ctx.get('graph') 并在 host/api 暴露 graph。
- CanvasHost：标题写回、拖动落盘、连边提交全部改走 host.graph；移除散落 save.set。
- 迁移到 graph 的插件：plugin-canvas-commands、plugin-node-text、plugin-node-image、plugin-edge-cutting、plugin-context-menu、plugin-clipboard、plugin-file-drop。
- Context.stop() 现在释放并重建 rootScope；新增 tryGet/hasService 方法。

相关测试：core 258 通过、render 130 通过；上述插件 typecheck 与单测均绿。

仍未开始：第三阶段平台扩展及剩余插件（group/align-arrange/auto-layout/multi-select）的 graph 化迁移。

第二阶段 graph 化迁移已全部完成（含 group/align-arrange/auto-layout/multi-select），相关插件单测与全量插件测试均绿。

仍未开始：第三阶段平台扩展（多端口、ResourceService、快捷键 remap、MenuRegistry、外部插件安全边界、registry 变更订阅、ContentContext、孤儿节点策略、render 实例 DOM 收口、配置持久化）。

## 第三阶段进度（2026-09-08 续）

第三阶段平台扩展已落地以下可独立交付的增强，配套单测全绿：

- **registry 变更订阅（E 部分收口）**：SlotRegistry/ThemeRegistry/NodeRegistry 均新增 subscribe(listener)（NodeRegistry 经段级 occupant 转发链统一通知）；CanvasHost 订阅 themeRegistry+nodeRegistry 运行期热更自动重装配 nodeTypes；SlotHost 订阅底层 slots registry、SettingsHost 订阅 themeRegistry，摆脱"只靠插件装卸事件"刷新。新增 slotRegistrySubscribe / themeRegistrySubscribe / nodeRegistrySubscribe 单测。
  - 修复 NodeRegistry.unregister 的**双重通知 bug**（clearByPrefix 已经转发链广播，原代码又显式 notify 一次 → 同一次注销通知两次）。
- **命令快捷键运行期重映射（G 项内核基础）**：CommandRegistry 新增 remapKeys / resetKeys / isRemapped；首次 remap 记住原始 keys，unregister/dispose 随命令清理。补 commandRemap 单测。shortcut-manager 插件此前注释的"键位重映射/持久化缺口"现在有了内核支撑。
- **配置持久化（D 项）**：
  - SettingsStore 新增保存快照：setSavedSnapshot / getSavedSnapshot / clearSavedKeys / entries；define 命中快照的 key 以其为初值；set 同步写回快照 → 热卸插件重装仍恢复用户值。
  - core 新增 settingsPersist.ts（createSettingsPersist）：把 ctx.settings ↔ save(config) 桥接——restore 注入上次保存值、onChange 全局订阅自动落盘、persistNow/resetKey。补 settingsSnapshot / settingsPersist 单测。
  - createMiniCanvasHost 默认接入（persistSettings=false 可关），暴露 host.settingsPersist 并在 stop 时 dispose。补 createMiniCanvasHostPersist 单测。
- **ResourceService（G/P1-14 基础 API）**：core 新增 resourceService.ts（ResourceStore + ResourceUrlBackend 注入式 URL 创建/回收，零 DOM 可测）：register/url/alive/revoke/revokeByResource/revokeByKind/dispose。createMiniCanvasHost 注入 ctx 'resources' 并在 stop 时全量回收（浏览器用真实 URL.createObjectURL/revokeObjectURL）。补 resourceService 单测。
  - file-drop 的"object URL 持久化与单节点删除即时 revoke"仍需接入（图片数据模型改造），列为下一步。

相关测试：core 284 通过、render 132 通过、插件全绿。


**追加（同日续）**：
- **file-drop / node-image 接入 ResourceService（P1-14 落地）**：图片节点保留 data.imageUrl（渲染零改动）并新增 data.resourceId；ResourceStore 新增 disposeUnreferenced(引用集合)，CanvasHost flushSave 前延迟回收已删节点 object URL（undo 恢复仍有效）；ImageService.removeNode 删除即时 revoke。补 file-drop 集成测试。
- **ctx.nodes.contribute（E 项 API 层）**：能力段与 PluginCapabilities 增加 contribute，自动随插件 scope 回收。补 capabilities 测试。
- 全量：core 288 通过、render 132 通过、插件全绿、三包 typecheck 通过。


**追加（2026-09-08 续 2）**：
- **渲染实例 DOM 收口（F 项）**：renderContext 增加 rootEl/rendererEl 实例字段；CanvasSurface 用模板 ref 捕获实例 DOM（替代
  document.querySelector('.vue-flow__renderer'/'__pane')）、defineExpose queryNodeEl；CanvasHost nodeEl 查询改走实例；
  viewport 服务透传 getRootEl/getRendererEl/getPaneEl/queryNodeEl；canvas-export/edge-cutting/auto-layout 插件优先用实例根
  （保留全局回退兼容单宿主）。新增 viewportService DOM 透传测试。
- **多端口边身份数据层 + DTO（B 项）**：edgeStoreId 带显式 handle 时纳入四元组（同源同目标不同端口不再互相覆盖，P0-5），
  无 handle/默认 handle 保持旧格式 e-{s}-{t} 存量零改动；CanvasHost 渲染边 DTO 保留 sourceHandle/targetHandle（新抽
  edgesFromStore 纯函数 + FlowEdge 类型，单测覆盖）。补 edgeStore 多端口 id / edgesFromStore 测试。
- **ContentContext 类型收口（C 项部分）**：新增 contracts/contentComponentTypes.ts（SegmentContentProps/SegmentNodeData/
  SegmentComponent/ContentComponent），content 组件 props 形状统一引用；canvas-render index 导出 FlowEdge/edgesFromStore 等。
- 全量：core 291 通过、render 137 通过、插件全绿。
- **SSR/headless 守卫（P1-13）**：useNodeMeasure 的 ResizeObserver/MutationObserver 惰性创建（仅 start() 时），
  无观察器/DOM 环境返回 no-op 不抛错。补无 RO/MO 环境测试。
- **manifest 登记诊断（P1-7）**：PluginManager 新增 manifestReport(manifest) 只读分析——逐项登记 disabled/
  will-install/superseded（同 id/name 重复后者覆盖），disabled 项不再静默不可见。补 manifestReport 测试。
- **core 运行时依赖净化（P2-7）**：canvas-core-v2 生产源码纯 TS 零 Vue/VueFlow/Pinia 运行时依赖——这些包从 dependencies
  移入 devDependencies（仅编译期 type shim 需要 vue）。
- **插件包运行时依赖声明（P1-15）**：源码直连型插件（clipboard/group/node-text/multi-select/node-find/file-drop）的
  @mini-canvas/canvas-render 从 devDependencies 移入 dependencies；构建发布型插件（theme-default/auto-layout/mini-map/
  align-guide/custom-handle/context-menu/shortcut-manager）本就以 peerDependencies 声明（宿主提供共享渲染依赖），保持不动。
- 全量：core 291 通过、render 140 通过、插件全绿、pnpm install 一致。
- **store listener 异常隔离（P2-6）**：NodeStore/EdgeStore/Selection/SettingsStore 的 notify 逐个 try/catch，坏订阅者不再阻断写操作。补 nodeStoreV2 隔离测试。
- **搜索浮层实时刷新（P2-3）**：node-find 打开期间订阅 nodeStore 变化，NodeFindOverlay 改 getNodes() + refreshKey 驱动重算，结果不再陈旧；关闭退订防泄漏。
- **节点类型注册原子性（P2-9）**：registerNodeType 展示侧注册失败时回滚已落的数据侧 type。
- **剪贴板实例隔离（P2-4）**：ClipboardServiceImpl 的 shared/pasteCount 从 static 改为实例字段（每 ctx 独立剪贴板，不再跨画布串数据；跨画布互贴另接系统剪贴板 provider）。补两实例隔离测试。
- 全量：core 292 通过、render 140 通过、插件全绿。
- **orphan policy 感知与占位（P1-9）**：NodeStore 新增 orphanTypes()（有存量节点但类型已注销的 type 列表）；
  CanvasHost applyTheme 把孤儿 type 也映射 BaseNode 壳 → 卸载插件后存量节点仍有占位渲染、数据不丢、重装恢复。补测试。
- **MenuRegistry 内核化（G 项）**：core 新增 menuService.ts（createMenuService）：从命令表实时组装 pane/node/edge/toolbar 菜单项
  （区域过滤/组优先级/组内 order/删除项 danger/新建节点区）；createMiniCanvasHost 注入 ctx 'menu' 并暴露 host.menu；
  context-menu 插件改消费 ctx.menu（与未来 toolbar/面板同一数据源）。补 menuService 测试。
- **子代理审核修正（第一轮）**：按审核报告修正——settingsPersist 头注释澄清只解决 P1-5（P1-4 key 冲突未做）；
  command:delete 混选边+节点改为单 transaction（一次撤销）；node-image removeNode 移除即时 revoke（改由 flushSave 延迟回收，保护 undo）；
  P1-2 补 rootScope 回收直接测试；clipboard 过期注释修正 + import 缩进；P1-14 文档补"刷新失效需产品选型"限制说明。
- 全量：core 299 通过、render 140 通过、插件全绿。
- **async stop（P1-3）**：Context 新增 stopAsync()——先同步触发全部 fiber dispose（同步 disposer 立即执行），await 全部异步 disposer 结算后再重置状态；CanvasHost 页面关闭可改用它。补 stopAsync 等待测试。
- **每包测试覆盖补全（P1-15 验证盲区）**：align-arrange 有 16 个测试但缺 test script → 补 script；canvas-commands / canvas-export / node-image / node-text 无任何测试 → 补 vitest devDep + vitest.config + 装配 smoke（命令/服务/节点类型注册 + 建节点）。至此 20 个插件包全部有可执行测试。
- **P2-5 确认已解决（graph 化后核对）**：审查列出的三条漏持久化/漏 selection 清理路径——context-menu:delete-edge、edge-cutting 批量删边、clipboard paste/cut——前几轮均已迁移到 GraphDocument（graph.removeEdges / graph.transaction），删除自动清选中 + 触发提交落盘。
- 全量：core 299 通过（含 stopAsync 用例）、render 140 通过、插件全绿。


## 第三阶段剩余（待办）

- 多端口完整渲染（B 项渲染面，余下）：BaseNode 按节点类型 inputs/outputs 声明渲染多端口/自定义 handle（触 core-node-contract 红线 + 交互设计，另开专项）。数据层(edgeStoreId 四元组)、DTO(edgesFromStore 保 handle)、校验层(resolveTargetInputPort/resolveSourceOutputPort + 自定义 handle canonical 正向 + 按口容量/accepts 校验)均已完成。
- ContentContext 运行时容器（C 剩余类型已收口，渲染层消费增强可选）。
- 外部插件安全边界（H 项：来源白名单/权限声明/完整性校验，建议单开计划）。
- P2-2 嵌套组坐标：已核实 v2 group 插件各路径（createGroup/reparentIfInside/ungroupIfLeft）均排除 group 类型与已有父的节点 → 不存在嵌套组，auto-layout 防御分支不触发。非实际缺陷。
- P1-14 图片刷新恢复：object URL 刷新失效需产品选型（转 dataURL / 接持久化上传），本插件已标注 session-only。

## 已排除的旧报告项


本次没有把已存在的改进重复算问题：EdgeStore 已下沉、settingsSourceFrom/SettingsHost 已加入、render context 已有 viewport/renderNodes/renderEdges、CanvasHost 已支持 manifest 属性、core/render/插件测试和类型检查当前均通过。它们仍需要上面的事务、端口和生命周期补强，才能成为稳定契约。










































































