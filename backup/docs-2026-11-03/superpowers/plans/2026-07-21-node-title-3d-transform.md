# Node Title 3D Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让节点标题继承卡片的 3D 倾斜，同时保持当前标题在不同画布缩放下的视觉大小和间距。

**Architecture:** 标题从 Teleport 的 `NodeToolbar` 移到 `.custom-node-card` 内部，通过绝对定位继续显示在卡片上方。标题布局工具改为返回节点内部使用的反向缩放值，使画布 zoom 和标题本地 scale 相乘后仍得到原来的屏幕效果。

**Tech Stack:** Vue 3、TypeScript、CSS transform、Node.js test runner、tsx

---

## File Structure

- Create: `packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts` — 验证标题本地缩放与最终屏幕效果。
- Modify: `packages/canvas-core/src/utils/viewportSpace.ts` — 将标题布局值改为节点内部坐标。
- Modify: `packages/canvas-core/src/components/Decoration/BaseNode.vue` — 标题移入卡片并在卡片上方定位。

### Task 1: 锁住标题缩放规则

**Files:**
- Create: `packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts`
- Test: `packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeTitleLayout } from '../viewportSpace'

test('node title keeps its screen size and offset above min zoom', () => {
  const layout = createNodeTitleLayout(2, { offset: 12, minZoom: 0.5 })

  assert.equal(layout.scale, 0.5)
  assert.equal(layout.offset, 6)
  assert.equal(layout.scale * 2, 1)
  assert.equal(layout.offset * 2, 12)
})

test('node title shrinks with the canvas below min zoom', () => {
  const layout = createNodeTitleLayout(0.25, { offset: 12, minZoom: 0.5 })

  assert.equal(layout.scale, 2)
  assert.equal(layout.offset, 24)
  assert.equal(layout.scale * 0.25, 0.5)
  assert.equal(layout.offset * 0.25, 6)
})

test('node title layout stays finite for an invalid zoom', () => {
  const layout = createNodeTitleLayout(0, { offset: 12, minZoom: 0.5 })

  assert.equal(Number.isFinite(layout.scale), true)
  assert.equal(Number.isFinite(layout.offset), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm exec tsx --test packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts
```

Expected: 第一个测试失败，当前 `scale` 是 `1`，不是节点内部需要的 `0.5`。

### Task 2: 改为节点内部的反向缩放

**Files:**
- Modify: `packages/canvas-core/src/utils/viewportSpace.ts`
- Test: `packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts`

- [ ] **Step 1: Write minimal implementation**

将 `createNodeTitleLayout` 的核心计算改为：

```ts
const localScale = 1 / Math.max(safeZoom, minZoom)

return {
  scale: localScale,
  offset: baseOffset * localScale,
  style: {
    transform: `scale(${localScale})`,
    transformOrigin: 'left bottom',
  },
}
```

- [ ] **Step 2: Run test to verify it passes**

Run:

```powershell
pnpm exec tsx --test packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts
```

Expected: 3 tests pass.

### Task 3: 将标题移入卡片

**Files:**
- Modify: `packages/canvas-core/src/components/Decoration/BaseNode.vue`

- [ ] **Step 1: Remove the title-only NodeToolbar dependency**

删除：

```ts
import NodeToolbar from './NodeToolbar.vue'
```

`Position` 仍供左右连接点使用，不删除。

- [ ] **Step 2: Move the existing title slot into the card**

删除卡片外的 `<NodeToolbar>...</NodeToolbar>`，在 `.custom-node-card` 的开头加入：

```vue
<div
  class="custom-node-title select-none nodrag nopan"
  :style="{ bottom: `calc(100% + ${titleOffset}px)` }"
  @dblclick.stop
>
  <slot name="title">
    <BaseTitle
      :title-style="titleStyle"
      :title-icon="nodeDef?.titleIcon"
      :label="nodeLabel"
    >
      <template v-if="$slots['title-icon']" #title-icon>
        <slot name="title-icon" />
      </template>
      <template #title-label>
        <slot name="title-label">
          <span class="truncate">{{ nodeLabel }}</span>
        </slot>
      </template>
      <template #title-extra>
        <slot name="title-extra" />
      </template>
    </BaseTitle>
  </slot>
</div>
```

- [ ] **Step 3: Add local positioning CSS**

```css
.custom-node-title {
  position: absolute;
  left: 0;
  z-index: 1;
}
```

标题是 `.custom-node-card` 的子元素，因此会自动继承 `cardTransform`。卡片已有 `overflow-visible`，标题不会被裁掉；内容仍由 `.custom-node-content-clip` 单独裁剪。

- [ ] **Step 4: Run type checking and build**

Run:

```powershell
pnpm build
```

Expected: `vue-tsc` 和 Vite build 都成功。

### Task 4: 浏览器验证

**Files:**
- Verify: `packages/canvas-core/src/components/Decoration/BaseNode.vue`

- [ ] **Step 1: Start the development server**

Run:

```powershell
pnpm dev --host 127.0.0.1
```

Expected: Vite 输出可访问的本地地址。

- [ ] **Step 2: Verify the title behavior**

在浏览器中检查：

1. 触发节点连接悬停反馈时，标题与卡片同步倾斜。
2. 画布 zoom 大于等于 `nodeTitleScaleMinZoom` 时，标题视觉大小与间距稳定。
3. zoom 小于阈值时，标题和间距继续随画布缩小。
4. 顶部、底部工具栏仍在屏幕空间显示，不跟随卡片倾斜。
5. 标题、卡片内容、连接点之间没有遮挡或跳动。

- [ ] **Step 3: Commit the implementation**

```powershell
git add -- packages/canvas-core/src/utils/__tests__/viewportSpace.test.ts packages/canvas-core/src/utils/viewportSpace.ts packages/canvas-core/src/components/Decoration/BaseNode.vue
git commit -m "fix(canvas): include node title in card 3d transform"
```
