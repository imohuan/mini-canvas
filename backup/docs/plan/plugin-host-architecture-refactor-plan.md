# 插件宿主架构重构 —— 引擎逻辑化 + 插件 DIY + 打包/开发双加载

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：待审核后执行
作者：code-developer

## 一、你要的目标（已对齐）
1. **插件 = 主题 + 业务 + 功能 任意组合**，一套 API 全由插件 DIY，宿主不替插件画 UI。
2. **宿主内嵌 vueflow，但只用它的 hooks/逻辑**（数据、交互、状态），不碰任何 UI 组件。
3. **所有看得见的 UI 由插件提供 vue 组件**：节点外壳/端口/toolbar、连线、画布背景——宿主给"可注册替换的组件槽位"。
4. **插件两种来源都要能跑**：① `pnpm dev` 起的开发脚本（热重载）；② vite lib 打包出的独立 js。为方便直接 index.html 里加载/链接。
5. demo 渲染跑通整条链路。

## 二、现状（读完代码的结论）
- 宿主 `src/demo/host.ts` / `CanvasDemo.vue` 是"装配点 + UI 渲染者"：`BaseNode.vue` 把标题/端口(MovingHandle)/toolbar/卡片 外壳**全写在宿主组件里**；插件只往 registry 塞"content 段"。
- `nodeRegistry.ts` 只有 content/title/top-toolbar/bottom-toolbar 四段，**没有** node-shell/edge/background 这种"换整套 UI"的槽位。
- text/image 插件 = `PluginModule`（逻辑） + content .vue（UI），demo 直接 `import`。**没有**独立 pnpm dev、没有打包 js、没有"运行时加载外部 URL 插件"。
- `Context` 已有 installPlugin/uninstallPlugin/reloadPlugin（动态装载地基），`createMiniCanvasHost` 是门面。

## 三、目标架构
```
宿主(引擎，无 UI，只用 vueflow hooks/逻辑)
 ├─ 数据: nodeStore/edges/selection/history/command
 ├─ 插件系统: install/uninstall/reload/list
 └─ 给插件 ctx 暴露: vueflow hooks 能力 + 注册 API

插件层(任意组合，一套 API DIY)
 ├─ 主题插件: 注册 node-shell / edge / background 组件(整套 UI)
 ├─ 业务/节点插件(A): 注册 node-content/<type>(中间内容)
 └─ 功能插件(B): 占宿主给的一块区块，自渲染(可自嵌画布)
```

### UI 槽位（宿主定契约，插件注册 vue 组件顶替，默认实现在"默认主题插件"里）
| 槽位 | 内容 | 谁注册 |
|---|---|---|
| `node-shell` | 节点外壳(卡片/标题/端口 Handle/toolbar) | 主题插件 |
| `node-content/<type>` | 某类节点的中间内容 | A 类节点插件 |
| `edge` | 连线渲染(各状态) | 主题插件 |
| `background` | 画布背景 | 主题插件 |
| `toolbar`/`panel` | 宿主工具栏/侧栏区块 | B 类功能插件 |

## 四、两条加载链路（本轮要跑通的）
1. **开发态**：插件包 `pnpm dev` 起一个 vite，吐 dev 入口 URL；宿主(index.html)动态 `import(url)` 该入口，拿到 PluginModule → `installPlugin`；插件自己带 HMR(改码→reloadPlugin)。改动在宿主侧无感、插件包内热更。
2. **生产态**：插件包 `pnpm build`(vite lib 模式)打成独立 js；宿主 index.html 里 `<script>` 或动态 import 该 js → installPlugin。

## 五、执行步骤（每步原子 commit + 验证）
- [ ] S1 摸清 vueflow 自定义 node/edge/background 组件契约(用已装 @vue-flow/core 实读类型/文档)
- [ ] S2 引擎去 UI：把"节点外壳/端口/toolbar/边/背景"从宿主抽成"槽位注册"，引擎只留数据+hooks+注册表
- [ ] S3 定义统一插件注册 API(set of register*：registerNodeShell/registerEdge/registerBackground/registerNodeContent)
- [ ] S4 默认主题插件(plugin-theme-default)：用 vue 组件实现 node-shell(含 Handle 端口)/edge/background
- [ ] S5 text/image 改回"只注册 node-content"，去掉它们自己画外壳的部分
- [ ] S6 插件包接 pnpm dev(lib 入口)+ pnpm build(lib 打包 js)
- [ ] S7 宿主/加载器：支持从 URL 动态 import 插件(dev url / built js)
- [ ] S8 demo/index.html：同时用"dev 链接"和"打包 js"两种方式加载插件，跑通渲染 + 热重载
- [ ] S9 全量测试回归 + tsc 三包干净

## 六、验证命令
```bash
# 插件 dev
cd packages/plugins/plugin-node-text && pnpm dev     # 吐 dev 入口
# 插件 build
cd packages/plugins/plugin-node-text && pnpm build   # 打独立 js
# 宿主 demo
cd packages/canvas-core-v2 && node ./node_modules/vite/bin/vite.js   # index.html 双加载渲染
# 测试
cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run
node ./node_modules/typescript/bin/tsc --noEmit
```

## 七、风险/注意
- vueflow Handle 必须真实渲染在节点 DOM 才能连线 → 节点外壳组件(主题插件提供)里必须放 vueflow 的 Handle，主题插件要会写 vueflow 节点组件。
- vue 单例问题：插件(dev/build)与宿主若各带一份 vue，组件/依赖会冲突 → 打包用 external vue(由宿主提供) 或用同一份依赖；dev 态靠 vite 去重。
- text/image 现在的"宿主画外壳"是大改，先跑通 S8 双加载主链路，再动外壳(主题插件)这块，避免一步推倒。
- 内核 tsc include 要能连带检查到插件 source 的 import.meta.hot(vite/client 引用放 index.ts 顶部，已有)。
