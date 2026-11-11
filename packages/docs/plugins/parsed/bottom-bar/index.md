# 底部状态栏 bottom-bar

> 插件解析 · `@plume-canvas/plugin-bottom-bar` · 自带件

**一句话**：节点卡片下面那条状态栏就是它 —— 它同时提供**可替换的底栏皮**、**注册式动作**（谁都能往底栏塞按钮）、
**任务进度覆盖层**（跑生成时的进度与取消），三件事合在一件里。

> 关键设计：**底栏动作 = 一条"拿上下文调一个能力、拿回产物"的东西**，与内核 `ctx.tools` 里的生成工具本来就是同一件事。
> 所以"加一个模型 = 装一个工具插件"，底栏不用改一行。

## 它注册了什么（全部落点）

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| 服务 | `nodeBar` | `NodeBarService`：读动作 / 读写入器 / 读节点态；写走注册糖 | [服务](/plugins/parsed/bottom-bar/service) |
| 服务 | `nodeTask` | `NodeTaskService`（插件内部）：跑任务 / 取消 / 刷新续查；外部走 `canvas.runBarAction` | 同上 |
| 注册糖 | `registerBarAction` / `registerBarApplier` / `publishToolActions` | 别的插件的**作者入口** | [注册糖](/plugins/parsed/bottom-bar/registry) |
| 注册场 | `node/bar` | 动作表（`actions/*`）+ 写入器表（`appliers/*`） | 同上 |
| UI 槽 | `overlay` × 3 | 底栏宿主 / 参考选择态 / 全屏媒体预览 | [UI 插槽](/plugins/parsed/bottom-bar/slots) |
| 节点区域 | — | 任务进度覆盖层已并入节点壳（`state:overlay`），底栏不再注册 | 同上 |
| 主题槽 | `bottomBar` | 默认底栏皮 `NodeBottomBar` | [主题槽](/plugins/parsed/bottom-bar/slots) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'bottom-bar'` | `src/nodeBarPlugin.ts` |
| 包名 | `@plume-canvas/plugin-bottom-bar` | `package.json` |
| 硬依赖（`inject`） | `['doc', 'nodeRegistry', 'themeRegistry']` | 同上 |
| 自带件 | `plume.builtin: true` | `package.json` |
| 产物出口 | `pluginBottomBar: PluginModule` | `src/index.ts` |

> **装配顺序很重要**：底栏插件必须在**三个节点插件之前**装载 —— 节点插件 `apply` 时 `nodeBar` 已在，
> 才能走"取得到就注册"的快路径（否则要等 `ctx:plugin-installed` 事件补注册）。

## 注意事项

1. **底栏挂在画布 UI 槽，不挂在节点里**：节点带 `transform` 必然成层叠上下文，底栏住在节点里就压不过外壳底部工具栏（`.shell-dock` z-index:30），输入区点击会被截走（实测复现）。
2. **写一律走注册糖、条目归注册方**：服务是共享单实例（`this.ctx` 恒为 bottom-bar 的 scope），所以它的**写面**方法都要收一个"调用方的 scope"参数，别人的动作才挂在自己名下、卸载时摘得掉。
3. **一个 kind 只能一个写入器**：`registerBarApplier` 对同 kind 重复注册会**抛错**。

## 引用名怎么算

每颗素材的**引用名 = 类型 + 它在参考数组里的位置**，例如第 1 个是图片就叫 `图片1`，
第 2 个（哪怕换成了视频）就叫 `视频2`。生成工具、底栏标签、后台 provider 用的是同一条算法。

- **只有数组顺序和平台对得上**。节点名（如「图片 11」）是给人看的，模型不认识；
  所以发给后台的引用名按序号编，节点名仍留在素材行显示。
- **标签只存资源 id**。提示词里的 `@图片1` 在数据里是一段 `{ type: 'tag', value: '<资源 id>' }`，
  名称到这里再按 id 查出来 —— 改名、换序都不会指错对象。
- **拖卡片换顺序 = 引用名跟着变**：拖动后重新编号（`nameRefNames`），标签上的名字随之更新。
- **不许把序号写进标签节点属性**：atom 节点的属性一变，ProseMirror 就会重建整颗标签 DOM，
  用户刚点中的标签会丢掉选中、光标先弹到前面再落回后面（2026-10-27 踩过一次，2026-11-08 又踩了一次）。
  显示位的序号只原位改 DOM 上的 `data-chip-index`。

> 视频节点常带封面图（`imageUrl`）。识别素材类型时**先看节点类型**，再看字段名 ——
> 否则视频会被当成图片、在提示词里变成「图片N」。

改这一块时三处要一起看：`panelSource.resourceEditorSpec`（画 DOM）、`useBottomBarCards.refreshSlotChips`（换序后重新登记）、
`prosemirror-editor-bundle` 的 `resourceCommands.syncChipIndexDom`（原位更新序号，不 dispatch 事务）。

## 点标签的交互：先选中，1 秒后光标落到后面

用户口碑里最容易被改坏的一条：点输入框里的标签 → **整颗高亮** → 1 秒后光标落到标签**之后**，只跳一次。

两处防护缺一不可：

1. 等待期间**不重建标签**：`replaceResource` / `refreshChips` 只在名字、地址、类型真的变了才 `setNodeMarkup`。任何"为了刷新外观"而成的事务重建，都会把整颗选中销毁、光标弹到标签前面。
2. 吞掉浏览器噪声选区：点下去时浏览器会先给一个紧贴标签前面的原生光标，ProseMirror 读到会派发一条只改选区的事务（`isChipCaretNoise` 判定，见 `useEditor.ts`）。

这两条都有单测钉着（`chipCaretNoise.test.ts`、`chipAttrsNeedUpdate.test.ts`、`refChipIndex.test.ts`）。改标签刷新逻辑前先读这三个文件。

## 按住 Ctrl 把素材拖进参考格

底栏开着、鼠标停在**某张素材卡**上时，按住 Ctrl 才进入拖拽态：画布上可拖的素材节点亮起来，
按住节点拖到卡片上就换成参考。松开 Ctrl 自动退出。

三个条件同时满足才进入（`ctrlDragMode.canEnterCtrlDragMode`）：

1. 底栏真的渲染出来了；
2. 按的是 Ctrl 的第一次 keydown（按住不放不算）；
3. 鼠标此刻停在素材卡上（读 `.nb-card:hover`）—— 在画布空白处或输入框里按 Ctrl 不触发，
   这样 Ctrl+C / Ctrl+V 这类编辑快捷键不会被抢走。

底栏自己的输入框不算「别处的输入框」：点节点后它常自动聚焦，若一并拦下，按 Ctrl 就永远进不了拖拽态。

