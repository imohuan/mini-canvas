# 界面与沙箱：你写的 HTML 跑在哪

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：AI 写的那段 HTML 住在一个**沙箱 iframe**（不透明源）里；宿主在文档加载前就把
"能读什么、能调什么"注入好了。这一页讲清那些注入项与五条硬约束 —— **缺一条就白屏**。

## 一、宿主注入什么（只读）

```js
window.__CANVAS_INPUTS__   // 本节点参数 { 键: 值 }（含界面自己 setInputs 交上去的）
window.__CANVAS_UPSTREAM__ // 连进来的素材 [{ refName, kind, url?, value?, nodeId? }]
window.__CANVAS_UI__       // { theme, baseUrl, canvasId, nodeId, palette }
```

| 注入项 | 内容 |
| --- | --- |
| `__CANVAS_INPUTS__` | 本节点参数（键 → 值） |
| `__CANVAS_UPSTREAM__` | 上游素材数组；`kind` 是 `image / video / audio / text`，媒体给 `url`（可直接放进 `<img>/<video>`），文本给 `value`；`refName` 是按类型编号的引用名（图片1 / 视频2 …） |
| `__CANVAS_UI__` | `theme`（`light|dark`）、`baseUrl`（后台地址）、`canvasId`、`nodeId`、`palette`（主题色板 `{ light, dark }`，用不用随你） |

> 页面基地址是 `about:srcdoc` —— **发请求必须写绝对地址**（用 `__CANVAS_UI__.baseUrl` 拼）。

## 二、界面往外交东西：`window.CanvasUI`（就 5 个）

| 方法 | 干什么 | 走哪条路 |
| --- | --- | --- |
| `setInputs(params)` | 交**参数**（笔迹、选项、配置都算参数） | `doc.updateNode`，**进撤销栈** |
| `onChange(fn)` | 上游或参数变了 → `fn({ upstream, inputs })`，照着重画 | 消息推送，**页面不重挂** |
| `save(data, name)` | 交**产物**（图/视频/音频/文本） | 上传槽位 + 写节点字段，**不进撤销栈** |
| `task(name, methods, args, opts)` | 叫后台脚本干活，自动带 canvasId/nodeId | `/api/task/call` + SSE |
| `cancel(runId)` | 取消一次调用（杀整棵进程树） | `/api/task/cancel` |

`save` 传字符串就是文本，传 Blob/字节就是文件。它自动落在**本节点自己的槽位**
（`?slot=<nodeId>`）—— 一个节点永远只有一份产物文件，地址不变、内容被覆盖。

### 只有两样东西：上游、参数。没有第三个概念。

- **上游** = 连线连进来的素材（`__CANVAS_UPSTREAM__`，只读）；
- **参数** = 节点 data 里给界面的值（`__CANVAS_INPUTS__`）；
- 界面 `setInputs` 交上去的笔迹 / 选项，**也是参数**（只是它自己写的）；
  刷新后宿主并回 `__CANVAS_INPUTS__`，重新读就能恢复画面 —— 不用另学一套。

### 两条关键规矩

1. **参数变化不重开页面**：上游/参数变化走消息（`onChange`），用户正在输的东西不丢。
2. **页面主动报到**：页面脚本一跑起来就发 `type:"ready"`，宿主收到才把数据送回去 ——
   这解决了"刷新后笔迹回不来"（以前靠宿主猜时机，消息早于监听建立就是白发）。

## 三、五条硬性约束（缺一条就白屏）

1. **不许外链**任何 js / css / 字体 / 图片 CDN —— 沙箱里只有后台一个源可达，外链一律连不上。
2. 样式写 `<style>`、脚本写 `<script>`，图标用**内联 SVG 或字符**。
3. **铺满整块**（`html, body` 宽高 100%、`body margin 0`），字号 12–14px。
4. **深浅色都要能看清**：读 `__CANVAS_UI__.theme`，或用 `html[data-theme="dark"]` 写分支。
5. **发请求写绝对地址**（页面基地址是 `about:srcdoc`，相对路径解析不出来）。

## 四、最小可跑例子

```html
<!-- 一段能跑的可视化节点界面：显示上游素材 + 一个按钮交参数 -->
<style>
  html, body { width: 100%; height: 100%; margin: 0; }
  body { font: 13px/1.5 system-ui; color: var(--ink); background: var(--bg); display: flex; gap: 8px; padding: 10px; }
  .card { flex: 1; border: 1px solid var(--line); border-radius: 8px; padding: 8px; overflow: auto; }
  button { font: inherit; }
</style>

<div class="card" id="out">（等待数据…）</div>
<div class="card">
  <button id="pick">选一个</button>
  <div id="picked"></div>
</div>

<script>
  // 1 读主题色板（跟画布一个调）
  var UI = window.__CANVAS_UI__ || {};
  var pal = (UI.palette || {})[UI.theme || 'light'] || {};
  document.body.style.setProperty('--ink', pal.text || '#333');
  document.body.style.setProperty('--bg', pal.surface || '#fff');
  document.body.style.setProperty('--line', pal.border || '#ddd');

  // 2 渲染上游素材（只读）
  function render(upstream) {
    var box = document.getElementById('out');
    if (!upstream || !upstream.length) { box.textContent = '（没有连入素材）'; return; }
    box.innerHTML = upstream.map(function (s) {
      if (s.kind === 'text') return '<pre>' + (s.value || '') + '</pre>';
      if (s.url) return '<img src="' + s.url + '" style="max-width:100%">';
      return '';
    }).join('');
  }

  // 3 上游 / 参数变了就重画（页面不重挂）
  if (window.CanvasUI && CanvasUI.onChange) {
    CanvasUI.onChange(function (d) { render(d.upstream); });
  }
  render(window.__CANVAS_UPSTREAM__);

  // 4 交参数（进撤销栈）：一笔松手 / 一次配置改完调一次，别每帧调
  document.getElementById('pick').onclick = function () {
    CanvasUI.setInputs({ choice: 'A' });
    document.getElementById('picked').textContent = '已选：A';
  };
</script>
```

## 五、色板 palette（提供给你，用不用随你）

`palette.light` / `palette.dark` 各是一组语义色，键一样、值不同：

| 键 | 含义 |
| --- | --- |
| `accent` / `accentHover` | 强调色（品牌色，主按钮/选中态）与其悬停态 |
| `danger` / `warn` | 危险色 / 警示色 |
| `edgeRail` / `edgeFlow` | 连线颜色 / 连线流光色 |
| `background` / `surface` | 背景色 / 卡片面板底色 |
| `text` / `textMuted` / `textFaint` | 正文 / 次要文字 / 最弱文字 |
| `border` | 分隔线 / 边框色 |

> **这只是「提供」，不是「必须用」**：想跟画布一个调就取 `palette[theme]`；想自己配色也可以 ——
> 只要求你看清当前是亮是暗（见硬性约束第 4 条）。

## 注意事项

1. **别跨源自己 POST**：产物一律走 `CanvasUI.save`，自己发请求当主路会**静默失败**（沙箱是不透明源）。
2. **`setInputs` 保持小**（几 KB 级）：它进撤销栈，太大会让撤销变得很重。
3. **参数与上游都在一次 `onChange` 里给你**：不用分别监听两件事。

