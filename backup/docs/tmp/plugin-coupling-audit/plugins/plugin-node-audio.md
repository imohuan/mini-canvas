# plugin-node-audio

## 一句话

音频节点是一个比较干净的独立件：只依赖内核与渲染层，按钮走主题的 UI 目录按名取，设置键带 `audio` 前缀。它没有底栏动作，也没有直接引用其它插件；主要风险是把波形、解码、播放、手势全部放在一个内容组件和播放器里。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-audio` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 14 个实现文件 |
| 测试文件 | 10 个 |
| 包依赖的其他插件 | 无运行依赖；`@mini-canvas/plugin-theme-default` 只在 devDependencies 供渲染测试（`package.json:34-37`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | `Service / PluginModule / bindTypeDefaultSize` | 是 | `src/nodeAudioPlugin.ts:22` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeAudioPlugin.ts:23` |
| `@mini-canvas/canvas-render` | 渲染上下文、选中态、UI 目录 | 是 | `src/AudioContent.vue:23`，`src/AudioTopToolbar.vue:19` |
| `@mini-canvas/kernel` | 无直接 import | — | 无命中 |
| 其它插件 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeAudioPlugin.ts:62-63` |
| `audio` 服务 | 本插件上架，只提供 `addAudioNode` | 硬（本包） | `src/nodeAudioPlugin.ts:36-59` |
| `ui` 目录 | 注册 `audioPreview`；顶栏按名取 `button` | 契约 | `src/nodeAudioPlugin.ts:112-114`，`src/AudioTopToolbar.vue:25-27` |
| `settings` | 读 `audioWaveHeight / audioBarMinWidth`，订阅变化 | 可选（缺则回落） | `src/AudioContent.vue:61-99`，`src/nodeAudioPlugin.ts:87-96` |
| `out:top` 段 | 上传按钮挂上控制栏 | 契约 | `src/nodeAudioPlugin.ts:128-130` |
| `command` | 上传/下载/重析三条命令 | 契约 | `src/nodeAudioPlugin.ts:142-168` |
| 底栏 / 其它节点插件 | 无 | — | 无命中 |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document.createElement('input'/'a')` | 选音频文件、下载 | 低：上传动作自身职责 | `src/audioTransform.ts:82-92,107-121` |
| `fetch` | 音频 HEAD、Range 读取、解码 | 中：依赖可访问地址与 Range 支持 | `src/AudioPreview.vue:57-60`，`src/audioSource.ts:42-60`，`src/audioTransform.ts:42` |
| `requestAnimationFrame` | 播放进度、边缘滚动、尺寸测量 | 低：卸载时取消 | `src/AudioWavePlayer.vue:231-237,536-540,571` |
| `setTimeout` | 拖拽 seek 空闲提交 | 低：有清理 | `src/AudioWavePlayer.vue:460` |
| `localStorage` | 无直接使用；注释强调不把音频写进去 | 低 | `src/audioOps.ts:197`，`src/audioTransform.ts:131` |
| 固定 URL / 固定存储键 | 无 | — | 无命中 |

## 内部职责与风险

1. **一个播放器承担波形、交互、播放、可访问性**：`AudioWavePlayer.vue` 814 行，包含进度、拖拽 seek、边缘滚动、键盘操作、波形画布。它明确声明“不读节点数据、不碰插件服务”（`src/AudioWavePlayer.vue:9`），这是好边界；但文件本身仍然很大。
2. **内容组件承担设置读取与元数据同步**：`AudioContent.vue` 262 行，读 settings、写元数据、装配播放器。设置键带前缀（`src/nodeAudioPlugin.ts:72-74`），不会与其它插件撞名。
3. **没有底栏动作**：音频生成动作由 `plugin-web2api-tools` 等工具插件发布（见 `plugin-web2api-tools.md:4-8` 的结论），音频节点只提供落点。这个分工是清晰的。
4. **测试覆盖播放与渲染，缺少跨插件目录契约**：`src/__tests__/audioToolbarRender.test.ts` 装载真实主题并从 `ui` 目录取件（`src/__tests__/audioToolbarRender.test.ts:27-43`），这是本组里少见的“真实跨插件”测试。设置项也有 smoke（`src/__tests__/nodeAudioSmoke.test.ts:145-149`）。
5. **服务面很窄**：只暴露 `addAudioNode`，其它协作走 `doc`（`src/nodeAudioPlugin.ts:32-39`）。这降低了耦合，但也意味着别的插件无法通过服务触发“上传/重析”，只能走命令或直接写数据。

## 单独装卸判断

- **单独装音频、不装主题**：节点可显示，但顶栏上传按钮取不到 `button`，会缺一个入口；命令仍可调用上传。`audioPreview` 也只是登记，没有消费方就不显示。
- **单独装音频、不装底栏**：完全正常；本包不依赖底栏。
- **单独卸音频**：`audio` 服务、节点类型、UI 目录项、命令随 scope 回收；没有跨插件动作需要摘除。
- **只装主题、不装音频**：主题里的 `audioPreview` 消费方取不到件，需按名取的地方自行兜底（不在本包）。

## 建议改法

1. **最小改动：把 `AudioWavePlayer.vue` 的纯手势/命中逻辑再抽一层。** 现在 814 行里混了 DOM 测量、指针、键盘、画布绘制；抽成 `audioWaveGeometry.ts` 后可单测，渲染组件只做装配。验证：现有 `audioGestures.test.ts`、`audioSeekAndProgress.test.ts` 不改行为。
2. **给 `ui` 目录名加契约测试。** 本包消费 `button`，生产在主题；加一条“装载真实主题后 `top('button')` 存在”的断言，避免主题改名后音频顶栏静默缺按钮。
3. **是否给 `audio` 服务补上传入口，需要产品决策。** 当前只暴露建节点；若其它插件要“把一段音频塞进现有节点”，会直接写 `doc`，绕过本包的元数据/波形规范化。
4. **统一媒体预览。** 音频预览目前是节点内的 `AudioWavePlayer`，底栏的 `MediaViewer` 也有音频分支；两者交互不一致，可考虑让底栏预览复用同一个播放器内核。

## 待验证

- 只装音频、不装主题时顶栏的 `warn` 行为是否会让用户看到空按钮还是整段消失；`useUiComponent` 的实现不在本包。
- 音频波形缓存 `PeakCache` 在节点卸载后是否释放；`peakCache.ts` 只有 56 行，未逐行核对生命周期。
- 底栏/媒体预览的音频分支与本包播放器是否会出现两套进度状态；未做真机对照。
