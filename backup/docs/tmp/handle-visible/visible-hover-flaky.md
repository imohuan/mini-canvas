# bug: hover 节点时端口按钮 有时显示 / 有时不显示

> 现象：鼠标 hover 到节点卡片时，`MovingHandle` 浮动端口按钮（CSS `.moving-handle-anchor.is-visible`，
> MovingHandle.vue:511-516）时有时无。
> 关键代码：`isShown = !disabled && !visible?solid:...` → 决定 `is-visible` class。

---

## 根因：`isHovered` 被两个来源互相覆写，谁最后写谁赢

`visible`（=`shouldShowHandles`）的第 5 项是 `isHovered || selected`。
而 `isHovered` 有**两个写入者，写的是同一个 ref**：

| 写入者 | 位置 | 写入值 |
|---|---|---|
| A. 卡片根 enter/leave | `BaseNode.vue:217/221` | `true` / `false` |
| B. 端口 zone 的 `@hover` | `BaseNode.vue:255` ← MovingHandle `emit('hover')` | `true` / `false` |

MovingHandle 内部会 emit `hover:false` 的地方有三处：
- `handleLeave()` 的 180ms 定时器回调（MovingHandle.vue:~330）；
- `watch(disabled)` 里 disabled 转 true 时（~117）；
- `watch(disabled)` 里 `!visible` 时（~123）。

**冲突场景**（就是"有时有、有时没有"的来源）：

1. 鼠标从**卡片 body** 进入 → A 写 `isHovered=true` → `visible=true` → 但 `keepVisible=false` 且未选中 → `isShown=false`（球不亮，符合设计）。
2. 鼠标继续移向端口 zone → 进 zone 触发 B：`handleEnter` → `emit('hover',true)` → `keepVisible=true` → 球亮。
3. 鼠标**停在 zone 与卡片交界处附近抖动**，或 zone 的 `mouseleave` 先于卡片的 `mouseenter` 触发 → B 先写 `isHovered=false`；
   此时 `keepVisible` 还在 180ms 倒计时里 → 但 `visible` 已被 B 打成 false → **第 101 行硬压制直接 return false** → 球灭。
4. 180ms 后定时器再补一枪 `emit('hover',false)`，彻底压死。

反过来，如果 A 的 `mouseenter` 在 B 之后触发，`isHovered` 又被拉回 true → 球亮。
**这就是"同样 hover 卡片、结果随机"的直接原因：两个写入者对同一 ref 竞争，胜负取决于 DOM 事件到达顺序。**

---

## 放大因素

1. **`zoneOffset` / 半圆区几何**：`port-follow-zone` 是绝对定位的半圆，`zoneOffset`（`portZoneOffset`）
   会让它相对卡片边缘**向内缩或向外偏**。鼠标在"卡片 body 但不在 zone 内"的缝隙里移动时，
   A 与 B 的 enter/leave 会来回抖，制造出上面第 3 步的竞态窗口。缝越大越容易复现。
2. **`disabled` watch 的副作用**：`disabled` 一抖（拖线判定边界、`blockedTargetPort` 变化）就会
   `keepVisible=false` + `emit('hover',false)` + `restorePosition()`，放大随机性。
3. **180ms 残留淡出**：`keepVisible` 有 180ms 尾巴，`isHovered` 没有。
   两者时间常数不一致，导致 180ms 窗口内 `visible` 与 `keepVisible` 组合出"半亮半灭"的中间态。

---

## 结论

**不是 CSS（511-516）的问题**，是它的输入 `is-visible`（`isShown`）的输入 `visible` 的上游
`isHovered` 被**两个事件源双写**、缺乏单一权威。

**两个写入者语义本来就不同却共用一个 ref**：
- A（卡片根）表达"鼠标在卡片上"；
- B（端口 zone）表达"鼠标在这个端口上"。

用同一个 `isHovered` 同时承载这两个语义，必然互相打架。

---

## 修复方向（择一，未实施）

- **方案 A（推荐，最小）**：拆成两个 ref —— `cardHovered`（A 写）与 `portHovered`（B 写），
  `shouldShowHandles` 用 `cardHovered || portHovered || selected`。语义清晰，无竞态。
- **方案 B**：`onPortHover(false)` 时**不要**直接写 `isHovered=false`，而用 `relatedTarget` 判断
  是否仍落在卡片内，在卡片内则维持 true。能修但仍是"猜"。
- **方案 C**：`isHovered` 完全由卡片根一个来源负责（A），端口 zone 只走 `keepVisible`，
  `shouldShowHandles` 不再吃 B。改动小，但要确认"只有 zone 无卡片根 enter"的场景不会丢显隐。

## 复现验证（动手确认用）

在 `isShown`（MovingHandle.vue:99）里临时打点，记录四个入参 + 事件顺序：

```ts
const isShown = computed(() => {
  console.log('[isShown]', props.id, {
    selected: props.selected, keepVisible: keepVisible.value,
    disabled: props.disabled, visible: props.visible,
  })
  ...
})
```

然后慢慢把鼠标从卡片 body 斜着推向端口 zone，观察 `visible` 是否在中途被翻成 false。
若出现 `keepVisible:true` 但 `visible:false` → 坐实是上面的竞态。
