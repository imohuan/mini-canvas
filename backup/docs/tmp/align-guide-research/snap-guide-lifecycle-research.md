# 对齐吸附参考线（Snap Guide Line）显隐生命周期与实现方式 · 联网调研

调研日期：2026-09-09
调研范围：Figma / tldraw / Excalidraw / draw.io(diagrams.net) / Miro / PowerPoint / Google Slides / Illustrator / Photoshop 的官方文档、帮助中心、权威教程与浏览器 Pointer Events 规范级资料。

---

## 来源 URL 列表

| # | 来源 | 主题 |
|---|------|------|
| 1 | https://help.figma.com/hc/en-us/articles/360039956914 | Figma 官方帮助：移动/旋转/对齐时 red guide 出现 |
| 2 | https://help.figma.com/hc/en-us/articles/360040449713 | Figma 官方帮助：从标尺拖出的**常驻 Guides**（canvas/frame 级） |
| 3 | https://uxcel.com/lessons/layer-alignment-097 | Figma Snap 行为复述（"red guide 作为视觉指示器"） |
| 4 | https://www.drawio.com/docs/manual/editor/alignment-tools | draw.io 官方文档：Alignment guidelines、page centre、Alt 临时关吸附 |
| 5 | https://www.drawio.com/docs/manual/shapes/arrange-align-shapes | draw.io 对齐/分布工具 |
| 6 | https://help.miro.com/hc/en-us/articles/4403634496402 | Miro 官方帮助：Snap to grid + Smart guides（blue 引导线，随放置/移动出现） |
| 7 | https://support.microsoft.com/en-us/visio/align-and-position-shapes-in-a-diagram | Visio：拖动时绿色定位引导线 |
| 8 | https://www.customguide.com/course/powerpoint/how-to-use-smart-guides-in-powerpoint | PowerPoint Smart Guides（拖动时出现）+ 独立**常驻 Guides**（可拖动/复制/清除） |
| 9 | https://learn.microsoft.com/en-us/answers/questions/818596/powerpoint-guides-vanished | PowerPoint 用户报"可拖动常驻 guides"，与临时 smart guide 是两套 |
| 10 | https://support.google.com/docs/answer/1696521 | Google Slides：Snap to Guides 拖动时出彩色线；另有常驻 guide lines |
| 11 | https://slidestack.com/blog/how-to-arrange-and-align-objects-in-google-slides-tips-and-tricks | Google Slides：拖动出红线，松手消失；Guides 与 Grid 区别 |
| 12 | https://marikedesigns.com/blog/use-guides-in-powerpoint-and-google-slides | PPT/Slides：smart guides 默认开、拖动即显 |
| 13 | https://www.youtube.com/watch?v=gcXQIWxGa4s | Illustrator 官方教程：**Ruler Guides（常驻） vs Smart Guides（临时 tooltip）** 明确区分 |
| 14 | https://jkost.com/blog/2017/05/grid-guides-and-ruler-shortcuts-in-photoshop-cc.html | Photoshop：标尺拖出常驻 guides；Smart Guides 仅"repositioning 时"辅助 |
| 15 | https://javascript.info/pointer-events | Pointer Events 权威：setPointerCapture 自动随 pointerup/cancel 释放 |
| 16 | https://stories.carlosrojas.dev/2025/10/13/the-complete-guide-to-pointer-events | Pointer Events 完整指南：pointercancel 必须兜底 |
| 17 | https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/1625 | Excalidraw 社区 feature request（期望 Google Slides 式实时对齐反馈） |
| 18 | https://cloudairy.com/features/drag-and-drop | 通用编辑器 Smart Alignment 行为概述 |

---

## 各问题结论

### Q1. 可见时机：只在拖拽过程中临时亮起，松手即消失？

**结论：是的，全行业统一——"临时吸附线（smart guide）"只在"元素被按住拖动/移动/resize"的那一瞬间显示，一旦松手（drop）就立刻消失，不会保持。**

- Figma 官方帮助：移动图层/调整大小时，与其它元素对齐会出现 **red guide** 作为视觉指示；这一动作结束时线即消失（"A red guide appears on the canvas as a visual indicator"）【1】【3】。
- draw.io：**蓝色横竖对齐线在"移动形状靠近其它形状时"出现**，用于对齐；页面中心另有橙色线；全程都是"as you move"的临时反馈【4】。
- Miro：Smart guides（blue）"**when you place or move an object** on the board, ... will appear"【6】。
- PowerPoint / Google Slides：smart guides 是"dynamic lines **appear as you move objects**"；拖动结束即不再显示【8】【10】【11】。
- Visio 同样：拖动时显示绿色定位引导线，松手即无【7】。
- Excalidraw 原生只做"拖动吸附到网格/对象边缘"（打开 snapping 后拖动时出红线【搜索结果 ab08ff】，即 Excalidraw snapping tutorial），并**没有**像 Google Slides 那种"拖动中实时提示与邻对象对齐"的 smart guide——社区还专门提 feature request 想要它【17】。也就是说 Excalidraw 本身也遵循"只有交互进行中才出线"。

> 反例提醒（异常即可证规则）：PowerPoint 曾报 bug——用户从标尺拖出的**常驻** guide 在拖动时"fade away"，用户抱怨"very frustrating"，官方答复是新版本需手动加常驻 guide 才会保留【9】。这说明"常驻线被临时逻辑误吞"本身被视为 bug 而非设计。

### Q2. 有没有"手动放置的常驻参考线/ruler guides"？和临时吸附线是两套机制吗？

**结论：有，且和临时吸附线是两套完全不同、并存、互不干扰的机制。**

- **临时吸附线（smart guides / alignment guides / snap guidelines）**：系统根据"当前被拖对象 vs 其它对象"实时计算出来的一次性提示线，**不可编辑、不留存、无文档坐标**，只在拖拽窗口内存在。代表：Figma 的 red guide、draw.io 的 blue 线、Miro/PPT/Slides 的 smart guides。
- **常驻标尺参考线（ruler guides / guide lines）**：用户从**标尺**手动拖出来、**明确持久存在、可拖动重定位/删除/锁定/可保存进文档**的一条真正的线（常为虚线/实线），作为全局对齐基准。代表：
  - **Figma**：从顶部/左侧标尺拖出，分 **canvas 级**和 **frame 级** guide，可 Alt+拖复制、拖回标尺删除、右键移除【2】。
  - **Illustrator/Photoshop**：从标尺拖出的 ruler guides；官方明确教学"ruler guide（常驻） vs smart guide（临时 tooltip 吸附提示）的区别"【13】【14】。
  - **PowerPoint/Google Slides**：常驻 guide lines（View→Guides→Add），可拖动、复制（Ctrl+拖）、清除【8】【10】。

**两套机制区别一句话**：临时吸附线是"当下这一次拖拽的对齐反馈"，随交互生灭、随目标变而变；常驻 ruler guide 是"你亲手放在那的持久参照物"，不因拖拽结束而消失，它自己也能被选中拖动、并能吸附其它对象。

> 附注：draw.io / Miro 目前未见独立的"从标尺拖出的常驻 guide"（它们靠临时线+网格），所以"常驻参考线"以 **Figma / PS / AI / PPT** 为代表，是最被广泛认可的做法。

### Q3. 临时吸附线的技术实现 & mouseup 兜底

**结论（业界标准做法）**：

1. **判定"正在拖拽"**：状态机驱动。在 pointerdown（且位移超过阈值如 ~10px）进入 dragging 状态，pointermove 期间更新，pointerup / pointercancel 回 idle。典型参考：tldraw 用 state machine（Idle→Pointing→Dragging，onPointerUp 回 idle）。
2. **刷线与收线**：
   - **必须用 `setPointerCapture(e.pointerId)`**：pointerdown 即捕获，之后所有 pointermove/up 都重定向到同一元素，鼠标拖出画布/元素外也照样能收到事件——这是现代拖拽的基石【15】。
   - 每帧在 **pointermove 或 rAF/requestAnimationFrame** 里重算吸附目标并重绘参考线（只更新几何，不整树重渲染）。
   - `pointerup`（含自动解绑）即收线。
3. **mouseup 监听不到的兜底（业界统一答案）**：
   - **`setPointerCapture` + `pointercancel` 监听**：规范级最佳实践明确要求 **pointerup 与 pointercancel 都必须写 cleanup**，否则设备旋转、浏览器 UI 接管等会导致 drag 无法正常终止、状态错乱【15】【16】。
   - **window/document 级兜底**：mouse 时代旧方案是把 mousemove/up 挂到 document 上，拖出窗口仍能收；现代 Pointer Events 用 capture 替代。
   - **blur/visibilitychange 兜底**：窗口失焦/切标签页时也应视为"交互中断"收线（业界常见做法，配合强制收尾，例如把"已松手/已取消"统一收敛到一个 cleanup 函数）。
   - 更稳健的还有 `lostpointercapture` 事件可监听。
   - **一句话**：不要只靠 mouseup——以 capture 后收到的 pointerup/pointercancel 为主、blur/visibilitychange/lostpointercapture 为辅，全走同一个收尾函数。单纯的 150ms 无操作定时器是一种脆弱补丁，不是规范答案。

### Q4. 吸附完成后，松手时参考线是否保留？——行业惯例

**结论：行业惯例明确——临时吸附线在"松手(drop)的那一刻"就消失，不保留。**

- 所有主流工具（Figma red guide、draw.io blue 线、PPT/Slides smart guides、Miro blue 线）都是"拖动中显示、drop 即消失"。
- 用户真正"想让参考线一直存在"的诉求，在业界**不是**靠延长临时线的寿命实现，而是靠**两套机制组合**满足：
  1. **对齐的"结果"已经落地**：对象已经真的被吸到对齐位置，位置数据已固化（snap 已生效），不需要一条残影线来"证明对齐了"。
  2. **确实需要常驻参照时，用 ruler guides**（从标尺拖出的持久线）。
- 所以"松手后还留一条临时线"在整个行业里**都不是惯例**。若产品想改进体验，正确的方向不是让临时线常驻，而是：
  - 把"当前正在拖拽"的判定做实（capture + pointercancel + blur 兜底），让线只在真正松手/取消时消失、并且**消失得即时可靠**（解决用户"线几秒后才消失/不该消失却消失"的抱怨根源）；
  - 若用户要长期参照，提供"常驻参考线（ruler guide）"机制。

---

## 业界通用最佳实践（总结）

> 把"临时吸附线"和"常驻 ruler guide"当**两套独立机制**对待，别混为一谈。
> 1. **临时 smart guide 只在"正在拖拽/移动/resize"时亮起，drop 即消失**——这是 Figma、draw.io、Miro、PPT、Slides、Visio 全行业一致行为。Figma 的 red guide 只在 move 时出现；draw.io 的蓝线只在移动形状时出现；Miro/PPT/Slides 全是"拖动中动态出现"。松手后留残影线不是任何主流工具的惯例。
> 2. **判定与收线用 Pointer Events 状态机**：pointerdown（过位移阈值）进入 dragging → 立刻 `setPointerCapture` → 在 pointermove/rAF 里重算重绘 → pointerup **和 pointercancel**（还有 blur / visibilitychange / lostpointercapture 兜底）统一进同一个 cleanup 收线。不要只监听 mouseup，也不要用"无操作 150ms"这种脆弱的定时器当唯一收尾手段。
> 3. **用户"想让参照线一直存在"的诉求**，业界用"常驻 ruler guide（从标尺拖出、可编辑、可存文档）"来满足——代表是 Figma / PS / AI / PPT 的持久 guide。它和临时吸附线是两套正交机制，可并存。
> 4. 一句话设计取舍：**临时线随交互生灭，别让它常驻**；要做的是把"交互何时真正结束"判定稳（解决 mouseup 靠不住），需要持久参照就上 ruler guide 机制。

---

### 对当前插件设计的直接映射（供决策参考，非本次调研结论）
- 插件"鼠标松开 / pointerup / blur / 无操作 150ms 后参考线消失"——**消失本身符合行业惯例**，问题不在"该不该消失"，而在"消失判定的可靠性"（mouseup 有时收不到、150ms 定时器是脆弱补丁）。
- 用户"希望参考线一直存在"的合理诉求，对应业界做法是补一条**常驻参考线（ruler guide）**能力，而不是把临时吸附线改成常驻。
