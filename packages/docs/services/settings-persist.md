# `settingsPersist` · 配置落盘桥

**一句话定位**：**`settingsPersist` 是"设置"和"存储"之间的一座桥—— 用户在设置面板改的每一项，都由它负责记住；下次打开画布，也是它把记着的东西放回去。**

**它属于哪一档**：**画布基础**。由基础插件 `canvas-base` 建好并注入（源码：`packages/canvas-data/src/settingsPersist.ts`；装桥的代码在 `packages/canvas-data/src/canvas/canvasBasePlugin.ts`）。它**有条件缺席**：

- 宿主显式关掉持久化（`createMiniCanvasHost({ persistSettings: false })`）时，桥不建，`ctx.get('settingsPersist')` 是 `undefined`；
- 纯内核 ctx（没装画布能力层、拿不到 `ctx.get('settings')`）时也会跳过——不静默造假服务。

## 用法

### 它是"宿主/维护者用的服务"，插件一般不碰

源码注释写得很直白："桥的只读接口（宿主 `ctx.get('settingsPersist')` 可拿；插件一般不需要）"。

- **插件作者**：什么都不用做。模块级导出 `Config` schema 声明可配置项，运行期改值——桥自动接管持久化。
- **宿主/维护者**：负责在"插件装载完成之后"调用一次 `restore()`（画布宿主就是这么干的），并在停止画布时 `dispose()`。

### 方法逐个看

签名逐字来自 `packages/canvas-data/src/settingsPersist.ts` 的 `SettingsPersistService`。

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `restore` | `restore(): Promise<void>` | 从 `save` 读上次保存值 → 注入 `SettingsStore`；顺带开始追踪后续变化，并订阅后端切换 | **插件全部装载完成之后**调一次（别在插件声明前调，那样恢复值命不中已声明项） |
| `persistNow` | `persistNow(): Promise<void>` | 把当前**全部**设置值整体落盘并立即 `flush()` | "手动保存"、"恢复默认"这类需要马上写死的时刻 |
| `resetKey` | `resetKey(key: string): boolean` | 让某个 key 回到 schema 默认并把它从保存快照里删掉；返回"快照里有没有这一项" | "恢复该项默认"、清掉一条用户改过的值 |
| `dispose` | `dispose(): void` | 取消订阅（变更订阅 + 后端切换订阅），防泄漏 | 画布 `stop()` 时 |

### 它在背后怎么工作（懂了这个就懂所有坑）

**存哪里、存成什么**：

```ts
export const SETTINGS_SAVE_KEY = 'settings'   // 裸 key
```

值是一整包对象：`{ 配置key: 值, ... }`，写进 `save` 的 **`config` 域**（`save.set('settings', snapshot, 'config')`）。物理 key 由 SaveService 加前缀，所以本地存储里看到的是 `config:settings`。

**三条数据流**：

| 时刻 | 桥的动作 |
| --- | --- |
| 启动 `restore()` | 读 `config/settings` → `store.setSavedSnapshot(快照)`；然后才开始订阅变更 |
| 运行中改值 | 全局订阅 `store.onChange` → 把这一个 key 的值并进快照 → `save.set('settings', 快照, 'config')`（真正的落盘由 SaveService 自己防抖 `flush`） |
| 后端切换 | `save.onAdapterChange(type)` 且 `type === 'config'` → 重读新后端（`reloadFromBackend`） |

**"快照"是桥自己的一份副本**，和 `SettingsStore` 里的"当前值"不是一回事。`setSavedSnapshot` 的语义是：

- `define` 新项时，如果 key 命中快照 → **以快照值为初值**（优先于 schema 的 `default`）；
- 已经被声明的项 → 立即覆盖成快照值并通知；
- 所以"先 `restore` 再 `define`"和"先 `define` 再 `restore`"**都成立**——这是刻意的设计。

### 什么时候会拿不到这个服务

| 场景 | `ctx.get('settingsPersist')` |
| --- | --- |
| 画布宿主（默认） | 服务对象（`createMiniCanvasHost` 缺省 `persistSettings: true`） |
| 宿主显式 `persistSettings: false` | `undefined`（宿主自己管配置） |
| 纯 `new Context()` + 没装能力层 | `undefined`（拿不到 `settings`，桥跳过） |

写取用方时用 `ctx.tryGet('settingsPersist')` 更清楚（画布宿主的实现就是这么写的：`const settingsPersist = base.services.settingsPersist` 然后 `if (settingsPersist) await settingsPersist.restore()`）。

## 注意事项

1. **`restore()` 必须等插件装载完成之后再调**。桥把"用户保存值"注入设置时，已声明的项会立刻被覆盖，还没声明的项则等它将来 `define` 时命中快照。如果反过来（先 restore 后装插件），注入那一刻设置里什么都没有——但因为是"快照式"注入，插件稍后 `define` 时仍能命中，所以顺序**不致命**；真正致命的是"restore 之后再也没人 define 插件 Config"（插件是热装的时候），那种场景请确认 `declareConfig` 逻辑拿到了快照（见 `packages/canvas-data/src/canvas/capabilityLayer.ts`）。
2. **它在纯内核/关掉持久化时缺席，且 `ctx.get` 不抛错**。宿主关 `persistSettings` 或没装画布能力层时，`ctx.get('settingsPersist')` 是 `undefined`。取用方一律先判空（`tryGet`），别直接 `settingsPersist.restore()`。
3. **"改值不落盘"往往是落到了另一本账上**。桥写进 `save` 的 `config` 域，而 `config` 域的后端是**运行期可换**的（云插件启动时切云端）。桥为此专门订阅了 `onAdapterChange('config')` 并在切换后重读——如果你手写了一套配置持久化，别忘了同样的处理，否则会出现"本地存了、云端没存，切过去以后读回旧值"。成品应用的首页（`packages/ui/src/composables/appTheme.ts`）就是照这条键去读的，两处必须一致。
4. **`resetKey` 只清"保存的快照"，不负责通知你看不见的事**。它做三件小事：`store.clearSavedKeys([key])`（已声明项回到 schema 默认）、从桥自己的快照里删掉这一项、如果确实删到了就写回 `save`。返回 `false` 表示"快照里本来就没有这一项"（用户没改过）。
5. **插件不要自己 import 桥、也不要把 `ctx.get('settingsPersist')` 当成常规依赖**。插件与桥之间隔着 `settings` 这一层：你改值、桥负责记。直接依赖桥会在"宿主关掉持久化"的环境里让插件停在 PENDING（连画布都用不了），这正是它被设计成"条件注入"的原因。

