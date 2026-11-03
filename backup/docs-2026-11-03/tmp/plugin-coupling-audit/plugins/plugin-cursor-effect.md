# plugin-cursor-effect

## 一句话

光标指针、跟随拖尾与点击粒子特效。它只挂 `overlay` 槽和设置页，插件间耦合很轻；主要粘连是 document 级指针监听、全屏 canvas、自定义光标写 `documentElement` 样式，以及本机 `localStorage` 的素材存储。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-cursor-effect` | 插件名 `cursor-effect` |
| 身份 | installable（未声明 `builtin`） |
| 源码 / 测试 | 11 个生产源文件 / 3 个测试文件（全包 47 个文件，含大量静态资源） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `ConfigSchema`、`InferConfig`、`Context`、`PluginModule` | 是 | `src/catalog.ts:13`；`src/index.ts:19` |
| canvas-render | `useCanvasRender` | 是 | `src/CursorEffectOverlay.vue:20`；`src/useCursorSettings.ts:8` |
| 其他插件 | 无 | — | — |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `overlay` 槽 | 全屏特效层 | 契约 | `src/index.ts:40-45` |
| `settingsNav` + `settingsGroup/光标` | 设置页 | 契约（两个 id 同名） | `src/index.ts:48-59`；`src/catalog.ts:16` |
| `settings` | 读 `cursorFx*` 配置、订阅变更 | 可选（缺则全默认） | `src/catalog.ts:209-239`；`src/CursorEffectOverlay.vue:75-76`；`src/useCursorSettings.ts:20-33` |
| `settings.set` | 设置页写回；缺服务时静默不写 | 可选（`store?.set`） | `src/useCursorSettings.ts:32-34` |
| `localStorage` 自定义素材 | 图片/SVG/帧序列 | 插件私有存储 | `src/customCursors.ts:24,37-93` |
| `window CUSTOM_CHANGED_EVENT` | 设置页改素材 → overlay 重读 | 中：跨组件 window 事件 | 发出 `src/customCursors.ts:26,80,88,91`；监听 `src/CursorEffectOverlay.vue:449` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document pointermove/pointerdown/dblclick/pointerout` | 触发跟随与点击特效 | 高：document 捕获监听，全页面生效 | `src/CursorEffectOverlay.vue:411-427` |
| `window resize` / `devicePixelRatio` / `innerWidth/Height` | 全屏 canvas 尺寸 | 中：全屏覆盖，DPR 变化需重算 | `src/CursorEffectOverlay.vue:429-441,461` |
| `document.documentElement.classList.add('mc-cursor-hidden')` | 隐藏原生光标 | 中：全局类；卸载时移除 | `src/CursorEffectOverlay.vue:43,346-366,471-473` |
| `--mc-cursor` CSS 变量 | 自定义光标 | 中：全局变量名，可能与其它插件冲突 | `src/CursorEffectOverlay.vue:352,359,362-364` |
| `localStorage['mc-cursor-effect:custom-cursors']` | 自定义素材（data URL） | 中：插件私有，但跨设备不同步；配额满会降级 | `src/customCursors.ts:24,76-93` |
| `requestAnimationFrame` / `setInterval` | 粒子循环、帧动画 | 中：页面隐藏时是否暂停未看到 | `src/CursorEffectOverlay.vue:316,458` |
| `.vue-flow__node` / `button` | hover 放大判定 | 中：VueFlow/宿主 DOM 类名 | `src/CursorEffectOverlay.vue:375` |
| `Teleport to="body"` | 特效层压过所有浮层 | 中：绕过画布容器裁剪与层叠 | `src/CursorEffectOverlay.vue:479-492` |
| `z-index: 2147483000` | 顶层覆盖 | 中：极高值，可能盖住系统级浮层 | `src/CursorEffectOverlay.vue:496` |

## 内部职责与风险

1. **引擎与 UI 分开**：粒子配方/推进/图标在 `engine.ts` 纯函数，Node 可测（`src/__tests__/engine.test.ts`）；组件只管 DOM、动画和设置接线。
2. **设置页 `mode:'replace'` 自绘整页**：与主题设置页是两种实现；主题换皮后仍应工作，但样式大量用 `var(--ui-* , fallback)`，与设计 token 有重复定义。
3. **document 捕获监听常驻**：只要插件启用，就对全页面 pointer 事件做处理；监听是 passive，但仍会影响输入法/浮层交互，且与多选、框选、edge-cutting 的捕获监听存在竞争。
4. **全局光标样式**：写 `documentElement` 的类和 CSS 变量；卸载时清理，但若同一页面有另一个插件也写 `--mc-cursor`，会互相覆盖。
5. **自定义素材只在本机**：放 `localStorage` 是为了不撑爆 settings/云端 KV；代价是换机器/清缓存后素材丢失，只把“当前 id”存进 settings，可能出现“选中了但素材不在”的悬空引用（组件会回落第一个/默认光标，`src/CursorEffectOverlay.vue:55-59`）。
6. **存储不可用有内存兜底**：`ls()` 探测失败/配额满返回 warning，不抛错（`src/customCursors.ts:37-93`），这是做得好的降级。
7. **测试只覆盖数据层**：3 个测试文件覆盖 catalog/engine/customCursors，没有组件级“监听挂载/卸载/全局样式恢复”的测试。

## 单独装卸判断

- 不装：无特效，其它功能不变。
- 卸载：overlay 条目、document 监听、window resize、自定义事件监听、documentElement 类和变量都应在 `onBeforeUnmount` 清理（`src/CursorEffectOverlay.vue:463-475`）。
- 只装插件、不装 settings：overlay 仍显示默认特效；设置页能打开，但写入被 `store?.set` 静默吞掉（无报错、无提示）。
- 多画布/多实例：`overlay` 每个画布宿主各一份；document 监听会叠加，需确认是否去重。

## 建议改法

1. **最小改动**：把 `--mc-cursor`、`mc-cursor-hidden` 加插件前缀并集中到一处常量；卸载时只在值仍属于自己时移除，避免覆盖其它插件。
2. **事件收口**：把 `CUSTOM_CHANGED_EVENT` 改成 `ctx.emit/ctx.on` 或注册场（`Context` 本身有 `emit/on`，设置页需从渲染上下文取 `ctx`），去掉 window 字符串事件；同时让设置页与 overlay 不依赖全局事件名。
3. **性能与生命周期**：页面隐藏时暂停 rAF/interval；document 监听改为按需启用（设置关闭即 detach），降低常驻开销。
4. **测试补边界**：补“卸载后 documentElement 类/变量恢复”“存储不可用时仍能选中并显示”“设置页改 fps 后 overlay 立即重读”三条组件/接线测试。
5. **悬空引用提示**：自定义 id 在素材列表里找不到时，设置页给出可见提示，而不是静默回落。

## 待验证

- `Teleport to="body"` + `z-index 2147483000` 是否会盖住宿主模态/系统弹窗；未做真机层叠验证。
- 多画布同时挂两个 overlay 时，document 监听是否重复注册；组件内只有 `attached` 布尔，未按实例隔离。
- 自定义素材在 localStorage 配额满时的体验；代码有 warning，但设置页是否展示未核。

