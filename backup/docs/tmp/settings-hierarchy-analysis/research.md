# 设置面板：现状搜集 + 二级菜单/预览UI/字段渲染器改造分析

> 日期 2026-09-09 · 目的：把「删除演示插槽 + 全插件 Config 二级菜单化 + 预览UI插槽 + 字段渲染器下发」这四件事先摸清再动刀。

## 一、现状搜集（事实，不推断）

### 1.1 谁给设置面板喂分组？（= 导出 `Config` 且宿主加载的插件）
只有 3 个插件导出 Config、并出现在 demo 宿主(ui App.vue)加载列表里，即它们的分组会进设置面板：

| 插件 | Config 文件 | 现状分组（平铺一级） |
|---|---|---|
| plugin-theme-default | src/index.ts | 连线 / 连线动效与箭头 / 端口 / 吸附带 / 调试 |
| plugin-node-image | src/nodeImagePlugin.ts | 图片/圆角、图片/阴影（我上次拆的二级）、边框、高级 |
| plugin-auto-layout | src/autoLayoutPlugin.ts | 布局 / 聚焦 |

其余 ~17 个插件**都没有 Config**，也不喂设置面板（它们大多是逻辑/服务插件，无视觉项）。

### 1.2 谁用了"自定义插槽效果"？（= ctx.slots 里 settingsNav/settingsTab/settingsGroup）
git grep 全插件 src：**只有 plugin-node-image 注册了 3 个演示插槽**，且只被它自己 + 我写的文档引用，无测试/宿主依赖：
- `settingsNav` id=边框（DemoSlotNavItem 顶替一级项）
- `settingsTab` id=图片/圆角（DemoSlotTab 顶替二级页签）
- `settingsGroup/图片/阴影`（DemoSlotContent 并存正文）
配套 3 个演示组件：`src/settingsDemo/DemoSlotNavItem.vue / DemoSlotTab.vue / DemoSlotContent.vue`。

theme-default 的 PluginSettingsDialog **消费**这三套槽（是我上次加的二级菜单能力），这不是"效果"，是面板能力，保留。

### 1.3 SettingsSchemaField 现状
theme-default 内部组件：`src/components/settings/SettingsSchemaField.vue`。props `{ group, fieldKey, settings }`；内部订阅 settings.onChange 自刷新；渲染 color/number/boolean/select/text 控件 + 描述。目前**只被 PluginSettingsDialog 用**，插件侧组件拿不到它（它被包在 theme-default 里，别的插件反向依赖它会破坏依赖方向）。

### 1.4 依赖方向红线
theme-default → canvas-render → canvas-core-v2，插件不反向 import。所以"把 SettingsSchemaField 下发给插件"，不能靠插件 import theme-default 的组件；要走"面板运行时经 provide/inject 注入"或"渲染层导出一个组件引用"的路子。

---

## 二、四个诉求的拆解与可行设计

### A. 删除 node-image 的演示插槽
删掉 apply 里 3 处 ctx.slots.register + 3 个 settingsDemo 组件 + node-image 里为演示拆的二级分组可回退/重构（见 B）。并同步改我写的用法文档（它拿 node-image 当例子）。

### B. 二级菜单化：给"有视觉/外观项的插件"分两级 group
提议（theme-default 最典型，因为全是外观项）：
- 现有扁平一级太多（连线/连线动效与箭头/端口/吸附带/调试）→ 应按"主题/块"归并成一级，视觉细分做二级。
  例如一级「连线」下二级：基础 / 动效箭头；一级「端口」下二级：尺寸/几何…；一级「其他」。
- auto-layout：一级「布局」已有，可把 direction/intra/inter 分二级（如 spacing/flow）。
- node-image：保留「图片/…」二级即可，去掉演示用的 Tab 顶替。
但到底怎么切、要不要新增视觉项，**需要用户拍板**（太多自由裁量）。

### C. 预览UI + 自定义内容插槽
现有 `settingsGroup/<key>` 已能"接管某组正文 = 放你自己的预览组件"，改值走 settings.set → 预览用 settings.onChange 自刷新。所以预览场景 = 插件给某组注册 settingsGroup 内容组件（replace/prepend/append），不必新增槽。缺的是把"字段控件渲染器"下发（见 D）和决定哪个组用预览。

### 定稿（2026-09-09，用户拍板）：一级按"画布对象/功能"跨插件聚合，颜色集中进「主题」
用户纠正"别把单插件拆太碎（二级=不同插件块）"且明确新增「节点/边」及「主题(收各种插件颜色)/常规」一级。
落点 = 各插件 Config 的 `group` 首段即一级、跨插件聚合；**颜色字段一律归 `主题/<插件或元素>`**。
已实现（分支 feat/cordis-plugin-system，commit 1f48cd4 + 34a27c8）：

| 一级 | 二级（来自哪些插件） |
|---|---|
| 节点 | 端口、吸附带(theme-default) / 图片节点(node-image) |
| 边 | 连线(theme-default) / 连线切割(edge-cutting) |
| 主题(颜色集中) | 连线(theme-default: edgeColor/edgeGlowColor) / 图片节点(node-image: borderColor) / 连线切割(edge-cutting: pathColor/bladeColor) |
| 布局 | auto-layout（方向/间距/聚焦/诊断 平铺，不拆 tab） |
| 小地图 | mini-map |
| 导出 | canvas-export |
| 调试 | theme-default |

字段源码留各自插件，面板只按 group 前缀归类；settings 读写 key 驱动，改 group 不影响取值。
依赖方向 / 面板二级页签语义不变（一级下 >1 个二级才出 tab 条）。「常规 general」尚无现成字段可归，未建。

---

### D. 把 SettingsSchemaField 下发，让注册的组件能直接渲染某字段控件
目标：插件的自定义组件（如预览/自定义页签正文）能直接摆出该组的标准 schema 控件，省得自己重画滑块/开关。
候选机制（需选型）：
1. **面板 provide 注入**：PluginSettingsDialog 渲染 content 插槽组件时，`provide('settingsField', SettingsSchemaField)`（并给 settings 源），自定义组件 `inject` 到后包一层 `<component :is>` 渲染某字段。改动小、贴合"壳内组件靠 Vue 注入"的记忆约定。
2. **渲染层导出组件**：把 SettingsSchemaField 从 theme-default 上移到 canvas-render 导出，插件反向 import canvas-render（合法方向），但属"换皮组件"而非默认皮内部件，改动较大。
3. **ctx 注入**：theme-default ctx.inject 一个组件引用（不太贴内核纯TS服务约定）。

倾向方案 1（provide/inject 令牌），符合 v2 双注入记忆（Vue provide/inject 给壳内组件）。

---

## 三、需要你拍板的点（改前问清，避免整包返工）
1. **哪些插件的哪些组要做成二级？** 尤其 theme-default 想怎么切分组树？auto-layout / node-image 怎么归？
2. **预览UI 放哪个/哪些功能？** 放"正文 replace"（接管整组）还是"prepend/append 并存"，先做哪个当样板？
3. **字段渲染器下发走哪条路**（推荐方案 1 provide/inject）？以及是否要我现在就把 D 的机制搭好 + 一个 theme-default 连线预览样例。
