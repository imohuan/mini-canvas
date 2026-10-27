# 参考卡片、标签与粘贴 解耦与归一化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行状态（2026-10-27）：全部 10 个任务已完成并验证。** 提交清单：
> `9bb3a7be`（归一化）→ `0ec68b38`（格数规则）→ `92bbdf5f`（缺号真实序号）→
> `8210f8a0`（按 id 换缩略图）→ `564f2c7a`（拖拽语义测试）→ `fd635f78`（默认图标）→
> `1bfd4115`（onPasteFiles）→ `6debda95`（底栏粘贴）→ `6648f2c5`（tagSpec）→
> `cba795a9`（真实节点回归探针）。

**Goal:** 让底栏输入框（`prosemirror-editor-bundle`）只提供通用能力，把标签/粘贴/下拉语义交给调用方；同时修掉「声明后凭空长出一堆空格」「拖拽后缩略图不跟手」「空壳没有默认图标」「粘贴图片没反应」。

**Architecture:** 编辑器侧新增可选回调（标签规格 `tagSpec`、粘贴 `onPasteFiles`、兜底渲染），不传时行为不变；底栏侧把参考区收敛成「按类型各自一个有序数组」，UI 序号 = 数组下标 + 1，缩略图 = 该类型数组第 N 项，声明序号在「标记」时归一化成 1..n。

**Tech Stack:** TypeScript / Vue 3 / ProseMirror / Vitest / Playwright（仓库自带 e2e 探针）

**Spec:** 本文件即设计说明（用户口述需求 + 2026-10-27 三轮澄清）。实施时以本文件为准。

## 数据模型（先把这件事说清楚，其余都从这里推）

参考区**不是**「一个按序号排列的槽位表」，而是**按资源类型分开的几个有序数组**：

```ts
interface RefBucket {
  kind: 'image' | 'video' | 'audio'
  /** 拖拽就是改这里的顺序；元素只需要 url（外加节点 id 供连线/删除） */
  items: Array<{ nodeId: string; url: string }>
}
```

由此推出四条规则，后面所有任务都必须遵守：

1. **UI 序号 = 数组下标 + 1**。图片、视频、音频各自从 1 数。
2. **标签名带序号**：`图片1` / `图片2` …；标签名就是引用名。
3. **缩略图 = 该类型数组的第 N 项**（N 取自标签名）。所以把第 4 张拖到最前面之后，它**就是**图片1，原来第 1 张变成图片2 —— 标签名不变、指向的图变了。
4. **拖拽只改数组顺序**，不产生任何新身份；序号永远等于位置。

格子数量的取值（用户已确认）：

```
格数 = max(该类型连线数量, 该类型声明归一化后的数量)
```

举例：连了 4 条、只声明 `@图片1` → 4 格全有图；连了 2 条、声明 `@图片1 @图片3 @图片9` → 归一化成 1,2,3 → 3 格（前两格有图，第 3 格空壳）；完全没连线、声明 3 个 → 3 个空壳。

## 归一化：为什么选它

用户给了两种方案（补全归一化 vs 保留原序号只补那一格）。选**归一化**：

- 序号连续，界面不会凭空长出一堆空格（`@图片44` 不会炸出 44 格）；
- 序号与数组位置天然一致，缩略图规则退化成「第 N 项」，不用再维护两套编号；
- 代价只有一个：会改写提示词里的序号（`@图片9` → 图片3）。转换后正文显示的就是新名字，用户看到的就是实际生效的东西。

## Global Constraints

- 不新建分支、不使用子代理写代码（用户明确要求）。
- 编辑文件只用 `apply_patch`，不用 PowerShell 写文件。
- 每完成一个文件（或一组相关改动）立刻 `git add` + `git commit`。
- 编辑器现有公开 API 不得破坏：`insertResource / replaceResource / replaceResourceThumbByName / refreshChips / setText / markRefSlots / menuOpen` 必须保持可用（Agent 面板在用）。
- 参考区只允许**一行**（用户 2026-10-25 口径）。
- 标签外观只有**一种**（chip），不允许同时存在 `@名字` 下划线文字样式。
- 同一份 `resource` schema 也被 Agent 面板的技能/MCP/资产标签共用，改动必须同时跑 `packages/plugins/plugin-agent` 测试。
- 验证命令：两侧 `test` + `typecheck`，构建链 `bundle → bottom-bar → ui`，回归样本用真实画布 `packages/cloud-server/.mini-canvas/canvases/824e779f34314f86/canvas.json` 的节点 23。

---

### Task 1: 声明序号归一化（标记时把 1,3,9 变成 1,2,3）

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/refSlots.ts`（新增 `normalizeRefSlots`）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/refSlots.test.ts`

**Interfaces:**
- Produces:
```ts
export function normalizeRefSlots(
  slots: ReadonlyArray<RefSlotRef>,
): { renamed: Array<{ slot: RefSlotRef; index: number }>; map: Map<string, number> }
```
  同类型按**出现顺序**重编成 1..n，互不跨类型影响。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeRefSlots } from '../refSlots'

describe('归一化：图片 1,9,3 → 1,2,3', () => {
  it('同类型按出现顺序重编，跨类型互不影响', () => {
    const out = normalizeRefSlots([
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'image:9', kind: 'image', index: 9 },
      { key: 'image:3', kind: 'image', index: 3 },
      { key: 'audio:5', kind: 'audio', index: 5 },
    ])
    expect(out.renamed.map((r) => r.slot.key)).toEqual(['image:1', 'image:9', 'image:3', 'audio:5'])
    expect(out.renamed.map((r) => r.index)).toEqual([1, 2, 3, 1])
    expect(out.map.get('image:9')).toBe(2)
    expect(out.map.get('audio:5')).toBe(1)
  })

  it('已经是 1..n 时不动（幂等）', () => {
    const out = normalizeRefSlots([
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'image:2', kind: 'image', index: 2 },
    ])
    expect(out.renamed.map((r) => r.index)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- -t "归一化"`
Expected: FAIL（`normalizeRefSlots` 不存在）

- [ ] **Step 3: 实现**

```ts
export function normalizeRefSlots(slots: ReadonlyArray<RefSlotRef>): {
  renamed: Array<{ slot: RefSlotRef; index: number }>
  map: Map<string, number>
} {
  const seq: Record<string, number> = {}
  const map = new Map<string, number>()
  const renamed = slots.map((slot) => {
    seq[slot.kind] = (seq[slot.kind] ?? 0) + 1
    const index = seq[slot.kind]
    map.set(slot.key, index)
    return { slot, index }
  })
  return { renamed, map }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- -t "归一化"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/plugins/plugin-bottom-bar/src/refSlots.ts packages/plugins/plugin-bottom-bar/src/__tests__/refSlots.test.ts
git commit -m "feat(bottom-bar): 声明序号归一化（图片 1,9,3 → 1,2,3）"
```

---

### Task 2: 参考格数量 = max(连线数, 归一化后的声明数)

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/refTiles.ts:15-27`（`RefTile` 增加 `slotIndex`）
- Modify: `packages/plugins/plugin-bottom-bar/src/refTiles.ts:66-180`（`mergeRefTiles`）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/refSlotRules.test.ts`

**Interfaces:**
- Produces: `RefTile` 新增 `slotIndex: number`（标签名里的序号），保留 `index`（= 显示位置，由排序后重编）。
  未拖拽时两者相同；拖拽后 `index` 变、`slotIndex` 不变。
- Produces: `mergeRefTiles(slots, cards, displayOrder?)` 签名不变。

- [ ] **Step 1: 写失败测试（钉住用户给的两个例子）**

```ts
it('只声明 图片44（已归一化成 1）、连线 4 条 → 4 格', () => {
  const tiles = mergeRefTiles(
    [{ kind: 'image', index: 1 }],
    [
      { id: 'a', name: '图片1', url: 'a.png', isText: false },
      { id: 'b', name: '图片2', url: 'b.png', isText: false },
      { id: 'c', name: '图片3', url: 'c.png', isText: false },
      { id: 'd', name: '图片4', url: 'd.png', isText: false },
    ],
  )
  expect(tiles).toHaveLength(4)
  expect(tiles.every((t) => !t.pending)).toBe(true)
})

it('声明归一化成 3 个、连线 2 条 → 3 格（第 3 格空壳）', () => {
  const tiles = mergeRefTiles(
    [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }, { kind: 'image', index: 3 }],
    [
      { id: 'a', name: '图片1', url: 'a.png', isText: false },
      { id: 'b', name: '图片2', url: 'b.png', isText: false },
    ],
  )
  expect(tiles).toHaveLength(3)
  expect(tiles[2]).toMatchObject({ pending: true, slotIndex: 3 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- -t "图片44"`
Expected: FAIL（当前补齐 1..N）

- [ ] **Step 3: 改实现**

```ts
for (const kind of ['image', 'video', 'audio'] as const) {
  if (!kinds.has(kind)) continue
  const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
  const bySeq = seqOf(kind)                       // 按 refName 的真实序号
  const declared = slots.filter((s) => s.kind === kind).map((s) => s.index)
  const cardCount = bySeq.size
  const declaredCount = new Set(declared).size
  const total = Math.max(cardCount, declaredCount, 0)
  for (let slotIndex = 1; slotIndex <= total; slotIndex++) {
    const card = bySeq.get(slotIndex)
    tiles.push({
      key: card ? 'card:' + card.id : 'slot:' + kind + ':' + slotIndex,
      slotKey: card ? undefined : kind + ':' + slotIndex,
      slotIndex,
      index: slotIndex,            // 临时值，排序后再重编成显示位置
      label: label + ' ' + slotIndex,
      pending: !card,
      name: card?.name ?? label + ' ' + slotIndex,
      url: card?.url,
      isText: false,
      card,
    })
  }
}
```

末尾排序后的重编（`refTiles.ts:175`）保持只改显示位：

```ts
return sorted.map((t, i) => ({ ...t, index: i + 1 }))
```

（`slotIndex` 不参与重编 —— 这就是「拖拽后序号不跟图走」的落点。）

- [ ] **Step 4: 同步改顶部注释**（把「格子数量 = max(连线素材数，正文声明的最大序号)」改成新规则）

- [ ] **Step 5: 跑测试**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test`
Expected: 新增用例通过；既有「声明到图片2 → 2 格」类用例按新语义复核

- [ ] **Step 6: 提交**

```bash
git add packages/plugins/plugin-bottom-bar/src/refTiles.ts packages/plugins/plugin-bottom-bar/src/__tests__/refSlotRules.test.ts
git commit -m "fix(bottom-bar): 参考格数量改为 max(连线数, 归一化声明数)，序号与显示位分离"
```

---

### Task 3: 缺号检查按真实序号

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/refTiles.ts:185-210`（`findRefGap`）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/refSlotRules.test.ts`

**Interfaces:**
- Produces: `findRefGap(slots, cards)` 语义不变，但内部按 `refNameToSlot` 的**真实序号**判断（修掉「图片2、图片4 被当成第 1、2 格」）。

- [ ] **Step 1: 写失败测试**

```ts
it('连线只有 图片2、图片4 → 缺 1、3（按真实序号判断）', () => {
  const gap = findRefGap(
    [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }, { kind: 'image', index: 3 }, { kind: 'image', index: 4 }],
    [
      { id: 'b', name: '图片2', url: 'b.png', isText: false },
      { id: 'd', name: '图片4', url: 'd.png', isText: false },
    ],
  )
  expect(gap).toEqual({ kind: 'image', missing: [1, 3] })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- -t "真实序号"`
Expected: FAIL（现在按出现顺序数，得出缺 3、4）

- [ ] **Step 3: 改实现**

```ts
const haveBy = (kind: 'image' | 'video' | 'audio'): Set<number> => {
  const set = new Set<number>()
  for (const c of cards) {
    const p = refNameToSlot((c as TileCardLike & WithRefName).refName || c.name)
    if (!p || p.kind !== kind) continue
    set.add(p.index)          // ← 用真实序号，不再 seq += 1
  }
  return set
}
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C packages/plugins/plugin-bottom-bar test
git add packages/plugins/plugin-bottom-bar/src/refTiles.ts packages/plugins/plugin-bottom-bar/src/__tests__/refSlotRules.test.ts
git commit -m "fix(bottom-bar): 缺号检查按 refName 的真实序号判断"
```

---

### Task 4: 缩略图按「该类型数组第 N 项」取值

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts`（新增 `applyThumbByIds` + `replaceResourceThumbByIds`）
- Modify: `packages/prosemirror-editor-bundle/src/index.vue`（expose）
- Modify: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`（`refreshSlotChips`）
- Test: `packages/prosemirror-editor-bundle/src/__tests__/thumbByIds.test.ts`（新建）

**Interfaces:**
- Produces:
```ts
export function applyThumbByIds(doc: PMNode, ids: readonly string[], url: string): PMNode
```
  - 命中任一 `attrs.id` 就只换 `url`，**绝不改 name**；没命中时原样返回同一个 doc 引用
- Produces: `replaceResourceThumbByIds(ids, url): boolean`（组件方法，内部走 view）

- [ ] **Step 1: 写失败测试（纯函数，不依赖 view）**

```ts
import { describe, expect, it } from 'vitest'
import { parsePlainTextToContent, applyThumbByIds } from '../useEditor.ts'

const schema = parsePlainTextToContent('<ref type="node" name="图片1" canvasId="c" nodeId="1" />', undefined)[0].type.schema

it('按 id 换缩略图：改 url，不改 name', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.nodes.resource.create({ id: 'ref-slot:image:1', name: '图片3', url: 'old.png', category: '素材' }),
    ]),
  ])
  const out = applyThumbByIds(doc, ['ref-slot:image:1'], 'new.png')
  const node = out.child(0).child(0)
  expect(node.attrs.url).toBe('new.png')
  expect(node.attrs.name).toBe('图片3')
})

it('id 对不上 → 原样返回（同一个引用）', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [
    schema.nodes.resource.create({ id: 'x', name: '图片1', url: 'a.png', category: '素材' }),
  ])])
  expect(applyThumbByIds(doc, ['nope'], 'b.png')).toBe(doc)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/prosemirror-editor-bundle test -- -t "按 id 换缩略图"`
Expected: FAIL（未导出）

- [ ] **Step 3: 实现（手工重建 doc，不新增依赖）**

```ts
export function applyThumbByIds(doc: PMNode, ids: readonly string[], url: string): PMNode {
  const set = new Set(ids)
  let changed = false
  const walk = (node: PMNode): PMNode => {
    if (node.type.name === 'resource' && set.has(String(node.attrs.id ?? '')) && (node.attrs.url ?? '') !== url) {
      changed = true
      return node.type.create({ ...node.attrs, url, thumbnail_url: '' }, null, node.marks)
    }
    if (node.childCount === 0) return node
    const kids: PMNode[] = []
    let same = true
    node.forEach((child, _offset, i) => {
      const next = walk(child)
      if (next !== child) same = false
      kids.push(next)
    })
    return same ? node : node.type.create(node.attrs, kids, node.marks)
  }
  const next = walk(doc)
  return changed ? next : doc
}
```

方法壳（保证与选区/历史配合）：

```ts
function replaceResourceThumbByIds(ids: readonly string[], url: string): boolean {
  if (!view) return false
  const next = applyThumbByIds(view.state.doc, ids, url)
  if (next === view.state.doc) return false
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
  return true
}
```

- [ ] **Step 4: 底栏调用（id 两侧都要给，序号用 slotIndex）**

```ts
const ids = [
  tile.card?.id,                              // 资源面板插入的标签：attrs.id = 节点 id
  'ref-slot:' + kind + ':' + tile.slotIndex,  // 标记转出来的标签：attrs.id = 槽位 id
].filter(Boolean) as string[]
editorComponentRef.value?.replaceResourceThumbByIds?.(ids, tile.url ?? '')
```

- [ ] **Step 5: 跑测试 + 提交**

```bash
pnpm -C packages/prosemirror-editor-bundle test
pnpm -C packages/plugins/plugin-bottom-bar test
git add packages/prosemirror-editor-bundle/src packages/plugins/plugin-bottom-bar/src
git commit -m "fix(bottom-bar): 缩略图按类型数组第 N 项取值，id 双形态命中"
```

---

### Task 5: 钉住「拖拽只改显示顺序」的语义

**Files:**
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarOrder.test.ts`

- [ ] **Step 1: 写测试**

```ts
it('拖拽只改显示顺序，slotIndex 不跟着换', () => {
  const tiles = mergeRefTiles([], [
    { id: 'a', name: '图片1', url: 'a.png', isText: false },
    { id: 'b', name: '图片2', url: 'b.png', isText: false },
  ], ['b', 'a'])
  expect(tiles.map((t) => t.card?.id)).toEqual(['b', 'a'])
  expect(tiles.map((t) => t.index)).toEqual([1, 2])
  expect(tiles.map((t) => t.slotIndex)).toEqual([2, 1])
})
```

- [ ] **Step 2: 跑测试 + 提交**

```bash
pnpm -C packages/plugins/plugin-bottom-bar test
git add packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarOrder.test.ts
git commit -m "test(bottom-bar): 钉住「拖拽只改显示顺序」的语义"
```

---

### Task 6: 空壳格子显示默认图片图标（保留可点提示）

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue:1727-1740`（模板）
- Modify: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue:2158-2200`（样式）
- Test: `packages/plugins/plugin-bottom-bar/src/__tests__/bottomBarRender.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('待输入格：有图片占位图标', async () => {
  const html = await render(NodeBottomBar as Component, '35', {
    barPromptDoc: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'resource', attrs: { id: 'ref-slot:image:2', name: '图片2' } },
    ] }] },
  }, makeCtx({ selectedIds: ['35'] }))
  expect(html).toContain('nb-card-placeholder')
  expect(html).toContain('slot:image:2')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/plugins/plugin-bottom-bar test -- -t "图片占位图标"`

- [ ] **Step 3: 改模板**

```html
<span v-else-if="tile.pending" class="nb-card-pending">
  <span class="nb-card-placeholder" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 16-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>
  </span>
  <span class="nb-card-plus" aria-hidden="true">+</span>
</span>
```

- [ ] **Step 4: 加样式**

```css
.nb-card-placeholder { display: grid; place-items: center; color: color-mix(in srgb, var(--ui-ink, #18202b) 32%, transparent); }
.nb-card-placeholder svg { width: 16px; height: 16px; }
.nb-card.is-pending:hover .nb-card-placeholder { color: var(--ui-accent, #7c3aed); }
```

- [ ] **Step 5: 跑测试 + 提交**

```bash
pnpm -C packages/plugins/plugin-bottom-bar test
git add packages/plugins/plugin-bottom-bar/src
git commit -m "fix(bottom-bar): 空壳参考格显示默认图片图标（保留可点提示）"
```

---

### Task 7: 编辑器把「粘贴文件」交给外部

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts`（`pickFilesFromClipboard` + `createPasteHandlerPlugin`）
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts`（props 增加 `onPasteFiles`）
- Modify: `packages/prosemirror-editor-bundle/src/index.vue`（透传 prop）
- Test: `packages/prosemirror-editor-bundle/src/__tests__/pasteFilesHook.test.ts`（新建）

**Interfaces:**
- Produces:
```ts
export function pickFilesFromClipboard(data: DataTransfer | null | undefined): File[]
export interface PasteFilesContext { insert(item: ResourceItem): void }
export type PasteFilesHandler = (files: File[], ctx: PasteFilesContext) => boolean | Promise<boolean>
```

- [ ] **Step 1: 写失败测试（只测纯函数，DOM 行为留给 Task 8）**

```ts
import { describe, expect, it } from 'vitest'
import { pickFilesFromClipboard } from '../useEditor.ts'

it('files 为空时退回 items', () => {
  const fake = {
    files: [],
    items: [{ kind: 'file', getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }) }],
  } as unknown as DataTransfer
  const files = pickFilesFromClipboard(fake)
  expect(files).toHaveLength(1)
  expect(files[0].name).toBe('a.png')
})

it('没有 data → 空数组', () => {
  expect(pickFilesFromClipboard(null)).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/prosemirror-editor-bundle test -- -t "pickFilesFromClipboard"`

- [ ] **Step 3: 实现**

```ts
export function pickFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const files = Array.from(data.files ?? [])
  if (files.length > 0) return files
  const out: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile?.()
    if (file) out.push(file)
  }
  return out
}
```

`handlePaste` 里：有文件且外部给了 handler → 调 handler，`insert` 在**执行时**读当前光标：

```ts
const files = pickFilesFromClipboard(event.clipboardData)
const handler = files.length > 0 ? getPasteFiles() : undefined
if (handler) {
  void handler(files, {
    insert(item) {
      const type = view.state.schema.nodes.resource
      if (!type) return
      itemRegistry.set(item.id, item)
      const { from, to } = view.state.selection
      const tr = view.state.tr.replaceWith(from, to, buildResourceNode(type, item))
      tr.insertText(' ')
      view.dispatch(tr)
    },
  })
  return true
}
```

- [ ] **Step 4: 提交**

```bash
git add packages/prosemirror-editor-bundle/src
git commit -m "feat(editor): 粘贴文件交给外部回调（onPasteFiles），支持 items 兜底"
```

---

### Task 8: 底栏接粘贴 —— 建节点 + 连线 + 插入标签

**Files:**
- Modify: `packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`（`:on-paste-files` + `onPasteFiles`）
- Test: `packages/ui/e2e/paste-image-probe.mjs`（新建，可运行）

- [ ] **Step 1: 写浏览器探针（可运行）**

```js
// 选中图片节点 → 打开底栏 → 向编辑器派发带 File 的 paste 事件
// 断言：新增 1 个图片节点、1 条连到本节点的边、输入框里出现 1 颗 chip
```

- [ ] **Step 2: 跑探针确认失败**

Run: `node packages/ui/e2e/paste-image-probe.mjs`
Expected: FAIL（当前粘贴无反应）

- [ ] **Step 3: 实现**

```ts
async function onPasteFiles(files: File[], ctx: { insert(item: ResourceItem): void }): Promise<boolean> {
  const image = files.find((f) => f.type.startsWith('image/'))
  if (!image) return false
  // 槽位 = 当前图片格数 + 1（追加到末尾）
  const used = refTiles.value.filter((t) => t.key.startsWith('slot:image:') || t.key.startsWith('card:')).length
  const index = used + 1
  try {
    await fillSlotFromFile('image', index, image)
  } catch {
    return false
  }
  // 关键：上传完成后**显式插入标签**（refreshChips 只刷已有标签，不会新建）
  ctx.insert({ id: 'ref-slot:image:' + index, name: '图片' + index, category: '素材', mediaType: 'image' })
  return true
}
```

模板：`<ProseMirrorEditor :on-paste-files="onPasteFiles" />`

- [ ] **Step 4: 跑探针 + 提交**

```bash
node packages/ui/e2e/paste-image-probe.mjs
git add packages/plugins/plugin-bottom-bar packages/ui/e2e/paste-image-probe.mjs
git commit -m "feat(bottom-bar): 粘贴图片走「建节点 + 连线 + 插入标签」"
```

---

### Task 9: 标签识别规则外置（tagSpec，全局注册表）

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/types.ts`（新增 `TagSpec`）
- Create: `packages/prosemirror-editor-bundle/src/tagRegistry.ts`
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts`（`markRefSlots` 与 `toDOM` 兜底读注册表）
- Modify: `packages/plugins/plugin-bottom-bar/src/panelSource.ts`（提供底栏 tagSpec）
- Test: `packages/prosemirror-editor-bundle/src/__tests__/tagSpec.test.ts`（新建）

**Interfaces:**
- Produces:
```ts
export interface TagMatch { from: number; to: number; item: ResourceItem }
export interface TagSpec {
  scan(text: string): TagMatch[]                       // 必须支持一段文字里多个
  render?(item: ResourceItem): HTMLElement | [string, Record<string, any>, ...any[]]
}
export function registerTagSpec(spec: TagSpec | null): void
```
  - `mySchema` 是模块级单例，`toDOM` 拿不到组件实例 → 用模块级注册表（与 `itemRegistry` 同层）。

- [ ] **Step 1: 写失败测试（多匹配 + 带空格）**

```ts
it('一段文字里多个标签都能转', () => {
  const spec: TagSpec = {
    scan(text) {
      const out: TagMatch[] = []
      const re = /@(图片|视频|音频)\s*(\d+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        out.push({ from: m.index, to: m.index + m[0].length, item: { id: 'ref-slot:image:' + m[2], name: '图片' + m[2], category: '素材' } })
      }
      return out
    },
  }
  expect(spec.scan('看 @图片1 和 @图片2')).toHaveLength(2)
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**：`markRefSlots` 改用 `scan()`，从后往前替换；`toDOM` 默认分支依次 `itemRegistry → tagSpec.render → 内置 chip`。

- [ ] **Step 4: 底栏提供 tagSpec**（把「图片N/视频N/音频N」正则从编辑器搬到 `panelSource.ts`）

- [ ] **Step 5: 跑两侧 + Agent 测试 + 提交**

```bash
pnpm -C packages/prosemirror-editor-bundle test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-agent test
git add -A packages/prosemirror-editor-bundle packages/plugins/plugin-bottom-bar
git commit -m "refactor(editor): 标签识别规则外置为 tagSpec（全局注册表）"
```

---

### Task 10: 真实节点 23 回归 + 全量验证

**Files:**
- 无代码改动（回归样本：`packages/cloud-server/.mini-canvas/canvases/824e779f34314f86/canvas.json`，节点 `23`）

- [ ] **Step 1: 在调试页确认（标题 `[DEBUG 44槽-节点23]`）**
  - 参考区不再出现 44 格
  - 把第 4 张拖到最前：它变成 图片1、缩略图跟着换、标签名不变
  - 收起再打开：缩略图正确、空壳显示图片图标
  - 粘贴图片：产生「节点 + 连线 + 标签」
- [ ] **Step 2: 全量测试**

```bash
pnpm -C packages/prosemirror-editor-bundle test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/plugins/plugin-agent test
pnpm -C packages/ui test
pnpm -C packages/prosemirror-editor-bundle typecheck
pnpm -C packages/plugins/plugin-bottom-bar typecheck
pnpm -C packages/ui typecheck
```

- [ ] **Step 3: 构建**

```bash
pnpm -C packages/prosemirror-editor-bundle build
pnpm -C packages/plugins/plugin-bottom-bar build
pnpm -C packages/ui build
```


