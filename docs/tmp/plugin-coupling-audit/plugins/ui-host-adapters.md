# 成品壳适配层（packages/ui）

## 一句话

成品壳用插件机制接入设置面板、下拉、资产上传和装配清单，方向正确；但有几处把“成品应用单例”当成了插件可用的能力，形成只有本应用才满足的暗契约。

## 清单

| 文件 | 角色 | 问题 |
|---|---|---|
| `packages/ui/src/assembly.ts` | 冷启动插件清单 | 静态数组 + 环境分支；插件清单与发布清单不完全一致 |
| `packages/ui/src/settingsPanelPlugin.ts` | 注册设置面板中间层 | 依赖 `theme` 单赢家槽，换主题即换设置页 |
| `packages/ui/src/uiDropdownPlugin.ts` | 用 `ui` 场顶替下拉 | 使用私有窄接口，缺类型契约 |
| `packages/ui/src/assetUploadPlugin.ts` | 右键/多选“收藏到资产库” | 直接使用 `useUi()` 成品单例，插件拿不到 |

## 跨包 import

| 目标 | 入口 | 说明 | 证据 |
|---|---|---|---|
| canvas-base / kernel | `PluginModule` | 公开 | `settingsPanelPlugin.ts:17`、`uiDropdownPlugin.ts:37` |
| 本应用组件 | `AppSettingsPanel`、`AxDropdown`、资产面板 | 应用内部，不是公共插件 API | 同上 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `theme` 场 | `ctx.theme.register('settingsPanel', comp, {order:-1})` | 契约 | `settingsPanelPlugin.ts:24-27` |
| `ui` 场 | `ui.add('dropdown', comp, {order:-1})` | 契约，但用自定义窄接口 | `uiDropdownPlugin.ts:42-48` |
| `commands` 场 | 右键菜单项 | 契约 | `assetUploadPlugin.ts:95-118` |
| `selectionRegion` | 多选上控制栏 | **成品应用专用扩展点** | `assetUploadPlugin.ts:126-133` |
| `doc` | 读节点 | 契约 | `assetUploadPlugin.ts:103-108` |
| `useUi()` | 资产列表、上传弹窗 | **单例暗契约**，只在成品壳可用 | `assetUploadPlugin.ts:55-58` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `window.addEventListener('mini-canvas:assets-changed')` | 资产变化后重建菜单 | 全局事件名没有类型/常量共享 | `assetUploadPlugin.ts:217` |
| `location.hash` / `location.search` | 取当前画布 id | 直接读浏览器路由，非画布服务 | `assetUploadPlugin.ts:224-230` |
| `showToast` | 用户反馈 | **空实现**，大量调用等于静默 | `packages/ui/src/composables/ui.ts:1340` |
| `selectionRegion` | 多选工具栏挂载 | 只在多选插件存在时可用；未安装则静默跳过 | `assetUploadPlugin.ts:126` |

## 内部职责与风险

1. **`assembly.ts` 是唯一装配清单，但“冷启动 / 可装卸 / 环境选装”三种身份混在一个数组 + 条件里**；插件清单页从云端读另一份，出现两份真相。
2. **`ui` 场顶替是正确的换肤机制**，但窄接口 `{add(key,value,opts)}` 绕过了内核的 `Registry` 类型；字段改名不会有编译错误。
3. **`assetUploadPlugin` 把资产能力藏在成品壳**：它自称“两个插件零改动”，实际只能在本应用工作，不能作为通用插件复用。
4. **`showToast` 空实现是跨层问题**：插件/组件调用它时以为有反馈，实际什么也不发生；这会把“功能失败”伪装成“点了没反应”。

## 单独装卸判断

- 移除 `ui-settings-panel`：回落到默认主题的设置面板，正常。
- 移除 `ui-dropdown`：回落到主题默认下拉，正常。
- 移除 `ui-asset-upload`：右键/多选收藏入口消失，不影响其他插件。
- 移除 `selectionRegion` 提供方：资产上传仍可注册命令，但多选入口静默缺失。

## 建议改法

1. 把 `selectionRegion` 提成 `canvas-data`/`canvas-render` 的公开能力契约（注册函数 + 类型），并让成品壳与插件使用同一份定义。
2. 把资产上传做成独立插件包，成品应用只注入“资产服务”；不要让插件直接 `useUi()`。
3. 给 `ui` 场加一个类型化 `UiCatalog` 助手，替代手写窄接口。
4. `showToast` 要么恢复真实反馈，要么改成显式 `notify` 服务；当前空实现应删除，避免误导。
5. 装配清单统一成一份，由云端 manifest 或本地静态清单择一生成；不要同时维护 `APP_PLUGINS` 和 `/plugin-catalog.json` 两套。

## 待验证

- `theme.register('settingsPanel')` 在换主题后是否仍保证设置页可用；当前靠 order -1 顶替。
- `assetUploadPlugin` 的 `selectionRegion` 是否需要 `needs:['selection']` 才真正渲染；当前只声明了需求。

