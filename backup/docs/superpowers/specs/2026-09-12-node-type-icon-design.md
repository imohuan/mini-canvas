# 节点类型图标（注册即声明，菜单与标题共用）设计

> 日期：2026-09-12
> 相关主线：canvas-core-v2（插件化节点注册）

## 1. 要解决的问题

右键菜单"新建节点"区每个节点类型都有图标，但那个图标**不是节点类型自己的**：

```
packages/plugins/plugin-context-menu/src/menuEnrich.ts
  const ICONS = { text: '<svg ...>', image: '<svg ...>', ... }
  function iconKeyOf(item) { if (item.nodeType === 'text') return 'text' ... }
```

菜单插件里写死一张"type 名字 → 图标"的对照表，按名字猜。同时节点标题条
`plugin-theme-default/.../BaseTitle.vue` 虽然支持 `titleIcon`，但 `BaseNode.vue` 从没把图标传进去，
于是标题左侧永远显示一个写死的"T"形兜底 svg，跟节点类型没关系。

目标：**节点类型注册时就声明自己的图标；右键菜单与节点标题都读同一处**，不再各猜各的。

## 2. 已确认的产品决策

1. 图标形态：**与 `content` 同款的不透明句柄**——SVG 字符串 或 Vue 组件，内核不解析。
2. 没声明图标的节点：**标题左侧不显示**（去掉现在的兜底"T"形 svg）。
3. 不改描述文案、不改菜单现有视觉规格（图标托恒在、16px、28px 托）。

## 3. 数据流（改完后）

```
插件 apply(ctx)   ctx.nodes.register({ type:'text', icon:<svg|组件>, ... })
   │
   ├─ capabilities.ts nodes.register ─► registerNodeType.ts ─► nodeStore.types.get('text').icon
   │                                                                    │
   │                          ┌─────────────────────────────────────────┴──────────────────────┐
   │                          ▼                                                                ▼
   │            menuService.menuFor(area, creatableTypes)                    useNodeCapability.icon
   │                    （create-node 项带上 icon）                                      │
   │                          ▼                                              BaseNode → BaseTitle
   │            plugin-context-menu 菜单浮层渲染                                （标题左侧图标）
   └────────────────────────────────────────────────────────────────────────────────────────────┘
```

单一来源 = nodeStore 节点类型表里的 `icon` 字段；两处消费，各自只负责渲染。

## 4. 组件与接口

### 4.1 内核数据层（不 import Vue）

| 文件 | 改动 |
|---|---|
| `packages/canvas-core-v2/src/services/nodeStore.ts` | `CanvasNodeType` 加 `icon?: unknown` |
| `packages/canvas-core-v2/src/core/registry/registerNodeType.ts` | `NodeTypeDef` 加 `icon?: unknown`，透传进 nodeStore |
| `packages/canvas-core-v2/src/core/capabilities.ts` | `NodeRegisterDef` 加 `icon?: unknown`，透传 |
| `packages/canvas-core-v2/src/core/types.ts` | `PluginCapabilities.nodes.register` 形参加 `icon?: unknown` |

类型用 `unknown` 的理由：内核零 Vue 依赖，不能写 `Component`；与现有 `content?: unknown` 一致。
`nodeStore.registerType` 已整对象存表，无需额外逻辑。

### 4.2 判定纯函数（新增，可单测）

`packages/canvas-core-v2/src/services/iconKind.ts`

```ts
export type IconRenderMode = 'html' | 'component' | 'none'

/**
 * 判定一个 opaque 图标句柄该怎么渲染。
 * - null / undefined / false / '' → 'none'（调用方不渲染任何图标）
 * - 字符串 → 'html'（调用方 v-html）
 * - 其它（Vue 组件等） → 'component'（调用方 <component :is>）
 */
export function iconRenderMode(icon: unknown): IconRenderMode
```

这是唯一一处"图标是什么形态"的判断，菜单浮层与标题条共用，避免两边各写一套 `typeof`。

### 4.3 菜单层

| 文件 | 改动 |
|---|---|
| `packages/canvas-core-v2/src/services/menuService.ts` | `MenuCreatableType` 加 `icon?: unknown`；`MenuItem.icon` 放宽为 `unknown`；`menuFor` 把可建类型的 icon 写进 `create-node` 项 |
| `packages/plugins/plugin-context-menu/src/menuBuilder.ts` | `MenuNodeTypeLike` 加 `icon`；`ContextMenuItem.icon` 放宽为 `unknown`；`buildMenuItems` 透传 |
| `packages/plugins/plugin-context-menu/src/connectionMenu.ts` | `buildConnectionMenuItems` 透传 icon（拖线落空白的菜单同源） |
| `packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts` | 构造可建类型列表时带上 `icon`（`openMenu` / `creatableNodeTypes` 两处） |
| `packages/plugins/plugin-context-menu/src/menuEnrich.ts` | **注册的图标优先**；删掉 `text`/`image` 两条按名字猜的硬编码；命令类（delete/copy/paste）猜测与 default 占位保留 |
| `packages/plugins/plugin-context-menu/src/ContextMenu.vue` | 图标位支持组件：`iconRenderMode` 分 `<component :is>` / `v-html` 两分支 |
| `packages/plugins/plugin-context-menu/src/ConnectionMenuContent.vue` | 同上 |

### 4.4 标题层（theme-default）

| 文件 | 改动 |
|---|---|
| `packages/plugins/plugin-theme-default/src/composables/useNodeCapability.ts` | 新增 `icon` computed（读类型定义字段） |
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 把 `cap.icon` 传给 `BaseTitle` |
| `packages/plugins/plugin-theme-default/src/components/node/BaseTitle.vue` | 用 `iconRenderMode` 判定；**删掉兜底"T"形 svg**——无图标就完全不渲染图标位 |

BaseTitle 仍是纯展示组件（只多 import 一个纯函数，无 Vue 依赖变化）。

### 4.5 节点插件声明图标

`plugin-node-text` / `plugin-node-image` 的 `ctx.nodes.register` 各加一个 `icon`，
内容沿用现在菜单里那两张 svg（文本 / 图片），保证链路有真实数据可验。

## 5. 错误处理与边界

- 未声明 icon：标题不渲染图标位；菜单项走 default 占位（图标列恒在，视觉不塌）。
- icon 为空串：按"未声明"处理（`iconRenderMode` 返回 none）。
- 组件图标尺寸：BaseTitle 的 `.base-title__icon`（14px）已套在外层，组件作者不必管尺寸。
- 本改动不动 nodeStore 的注册/注销语义，热卸插件行为不变。

## 6. 验证方式

| 层 | 测试 |
|---|---|
| 内核 | `iconKind.test.ts`（三态判定）、`menuService.test.ts` 增例（可建类型 icon 进菜单项）、`registerNodeType.test.ts` 增例（icon 落表） |
| 菜单插件 | `menuBuilder.test.ts`（create-node 透传 icon）、`menuEnrich.test.ts`（注册优先；text/image 不再靠猜） |
| 主题插件 | 现有测试保持全绿；BaseNode→BaseTitle 传值属字段透传，由类型检查 + vite 目验覆盖 |

命令（每步改完跑）：

```bash
cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-theme-default && node ./node_modules/vitest/vitest.mjs run
```

## 7. 不做的事（YAGNI）

- 不做图标选择器 / 图标注册表 / 图标主题化（插件现在直接给 svg 或组件足够）。
- 不改菜单描述文案与分组排序规则。
- 不改 v1（`packages/canvas-core/src`）——红线。

## 8. 契约文档同步

`docs/plan/canvas-core-v2-api.md` 节点注册段的 `title: { icon }` 设想落地为顶层 `icon`
（与 `content` 并列的不透明句柄）。
