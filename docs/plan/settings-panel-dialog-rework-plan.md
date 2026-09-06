# 设置面板重构为"Dialog + 左右导航 + 分组级内容插槽"—— 计划

日期 2026-09-06 · 分支 feat/cordis-plugin-system · 作者 code-developer · 状态：第一版已实现并提交(commit 34b5653)，以下为设计稿留档

## 〇、需求收敛（与用户逐轮确认的最终版）

把默认设置面板 `PluginSettingsPanel.vue`（plugin-theme-default 的 settingsPanel 默认皮）从"一列堆叠分组卡片"重构成**标准设置弹窗**：

1. **外层形态**：居中 modal + 遮罩 + 右上角 ✕。
2. **左右布局**：
   - 左 = 分组导航列表（一项 = 一个分组名）。
   - 右 = 上下两块：上为该分组**标题**（就是分组名，**舍弃描述**，不做额外元数据），下为该组 **schema 配置控件内容区**。
3. **分组合并**：多个插件往同一 `group` 名塞字段 → 合并到同一分组渲染，**不做插件二级分类**。
4. **左导航 SlotHost**：插件可插自定义导航项，需 props 注入切换能力（见 §三）。
5. **同名覆盖**：插件插的导航项若与某 config 分组同名 → **顶替默认分组 tab**，不重复渲染。
6. **顺序**：**本次不做**（无分组配置元数据），后期改拖拽排序（见 §六 后续）。

> 架构边界（承接 settings-panel-slot-host-plan §〇）：本面板是"可替换设置面板"的**默认皮**，整体仍经 `theme.register('settingsPanel', 组件)` 走单赢家槽。整个弹窗可被插件换皮；本库只提供默认皮。依赖方向 plugin-theme-default → canvas-render(抽象) → canvas-core-v2(内核)，不反向。

---

## 一、现状（改前结构）

- `App.vue` 顶部"⚙ 设置"按钮 → 切换右下角固定浮窗 `settings-dock` 显隐 → dock 内一行 `<SettingsHost/>`。
- `SettingsHost`（canvas-render 渲染层）：读 `themeRegistry.winner('settingsPanel')` 得赢家组件，`<component :is :settings>` 把 settings 喂给它。**只 v-bind `settings` 一个 prop，不传 ctx**。
- `PluginSettingsPanel`（plugin-theme-default 默认皮）：`props.settings`，把 `settings.groups()` 每个组从上到下堆成卡片，组内 `groupOf(g)` 的字段按 schema 长控件。
- 数据契约 `SettingsPanelSource = { groups(), groupOf(g), set(key,v), onChange(cb) }`（settingsPanelTypes.ts）。
- 分组无任何元数据（无标题字段、无描述、无 order），只有字段 schema 上的 `group` 字符串。
- 左/右侧都**没有插槽**，不是弹窗。

---

## 二、设计定稿

### A. 整体仍是"可替换皮"，壳与内容分开
`PluginSettingsPanel` = 整个 Dialog 皮，仍注册在 `settingsPanel` 槽。它内部自含：
- modal 外壳（遮罩 + 居中 + ✕）；
- 左导航列 + 右内容区；
- 但把"读 groups / 渲染控件 / 读插槽"这些**逻辑逻辑上尽量薄**，控件渲染仍复用现 schema 控件区（可抽一个内部小组件或保留内联）。

### B. 数据：分组 = 纯合并、无描述
面板消费端不变：仍读 `SettingsPanelSource.groups()`（SettingsStore 已天然合并同组字段，`groupOf` 返回同组所有字段，含多插件申报的——内核 `SettingsStore` 的 map 以 key 存、group 仅归类，天然满足"同组合并"）。不引入任何分组元数据。

### C. 左导航 = config 分组 + 自定义导航插槽（SlotHost 语义）
左侧渲染一个"导航项集合"，由两类来源合成：
1. **config 分组项**：`settings.groups()` 每个组名生成一个默认导航项。
2. **自定义导航项**：读一个**新语义槽**（槽名如 `settingsNav`，多 occupant），插件 `ctx.slots.register('settingsNav', { id: <组名或自定义>, order, value: 组件 })`。

合成规则（关键，含同名覆盖）：
- 先取插槽 occupant；每个 occupant 声明 `id`。
- **若 occupant 的 `id` 命中某 config 分组名 → 该分组的默认导航项被顶替**（左侧只显示插槽项，config 分组项不再渲染）。
- occupant 的 `id` 不命中任何分组 → 作为"纯自定义导航项"追加（点它右侧渲染它自带的组件，见 E）。
- 排序：本次**不排序**，config 分组项按 `groups()` 返回顺序在前，插槽项在后按 order；同名覆盖位维持原分组位置（若占位逻辑需固定，就排在该组名原顺序位）。后续拖拽。

> 注：`settingsNav` 插槽放左导航；右侧内容区插槽另见 E。两处都以 "ctx.slots" 多 occupant 机制承载（SlotRegistry 已支持任意槽名 + 前缀 + order + id 覆盖）。

### D. 左侧插槽注入的能力（你反复强调的点）
左导航插槽里渲染的 occupant 组件（`<component :is>`）**必须拿到默认 props**，否则点了没反应：
- `onSelect(group)`：激活并切换右侧到该分组内容。
- `active`(boolean)：当前该项是否被选中（供高亮态）。
- `group`(string)：该项对应的分组名 / 自定义 key。
- `settings`：数据源（可选，需要时读该组字段用）。

插件侧占位组件只需 `defineProps` 里声明要用到的即可（Vue 组件会忽略多余的注入 prop）。同名顶替的那个分组项，被点击时 `onSelect(分组名)` → 右侧仍渲染该组 schema 配置（见 E 决定项），只是左侧长相/交互被插槽组件接管。

### E. 右侧内容区 = 按分组名的默认插槽（你第 3 轮澄清的核心）
右侧内容区**本身是一个按分组路由的插槽区**，规则：
- 当前激活分组 = `activeGroup`（ref，默认第一个）。
- 渲染时先检查：**该分组名是否有人注册了"内容接管插槽"**（槽名约定 `settingsGroup/<分组名>`，多 occupant）。
  - 有 → 渲染该插槽的 occupant（默认 props 注入 activeGroup + settings），**接管该组内容渲染**。
  - 无 → 默认 fallback：按 schema 渲染该组所有控件（现有逻辑）。
- 于是"在内容区插自己的 Vue 组件" = `ctx.slots.register('settingsGroup/连线', { id, order, value: 组件 })`，命中"连线"组就在右侧内容区显示。**前缀 + group ID 即槽名** —— 与你描述的机制一致。
- 可选的第二层：内容区插槽还可细分为"整组接管"(上面) 与"组内追加/替换"两类；**第一版只做"整组接管"最省事**，组内逐字段接管留后续（见 §六）。

### F. 面板如何拿到 ctx（关键接线问题）
现状 `SettingsHost` 只喂 `settings` prop。要做 slot，面板需要 `ctx`（读 `ctx.slots`）。解决：
- 方案：面板整体既然在 `SettingsHost`（canvas-render 渲染层、`useCanvasRender()` 可得 ctx）渲染子树内，默认皮 `PluginSettingsPanel` 可直接 `useCanvasRender()` 拿 `ctx`（plugin-theme-default 依赖 canvas-render，useCanvasRender 已导出）。**不需改 SettingsHost**。
- 但注意：面板走的是 `settingsPanel` theme 赢家，若插件换皮成"不带 ctx 的组件"，仍只要 `props.settings` 就行——**slot 能力是默认皮的增强，不是 settingsPanel 槽契约**。替换皮用不到 slot 可忽略。

> 分歧点需用户拍板：让"settingsPanel 赢家必须能拿 ctx"进入槽契约（改 SettingsHost 给赢家 v-bind ctx/或暴露 host），还是只在默认皮内用 useCanvasRender() 就地取？（我倾向后者，改动最小、不破坏换皮契约，见 §五 需确认点 1。）

---

## 三、落地步骤（每步独立 commit）

1. **canvas-render 抽 schema 控件渲染为可复用小组件**（可选，若内联太肥）：
   - 把 PluginSettingsPanel 里"按 schema 长控件"那段（color/number/boolean/select/text + coalescer 合帧）抽成渲染层小组件 `SchemaField.vue` 或保留复制一份到新文件，供新面板 fallback 用。若判断内联够薄则跳过（见 §五 2）。
2. **新建默认皮 Dialog 结构**（plugin-theme-default/src/components/ 下，改名或新文件，如 `PluginSettingsDialog.vue`，不覆盖旧文件以免破坏他人未提交行）：
   - modal 外壳：遮罩层 + 居中容器 + 右上角 ✕（`emit('close')` / 内部控制开关 + App.vue 传开关）。
   - 左右布局 CSS（左固定窄列导航、右自适应标题+内容）。
   - 读 `settings.groups()` 生成左导航 + 默认激活第一个；读插槽合成导航（§C/D）；右内容区按 activeGroup 路由到"组插槽 or schema fallback"（§E）。
   - `useCanvasRender()` 拿 ctx（走 §二F 定稿），读 `ctx.slots`。
3. **默认皮接入开关**：面板自己可开/关，或由宿主（App.vue）控制 open 状态 + `emit`。确定打开/关闭的归属（见 §五 3）。App.vue 现 `settingsOpen` 控制右下 dock —— 改为控制 Dialog 显隐 + 遮罩关闭。
4. **App.vue / 渲染接线**：右下 dock 改造或换成 `<SettingsHost/>`（SettingsHost 不变，仍渲染 settingsPanel 赢家 = 新 Dialog）。顶部按钮与关闭/遮罩联动。
5. **文档 / 导出**：新皮文件导出、可替换说明注释；确认旧 PluginSettingsPanel 的去留（保留为导出兼容 or 删除，见 §五 4）。
6. **验证**：
   - vue-tsc（canvas-render + plugin-theme-default + ui）绿；
   - 渲染层 / 内核相关单测照常；
   - visual：打开设置 → 居中弹窗；左导航点分组切右侧；改控件实时生效；
   - 插件插入验证：造一个假插件 `ctx.slots.register('settingsNav', {id:'连线', ...})` 顶替"连线"分组 tab、`ctx.slots.register('settingsGroup/连线', ...)` 接管右侧渲染 → 用 dev 热装验证两种插槽都生效、装卸回退。

---

## 四、风险与注意

- **同组合并天然满足**（SettingsStore map key 全局唯一、group 归类），无需额外代码，但要验证多插件同组字段确实并排渲染。
- **左导航 SlotHost 与右内容插槽是两套槽名**（`settingsNav` vs `settingsGroup/<组>`），别混淆；同名覆盖只发生在左导航（id 命中分组名）。
- **注入 props 契约**：占位组件必须能收到 onSelect/active，缺了就是"点了没反应"（用户最在意）。要写成约定 + 注释 + 可能给一个默认包装组件示例。
- **SettingsHost 不传 ctx 的问题**（§二F）：若换皮组件也想用 slot，需要 ctx——本计划先在默认皮内 useCanvasRender() 解决，不强改契约。
- 不碰他人未提交的文件行：plugin-theme-default/src/index.ts、CanvasSurface.vue 等已有本地改动，用新文件承载。

---

## 五、需你确认（动手前拍板）

1. **ctx 获取方式**：默认皮内 `useCanvasRender()` 就地取（改动最小），还是把"赢家能拿 ctx"纳入 settingsPanel 槽契约（改 SettingsHost 多 v-bind）？—— 倾向前者。
2. **schema 控件段**：抽成 canvas-render 复用小组件，还是新面板内联复制一份？—— 倾向内联（避免动 canvas-render，减小改动面），你定。
3. **弹窗开关归属**：面板自带开关 UI（含遮罩点击关闭）并在内部管理 open，还是由宿主 App.vue 传 `open` + 面板 emit `close`？—— 倾向后者（宿主控制，符合"面板不背布局职责"）。是否保留"点遮罩关闭 + Esc 关闭"？
4. **旧 PluginSettingsPanel.vue 去留**：作为默认皮被新 Dialog 顶替后，旧文件删除 or 保留导出（可能有外部引用）？—— 需查引用再定。
5. **右侧"整组接管"第一版就够**，对吗？（不做"同组内逐字段替换/追加"的精细插槽。）

---

## 六、后续方向（本次不做）

- **导航顺序**：拖拽排序（用户已确认本次不做）。届时给分组项/插槽项暴露可拖 handle + 持久化顺序。
- **组内逐字段替换/追加插槽**：现在只做"整组接管"，将来可做"`settingsField/<组>/<字段>`"级插槽。
- **分组元数据**（标题/描述/图标）若将来要，需要引入"组 owner 声明"机制（本计划确认舍弃，仅保留组名）。

---

## 七、验证方案汇总

- 静态：三个包 vue-tsc / tsc 绿。
- 单测：渲染层现有测试不破坏；若抽 SchemaField 则补其控件渲染测试（可后补）。
- 手工/visual（ui 包 npm run dev）：弹窗形态、左右切换、控件实时生效、同组多插件合并。
- 热装验证：dev 里加载假插件，验证 settingsNav 同名顶替 + settingsGroup/<组> 内容接管 + 卸载回退。
