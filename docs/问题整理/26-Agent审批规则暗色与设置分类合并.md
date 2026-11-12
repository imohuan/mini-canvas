# 26 · Agent「审批规则」暗色分隔线发白，设置左侧「个人 / 外观」合成「常规」

- 状态：已完成
- 负责人：Codex
- 完成时间：2026-11-12

## 你的原话

> 第一个就是这个 Agent 主题中，审规则审核这个 UI 的问题，可以看到你这边暗色主题的支持并不是很好。 请优化一下它这个暗色主题的一个颜色
>
> 其次，你的设置面板左侧有个“个人”和“外观”，请把这两个配置进行整合，放在一个常规的菜单下面 就不需要单独的区分个人和外观了，因为你这边只有一个菜单

## 要解决的问题

1. 暗色主题下，Agent 设置里的「审批规则」卡片，每条规则之间是一条亮白线，很扎眼；同一张卡片里其它分隔线（开关行）也一样发亮。
2. 设置面板左侧的第 0 级分类里，「个人」只有「快捷键」一项，「外观」只有「主题」一项。两段各一个菜单，读起来像多余的分组。合成一段「常规」即可。

## 范围与位置

- 页面：设置 → 智能助手 → 审批规则；设置左侧导航
- 参考代码：
  - `packages/canvas-render/src/styles/ui-theme.css`（`--ui-line-faint` / `--ui-line-strong` / `--ui-ease-back`）
  - `packages/plugins/plugin-agent/src/ui/settings/RulesPage.vue`（`.ap-rule-row + .ap-rule-row`）
  - `packages/plugins/plugin-theme-components/src/components/settings/ShadcnSettingsRow.vue`
  - `packages/plugins/plugin-theme-components/src/components/settings/defaultMenu.ts`
  - `packages/plugins/plugin-theme-components/src/components/settings/navCategory.ts`
- 相关资源：用户截图（临时目录 codex-clipboard-a3433908…png），未入库
- 关联问题：无

## 现在 vs 期望

| | 现在 | 期望 |
| --- | --- | --- |
| 审批规则分隔线 | 暗色下是 `#eef0f4`（接近白），每条之间一条亮线 | 暗色下是比卡片底 `#262626` 亮一点点的 `#2f2f2f` |
| 设置左侧分类 | 常规前还有「个人」「外观」两段，各一项 | 只有一段「常规」，里面是 主题 / 快捷键 |

## 问题原因

- 状态：已定位
- 复现步骤：暗色主题 → 设置 → 智能助手 → 审批规则。
- 证据（日志 / 截图 / 调用路径）：
  - `RulesPage.vue` 和 `ShadcnSettingsRow.vue` 都写 `border-top: 1px solid var(--ui-line-faint, #eef0f4)`；
  - 但 `ui-theme.css` 的亮色 / 暗色两套都没有定义 `--ui-line-faint`，浏览器一直吃 `#eef0f4` 这个浅色兜底 —— 暗色下就等于白线。
  - 实测：修复前 `--ui-line-faint` 取值为空，规则行 `borderTopColor = rgb(238, 240, 244)`；修复后为 `rgb(47, 47, 47)`。
- 根因：主题 token 缺失（组件引用了一个从未定义的变量），不是组件自己写死了颜色。

## 修改方案

- 改哪里：
  - `ui-theme.css`：补 `--ui-line-faint`（亮 `#f2f4f7` / 暗 `#2f2f2f`）、`--ui-line-strong`（亮黑 14% / 暗白 18%）、`--ui-ease-back`；这些名字组件已经在用，只是从未定义。
  - `defaultMenu.ts`：把「个人」「外观」两个分类合成「常规」（id 仍用 `category/personal`，外部插件不受影响）；「主题」移到「常规」下，顺序 通用 → 主题 → 快捷键。
  - `navCategory.ts`：内置分类顺序改成 常规 / 集成 / 画布 / 开发；旧的 `'个人'` / `'外观'` 字符串统一收拢到「常规」，避免插件里残留的 meta.category 再造出旧段。
  - `settingsMenu.ts`：自动兜底分类的标题改成「常规」，查找时兼容 `category/personal` 这个 id。
  - 快捷键插件注册的 `meta.category` 同步改成「常规」。
- 为什么这样改：只补 token 就能让所有用同一变量的分隔线一起变暗，不必逐个页面写死颜色；分类按 id 合并、按名字加别名，旧插件不会失效。
- 风险 / 影响面：所有用 `--ui-line-faint` / `--ui-line-strong` 的组件会从"浅色兜底"变成真正的主题值（这是期望方向）；`--ui-ease-back` 仅补别名，动画值与原来一致。
- 验证方式：Chrome 实测亮 / 暗两套；跑相关包测试与 typecheck。

## 验收标准

- [x] 暗色下审批规则卡片里，规则之间是深灰细线，不再有亮白线
- [x] 亮色下分隔线仍是极浅的灰线，卡片观感不变
- [x] 设置左导航只出现 常规 / 集成 / 画布 / 开发 四段，「常规」下是 主题 / 快捷键
- [x] 插件仍写 `category: '个人'` 或 `'外观'` 时不会冒出第五段

## 不能动

- 不改审批规则的保存逻辑（`agent.savePolicy` / `restorePolicy`）。
- 不改 `category/personal` 这个分类 id（外部插件 + 旧示例都按它登记）。
- 不动核心节点组件。

## 假设与待确认

- 假设：「常规」下的顺序按 主题 → 快捷键 排（用户原话只说合成一个菜单，没指定顺序）。
- 待确认：要不要把「通用」也重新挂回一级（目前它没有配置字段，面板里不显示）。

## 执行记录

- 改动文件：
  - `packages/canvas-render/src/styles/ui-theme.css`
  - `packages/canvas-render/src/contracts/themeModeSettings.ts`（只改注释）
  - `packages/canvas-data/src/canvas/settingsMenu.ts`
  - `packages/plugins/plugin-theme-components/src/components/settings/defaultMenu.ts`
  - `packages/plugins/plugin-theme-components/src/components/settings/navCategory.ts`
  - `packages/plugins/plugin-shortcut-manager/src/shortcutSettingsPlugin.ts`
  - `packages/plugins/plugin-shortcut-manager/src/shortcutManagerPlugin.ts`
  - 对应测试：`settingsMenu.test.ts`、`defaultMenu.test.ts`、`settingsPanelTree.test.ts`、`settingsShortcutPage.test.ts`、`settingsPanelData.test.ts`
  - 正式文档：`packages/docs/theme/palette.md`、`packages/docs/theme/preview.md`
- 验证命令与结果：
  - `pnpm -C packages/canvas-data test` → 46 文件 / 460 用例全过
  - `pnpm -C packages/canvas-render test` → 66 文件 / 629 用例全过
  - `pnpm -C packages/plugins/plugin-theme-components test` → 36 文件 / 214 用例全过；typecheck 通过
  - `pnpm -C packages/canvas-data typecheck` 通过
  - `pnpm -C packages/plugins/plugin-shortcut-manager test` → 6 文件 / 40 用例全过
  - `pnpm -C packages/ui test` → 91 文件 / 586 用例通过（1 skipped）
  - Chrome 实测（localhost:5288）：暗色审批规则分隔线 `rgb(47,47,47)`；左导航只有「常规 / 集成 / 画布 / 开发」；切亮色后分隔线 `#f2f4f7`，卡片观感不变
- 完成时间：2026-11-12
- 代码提交（可选）：未提交
