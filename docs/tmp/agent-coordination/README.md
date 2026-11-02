# 四任务协调表

更新时间：2026-11-02

## 分工

| 任务 | 会话 | 负责范围 |
| --- | --- | --- |
| Shadcn A | `01a1968e-c488-7651-a07f-9d94b3836bc1` | `packages/ui/src/components/Ax*.vue` 及 `packages/ui/src` 的直接调用点；原生按钮替换 |
| Shadcn B | `01a19a6f-8b69-7253-bc69-46308acbce3f` | 旧版 `@mini-canvas/ui-kit` 退场；`packages/ui-kit*`；插件里的旧组件消费点 |
| 设置菜单 | `01a19a53-47df-7fb0-b5a1-3fb3aacc1859` | `canvas-data` 的 0/1/2 级菜单注册表；`plugin-theme-default` 的设置导航 |
| 颜色工作台 | `01a19990-fe2c-7671-acbb-12ff4750dcf9` | `plugin-demo-kit/src/theme-lab/**`；设置面板里的宽版入口 |

## 共同规则

1. 只改自己范围内的文件，基于工作区现状增量修改。
2. 不执行 `git add -A`、`git checkout`、`git restore`。
3. 不提交或清理其他任务的未提交改动。
4. 发现别人覆盖自己的改动，先通知调度器，不要反向改回。
5. `AppSettingsPanel.vue` 已由颜色任务完成宽版入口，2026-11-02 交接给设置任务；Shadcn A/B 继续不碰它。交接时必须保留 `THEME_STUDIO_NAV` 常量和 `.asp-page.is-wide` 宽度规则。
6. `packages/plugins/plugin-theme-default/src/components/settings/**` 归设置任务；Shadcn B 暂不碰。

## 当前交叉点

- `packages/ui/src/__tests__/uiDropdownRegistration.test.ts`：B 删除主题默认 `dropdown` 注册后失败，B 负责迁移 `uiDropdownPlugin` 与测试。
- `packages/ui/src/components/ProjectsPage.vue`：A 按钮替换需保留原 hover/层级语义；已提醒核对 `destructive` 与空占位按钮。
- `packages/ui/src/components/settings/AppSettingsPanel.vue`：颜色任务已完成，设置任务已接手；保留现有宽版两处规则。
- `plugin-theme-default/src/index.ts` 的旧 `Dropdown/Tooltip/Select` 再导出：B 已清理；`plugin-demo-kit` 构建恢复通过。
- `packages/ui/src/__tests__/settingsMenuNavigation.test.ts`：AppSettingsPanel 尚未接 `settingsMenu`，设置任务在跟进。

## 已核对结果（2026-11-02）

- `pnpm -C packages/canvas-data test -- --run settingsMenu`：446/446 通过。
- `pnpm -C packages/plugins/plugin-theme-default typecheck`：通过。
- `pnpm -C packages/plugins/plugin-demo-kit build`：通过。
- `pnpm -C packages/ui typecheck`：通过。
- `pnpm -C packages/ui-kit-shadcn typecheck`：通过。
- `pnpm -C packages/ui test -- --run shadcnFamilies`：仍有 `uiDropdownRegistration` 2 个失败（B 负责）和 `settingsMenuNavigation` 1 个失败（设置任务负责）。
- 2026-11-02 13:5x：`packages/ui` 全量 542/542、`plugin-theme-default` 351/351、`canvas-data` 446/446、`plugin-image-grid-split` 92/92、`plugin-demo-kit` 16/16 通过；`plugin-bottom-bar` 仍有 7 个旧断言/触发布局问题，`plugin-agent` 4 个 + 1 个套件加载失败，`plugin-group` 3 个 SSR 色板断言失败。

## 2026-11-02 恢复续跑

- 四个会话均曾被中断；已分别发“继续任务”通知，要求从当前工作区续跑。
- 工作区现状：AxDropdown/AxMenu/AxMenuItem/AxSubMenu/AxTooltip/uiDropdownPlugin 已删除，新增 AppDialog/ScrollPane；设置任务未完成的 settingsMenu 与两套面板改动仍在。
- 继续时禁止恢复已删除的旧文件；先修调用点或通知 /root。

## 2026-11-02 续跑检查

- `pnpm -C packages/ui test`：77 个文件、545 条全过（上次记录的 5 条已修）。
- 额外插件包：`plugin-group` 61、`plugin-agent` 401、`plugin-bottom-bar` 306、`plugin-image-grid-split` 92、`plugin-demo-kit` 16、`plugin-manager` 60、`plugin-node-ui` 377、`plugin-node-rotate` 22、`plugin-hot-reload` 39、`plugin-multi-select` 153、`plugin-cursor-effect` 33、`plugin-clipboard` 43、`plugin-context-menu` 74、`plugin-file-drop` 49、`plugin-mini-map` 21、`plugin-shortcut-manager` 32、`plugin-style-library` 36、`plugin-canvas-export` 70、`plugin-edge-cutting` 30、`plugin-align-arrange` 24、`plugin-node-text` 69，均通过。
- `packages/ui-kit` 已整体删除；代码 import 已清空，但公开文档仍有旧包说明，已转给 Shadcn 任务修正。
- 文档站补了缺失依赖 `@mini-canvas/ui-kit-shadcn`，并修好 ThemeKitProbe 的旧 Tooltip/Select；`pnpm -C packages/docs build` 已完成一次（dist 刷新）。
- 不要提交 `packages/docs/--port/` 缓存目录与 `.vitepress/data/plugins.data.ts.timestamp-*.mjs` 临时文件。

## 2026-11-02 最终收尾

- 四个任务都已交付。设置菜单与颜色工作台由调度器按文件边界提交，没有使用 `git add -A`。
- `mediaViewerControls.test.ts` 有 3 条断言仍按原生 `<button>` 匹配；实现已经是 shadcn `<Button>`。
  测试改成匹配 `<Button>`，下载无 `v-if`、缩放只在 `canZoom`、旋转/镜像在 `hasTools` 的断言全部保留。
- 最后一次全量结果：`packages/ui` 77 个文件、550 条；`plugin-theme-default` 341 条；
  `canvas-data` 448 条；`plugin-agent` 401 条；`plugin-bottom-bar` 306 条；`plugin-group` 61 条，
  其余插件包与之前记录一致。`packages/ui`、`plugin-theme-default`、`canvas-data` 类型检查通过。
- 文档站构建通过。浏览器目验仍受 `Local browser use is disabled in Work settings` 限制，
  设置菜单、主题工作台、右键菜单和底栏的交互只能算测试/SSR/构建验证，不能算 Chrome 验收。

## 2026-11-02 三项问题验收（调度器）

本节记录用户 11-02 报的三类问题，以及各自修复提交与验收方式。

| 问题 | 提交 | 结论 |
| --- | --- | --- |
| 设置面板打开白屏（`Cannot access 'ue' before initialization`） | `e810a4b8` | 已修；两套面板把 `navIcons/iconOf` 提到 `watch(navEntries)` 之前，并加 SSR 渲染与声明顺序测试 |
| 设置左导航重复「外观」、破折号图标、个人下多出兜底项 | `64c7f7ab`、`498038f7`、`ea95cf81` | 已修；section 按完整分组名匹配，图标按标题取，导航改用 shadcn Button，新增全插件菜单测试 |
| 尺寸档管不到显式 `size`、下拉高亮字看不清、浮层被外壳压住、Agent 按钮圆角写死 | `32867b40`、`ed89b117` | 已修；显式 size 改为以全局控件高为基准，菜单高亮成对用 `--ui-on-accent`，浮层提到 `--layer-modal`，去掉 `rounded-full` |

验收结果：

- `packages/ui-kit-shadcn test`：6 条契约测试通过；类型检查通过。
- 设置相关 7 个测试文件：52 条通过（含 `settingsAllPlugins` 全插件零兜底）。
- `canvas-render`：627 条通过；`plugin-theme-default`：341 条通过；两者类型检查通过。
- `packages/ui typecheck` 通过；`packages/ui test` 当前唯一红点是「颜色配置」会话未提交的
  `ThemePreview*.vue` 里 12 处硬编码颜色（`themeColorHygiene`），与本节三项修复无关，
  等该会话交付后复跑。
- Chrome（8865，新构建 `index-DHTIwEz5.js`）目验：设置面板正常打开、左导航只剩
  「外观 / 集成 / 画布 / 开发」各一份且无兜底项、顶部只剩浮动与关闭；尺寸档从紧凑切到
  大时 `size="icon-sm"` 的关闭按钮 24px → 40px、导航行高同步变化；下拉选中行青底白字；
  左上画布菜单、资产面板加号菜单完整显示；Agent 圆球圆角为 7.2px（跟随 `--mct-radius`）。
- 「快捷键」tooltip 的箭头只能核对样式层级（`--layer-modal-top` = 100001 > 外壳 700），
  本轮坐标点击/悬停均未触发 tooltip，未算作目验通过。

遗留（不属于本次三项）：

- 「颜色配置」会话仍在工作区写 `ThemePreview*`：改完需复跑 `packages/ui test` 与 typecheck。
- 当前 8865 实例未安装光标 / 风格库插件，设置「工具」页只显示导出、小地图；
  全插件测试已覆盖这两项的归组。
