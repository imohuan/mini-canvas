# Standards 轴 code review — commit 2e0ce0e

审查范围：只评「代码是否符合仓库既有规范/约定」，不含功能对错（功能对错归 Spec 轴）。
对照：keys.ts/index.ts 既有 key 写法、CanvasSurface.vue、createMiniCanvasHost.ts、viewportService.ts、CanvasHost.vue 其它生命周期/回收段落。

## 总评
整体风格对齐得很好——keys 注册与导出、onBeforeUnmount 回收、中文注释分节、prop 文档化都与仓库一致，无破坏测试/契约。仅几处「复用既有抽象」的轻度不一致可打磨。

## 问题清单
1. **[L] `ViewportState` 类型重复内联，未复用既有 canonical 类型**
   viewportService.ts 已导出 `interface ViewportState { x; y; zoom }`，本 commit 在 CanvasHost.vue:300/:314/:945 三处重复写 `{ x: number; y: number; zoom: number }`。建议 import 后统一用，避免语义漂移。

2. **[L] 同一视口读了两条路：`h.viewport`(服务) 与 `surfaceRef.getViewport`(原始暴露) 混用**
   恢复路径走 `h.viewport.getViewport()`，落盘路径 `persistViewport()` 却绕过服务直接 `surface?.getViewport?.()`。底层同源无 bug，但 viewportService.ts 头注释主张「VueFlow 能力统一经 viewport 服务收敛」，宿主应统一走服务。

3. **[L] `persistViewport=false` 时 watch 永不自我解除**
   watch 首行提前 return（在 self-stop 前），持久化关闭时每次触发都早退不停止，只能靠 onBeforeUnmount 兜底。资源整洁度问题。

4. **[L] 内联魔法阈值 `0.5` / `0.0001` 无注释**
   fitViewFirstRun 的 moved 判断用硬编码像素/缩放精度，仓库首见写法，建议补一句注释说明阈值语义。

## 亮点
- GRAPH_VIEWPORT_KEY 与兄弟 key 同构（kebab 裸 key + type='canvas' + 中文 JSDoc），正确补进 index.ts barrel。
- 生命周期配对完整：onBeforeUnmount 补 stopViewportRestore?.() + clearTimeout 全部 viewportTimers，无泄漏。
- 注释分节与 prop 三行文档风格对齐文件其余部分。
- 未改任何测试，不触碰 Do-not-change-tests 守则；改动最小化集中在 3 个归属清晰文件。
- 落盘只 save.set 靠既有防抖 flush，完全符合仓库存储语义。
