# 节点类型图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 节点类型注册时声明自己的图标，右键菜单"新建节点"与节点标题左侧都读同一处；没声明就不显示。

**Architecture:** 图标是"不透明句柄"（SVG 字符串或 Vue 组件），内核只存不认（`unknown`，与 `content` 同款）。新增一个纯函数 `iconRenderMode()` 作为全局唯一的形态判定点，菜单浮层与标题条共用。数据从 `ctx.nodes.register` 经 nodeStore 类型表流向两个消费端。

**Tech Stack:** TypeScript + Vue 3 + vitest（各包独立 `vitest.config.ts`，node 环境）。

**工作区：** `D:/Code/Git/mini-canvas/.worktrees/node-type-icon`，分支 `codex/node-type-icon`。
以下所有路径相对该工作区根。

**测试命令（各包独立跑）：**
```bash
cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-theme-default && node ./node_modules/vitest/vitest.mjs run
```

---

## Task 1: 内核 —— 图标形态判定纯函数

**Files:**
- Create: `packages/canvas-core-v2/src/services/iconKind.ts`
- Test: `packages/canvas-core-v2/src/services/__tests__/iconKind.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { iconRenderMode } from '../iconKind'

describe('iconRenderMode（图标句柄形态判定）', () => {
  it('字符串图标判为 html（v-html 渲染）', () => {
    expect(iconRenderMode('<svg viewBox="0 0 24 24"></svg>')).toBe('html')
  })
  it('Vue 组件图标判为 component（<component :is> 渲染）', () => {
    const Comp = { name: 'FakeIcon', render: () => null }
    expect(iconRenderMode(Comp)).toBe('component')
  })
  it('未声明（undefined/null/false/空串）判为 none', () => {
    expect(iconRenderMode(undefined)).toBe('none')
    expect(iconRenderMode(null)).toBe('none')
    expect(iconRenderMode(false)).toBe('none')
    expect(iconRenderMode('')).toBe('none')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run iconKind`
Expected: FAIL —— 找不到模块 `../iconKind`

- [ ] **Step 3: 写最小实现**

```ts
/**
 * iconKind —— 图标句柄形态判定（唯一判定点）。
 *
 * 节点类型注册时声明的 icon 是**不透明句柄**：可以是 SVG 字符串，也可以是 Vue 组件，
 * 内核不解析、不依赖 Vue（同 content 的 opaque 语义）。谁来渲染，谁就在这里问一句
 * "它该怎么渲染"——避免菜单层与标题层各写一套 typeof 判断而漂移。
 */

/** 图标渲染方式：html=v-html 字符串 / component=<component :is> / none=不渲染 */
export type IconRenderMode = 'html' | 'component' | 'none'

/**
 * 判定图标句柄该怎么渲染。
 * - null / undefined / false / ''（未声明或空）→ 'none'
 * - 非空字符串 → 'html'
 * - 其它（Vue 组件、自定义对象等）→ 'component'
 */
export function iconRenderMode(icon: unknown): IconRenderMode {
  if (icon === null || icon === undefined || icon === false) return 'none'
  if (typeof icon === 'string') return icon === '' ? 'none' : 'html'
  return 'component'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS（320 + 新增 3）

- [ ] **Step 5: 从 services 出口导出**

`packages/canvas-core-v2/src/services/index.ts` 末尾加：

```ts
export { iconRenderMode } from './iconKind'
export type { IconRenderMode } from './iconKind'
```

- [ ] **Step 6: 提交**

```bash
git add packages/canvas-core-v2/src/services/iconKind.ts packages/canvas-core-v2/src/services/__tests__/iconKind.test.ts packages/canvas-core-v2/src/services/index.ts
git commit -m "feat(canvas-core-v2): 新增图标句柄形态判定 iconRenderMode"
```

---

## Task 2: 内核 —— 节点类型注册带上 icon

**Files:**
- Modify: `packages/canvas-core-v2/src/services/nodeStore.ts`（`CanvasNodeType`）
- Modify: `packages/canvas-core-v2/src/core/registry/registerNodeType.ts`（`NodeTypeDef`）
- Modify: `packages/canvas-core-v2/src/core/capabilities.ts`（`NodeRegisterDef`）
- Modify: `packages/canvas-core-v2/src/core/types.ts`（`PluginCapabilities.nodes.register` 形参）
- Test: `packages/canvas-core-v2/src/core/registry/__tests__/registerNodeType.test.ts`

- [ ] **Step 1: 写失败测试**

在 `registerNodeType.test.ts` 的 `describe('registerNodeType（插件"一次自描述"节点注册接缝）')` 里追加：

```ts
  it('icon 随类型注册落入 nodeStore（字符串与组件句柄原样透传）', async () => {
    const SvgIcon = '<svg viewBox="0 0 24 24"><path d="M4 7h16"/></svg>'
    const CompIcon = { name: 'FakeIcon', render: () => null }
    const { nodeStore } = await bootWithSetup((ctx) => {
      registerNodeType(ctx, {
        type: 'with-icon',
        label: '带图标',
        defaultSize: { w: 10, h: 10 },
        icon: SvgIcon,
        segments: { content: TextContentStub },
      })
      registerNodeType(ctx, {
        type: 'comp-icon',
        label: '组件图标',
        defaultSize: { w: 10, h: 10 },
        icon: CompIcon,
      })
    })
    expect(nodeStore.types.get('with-icon')?.icon).toBe(SvgIcon)
    expect(nodeStore.types.get('comp-icon')?.icon).toBe(CompIcon)
  })

  it('未声明 icon 时字段为 undefined（标题侧据此不渲染图标）', async () => {
    const { nodeStore } = await bootWithSetup((ctx) => {
      registerNodeType(ctx, { type: 'no-icon', label: '无图标', defaultSize: { w: 1, h: 1 } })
    })
    expect(nodeStore.types.get('no-icon')?.icon).toBeUndefined()
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run registerNodeType`
Expected: FAIL —— `icon` 未落表（两条均得到 undefined）

- [ ] **Step 3: 落实现（四处字段透传）**

`nodeStore.ts` 的 `CanvasNodeType` 里，`resizable` 上一行加：

```ts
  /** 节点类型图标（opaque 句柄：SVG 字符串或 Vue 组件；内核不解析）。菜单"新建节点"与节点标题共用。 */
  icon?: unknown
```

`registerNodeType.ts` 的 `NodeTypeDef` 里，`resizable` 上一行加：

```ts
  /** 类型图标（opaque 句柄，同 content 语义；缺省 = 不显示图标） */
  icon?: unknown
```

同文件 `registerNodeType()` 的 `nodeStore.registerType({ ... })` 里加一行：

```ts
    icon: def.icon,
```

`capabilities.ts` 的 `NodeRegisterDef` 里，`resizable` 上一行加：

```ts
  /** 类型图标（opaque 句柄：SVG 字符串或 Vue 组件；透传进 nodeStore） */
  icon?: unknown
```

`capabilities.ts` 的 `nodes.register` 里，`registerNodeType(ctx, { ... })` 加一行：

```ts
          icon: def.icon,
```

`types.ts` 的 `PluginCapabilities.nodes.register` 形参里，`resizable` 上一行加：

```ts
      /** 类型图标（opaque 句柄：SVG 字符串或 Vue 组件；缺省不显示） */
      icon?: unknown
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/canvas-core-v2/src/services/nodeStore.ts packages/canvas-core-v2/src/core/registry/registerNodeType.ts packages/canvas-core-v2/src/core/capabilities.ts packages/canvas-core-v2/src/core/types.ts packages/canvas-core-v2/src/core/registry/__tests__/registerNodeType.test.ts
git commit -m "feat(canvas-core-v2): 节点类型注册支持 icon 字段透传"
```

---

## Task 3: 内核 —— 菜单服务把类型图标带进 create-node 项

**Files:**
- Modify: `packages/canvas-core-v2/src/services/menuService.ts`
- Test: `packages/canvas-core-v2/src/services/__tests__/menuService.test.ts`

- [ ] **Step 1: 写失败测试**

在 `menuService.test.ts` 追加：

```ts
  it('pane 新建节点项带上该类型的 icon（字符串与组件都原样透传）', () => {
    const svc = createMenuService(() => [])
    const SvgIcon = '<svg viewBox="0 0 24 24"></svg>'
    const CompIcon = { name: 'FakeIcon', render: () => null }
    const items = svc.menuFor('pane', [
      { type: 'text', label: '文本', icon: SvgIcon },
      { type: 'custom', label: '自定义', icon: CompIcon },
      { type: 'plain', label: '无图标' },
    ])
    expect(items[0].icon).toBe(SvgIcon)
    expect(items[1].icon).toBe(CompIcon)
    expect(items[2].icon).toBeUndefined()
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run menuService`
Expected: FAIL —— `items[0].icon` 为 undefined

- [ ] **Step 3: 落实现**

`menuService.ts` 三处改动：

① `MenuItem.icon`（原 `icon?: string`）改为：

```ts
  /** 图标（opaque 句柄：SVG 字符串或 Vue 组件，原样传显示层） */
  icon?: unknown
```

② `MenuCreatableType` 加字段：

```ts
export interface MenuCreatableType {
  type: string
  label: string
  /** 该类型声明的图标（opaque 句柄；缺省不传） */
  icon?: unknown
}
```

③ `menuFor` 的 pane 建节点区，把 icon 带出去：

```ts
        creatableTypes.forEach((t, index) => {
          items.push({
            id: 'create-node:' + t.type,
            label: t.label,
            group: 'create',
            order: index,
            kind: 'create-node',
            nodeType: t.type,
            ...(t.icon !== undefined ? { icon: t.icon } : {}),
          })
        })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/canvas-core-v2/src/services/menuService.ts packages/canvas-core-v2/src/services/__tests__/menuService.test.ts
git commit -m "feat(canvas-core-v2): 菜单服务把节点类型 icon 带进新建节点项"
```

---

## Task 4: 菜单插件 —— 菜单项透传注册图标，去掉按名字猜的硬编码

**Files:**
- Modify: `packages/plugins/plugin-context-menu/src/menuBuilder.ts`
- Modify: `packages/plugins/plugin-context-menu/src/connectionMenu.ts`
- Modify: `packages/plugins/plugin-context-menu/src/menuEnrich.ts`
- Modify: `packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts`
- Test: `packages/plugins/plugin-context-menu/src/__tests__/menuBuilder.test.ts`
- Test: `packages/plugins/plugin-context-menu/src/__tests__/menuEnrich.test.ts`

- [ ] **Step 1: 写失败测试**

`menuBuilder.test.ts` 追加：

```ts
  it('create-node 项透传节点类型声明的 icon', () => {
    const SvgIcon = '<svg viewBox="0 0 24 24"></svg>'
    const items = buildMenuItems('pane', [], [
      { type: 'text', label: '文本', icon: SvgIcon },
      { type: 'plain', label: '无图标' },
    ])
    expect(items[0].icon).toBe(SvgIcon)
    expect(items[1].icon).toBeUndefined()
  })
```

`menuEnrich.test.ts` 改写既有用例 + 追加（原有 4 例里依赖"按名字猜 text/image"的部分要按新语义调整）：

```ts
  it('注册的图标优先于插件内置猜测', () => {
    const SvgIcon = '<svg viewBox="0 0 24 24" data-custom="1"></svg>'
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text', icon: SvgIcon }),
    ])
    expect(it.icon).toBe(SvgIcon)
  })
  it('组件图标原样透传（不被替换成内置 svg）', () => {
    const CompIcon = { name: 'FakeIcon', render: () => null }
    const [it] = enrichMenuItems([
      item({ id: 'create-node:weird', label: '怪节点', kind: 'create-node', nodeType: 'weird', icon: CompIcon }),
    ])
    expect(it.icon).toBe(CompIcon)
  })
  it('未注册图标的节点类型给 default 占位（图标列恒在，不按名字猜）', () => {
    const [it] = enrichMenuItems([
      item({ id: 'create-node:text', label: '文本', kind: 'create-node', nodeType: 'text' }),
    ])
    expect(it.icon).toContain('<svg')
    expect(it.icon).not.toContain('M4 7V5h16v2') // 不是文本专用图标
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run menuBuilder menuEnrich`
Expected: FAIL

- [ ] **Step 3: 落实现**

`menuBuilder.ts`：

① `MenuCommandLike.icon` 保持 `string`（命令只给 svg 字符串）；`MenuNodeTypeLike` 加 `icon`：

```ts
export interface MenuNodeTypeLike {
  type: string
  label: string
  /** 该类型声明的图标（opaque 句柄：SVG 字符串或 Vue 组件） */
  icon?: unknown
}
```

② `ContextMenuItem.icon`（原 `icon?: string`）改为：

```ts
  /** 图标（opaque 句柄：SVG 字符串或 Vue 组件，原样传显示层） */
  icon?: unknown
```

③ `buildMenuItems` 的 pane 建节点区带上 icon：

```ts
    nodeTypes.forEach((t, index) => {
      items.push({
        id: 'create-node:' + t.type,
        label: t.label,
        group: 'create',
        order: index,
        kind: 'create-node',
        nodeType: t.type,
        ...(t.icon !== undefined ? { icon: t.icon } : {}),
      })
    })
```

`connectionMenu.ts` 的 `buildConnectionMenuItems` 同样带上：

```ts
export function buildConnectionMenuItems(types: readonly MenuNodeTypeLike[]): ContextMenuItem[] {
  return types.map((t, index) => ({
    id: 'create-node:' + t.type,
    label: t.label,
    group: 'create',
    order: index,
    kind: 'create-node' as const,
    nodeType: t.type,
    ...(t.icon !== undefined ? { icon: t.icon } : {}),
  }))
}
```

`menuEnrich.ts`：

① 删掉 `ICONS` 里的 `text` 与 `image` 两条（不再由插件替节点类型定图标）。

② `iconKeyOf` 只保留命令类推断与 default：

```ts
function iconKeyOf(item: ContextMenuItem): string {
  // create-node 的图标来自节点类型注册（menuBuilder 已带上）；此处只在未注册时给 default 占位。
  if (item.kind === 'create-node') return 'default'
  const id = item.commandId ?? ''
  if (/delete|remove/i.test(id)) return 'trash'
  if (/duplicate/i.test(id)) return 'duplicate'
  if (/copy/i.test(id)) return 'copy'
  if (/paste/i.test(id)) return 'paste'
  return 'default'
}
```

③ `enrichMenuItems` 的 icon 行改为"注册的优先，未注册才占位"：

```ts
      icon: itemHasIcon(it) ? it.icon : ICONS[iconKeyOf(it)],
```

配套加一个私有小判定（或直接内联 `it.icon !== undefined && it.icon !== '' && it.icon !== null && it.icon !== false`）。
推荐复用内核纯函数，避免第二套判定：

```ts
import { iconRenderMode } from '@mini-canvas/canvas-core-v2'
// ...
      icon: iconRenderMode(it.icon) === 'none' ? ICONS[iconKeyOf(it)] : it.icon,
```

`contextMenuPlugin.ts` 两处构造可建类型列表时带上 icon：

```ts
    const nodeTypes = [...nodeStore.types.values()]
      .filter((t) => creatable.has(t.type))
      .map((t) => ({ type: t.type, label: t.label, icon: t.icon }))
```

和

```ts
    return [...nodeStore.types.values()]
      .filter((t) => creatable.has(t.type))
      .map((t) => ({ type: t.type, label: t.label, icon: t.icon }))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-context-menu/src/menuBuilder.ts packages/plugins/plugin-context-menu/src/connectionMenu.ts packages/plugins/plugin-context-menu/src/menuEnrich.ts packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts packages/plugins/plugin-context-menu/src/__tests__/menuBuilder.test.ts packages/plugins/plugin-context-menu/src/__tests__/menuEnrich.test.ts
git commit -m "feat(context-menu): 新建节点图标取自节点类型注册"
```

---

## Task 5: 菜单浮层 —— 支持组件图标渲染

**Files:**
- Modify: `packages/plugins/plugin-context-menu/src/ContextMenu.vue`
- Modify: `packages/plugins/plugin-context-menu/src/ConnectionMenuContent.vue`

（纯模板分支，由 Task 7 的类型检查 + 目验覆盖；判定逻辑已在 Task 1 单测。）

- [ ] **Step 1: ContextMenu.vue 图标位改为双分支**

`<script setup>` 里 `splitComboChips` 的 import 旁加：

```ts
import { iconRenderMode } from '@mini-canvas/canvas-core-v2'
```

模板里把原来的：

```html
            <span class="ctx-menu-icon">
              <span v-if="item.icon" class="ctx-menu-icon-raw" v-html="item.icon" />
```

改为：

```html
            <span class="ctx-menu-icon">
              <span v-if="iconRenderMode(item.icon) === 'html'" class="ctx-menu-icon-raw" v-html="item.icon" />
              <component
                v-else-if="iconRenderMode(item.icon) === 'component'"
                :is="item.icon"
                class="ctx-menu-icon-raw"
              />
```

`@mini-canvas/canvas-core-v2` 已在 `contextMenuPlugin.ts` 里 import（同包依赖已声明），无需改 package.json。

- [ ] **Step 2: ConnectionMenuContent.vue 同样处理**

同款双分支替换（类名 `conn-menu-icon-raw`）。

- [ ] **Step 3: 跑两个包的测试确认没跑坏**

Run: `cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/plugins/plugin-context-menu/src/ContextMenu.vue packages/plugins/plugin-context-menu/src/ConnectionMenuContent.vue
git commit -m "feat(context-menu): 菜单图标支持 Vue 组件形态"
```

---

## Task 6: 主题壳 —— 节点标题左侧显示类型图标

**Files:**
- Modify: `packages/plugins/plugin-theme-default/src/composables/useNodeCapability.ts`
- Modify: `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`
- Modify: `packages/plugins/plugin-theme-default/src/components/node/BaseTitle.vue`

- [ ] **Step 1: useNodeCapability 暴露 icon**

`resizable` computed 旁加：

```ts
  /** 该 type 声明的图标（opaque 句柄：SVG 字符串或 Vue 组件；缺省 undefined = 不显示） */
  const icon = computed(() => nodeDef.value?.icon)
```

return 里加 `icon`：

```ts
  return { hasTarget, hasSource, defaultSize, resizable, icon }
```

- [ ] **Step 2: BaseTitle 改用 iconRenderMode 并去掉兜底图标**

`<script setup>` 里 import 并重写判定：

```ts
import { iconRenderMode } from '@mini-canvas/canvas-core-v2'

const props = defineProps<{
  label?: string
  titleIcon?: TitleIcon
  titleStyle?: CSSProperties
  interactive?: boolean
  editing?: boolean
}>()

/** 图标形态：'html' 走 v-html、'component' 走 <component :is>、'none' 完全不渲染图标位 */
const iconMode = computed(() => iconRenderMode(props.titleIcon))
```

（原来的 `shouldRenderIcon` / `componentTitleIcon` / `htmlTitleIcon` 三个 computed 一并删掉。）

模板图标位改为：

```html
    <slot v-if="iconMode !== 'none'" name="title-icon">
      <span v-if="iconMode === 'html'" class="base-title__icon base-title__icon--html" v-html="titleIcon" />
      <component v-else :is="titleIcon" class="base-title__icon" />
    </slot>
```

（原来那个写死的 `<svg>…<polyline points="4 7 4 4 20 4 20 7"/>` 兜底 svg 整段删除。）

同时把 `.base-title__icon` 尺寸从 `0.875rem`（14px）提到 16px 前先看设计规范——
§3.10 规定行内图标只用 12/14/16 三档，标题属"行"级 → **保持 14px 不变**，只补一条让组件图标也吃满尺寸：

```css
.base-title__icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

/* 组件图标：作者给的组件不必自带尺寸，外层统一约束 */
.base-title__icon > :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
```

- [ ] **Step 3: BaseNode 把 icon 传下去**

`BaseTitle` 那处模板（`:label="nodeLabel"` 一行）加属性：

```html
        <BaseTitle v-else :interactive="true" :editing="isEditingTitle" :label="nodeLabel" :title-icon="capabilityIcon">
```

`useNodeCapability` 的调用点在文件里已有（第 175 行 `const cap = useNodeCapability(props.type)`），
在 `showSourceHandle` 那两行下面接出图标，**不要重复调用**：

```ts
const showTargetHandle = cap.hasTarget
const showSourceHandle = cap.hasSource
// 标题左侧图标 = 类型注册时声明的 icon（opaque 句柄；未声明则不显示）
const titleIcon = cap.icon
```

模板用 `:title-icon="titleIcon"`。

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `cd packages/plugins/plugin-theme-default && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS（30 例全绿）

Run: `cd packages/plugins/plugin-theme-default && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
Expected: 无输出（0 错误）

- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-theme-default/src/composables/useNodeCapability.ts packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue packages/plugins/plugin-theme-default/src/components/node/BaseTitle.vue
git commit -m "feat(theme-default): 节点标题左侧显示类型图标"
```

---

## Task 7: 节点插件声明图标 + 契约文档 + 全量验证

**Files:**
- Modify: `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`
- Modify: `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts`
- Modify: `docs/plan/canvas-core-v2-api.md`

- [ ] **Step 1: text 插件声明图标**

`nodeTextPlugin.ts` 顶部加常量（沿用原菜单里那张文本 svg）：

```ts
/** 节点类型图标（标题左侧与右键"新建节点"共用；SVG 字符串 = opaque 句柄） */
const nodeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>'
```

`ctx.nodes.register({ ... })` 里 `label: '文本',` 下一行加：

```ts
    icon: nodeIcon,
```

- [ ] **Step 2: image 插件声明图标**

同款做法，图标用图片那张：

```ts
/** 节点类型图标（标题左侧与右键"新建节点"共用；SVG 字符串 = opaque 句柄） */
const nodeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>'
```

`ctx.nodes.register({ ... })` 里 `label: '图片',` 下一行加 `icon: nodeIcon,`。

- [ ] **Step 3: 跑这两个包的测试**

Run: `cd packages/plugins/plugin-node-text && node ./node_modules/vitest/vitest.mjs run`
Run: `cd packages/plugins/plugin-node-image && node ./node_modules/vitest/vitest.mjs run`
Expected: PASS

- [ ] **Step 4: 契约文档同步**

`docs/plan/canvas-core-v2-api.md` 节点注册示例（`ctx.node.register('text', { ... })`）里，
把 `title: { icon: '…' },               // 只声明图标，label 由内核管` 一行改为：

```ts
  icon: '…',                          // 类型图标（opaque：SVG 字符串或 Vue 组件）；菜单新建项 + 节点标题共用
```

并在该代码块下方条目里补一条：

```md
- **图标单一来源**：节点类型注册时声明 `icon`（SVG 字符串或 Vue 组件，内核不解析），右键菜单"新建节点"
  与节点标题左侧读同一处；未声明则不显示图标。
```

- [ ] **Step 5: 全量验证（三个包测试 + 三处类型检查）**

```bash
cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-context-menu && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-theme-default && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-node-text && node ./node_modules/vitest/vitest.mjs run
cd packages/plugins/plugin-node-image && node ./node_modules/vitest/vitest.mjs run
```

Expected: 全部 PASS（0 失败）。

类型检查（逐个包）：

```bash
cd packages/canvas-core-v2 && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
cd packages/plugins/plugin-context-menu && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
cd packages/plugins/plugin-theme-default && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

Expected: 均无输出。

- [ ] **Step 6: 提交**

```bash
git add packages/plugins/plugin-node-text/src/nodeTextPlugin.ts packages/plugins/plugin-node-image/src/nodeImagePlugin.ts docs/plan/canvas-core-v2-api.md
git commit -m "feat(node-plugins): text/image 声明节点类型图标并同步契约文档"
```
