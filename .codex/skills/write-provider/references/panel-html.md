# provider 自带 HTML 面板（panelHtml）

动作上写 `panelHtml: '<style>…</style><div>…</div>'`，底栏就用这段 HTML 顶替默认的
参数控件。宿主把它放进 `sandbox="allow-scripts"` 的 iframe 里渲染
（不给 `allow-same-origin`），所以它碰不到画布的 DOM、cookie 和 localStorage。

两种形态：

- **有输入框**（`needsPrompt: true`）：面板画在参数区，输入框还在下面。适合整体改配置。
- **没有输入框**（`needsPrompt: false`）：面板直接占底栏输入框那一行，自己当操作区。

## 面板里能用什么

宿主会先注入一个桥接脚本，面板里直接用 `window.api`：

```js
api.onContext(fn)      // 收到（或更新）上下文时回调，可多次调用
api.setValues({ ... }) // 改参数，可以一次改多个键
api.run()              // 等价于点发送
api.resize(px)         // 自己报高度（一般不用，宿主会自动量）
api.notify(msg, 'success' | 'info' | 'error')
api.reportHeight()     // 立刻重量一次高度
```

`onContext` 收到的上下文：

```js
{ type, values, params, actionId, model, nodeType, disabled, theme }
```

- `values` 是当前参数值，`params` 是这个动作的 `fields` 定义。
- `theme` 是宿主读出来的真实色值（`panel / ink / inkDim / line / accent / chip / danger / radius / font / dark`），
  桥接脚本已经把它写成 CSS 变量，面板里直接 `var(--ui-ink)` 就能跟随主题。
- 面板外部参数被改（切预设、开始生成）时会再推一次 `canvas:panel:update`，
  所以面板要按 `onContext` 的重入来写，不能只初始化一次。

## 硬性要求

1. **不要自己滚**。iframe 高度跟着内容走，滚动交给外层 ScrollArea；
   面板里出现自己的滚动条就会和外面那条并排，用户看到两条。
   内容很长就让它长，宿主会把高度报上去。
2. **不要写死颜色**。全部用 `var(--ui-*)`，否则切主题就花。
3. `<script>` 里出现 `</script>` 字符串会把标签提前闭合，需要拆开写
   （例如 `'</scr' + 'ipt>'`）。
4. 面板拿不到 Node，也没有额外网络能力；它只负责画界面和改参数，真活留给 `submit`。
5. 按钮要有自己的选中态（`.on` 之类）。`setValues` 只是通知宿主，
   宿主回推 `update` 之前界面得自己先变，不然点了像没反应。

## 一个最小面板

```js
const PANEL = `
<style>
  body { margin: 0; padding: 10px 12px; font: 12px/1.6 system-ui; color: var(--ui-ink, #18202b); background: transparent; }
  .row { display: flex; gap: 6px; }
  .chip { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--ui-line, #e2e5ea);
          background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .chip.on { border-color: var(--ui-accent, #0891b2); color: var(--ui-accent, #0891b2); font-weight: 600; }
</style>
<div class="row">
  <button class="chip" data-ratio="16:9">16:9</button>
  <button class="chip" data-ratio="9:16">9:16</button>
</div>
<script>
  var values = {}
  function paint() {
    document.querySelectorAll('[data-ratio]').forEach(function (b) {
      b.classList.toggle('on', values.ratio === b.getAttribute('data-ratio'))
    })
  }
  document.querySelectorAll('[data-ratio]').forEach(function (b) {
    b.onclick = function () {
      values.ratio = b.getAttribute('data-ratio')
      api.setValues({ ratio: values.ratio })
      paint()
    }
  })
  api.onContext(function (ctx) { values = ctx.values || {}; paint() })
` + '</scr' + 'ipt>'
```

这段同时覆盖了必须做的事：用 `setValues` 回写、自己维护选中态、按 `onContext` 刷新。
