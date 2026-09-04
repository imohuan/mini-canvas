# v2 插件系统重构调研：dsh/Cordis 模式 vs 现状

> 来源：https://dev.to/henry_lin_3ac6363747f45b4/deepseek-harness-dsh-cha-jian-kai-fa-jiao-cheng-4h6j
> 目的：摸清 dsh 怎么做插件，再对照 v2 现状，得出重构方向。本文件为中间调研，任务完成后再定去留。

## 一、dsh 插件模式的核心（读教程所得）

dsh 由 vendored 的 **Cordis** 驱动，口号是"一切皆插件"——产品里没有特权核心，连主循环都是插件。

**五个必须记住的想法：**
1. **插件** = 一个实现了 Service 的对象。最常见是带 `apply(ctx)` 的函数。
2. **上下文 Context** = 服务的仓库。服务挂到稳定的 `ctx.<key>`，插件间靠 key 找服务，**不 import 具体实现**。
3. **inject** = 声明插件需要的服务。loader 等这些服务存在后才执行插件；加载顺序由依赖决定，不是文件顺序。
4. **类型化事件**：服务声明合并定义事件，用 emit/waterfall/parallel/serial 分发。
5. **可逆注册**：所有注册走 `ctx.effect()/ctx.on()`；插件卸载（HMR/关停）时一切自动回滚。

**函数插件四件套导出：**

```ts
export const name = 'my-plugin'          // 诊断显示名
export const inject = ['tools']          // 声明的必需服务依赖
export interface Config { greeting: string }
export const Config: z<Config> = z.object({ greeting: z.string() })  // schemastery 校验
export function apply(ctx: Context, config: Config) { ... }          // 主体
```

**三种插件形态：** 函数插件 / 带 apply 的对象插件 / Service 子类插件（对外提供 `ctx.<key>` 服务）。

**能力缝（Service Definition / Provider / Consumer）：** 一个能力要"可替换"时用三个角色——Definition 声明接口挂在 `ctx.<key>`；Provider 实现它（换 Provider = 整体换行为）；Consumer 消费它（通常做成模型可见的工具）。**一个角色不算缝**，要新增能力就三个角色一起设计。

**插件作为独立包：** 外置插件 = 独立 npm 包，profile 里 `dsh plugin add` 安装；`package.json` 里 `"dsh": {"bundle": ...}` 自动进 bundle 层。

**卸载/生命周期纪律：** 注册必须是 `ctx.effect()/ctx.on()` 系，apply 里裸干的事不会被回滚（HMR 残留）。配置误配 fail loud 不静默。

## 二、mini-canvas v2 现状（自己写的）

- 没有真 Cordis，是**自研极简 Cordis 复刻**：`canvas-core-v2/src/core/`（Context/Scope/EventBus/topo）。
- 插件契约：`PluginModule { name, deps?, setup(ctx) }`，服务注入 `ctx.inject/get`，副作用自动归插件 scope。
- 插件只有 3 个纯逻辑文件：`src/plugins/nodeText.ts / nodeImage.ts / canvasCommands.ts`。
- **UI 和逻辑分离**：UI 内容组件放在 `demo-web/components/TextContent.vue / ImageContent.vue`（demo 层，非插件包内），逻辑在 `src/plugins`。这正是用户不满的"分家"。

## 三、真·主项目 v1（packages/canvas-core）怎么做的 —— 这才是"原始代码"

v1 已经有完整插件系统，且**每个节点类型就是一个自包含插件**，UI+逻辑焊在一个文件夹：

```
packages/canvas-core/src/
  nodes/<type>/            ← 每类节点一个自包含"插件"
    text/       TextNode.vue + TextNodePlugin.ts + index.ts
    image/      ImageNode.vue + Cropper/Masker/Expander/... + ImageNodePlugin.ts
    image-compare/ ...
    panorama/   PanoramaNode.vue + PanoramaNodePlugin.ts
    Video/      VideoNode.vue + VideoClipToolbar/Cropper + VideoNodePlugin.ts
  plugins/                 ← 能力插件（~20个）
    PluginManager / PluginContext / PluginInstaller / PluginRegistry / PluginDependencyGraph
    align-arrange / align-guide / auto-layout / auto-save / backend-sync / canvas-export
    clipboard / context-menu / custom-handle / edge-cutting / file-drop / group
    history / mini-map / multi-select / node-find / shortcut-manager / storage / theme
  components/              ← 核心壳 + UI 组件
    CustomNode.vue(入口/错误边界)  CustomEdge.vue
    Decoration/ BaseNode BaseTitle MovingHandle NodeToolbar ResizeHandle ToolbarButton
    Menu/ Panel/(DynamicSettingsPanel, DynamicSettingField)  Toolbar/  Performance/  Ui/(Ax*)
```

**v1 插件契约（CanvasPlugin）：**

```ts
export const TextNodePlugin: CanvasPlugin = {
  name: 'node:text', version: '1.0.0',
  install(context: PluginContext) {
    context.canvasNodes.register({ type:'text', node: markRaw(TextNode), label:'文本', ... })
    context.commands.register(...)
    context.toolbars.register('node:text', ...)
    return { uninstall() { ... } }
  },
}
```

即：`install(context)` 里往 `context.canvasNodes / commands / toolbars / ...` 各注册表登记，UI 组件随插件一起 `markRaw` 注册。

## 四、差距清单（一目了然缺了太多）

v2 相对 v1 缺：
- **节点类型插件**：text/image 只有简化占位 content；**缺 video/panorama/image-compare** 整个族。
- **核心壳**：CustomNode(错误边界/入口)、BaseTitle、NodeToolbar(节点浮层)、ResizeHandle(八向裁剪)、Toolbar 体系都缺。
- **能力插件**：v1 ~20 个能力插件 v2 全无（对齐全在 v1，只是没搬到 v2）。
- **UI 体系**：Menu/Panel/Performance/Ui(Ax*) 全套缺。
- **插件承载形态**：v2 插件不是独立包、UI 不在插件包内 → 需要独立 packages + UI/逻辑同包。

## 五、dsh 模式与 v1 现网插件的对应关系（重构时翻译用）

| dsh/Cordis 概念 | v1 现网对应 | 重构建议 |
|---|---|---|
| `apply(ctx)` 函数插件 | `CanvasPlugin.install(context)` | 统一成 Cordis 风格函数插件：`name/inject/apply` |
| `ctx.<key>` 服务仓库 | `PluginContext.canvasNodes/commands/toolbars...` | 转成 ctx 上的服务注册表（nodeRegistry 等） |
| 可逆注册 `ctx.effect()` | uninstall 返回 + 各 registry 反注册 | 统一 `ctx.effect()` 自动回滚 |
| 依赖声明 `inject` | PluginDependencyGraph 拓扑 | 保留拓扑但用 inject 显式声明 |
| Service Definition/Provider/Consumer 缝 | （v1 部分有，如 storage 多种 backend） | 能力设计时按三角色拆 |
| 独立 npm 包插件 | nodes/* 文件夹（仓库内） | **抽到独立 packages/ 插件目录** |
| UI 卡片/渲染由插件带 | 节点 .vue 随插件 markRaw 注册 | 插件包自带 UI，随包注册 |

## 六、用户两条指令合并的解读

1. **UI 1:1 复刻**：删掉 v2 里我臆想的简化壳（BaseNode/CustomEdge/MovingHandle/content 占位），以 v1 真实源码为准逐组件照搬（含全部 Decoration/Panel/Toolbar/Menu/CustomNode 及 text/image/panorama/video/image-compare 各族节点 UI+交互）。
2. **插件系统按 dsh 重构**：v2 里的插件抽成**独立 packages 插件包**，每插件 = UI + 逻辑一体；实现参考 Cordis/dsh（函数插件 name/inject/Config/apply + ctx 服务 + effect 可逆注册 + 能力缝）。

> 这两条其实同源：v1 本来就是"每类节点一个自包含 plugin 文件夹"，把整套按 dsh 规则搬成独立包，正好同时满足"UI+逻辑一体"与"独立插件库"。所以**复刻 v1 + 用 dsh 方式把复刻出来的内容拆成插件包**是同一件事的两面。
