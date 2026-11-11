# AI Elements 对话渲染：官方 Demo 与本地实现的视觉差异对照

> 目的：把「官方 Demo 长什么样」和「我们长什么样」之间的具体数值差异固定下来，
> 以后改这块先对照本表，不再凭感觉调整。
> 数据来源：在 shadcn-vue 官方站点用 Chrome 实测 getComputedStyle + 官方站点 CSS
> （entry.CGZHlU_F.css）里的 .style-vega .cn-* 规则。2026-11-05。

## 一、根本差异：官方有两套样式体系，我们只用了其中一套

官方 docs 站点把组件样式编译成**语义类**（cn-bubble、cn-bubble-content、cn-trace-line…），
这些类由主题变量驱动：

| 语义类 | 官方定义（style-vega） |
|---|---|
| .cn-bubble | gap: var(--spacing); max-width: 80% |
| .cn-bubble[data-variant=ghost] | max-width: 100% |
| .cn-bubble-content | border-radius: calc(var(--radius) * 1.4); padding-block: calc(var(--spacing) * 2); padding-inline: calc(var(--spacing) * 3); font-size: var(--text-sm); line-height: var(--leading-relaxed); border-width: 1px |
| .cn-message | font-size: var(--text-sm); gap: calc(var(--spacing) * 2) |
| .cn-message-content | gap: calc(var(--spacing) * 2.5) |
| .cn-message-footer | font-size: var(--text-xs); padding-inline: calc(var(--spacing) * 3); font-weight: 500; color: var(--muted-foreground) |
| .cn-trace | gap: calc(var(--spacing) * 2) |
| .cn-trace-line | font-size: var(--text-sm); gap: calc(var(--spacing) * 2) |
| .cn-trace-collapsible-trigger | border-radius: calc(var(--radius) * 0.8); gap: var(--spacing) |
| .cn-trace-collapsible-content-inner | border-left-width: 1px; margin-left: calc(var(--spacing) * 2 - 1px); margin-top: calc(var(--spacing) * 2); margin-bottom: var(--spacing); padding-left: calc(var(--spacing) * 4); padding-right: var(--spacing); line-height: var(--leading-relaxed) |

我们从 registry 拉的组件是 **Tailwind 原子类版本**（rounded-xl px-3 py-2 text-sm），
它跟语义类版本在**数值上不等价**：

| 项 | 官方（语义类 + 主题变量） | 我们的原子类版本 |
|---|---|---|
| 气泡圆角 | calc(--radius * 1.4) → 实测 **22px** | rounded-xl → **12px** |
| 气泡内边距 | block 8px / inline 12px（spacing×2 / ×3） | px-3 py-2（同样 12px / 8px，一致） |
| 气泡最大宽 | 80% | max-w-[80%]（一致） |
| 消息 gap | calc(spacing*2) = 8px | gap-2 = 8px（一致） |
| 内容 gap | calc(spacing*2.5) = 10px | gap-2.5 = 10px（一致） |
| footer 字重 | 500（medium） | font-medium（一致） |

**结论**：官方 docs 站显示的是「主题化语义类」版本，圆角随主题半径放大 1.4 倍。
我们拿的是同一批组件的原子类版本，所以圆角明显更小（12px vs 22px）、观感更「方」。
其余间距、字重、行高是对得上的。

## 二、真机实测对照（同一段「你好」消息）

| 属性 | 官方 Demo | 我们的实现 | 判定 |
|---|---|---|---|
| bubble 对齐 | alignSelf: flex-end | alignSelf: flex-end | 一致 |
| bubble 最大宽 | 80% | 85% | 我们更宽 |
| bubbleContent 背景 | oklch(0.97 0 0) 实色浅灰 | rgba(0,0,0,0.035) 半透明 | 观感不同 |
| bubbleContent 圆角 | **22px** | **12px** | 明显差异 |
| bubbleContent 内边距 | 10px 12px | 8px 12px | 纵向更紧 |
| bubbleContent 行高 | 22.75px | 22.75px | 一致 |
| message 方向 | row-reverse（用户消息） | row | 之前被我们的 CSS 压成 row |
| message gap | 8px | 8px | 一致 |
| messageContent gap | 8px | 10px | 略有差异 |
| footer padding | 0 | 0 12px | 我们多了左右内边距 |
| footer 对齐 | justify-content: flex-end | 同 | 一致 |

## 三、修过的问题（保留记录）

1. **用户气泡靠左**：旧 CSS .ac-msg > .ac-bubble { display: block } 把
   MessageContent 的 flex 覆盖成 block，self-end 失效。已删。
2. **编辑态「容器被撑开」**：琥珀描边挂在 MessageContent（整行）上，
   应挂 Bubble 本体。已改。
3. **Trace 展开区左侧竖线消失**：Tailwind v4 的类提取器在本仓没生成 .border-l
   （.border-r/.border-t/.border-b 都有）。已在 packages/ui/src/app.css 补等价规则。
4. **思考/工具行自绘 CSS**：已全部删除，交给 Trace 组件的原子类。

## 四、下一步要决策的事

气泡圆角差异（12px vs 22px）不是 bug，是**两套样式体系的选择**：

- 方案 A：沿用原子类版本（当前），圆角跟随项目 --radius-xl（12px），
  与项目其它控件一致，但和官方 docs 截图像素不同。
- 方案 B：在组件库补一份语义类样式，让气泡圆角 = calc(--plume-radius * 1.4)，
  观感与官方 docs 一致。

需要用户拍板后再动，避免又一次「改完还是不像」。
