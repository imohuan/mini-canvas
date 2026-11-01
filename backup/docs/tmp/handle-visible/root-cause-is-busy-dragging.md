# 最终定位：`isBusyDragging` 卡在 true 把端口永久压死

## 决定性证据（用户日志）

```
[v2:base-node] [10] gate 快照 { visible: false, lowDetail: false, suppressHandles: false,
                                isCurrentConnectingNode: false, isBusyDragging: true, …}
                                                                      ↑↑↑ 元凶
```

同一份日志里，node [9] 的 `onPortHover` 连续打出 `{value: true, before: true}`（12 次），
说明 **`portHovered` 明明是 true**，事件链路完全正常；
可 MovingHandle 那边 enter 时读到的依然是 `visible: false`。

→ **不是 hover 链路的问题，是 `shouldShowHandles` 里 `!interaction.isBusyDragging.value` 为 false。**

其余 4 个门在同一快照里全是正常值（lowDetail/suppressHandles/isCurrentConnectingNode 都是 false，
portHovered 为 true），唯独 `isBusyDragging: true`。

---

## `isBusyDragging` 为什么会在"纯 hover"时为 true

定义（`canvas-render/src/contracts/interactionContext.ts:80-86`）：

```ts
isBusyDragging = nodeDragging || paneDragging || edgeDragging || selecting
```

四个旗子里，**`paneDragging` 是由 `onMoveStart` 写入的**（`CanvasHost.vue:397-401`）：

```ts
/** 视图平移/缩放开始（pan 与 wheel/pinch 缩放同源于 VueFlow 同一套 move 事件，A 决策：统一置 paneDragging） */
function onMoveStart(): void {
  beginViewportMove(interaction)   // → paneDragging = true
  emitMove(RenderEvents.MoveStart)
}
```

注释里写得很清楚：**pan 与 wheel 缩放共用同一套 VueFlow move 事件**，都置 `paneDragging`。
所以只要用户**滚过滚轮缩放视图**（哪怕只是一下），`paneDragging` 就会被置 true。

而清除它依赖配对的 `onMoveEnd` → `endViewportMove`（`:403-408`）。
**只要 start / end 不配对（VueFlow 的 moveEnd 未派发、或派发时组件已重挂载），
`paneDragging` 就永久停在 true → `isBusyDragging` 永久 true → 端口永久被压死，怎么 hover 都不显示。**

这完全解释了用户描述的"有些时候"：取决于这次会话里 move 事件有没有成功配对。

---

## 还有一处值得注意的反常

日志中 node [10] 出现：

```
[v2:base-node] [10] gate 快照 { visible: false, ..., isBusyDragging: true, …}
[v2:base-node] [10] card mouseenter → isHovered=true
[v2:moving-handle] [target] zone enter { disabled: false, visible: false, …}
```

`card mouseenter` 已经触发、`isHovered` 已 true，`portHovered` 也已 true，
但 `visible` 仍是 false → 再次印证 4 个压制门里有 true，而快照指名是 `isBusyDragging`。

---

## 已知未接线项（次要）

`beginSelecting` / `endSelecting`（`interactionContext.ts:134/139`）**定义了但全仓库无人调用**
（index.ts 只导出，CanvasHost 未使用）。也就是说 `selecting` 旗子目前恒为 false。
这不是当前 bug 的原因，但说明该状态机确实存在"只写不清"的风险面 ——
`paneDragging` 就是活生生的例子。

---

## 修复方向（未实施，待定）

### 方案 1（治本，推荐）：让压制门只认"真的在拖"
`isBusyDragging` 把 `paneDragging`（含滚轮缩放）也算进去，对"压端口"这个用途来说过宽：
用户滚一下滚轮缩放，就把所有端口压死了，语义上说不通。

- 把 `shouldShowHandles` 里的 `!interaction.isBusyDragging.value`
  换成只挡真正的拖拽：`!interaction.isNodeDragging.value && !interaction.isPanning.value`
  （或新增一个 `isGestureDragging` 派生位，不含 zoom）。

### 方案 2（治标，必做）：补上 move 事件的兜底复位
给 `paneDragging` 加保险：`mouseup` / `pointerup` / 窗口 `blur` 时无条件 `endViewportMove`，
确保任何情况下都不会残留。这样即使 VueFlow 漏发 moveEnd 也能自愈。

### 方案 3：排查 VueFlow move 事件为何不配对
确认 `@move-start` / `@move-end` 的绑定方式，以及 CanvasHost 重挂载（epoch bump）时
是否丢掉了 end。工作量大，建议先上 1+2。

---

## 排查用诊断（当前已加在 BaseNode.vue，定位后应删除）

- `onCardMouseEnter/Leave` 打 `isHovered` 写入
- `onPortHover` 打 `value/before`（证明 emit 链路正常）
- `watch(shouldShowHandles)` 每次变化打全量门状态
- `.v2-node` 的 `@mouseover="logVisibleGate"` 高频快照（含 `isBusyDragging`，本次即靠它定位）
