# P4 · ctx.settings 分组配置 → cordis「注册 Config(schema) + apply(ctx,config)」迁移 —— 侦察与设计

> 分支 `feat/cordis-plugin-system`，只原地 commit。目标文档 `docs/plan/plugin-cordis-migration-plan.md` P4。
> 全绿基线实测：内核 vitest 179、render vitest 34、内核 tsc EXIT=0（均已 node 直跑确认）。

## 一、现状全链路侦察结论

### 声明侧（内核能力段）
- `core/settingsStore.ts`：`SettingsStore` = 分组化"单一数据源"。`define(group, items, scope)` 以 **key** 为唯一登记单位（同 key 重复抛错），
  `set/get/groups/groupOf/onChange(cb,{scope})`（按**声明方 scope** 过滤→不误触别人）、`removeByScope`（热卸/重载清理）。**set 越界静默夹取**。
- `core/capabilities.ts` `settings` 段：`ctx.settings.define({group,items})` 记 `scope=pluginName` 并经 `ctx.effect` 回收 `removeByScope`；
  `set/get/onChange(scope,cb)/groups`。→ 这是要**替换掉的声明入口**。
- `core/Context.ts`：内置 `builtinSettings = new SettingsStore()`，`ctx.get('settings')` 返回它（宿主/demo 读同一实例）。
  插件激活 `tryActivate` → `runPlugin(mod, scopeCtx)`：`runPlugin` **只传 ctx，尚未把 config 传 apply 第二参**。
- `types.ts`：`PluginModule` 有 `config?: TConfig` 字段但未用；`apply?(ctx)` 单参。fiber.ts `Fiber.config` 已留空（P4 填）。

### 展示/消费侧
- theme-default `plugin-theme-default/src/index.ts`：在 `apply` 里 `ctx.settings.define` 两组（连线/连线动效与箭头）
  申报 7 项 edge 外观，schema default 取自 `DEFAULT_THEME_EDGE`。这是**要迁移成 Config schema** 的插件。
- render `PluginSettingsPanel.vue` + `settingsPanelTypes.ts`：读 SettingsStore 的 `groups()/groupOf()/set()/onChange()`
  schema 驱动长控件，set 经 `createCoalescer` rAF 合帧。
- `host/pluginManager.ts`：装完插件用 `applyConfig` → `ctx.get('settings').has/set` 覆写（**manifest config 走后门 settings.set**，未过装配校验）。
- demo `CanvasDemo.vue`：boot 后 `ctx.get('settings')` 取 SettingsStore → 传给 PluginSettingsPanel；
  `bindThemeSettings` 订阅 `store.onChange` 把声明过的 edge 键窄更新到 `cfg.edge` → 经 CanvasHost `edge-visual` 实时生效（**就地处理、不整图重建**）。

### 其它 3 插件与 canvas-base
- node-text/image/canvas-commands 均用 `apply(ctx)`/Service 类形态，**不 declare settings**，不受 define 删除影响（只需 apply 收多余 config 参不报错）。

### 参考（语义，自研不复刻代码）
- `05-config.zh.md`：插件导出 `Config` schema，装配处给 config，`apply(ctx, config)` 收**经 schema 校验** config；缺省补齐；校验错 → `ValidationError`/fiber FAILED + 响亮报错。
- `vendor/cordis/src/fiber.ts resolveConfig`：无 Config → 原样；有 → `Config['~standard'].validate`。

## 二、设计决策

核心目标：**config = 新的"单一数据源"，旧 SettingsStore 底座复用/改名**；声明入口从 `ctx.settings.define` 收口成
「插件模块级导出 `Config` schema + 装配处给 config + apply 收校验后 config」；"config 变化可监听→就地处理、实时生效"逻辑**不动**。

### 决策 D1：Config schema 放内核（自研，零第三方）
新增 `core/configSchema.ts`：
- 类型：`Primitive = string|number|boolean`；`ConfigField { type:'string'|'number'|'boolean'|'color'|'select'; default:Primitive; label?; group?; min?; max?; options?:string[] }`；`ConfigSchema = Record<string,ConfigField>`。
- 一个字段类型子集帮助函数 `S.string/color/number/boolean/select(...).default().label().min().max()`（链式或纯对象，见实现）。
- `ConfigError`（读消息）+ `resolveConfig(schema, raw): ConfigSchema 校验后对象`：
  - 每个 schema 字段：raw 缺该 key → 用 `default`（缺 default 且无 raw → ConfigError "missing"）；
  - 类型不符 / number 非有限 / select 不在 `options` 枚举 / color 非法 → ConfigError（响亮、带字段名与期望）；
  - number 越界 raw → ConfigError（严格，装配校验错 → FAILED，对齐 cordis ch5）。**运行时面板编辑的 set 仍走 SettingsStore 的越界夹取**（那是实时微调，不进 FAILED）。
  - 返回全量补齐默认后的对象。

### 决策 D2：Config 进内核统一存储 + apply 收校验后 config
- `PluginModule`：加 `Config?: ConfigSchema`；`apply?(ctx, config?: object)`（config 泛型）。
- `runPlugin(mod, ctx, config)`：有 apply 调 `apply(ctx, config)`；setup 仍 `setup(ctx)`（旧插件 apply 单参也不受影响）。
- `Context.plugin(mod, config?)` / `installPlugin(mod, config?)` 收装配 config；`tryActivate` 里：
  1. `fiber.config = resolveConfig(mod.Config, rawConfig)`（无 Config → raw/undefined）；
  2. 校验错 → 走既有 FAILED 路径（fiber.markFailed + 抛 ConfigError，响亮）；
  3. **把 schema 字段声明进 builtinSettings（scope=pluginName）**，作为面板/demo/插件可读可订阅的单一数据源，初值=校验后 config；
  4. `runPlugin(mod, scopeCtx, validatedConfig)`。

### 决策 D3：替换 ctx.settings.define 声明入口（settingsStore 底座保留）
- capabilities 与 types 的 `ctx.settings` **移除 `define`**（声明改由 Config schema 自动完成），保留 `set/get/onChange/groups`（读+订阅"已装配 config"）。
- `SettingsStore` 类不删（config 层内部调它的 define/removeByScope），`settingsStore.test.ts` 不受影响。
- `Context` 在激活声明字段后，把 `removeByScope(pluginName)` 经插件 scope 登记（热卸/重载清，沿用旧语义）。

### 决策 D4：theme-default 迁移成 Config schema 形态
- `export interface Config {...}` + `export const Config: ConfigSchema`（含 group/label/min/max/options，保证面板分组样式与旧一致）。
- `apply(ctx, config)` 收 config，不再 `ctx.settings.define`。
- demo/render 仍读 `ctx.get('settings')`（config 字段自动声明进来）→ 面板 + bindThemeSettings 实时窄更新链路**零改动仍工作**。

### 决策 D5：pluginManager manifest config 走"装配通道"
- `createPluginManager` 装插件改为 `ctx.installPlugin(mod, config)`（把装配 config 在校验通道里消化）；
  去掉装完再 `settings.set` 的后门 `applyConfig`。

### 决策 D6：测试迁移（语义保留，不裸删）
- 新增内核 `configSchema.test.ts`（校验通过/失败/默认补齐/apply 收 config/装配覆盖）。
- `capabilities.test.ts` settings 两用例、`b2SettingsHost.test.ts` 三用例：从「apply 里 ctx.settings.define + onChange('插件名')」
  迁移成「模块级 Config schema + 装配 config + apply(ctx,config) + ctx.settings.onChange 就地」的等价断言（scope 隔离/单源/热卸清/窄更新语义不变）。
- `context.test.ts` 中涉及 runPlugin/apply 的用例：若因 apply 第二参/PluginModule.Config 类型变化需微调，仅做最小类型级迁移，不删语义。

## 三、改动文件清单
- `packages/canvas-core-v2/src/core/configSchema.ts`（新）
- `packages/canvas-core-v2/src/core/types.ts`（PluginModule.Config + apply(ctx,config)；PluginCapabilities.settings 去 define）
- `packages/canvas-core-v2/src/core/capabilities.ts`（settings 段去 define）
- `packages/canvas-core-v2/src/core/Context.ts`（plugin/installPlugin 收 config、tryActivate 校验+声明+传参、runPlugin 传 config）
- `packages/canvas-core-v2/src/core/index.ts`（导出 schema/ConfigError）
- `packages/canvas-core-v2/src/core/__tests__/configSchema.test.ts`（新）+ 迁移 capabilities/b2SettingsHost 的 settings 用例
- `packages/plugins/plugin-theme-default/src/index.ts`（Config schema + apply(ctx,config)）
- `packages/canvas-render/src/host/pluginManager.ts`（config → installPlugin 装配通道）
- 受影响的 canvas-core-v2/render 相关测试与类型若有编译报错则顺带修

## 四、风险与取舍
- **取舍 A**：theme 的实时就地生效由 demo 的 bindThemeSettings（读 SettingsStore.onChange）驱动——保留（config 字段自动进 SettingsStore），
  迁移后该链路语义不变，是"config 变化→就地窄更新"的最省力落地；插件自身是否在 apply 里订阅自有 config 属 P6 扩展，不在本 P4 强求。
- **取舍 B**：装配校验严格（错→FAILED）与运行时 set 夹取并存，二者语义本就不同（装配给错该炸 vs 拖动实时微调该夹）。
- **风险**：改 PluginModule 类型面广，任何 `apply(ctx)` 用法不传 config 不受影响（config 可选）；只删 `ctx.settings.define`，需保证仓库内仅 theme 用了它（已 grep 确认其余 3 插件不用）。
- **风险**：内核 `context.test.ts`/render 测试若引用 settings.define 需一并迁移；逐一跑全量核验。

## 五、实施落地记录（与设计对照）
- D1 ✓ `core/configSchema.ts`：ConfigSchema/ConfigField/ConfigSelectOption + F 便捷助手 + ConfigError + resolveConfig；
  select 选项支持带 label 的 `{value,label}`（optionValues/selectOptionEntry）。**未引任何第三方**。
- D2 ✓ `Context.ts`：`plugin(mod,config?)`/`installPlugin(mod,config?)` 收装配 config 存 `configs` map；
  `tryActivate` 先 `resolveConfig(mod.Config, raw)` → 失败 delete+`fiber.markFailed(err)`+抛 ConfigError；成功 `fiber.config=config`、
  `declareConfigIntoStore` 进 settings、`runPlugin(mod, scopeCtx, config)` 收校验后 config。`runPlugin` 第二参只喂 apply。
- D3 ✓ 能力段/类型 `ctx.settings` 移除 `define`（留 set/get/onChange/groups）；`SettingsStore` 类保留（config 层内部调 define/removeByScope）。
- D4 ✓ theme-default 导出模块级 `Config` schema（7 项，group=连线/连线动效与箭头、label/options 中文），apply(ctx,config)；
  canvas-base 重导出 ConfigSchema/F/InferConfig 等作者类型。
- D5 ✓ pluginManager install/reload/applyManifest 的 config 随 `installPlugin(mod,config)` 装配（删 applyConfig 后门）；reload 重放上次 config。
- D6 ✓ 新增 configSchema.test(8)；capabilities settings 2 用例、b2SettingsHost 3 用例迁移成 Config-schema 声明 + apply(ctx,config) 等价断言。

### 取舍落地
- theme 的"实时就地改连线"仍由 demo 层 bindThemeSettings(读 settings 单一数据源 onChange → 窄更 cfg.edge → 走 edge-visual)驱动；
  内核级"插件自订阅自有 config 就地窄更新"语义由迁移后的 b2SettingsHost/capabilities 用例保持绿。符合"config 变化可监听→就地处理、实时生效、不整图重建"。

### 结果
- 内核 vitest 187（原 179 + config 8）；render vitest 34；内核 tsc 0；canvas-base/render/node-text/image/commands/theme-default typecheck 全 PASS；
  canvas-core-v2 demo vite build 成功(94 模块, dist gitignore)。
- 其余 3 插件与 canvas-base 不受影响（本就不 declare settings；grep 无残留 settings.define 调用）。
