# 案例速查：我想做 X，抄哪个案例

先在这张表里找到你想做的事，跳到对应案例抄代码。

| 我想让画布…… | 抄哪个案例 | 核心调用 | 真实插件参照 |
| --- | --- | --- | --- |
| 在项目页加一个插件页签（不用打开画布） | [案例 10](/examples/projects-panel) | `ctx.slots.register('app.projects.tabs')` | `packages/plugins/plugin-style-library/src/index.ts` |
| 多一种节点（卡片） | [案例 1](/examples/first-node) | `ctx.nodes.register` | `plugin-node-text` |
| 节点卡片里面长这样 | 案例 1 | `ctx.nodes.register` 的 `in:` 字段 | `plugin-node-text` |
| 节点外面挂个按钮/徽标 | 案例 1 + [案例 7](/examples/bottom-bar) | `ctx.nodes.attach` | `plugin-bottom-bar` |
| 画布上叠一层浮层 UI | [案例 2](/examples/ui-slot) | `ctx.slots.register('overlay')` | `plugin-cursor-effect` |
| 设置面板多一页（自绘） | 案例 2 | `ctx.settingsMenu.nav/section` + `settingsGroup/<id>` | `plugin-cursor-effect` |
| 设置菜单分几个 0/1/2 级、调前后顺序 | [设置面板](/plugins/theme-components/plugin-settings-content) | `ctx.settingsMenu` + `order` / `before` / `after` | `theme-components` |
| 快捷键触发动作 | [案例 3](/examples/command-shortcut) | `ctx.commands.register({ keys })` | `plugin-mini-map` |
| 设置面板多几个配置项 | [案例 4](/examples/config-panel) | 模块级 `Config` schema | `plugin-mini-map` |
| 配置一改画布立刻变 | 案例 4 | `Config` + `bindTypeDefaultSize` / `onChange` | `plugin-node-text` |
| 别的插件能调我的功能 | [案例 5](/examples/provide-service) | `ctx.inject('名字', 实现)` | `plugin-file-drop` |
| 我的插件要用别人的功能 | 案例 5 | `inject: ['名字']` 或 `ctx.tryGet` | `plugin-node-image` |
| AI/节点面板能调我的生成能力 | [案例 6](/examples/register-tool) | `ctx.tools.register` | `plugin-tool-text-generation` |
| 节点顶部/底部状态栏装按钮或换面板 | [案例 9](/examples/node-toolbar) | `registerMode` / `ctx.slots.register` | `plugin-node-image` / `plugin-demo-kit` |
| 节点/画面正在加载时显示统一的加载态 | [节点加载态](/plugins/theme-components/node-loading-state) | `import { NodeLoadingState } from '@plume-canvas/plugin-theme-canvas'` | `plugin-theme-canvas` / `plugin-node-video` |
| 给节点加自定义状态层（排队中之类） | [节点加载态 · 注册自己的状态组件](/plugins/theme-components/node-loading-state) | `ctx.nodes.attach('*', { region: 'state:overlay', component })` | `plugin-theme-canvas` |
| 工具栏下拉里嵌一块自定义面板（色板、宫格） | [下拉菜单](/plugins/theme-components/dropdown) | shadcn `DropdownMenuSub` 的默认插槽 | `plugin-image-grid-split` |
| 节点底栏多一个动作按钮 | [案例 7](/examples/bottom-bar) | `registerBarAction`（跨插件） | `plugin-node-text` |
| 拖文件/粘贴进画布建节点 | [案例 8](/examples/file-drop) | `ctx.effect` 包 window 监听 | `plugin-file-drop` |
| 给节点加图片/视频/音频，只存资源 ID | — | `useCapability('media')` → `put` 拿 ID、`addNode(kind, id, pos)` | `plugin-node-image` / `plugin-node-video` / `plugin-node-audio` |
| 读上游数据（可继续往上，直到最早的依赖） | [上游与执行顺序](/canvas-data/upstream) | `useCapability('upstream')` 的 `nodes()` / `ancestors()` / `media()` / `order()` | `plugin-node-3d-preview` / `plugin-node-image-compare` |
| 从最后一个节点倒推、按依赖顺序执行 | [上游与执行顺序](/canvas-data/upstream) | `upstream.order()` 返回拓扑序 | 执行类插件（ComfyUI 式） |
| 定时任务/轮询 | 案例 8 | `ctx.effect` 包 `setInterval` | `plugin-auto-save` |
| 换掉整个节点外壳/连线 | [主题手册](/theme/) | `ctx.theme.add(slot, comp, { order })` | `theme-components` |
| 设置里改字体 / 圆角，整站跟着变 | [组件库](/plugins/theme-components) | 默认主题的「外观」配置 → `--plume-*` 变量 | `theme-components` |
| 给自己的颜色加实时预览 | [颜色与预览](/theme/preview) | `Config` 的 `type: 'color'` + `ctx.slots.register(THEME_PREVIEW_SLOT)` | `plugin-multi-select` |
| 看某个 shadcn 组件是哪个文件在用 | [组件库](/plugins/theme-components) | 「常规 → 调试 → 组件库使用标记」 | `theme-components` |
| 写界面 / 补组件 / 弹通知 | [UI 开发](/plugins/ui-development) | `useUiComponent()` + `ctx.get('notify')` | `plugin-manager` |

## 没找到你想做的？

看 [核心 API 总览](/core/) 的注册场清单 —— 那是「能往画布上放东西」的完整列表；
或者去 [活快照](/plugins/live) 看**真实运行中的画布**上都注册了些什么，找同类抄。
