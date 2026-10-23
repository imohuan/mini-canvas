# plugin-auto-layout

## 一句话

整图自动布局（dagre + 分组收拢）与 F/R 键聚焦、适应视图。算法独立，但与 group 插件共享节点类型名和一组设置键。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-auto-layout |
| 身份 | installable |
| 源码文件 | 8 个（plugin / config / types / engine / hierarchy / bounds / focus / index） |
| 测试文件 | 6 个，33 个用例 |
| 包依赖的其他插件 | 无（package.json 只有 canvas-base / canvas-data / dagre） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule / ConfigSchema / InferConfig / resolveConfig | 是 | src/autoLayoutPlugin.ts:23-24 |
| canvas-data | 类型 DocService / SelectionService / CanvasNode | 是 | 同上:25 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合，但存在 L2 级“数据形状契约”。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get | 必需 | src/autoLayoutPlugin.ts:34、116 |
| selection | inject + get | 必需 | 同上:34、117 |
| nodeLayout | inject + get | 必需 | 同上:34、118 |
| viewport | inject + get | 必需 | 同上:34、119 |
| settings | tryGet，每次命令现读 | 可选 | 同上:124-148 |
| 命令 | mod+l / f / r | — | 同上:301-324 |

三条隐式跨插件契约：

1. 节点类型名 group 写死在本包（src/autoLayoutPlugin.ts:31、src/groupHierarchy.ts:48、57、75）。plugin-group 的 groupEngine.ts:22 也定义同一字符串。两边没有共享常量，任一改名字就会把分组当普通节点布局。
2. 组尺寸字段写 size，并依赖 nodeStore 自动镜像 data.cardWidth/cardHeight（src/autoLayoutPlugin.ts:253-265 注释与代码）。这与 plugin-group 的 groupSizePatch 是同一套字段约定（packages/plugins/plugin-group/src/groupPlugin.ts:231-237）。
3. 布局后不调用 group 服务的 recalculateBounds，而是自己算 groupFrames 并直接 updateNodes（src/autoLayoutPlugin.ts:250-277）。plugin-group 导出了 recalculateBounds 并在注释里写明“供 auto-layout 布局后调用收拢”（groupPlugin.ts:108-112），但实际调用方为零。这是双向文档契约与实际实现的漂移：auto-layout 绕开了 group 服务，group 服务的这个 API 成了死接口。

设置键也有跨插件重叠：auto-layout 的 direction / debug / intraSpacing* / interSpacing* 是全局平面命名（src/autoLayoutPlugin.ts:44-98），align-arrange 的字段刻意加前缀避让（packages/plugins/plugin-align-arrange/src/alignArrangePlugin.ts:44-45）。debug 是裸键，若未来别的插件也声明 debug，先声明者保留，后声明者的这一项会被跳过（canvas-data capabilityLayer.ts:94-117，仅 dev 下 warn）；插件本身仍能装配，只是那个设置项不生效。

F/R 键与 plugin-node-3d-preview 的 f/r 命令同键（packages/plugins/plugin-node-3d-preview/src/node3dPreviewPlugin.ts:122-143）。内核按 order 小的赢、when 不满足则让位（packages/kernel/src/command.ts:215-251），3D 插件 order 为 5（node3dPreviewPlugin.ts:79），auto-layout 为 20/30（autoLayoutPlugin.ts:313、321），所以选中 3D 节点时 3D 赢，其余情况 auto-layout 赢。这是一套可用但依赖数值的隐式优先级。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| document.querySelector('.vue-flow') | viewport.getRootEl 缺失时的兜底 | 中，多画布会取到第一个 | src/autoLayoutPlugin.ts:181 |
| console.log | 诊断日志 | 低，受 debug 开关 | 同上:245、280 |
| 无定时器 / 无 localStorage | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

引擎层（layoutEngine 443 行、groupHierarchy 321 行）承担了布局、分组树、跨簇合并；插件入口承担设置读取、视口聚焦、命令注册。分层合理。真正的风险是它复制了 group 的几何职责：组收拢的坐标换算、padding 语义、size 字段都在本包又实现了一遍（src/groupBounds.ts、groupHierarchy.ts）。两份实现今天数值一致（测试 groupBounds.test.ts:42-52 断言了非对称 padding 的结果，但并没有跨包读取 plugin-group 的 Config），而且 src/groupBounds.ts:6-9 的注释自己承认“两边 key 必须同步改”。没有任何机制阻止它们漂移。

## 单独装卸判断

可独立装卸，装不装 group 都能跑（注释 src/autoLayoutPlugin.ts:13-14 明确说无 group 服务也能工作）。但不装 group 时，group 类型节点若来自旧存档，会被当成普通节点参与布局，视觉上分组会散开。反过来卸载 auto-layout 不影响 group。

## 建议改法

1. 最小改动：把 group 节点类型名与 padding 键收进 canvas-data 或 canvas-base 的公开常量，两个插件共同引用，消掉 src/groupBounds.ts:17-26 的复制。
2. 让布局后的组收拢改为可选调用 group 服务的 recalculateBounds（存在则用，不存在回落本包实现），把死接口激活或删掉。
3. 验证：补一条“auto-layout + group 同时装配”的宿主级测试，断言布局后 group 的 parentId / 相对坐标 / size 三者一致；现有测试只覆盖纯引擎与设置生效。

## 待验证

- 已确认 groupBounds.test.ts:42-52 只验证本包 calculateGroupFrameFromAbsoluteChildren 的非对称 padding 结果，标题里的“与 plugin-group 同 key 同默认值”并未跨包读取 group 的 Config；两边一致性没有真正的守护测试。
- debug 裸键目前是否有第二个声明者；rg 未发现，但动态插件可能运行期声明。

