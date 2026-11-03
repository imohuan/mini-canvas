# plugin-shortcut-manager

## 一句话

快捷键帮助面板 + 行内重映射 + 导出导入。数据源是命令注册表的 keys 字段，自己只补持久化与 UI。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-shortcut-manager |
| 身份 | 未声明 miniCanvas 字段（成品应用不装，见 packages/ui/src/assembly.ts:54-55 注释） |
| 源码文件 | 8 个（plugin / manager / remap / groups / labels / 3 个 .vue） |
| 测试文件 | 4 个，30 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule | 是 | src/shortcutManagerPlugin.ts:19 |
| kernel | 类型 CommandService | 是（包直接依赖 kernel） | src/v2ShortcutManager.ts:13 |
| canvas-render | useCanvasRender（组件内） | 是 | src/RemapPanel.vue:16、src/ShortcutHelpPanel.vue |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| command | get，list/has/remapKeys/resetKeys/isRemapped | 必需 | src/shortcutManagerPlugin.ts:33；src/v2ShortcutManager.ts:7-9 |
| save | tryGet，get/set/onAdapterChange | 可选 | src/shortcutManagerPlugin.ts:32；src/shortcutRemapEngine.ts:26-38 |
| shortcut-manager 服务 | ctx.inject，reactive { visible } + manager 方法 | 对外提供 | src/shortcutManagerPlugin.ts:49-51 |
| shortcut-remap 服务 | ctx.inject，remapEngine | 对外提供 | 同上:74 |
| overlay 槽 | slots.register('overlay', order 200) | 宿主需渲染 overlay | 同上:54-59 |
| 命令 | mod+/ | — | 同上:62-71 |
| 固定 save 域 | type='shortcut'，key='keys' | — | src/shortcutRemapEngine.ts:15、58、90、99 |

这是本组里运行时协作面最宽的插件，但它依赖的都是公开服务，符合 L2 契约。

跨插件风险有三条：

1. 分组靠标题关键词猜。v2GroupOf 用 title 里是否含“搜索/聚焦/小地图/撤销/复制…”来归类（src/v2ShortcutManager.ts:47-67）。新增插件若起名不含这些词，会落进 plugin 组；改名则组别漂移。这是把中文文案当契约。
2. 命令 order 被当作冲突优先级。findV2Conflicts 按 order 排序并标记 resolved（src/v2ShortcutManager.ts:31-36、108-130），但内核真实分发规则是 order 小的赢、when 不满足则让位（packages/kernel/src/command.ts:215-251）。面板显示的“已解决冲突”可能和实际命中不一致，尤其同 order 时内核回落注册顺序、面板按 title 排序。
3. 持久化写死 save type='shortcut' 与 key='keys'。云插件切后端时靠 onAdapterChange('shortcut') 重读（src/shortcutRemapEngine.ts:26-38、77-83）。这要求云插件必须使用同一个 type 字符串；目前 rg 未见其它插件写 'shortcut'，但这是字符串契约，改一处就静默失效。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| window keydown/keyup/blur（捕获） | 录制新键位 | 中，全局监听 | src/RemapPanel.vue:224-226 |
| setTimeout 1300ms | 纯修饰键长按兜底 | 低，卸载清理 | 同上:54、137-141、231 |
| document keydown | Escape 关闭帮助面板 | 中 | src/ShortcutHelpPanel.vue:248-249 |
| document.createElement('a'/'input') | 导出/导入键位 JSON | 低 | 同上:210-218 |
| SYSTEM_RESERVED_KEYS | 浏览器保留键提示 | 低，硬编码清单 | 同上:58-63 |

RemapPanel 的捕获监听在 window 捕获阶段吞掉所有按键（src/RemapPanel.vue:144-163、224-226），只在 listening 为 true 时处理。若组件异常卸载未移除监听，会长期吞键；onBeforeUnmount 有清理（:230-237），但异常路径无兜底。

## 内部职责与风险

职责分得清楚：v2ShortcutManager 是纯逻辑适配器，shortcutRemapEngine 负责持久化，三个 .vue 负责展示与录制。问题在 ShortcutHelpPanel 784 行，承担了列表、搜索、分组、冲突提示、导出导入、面板定位。它读取的命令描述表是另一份硬编码文案（src/ShortcutHelpPanel.vue:71-90），与命令 title 可能漂移。

测试覆盖纯逻辑 30 例，没有覆盖 RemapPanel 的真实按键录制与 window 监听清理。

## 单独装卸判断

可独立装卸。不装时命令 keys 仍由 CanvasHost 分发，只是没有帮助面板与重映射 UI。成品 UI 明确不装它，改用自带快捷键面板（packages/ui/src/assembly.ts:54-55；packages/ui/src/__tests__/entrypoint.test.ts:54-55）。因此它与宿主自带面板存在职责重叠：本包用 mod+/ 打开插件面板，宿主面板由 DockArea 的“快捷键”按钮打开（packages/ui/src/components/areas/DockArea.vue:178-180、packages/ui/src/composables/ui.ts:2078-2080），两者入口不同但内容重叠，同时启用会出现两套快捷键列表。

这里还有一条反向依赖：成品宿主虽然不装本插件，却直接 import 本包导出的纯函数 buildV2HelpList / groupV2HelpList / keyPartsToLabels（packages/ui/src/composables/ui.ts:11；包的公开出口 packages/plugins/plugin-shortcut-manager/src/index.ts:14、15-22）。也就是说本包同时是“可装卸插件”和“宿主 UI 工具库”两种身份。公开出口是 index.ts，按判据不算 L3，但它让宿主在运行期依赖一个不装配的插件包；删包或改这些函数签名会直接弄坏宿主快捷键面板。构建侧也把它列为依赖（packages/ui/vite.config.ts:65、packages/ui/package.json:58）。

## 建议改法

1. 最小改动：v2GroupOf 改为读命令显式声明的 group/areas，删掉按中文标题猜分组。
2. 冲突提示与内核分发对齐：用 findCommandByKeys 的同一套 order/when 规则计算“实际赢家”，不要只按 order 排序。
3. 验证：补一条“同一键位两条命令、order 相同”的面板显示与内核实际命中的一致性测试。
4. 中期：把 buildV2HelpList / keyPartsToLabels 这类纯展示工具迁到 canvas-base 或独立 utils 包，让本包只剩插件本体；宿主不再依赖一个不安装的插件。

## 待验证

- 宿主自带快捷键面板与插件版是否真的同时可达；本次只看到测试注释说明“不装插件版”，未查宿主面板的入口条件。
- 'shortcut' save 域的云端适配器是否使用同一 type 字符串；需查 plugin-cloud-client。

