# MovingHandle `props.visible` 完整来源追踪

> 追踪对象：`packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue` 的 `props.visible`
> 结论口径：`visible` 只表示"**允许**显示"，不是"真的显示"。真正显示还要看 `isShown`。

---

## 1. 传递链（谁给 MovingHandle 传的 visible）

```
BaseNode.vue:528 / 552
    :visible="shouldShowHandles"        ← 唯一传入口
            ↑
    BaseNode.vue:295-302   shouldShowHandles（computed）
            ↑ 由 5 个量 AND 而成
```

`MovingHandle` 全仓库只有 `BaseNode.vue` 一处使用（527/551 行，target 与 source 各一个实例），
所以 `visible` **只有 `shouldShowHandles` 这一个来源**，没有别的调用方。

```ts
// BaseNode.vue:295-302
const shouldShowHandles = computed(
  () =>
    !lowDetail.value &&                                  // ①
    !suppressHandles.value &&                            // ②
    !isCurrentConnectingNode.value &&                    // ③
    !interaction.isBusyDragging.value &&                 // ④
    (isHovered.value || props.selected),                 // ⑤
)
```

**任意一项为假 → `visible = false`。全 5 项为真 → `visible = true`。**

---

## 2. 五项依赖各自"什么时候 true / false"

| # | 依赖 | 为 **true**（不拦） | 为 **false**（拦住 → visible=false） | 写入点 |
|---|------|---------------------|--------------------------------------|--------|
| ① | `lowDetail` | `zoom >= nodeLodLowDetailZoom`（默认 0.4） | 画布缩得比阈值还小 → 进 LOD 省性能 | `BaseNode.vue:64` 读 `vf.viewport.zoom` |
| ② | `suppressHandles` | 没在拖线 | **正在拖线**（`connectStart` 按下到 `connectEnd` 松开） | `host/connectionState.ts:40/48`，由 `CanvasHost.onConnectStart`(539) / `onConnectEnd`(774) 调用 |
| ③ | `isCurrentConnectingNode` | 我不是拖线发起节点 | **我就是拖线源头节点**（拖线期间压自己的口） | `BaseNode.vue:188`，= `isConnecting && activeConnection.sourceNodeId === props.id` |
| ④ | `interaction.isBusyDragging` | 没有任何物理拖拽手势 | 正在 **拖节点 / pan 平移 / 拖边 / 框选** 任一 | `contracts/interactionContext.ts:80`；`CanvasHost.onNodeDragStart`(373) / `onMoveStart`(399) 写入 |
| ⑤ | `isHovered \|\| props.selected` | **鼠标在卡片上**（含端口 zone）**或** 节点被选中 | 鼠标离开卡片，且节点未选中 | `isHovered`：`onCardMouseEnter/Leave`(214/218) 与端口 `@hover`(252) 双写 |

---

## 3. `visible = true` 的完整成立条件（说人话）

同时满足下面 5 条，`visible` 才是 `true`：

1. 画布缩放 **没小到** LOD 阈值（默认 zoom ≥ 0.4）；
2. 当前 **没有在拖线**；
3. 拖线的源 **不是我自己**；
4. 当前 **没有任何拖拽手势**（没拖节点、没平移画布、没框选）；
5. 鼠标 **停在卡片上**（卡片 body 或端口 zone），**或者** 这个节点处于 **选中** 状态。

任意一条不成立 → `visible = false`。

---

## 4. 最容易误解的一点：`visible=true` ≠ 球出现

`visible` 只是"上层允许"，MovingHandle 内部还有第二道闸：

```ts
// MovingHandle.vue:96-99
const isShown = computed(() => {
  if (props.disabled || !props.visible) return false   // visible 是硬压制之一
  return Boolean(props.selected) || keepVisible.value  // 软可见：选中 或 本端口 zone hover
})
```

所以**鼠标只停在卡片 body、没进任何端口 zone** 时：
`visible` 已经 `true`，但 `keepVisible=false` 且未选中 → `isShown=false` → 球**不显示**。

这是刻意设计：保证"只亮鼠标靠近的那个端口"，而不是整卡 hover 时左右两个口一起亮。
（`BaseNode.vue:294-297` 注释明确写了这一语义。）

另外 `disabled` 是**独立的第二硬闸**，优先级高于 `visible`：
`disabled = isCurrentConnectingNode || blockedTargetPort/blockedSourcePort`（BaseNode.vue:525/549）。
`disabled=true` 时 MovingHandle 内部 `handleEnter` 也会直接 return，不走点亮逻辑。

---

## 5. 一句话总结

`visible` = **"这个端口此刻被允许显示"**，来自 `BaseNode.shouldShowHandles` 这一个 computed；
它是 5 个"压制条件"的与门（LOD / 拖线全局压 / 拖线源自身 / 拖拽手势 / 鼠标 hover 或选中）。
真正的显隐还得再过 MovingHandle 内部 `isShown` 的 `keepVisible || selected` 这一关。
