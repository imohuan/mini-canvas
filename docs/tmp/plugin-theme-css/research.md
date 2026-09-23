# 主题机制：从「插件自带配置项」收敛到「一套 CSS 主题」

> 调研 + 改造记录。目标：回答「mini-map 现在怎么换主题」，并给出**所有插件通用的做法**。

---

## 一、改造前：mini-map 是怎么"换主题"的（问题在哪）

`packages/plugins/plugin-mini-map/src/miniMapConfig.ts` 里有一个**配置项**：

```ts
miniMapTheme: { type: 'select', default: 'auto',
  options: [跟随主题 / 浅色 / 深色], group: '常规/小地图' }
```

`MiniMapOverlay.vue` 里靠 JS 把配色算出来：

1. 组件内维护一个 `THEMES: { light: {...}, dark: {...} }` 常量表（9 个颜色/圆角值）；
2. `themeName = cfg.miniMapTheme`，`appTheme` 是 `ref`，**用 `MutationObserver` 盯 `html[data-canvas-theme]`**；
3. `palette = computed(...)` → `rootVars = computed(...)` 生成 9 个 `--mm-*` 内联变量；
4. 模板 `:style="rootVars"` 绑到根节点。

**三个问题**：

- 主题本来是全局的，却被降格成一个**只有小地图才有的设置项**，用户要为每个插件各调一次；
- 每个想跟随主题的插件都得自己抄一遍 MutationObserver + 调色板 + 内联变量；
- 颜色写在 TS 里，改主题要重新打包，且和 `--ui-*` / `--canvas-node-*` 两套 CSS 变量平行存在、各写各的值。

---

## 二、真正的主题源：`<html data-canvas-theme>`

全仓主题切换的唯一开关在这里（v2 / `packages/ui`）：

- `packages/ui/src/composables/ui.ts` → `toggleTheme()` 写 `state.theme`；
- `packages/ui/src/App.vue` → `document.documentElement.dataset.canvasTheme = s.theme`；
- 两套取值靠 CSS 属性选择器切换：`html[data-canvas-theme='dark']` / `'light'`。

变量目前分红三族：

| 族 | 定义处 | 谁在用 |
|---|---|---|
| `--canvas-node-*` | `plugin-theme-default/src/styles/node-theme.css`（`:root` 亮色默认）<br>+ `packages/ui/src/app.css` 的 dark 覆盖 | 节点壳 / 端口 / 边 |
| `--ui-*` `--sf-*` `--ps-*` `--dd-*` | **改造前只**在 `packages/ui/src/app.css` | 宿主壳 + 设置面板字段 |
| 各插件自造 | 插件自己的 `<style>` 或 TS 常量 | 只有自己 |

**症结**：只有宿主应用（`@mini-canvas/ui`）能拿到 `--ui-*`。插件不在那棵依赖树上，只能硬编码浅色值——所以暗色主题下右键菜单、搜索浮层、快捷键面板全是"白底黑字"。

---

## 三、改造：把通用 token 提到 canvas-render

### 3.1 新增唯一真源 `packages/canvas-render/src/styles/ui-theme.css`

- 把 `--ui-*` / `--sf-*` / `--ps-*` / `--dd-*` 整套搬进来，暗色为默认（`:root` + `html[data-canvas-theme='dark']`），`html[data-canvas-theme='light']` 覆盖亮色；
- 补了三个新 token：`--ui-danger` / `--ui-danger-soft` / `--ui-danger-veil`（危险操作色，之前各插件写死 `#ef4444`/`#f87171`）、`--ui-guide` / `--ui-guide-veil`（对齐参考线 / 框选框）；
- 在 `packages/canvas-render/src/index.ts` 顶部 `import './styles/ui-theme.css'` —— **包加载即生效**，所有依赖 canvas-render 的渲染插件自动获得同一套 token。

选 canvas-render 而不是 canvas-data 的理由：这是**渲染层**的事，canvas-data 是零 Vue/零 DOM 的内核；而插件普遍已经依赖 canvas-render（14/23 个）。

### 3.2 `packages/ui/src/app.css` 删掉重复定义

只留 Tailwind 的 `@theme inline` 映射（把 `--color-*` 指向 `--ui-*`）和 `--canvas-node-*` 的 dark 覆盖，加注释指向新真源，避免两处值漂移。

### 3.3 插件写法（新的标准姿势）

**组件里：一律 `var(--ui-xxx, <原来的浅色值>)`。** 兜底值保留改造前的浅色值，脱离主题表单独渲染也不崩。

已改造：

| 文件 | 做法 |
|---|---|
| `plugin-mini-map/src/MiniMapOverlay.vue` | 删掉 `THEMES` 常量表 / MutationObserver / 内联 `rootVars`，改用 `<style scoped>` 里两套 `--mm-*`（默认暗色 + `html[data-canvas-theme='light'] .mini-map-overlay` 覆盖） |
| `plugin-mini-map/src/miniMapConfig.ts` | **删掉 `miniMapTheme` 配置项**（不再需要用户选） |
| `plugin-context-menu/src/ContextMenu.vue` | 面板底/边框/文字/图标托/键帽/hover/danger 全走 `--ui-*` |
| `plugin-context-menu/src/ConnectionMenuContent.vue` | 同上 |
| `plugin-node-find/src/NodeFindOverlay.vue` | 遮罩/面板/输入/列表/类型标签 全走 `--ui-*` |
| `plugin-multi-select/src/SelectionGroupToolbar.vue` | 工具条底/边框/阴影走 `--ui-*` |
| `plugin-multi-select/src/BoxSelectLayer.vue` | 框选框是 JS 建的 DOM，运行时 `getComputedStyle(documentElement).getPropertyValue('--ui-guide')` 取值再拼 `cssText` |
| `plugin-align-guide/src/AlignGuideOverlay.vue` | 参考线色走 `--ui-guide` |

### 3.4 两个踩到的坑

1. **`scoped` 样式里不能用 `:global(html[...]) .cls`** —— Vue SFC 编译器会把整个选择器当全局，丢掉 `.cls`，结果规则变成裸的 `html[data-canvas-theme='light'] { --mm-bg: ... }`（覆盖全局、且 specificity 反而比组件内规则低）。直接写 `html[data-canvas-theme='light'] .mini-map-overlay` 就对，scoped 只给**最后一段**加 `data-v-xxx`。
2. **JS 里建的 DOM（框选框）拿不到 CSS 变量**，只能运行时 `getComputedStyle(document.documentElement).getPropertyValue('--ui-guide')` 读值再拼字符串。切主题时已建的框不会变色——框选是一次性短生命周期交互，可接受；真要实时可用 `boxEl.style.setProperty` + 监听主题属性变化。

---

## 四、还没做的（按硬编码量排序）

统计口径：`.vue` 里 `#rrggbb` / `rgb()` / `rgba()` 出现次数，减去 `var(--…)` 兜底里的。

| 文件 | 硬编码量 | 备注 |
|---|---|---|
| `plugin-shortcut-manager/src/ShortcutHelpPanel.vue` | 45 | 快捷键面板，最大头 |
| `plugin-node-image/src/ImageGeneratePanel.vue` | 38 | 生成面板 |
| `plugin-shortcut-manager/src/RemapPanel.vue` | 30 | 改键面板 |
| `plugin-node-text/src/TextGeneratePanel.vue` | 25 | 生成面板 |
| `plugin-theme-default/.../PluginSettingsDialog.vue` | 54 | 默认皮设置弹窗（已被 ui 的面板顶掉，优先级低） |
| `plugin-theme-default/.../ui/{Select,ColorField,NodeToolbarButton,ToolParamField}.vue` | 17+17+16+12 | 通用控件 |
| `plugin-node-image-compare` / `plugin-node-3d-preview` / `plugin-node-video` | 16/16/15 | 内容区 |
| `plugin-group/src/GroupTopToolbar.vue` | 13 | |

**另一处独立缺口**：`--canvas-node-*` 在 `node-theme.css` 的 `:root` 里定义了 33 个，但 `app.css` 的 dark 块只覆盖了 25 个，**这 8 个暗色下还是亮色值**：
`canvas-node-surface`、`canvas-node-shadow-{strong,soft,subtle,panel}`、`canvas-node-snap-zone-shadow`、`canvas-node-debug-danger{,-fill}`。
（节点壳实际用 `--card-surface` 包了一层，所以 surface 影响有限；阴影类在暗底上基本看不见，属于"没出事但不正确"。）

---

## 五、给插件作者的一句话规范

> **不要发明 `theme` 配置项。** 需要颜色就 `var(--ui-xxx, 浅色兜底)`；组件私有的多值色板就在 `scoped` 里写两套 `html[data-canvas-theme='light'] .your-root { --your-var: … }`。主题由宿主的 `<html data-canvas-theme>` 决定，插件零 JS 参与。

新增 token 时**必须暗亮两侧都给值**（现在两表严格对称，各 59 个），否则一侧会静默继承另一侧。
