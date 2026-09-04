# 快捷键刷新丢、通用设置不丢 —— 问题分析

日期：2026-09-04 · 仓库：mini-canvas（packages/canvas-core）· 状态：分析定稿（未修）

## 一、现象
- **快捷键重映射刷新后丢失**。
- **通用设置刷新后不丢**。

## 二、背景：两套配置存储链路的本质区别

| | 通用设置（zoom 范围、布局、面板项） | 快捷键重映射 |
|---|---|---|
| 落盘触发 | `canvas.state` 整体由 `useStorage('canvas-state', state, localStorage)` 深度绑定，**改即写穿 localStorage**（`useCanvasStore.ts:223`） | 只在 **Canvas.onUnmounted** 一次性写回 state（`Canvas.vue:644`） |
| 编辑目标 | 直接改 `canvas.state.core.*` 响应式对象 → 立刻持久化 | UI 只调用 **ShortcutManager 内存单例** `manager.remap()`（`RemapPanel.vue:210`），单例内部 registry 变化**不碰 state** |
| 数据方向 | 双向绑定，改哪都同步 | 单向：`state → manager`（mount 时 loadKeymap）；`manager → state`（unmount 时 exportKeymap） |

## 三、根因
快捷键 UI 的全部操作（重映射/录制/重置）只作用于**内存单例 `ShortcutManager`**；唯一把结果写回 `state.core.shortcutKeymap`（从而触发 `useStorage` 落盘）的地方是 **Canvas.vue 的 `onUnmounted`**（`Canvas.vue:636-644`）。

**刷新是"页面被杀"，不保证走完组件卸载生命周期** → `onUnmounted` 经常不执行 → 内存里的新映射从未写回 state → localStorage 里的 `shortcutKeymap` 仍是旧值 → 刷新后 `loadKeymap(state.shortcutKeymap)`（`Canvas.vue:610`）加载回旧值 → 快捷键"丢"。

通用设置因为是"改即写穿"，与卸载生命周期无关，所以刷新不丢。

## 四、附带隐患
`exportKeymap()`（`ShortcutManager.ts:361-370`）**只导出与默认键位不同的"脏映射"**。这意味着：
1. 一旦某次漏写（如上），丢失的不仅是重映射值，而是整份"与默认不同"的记录。
2. `loadKeymap` 只恢复脏映射，未动过的保持注册默认值——设计本身没错，但**依赖"导出-落盘-再导入"闭环成立**；闭环任一环（尤其卸载写回）断了就丢。

## 五、修法思路
核心目标：**摆脱"依赖 onUnmounted 才落盘"**，让快捷键改动像通用设置一样"改即持久化"，且可插拔。

候选：
1. **写穿监听（最小改动）**：给 `ShortcutManager` 的重映射动作（remap/reset/loadKeymap）加一个"变更回调/事件"，Canvas 订阅后立刻 `canvas.state.core.shortcutKeymap = mgr.exportKeymap()` → 触发 `useStorage` 写穿，不再等卸载。保留 onUnmounted 作为兜底。
2. **直接从单例读回初始化**：mount 时不是只 `loadKeymap(state)`，而是以 state 为种子、以单例当前态为准，避免状态回退。
3. **解耦持久化载体（与架构演进合并）**：把快捷键/设置的"存储"抽象成可替换模块（呼应"默认保存 vs 云端同步 可插拔"的更大诉求），当前先解决"落盘时机"。

## 六、验证方法
1. Chrome 实测：重映射一个快捷键（如把"保存"改成 `ctrl+shift+s`）→ **不刷新**，先直接 `localStorage` 查 `canvas-state` 里 `shortcutKeymap` 是否已含新值（改即写穿应已写入，而不是等卸载）。
2. **刷新页面** → 打开快捷键面板，确认改动仍在。
3. 回归：恢复默认、录制冲突提示、VueFlow 系统键位（缩放/平移）仍正常。
4. 对照：通用设置（zoom 范围）刷新仍在（对照组，防改动破坏现有写穿链路）。

## 关联
用户同时提出更大诉求：把"保存"（快捷键/设置/画布/资源）做成 **Cordis 式可插拔模块系统**——默认保存插件与云端同步插件各管一套、互不干扰。本快捷键问题是其中"落盘时机"的一环，可并入该架构一并设计。
