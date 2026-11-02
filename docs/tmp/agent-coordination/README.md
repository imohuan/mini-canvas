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
