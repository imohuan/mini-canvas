# ShortcutManager 重构计划

> 状态：设计完成 → 开始实施
> 目标：将现有独立快捷键系统重构为集中式 ShortcutManager + 用户可自定义快捷键 + VueFlow 键盘绑定统一管理

---

## 背景

### 当前问题
1. **多 listener**：每个 PluginContext 有自己的 `shortcuts` Map 和 `shortcutListener`，多个插件导致多个 `document.addEventListener('keydown')`
2. **无冲突检测**：跨插件快捷键冲突只在各自 context 内警告，不同 context 间完全不可见
3. **HistoryPlugin 绕过**：用 `document.addEventListener('keydown', handleKeyDown, true)` 直接监听 Delete/Backspace，不经过快捷键系统
4. **不支持自定义**：用户无法修改快捷键映射
5. **无帮助面板**：用户不知道有哪些快捷键可用
6. **VueFlow 键盘隔离**：VueFlow 的 deleteKeyCode/selectionKeyCode 等 5 个键位与插件快捷键不在同一管理体系

### 当前快捷键清单（8 个，3 个插件）

| 快捷键 | 插件 | 功能 |
|--------|------|------|
| `ctrl+c` | ClipboardPlugin | 复制 |
| `ctrl+v` | ClipboardPlugin | 粘贴 |
| `ctrl+x` | ClipboardPlugin | 剪切 |
| `ctrl+z` | HistoryPlugin | 撤销 |
| `ctrl+shift+z` | HistoryPlugin | 重做 |
| `ctrl+y` | HistoryPlugin | 重做（备用） |
| `ctrl+a` | MultiSelectPlugin | 全选 |
| `escape` | MultiSelectPlugin | 清除选中 |

---

## 架构设计

```
┌──────────────────────────────────────┐
│     ShortcutManager (单例)            │
│──────────────────────────────────────│
│  registry: Map<string, ShortcutEntry>│
│  keymap:   Record<string, string>    │ ← 用户自定义映射（持久化到 canvasStore）
│  conflicts: ShortcutConflict[]       │
│  enabled:  boolean                    │
│──────────────────────────────────────│
│  register(entry) → RegisterResult    │
│  unregister(id)                      │
│  remap(id, newKeys) → RemapResult    │
│  getConflicts() → ShortcutConflict[] │
│  loadKeymap(map) / exportKeymap()    │
│  resetDefaults()                      │
│  getHelpList() → ShortcutHelpItem[]  │
└──────────┬───────────────────────────┘
           │ 单例，所有 PluginContext 共享
           ▼
┌──────────────────────────────────────┐
│  PluginContext (改)                   │
│  registerShortcut 委托到 Manager      │
│  unregisterShortcut 委托到 Manager    │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  ShortcutManagerPlugin                │
│  - Ctrl+/ 帮助面板                     │
│  - 重映射 Dialog                      │
│  - 冲突警告面板                        │
│  - VueFlow 键盘绑定同步               │
└──────────────────────────────────────┘
```

### 核心数据模型

```ts
interface ShortcutEntry {
  id: string              // 稳定 ID: 'history.undo'
  command: string         // 人类可读: '撤销'
  keys: string            // 默认键位: 'Ctrl+Z'
  handler: () => void
  priority: number        // 0-99，越小越高
  pluginId: string
  group: 'edit' | 'canvas' | 'view' | 'system'
  isSystemManaged?: boolean  // true = 由 VueFlow/外部驱动
}

type RegisterResult = 
  | { ok: true }
  | { ok: false; conflict: ShortcutConflict }

type RemapResult = 
  | { ok: true }
  | { ok: false; conflict: ShortcutConflict }
```

### 优先级

```
0  — 系统    (Ctrl+/, 全局开关)
10 — 编辑    (Ctrl+Z/Y, Ctrl+C/V/X, Delete)
20 — 画布    (Ctrl+A, Escape, 框选)
30 — 插件    (自定义插件快捷键)
99 — 兜底
```

---

## Task 拆解（2-5 分钟微任务）

### Task 1: 创建 `ShortcutManager` 纯 TS 类

**文件：** `src/canvas/core/plugins/ShortcutManager.ts`

**内容：**
1. `Map<string, ShortcutEntry>` registry（以 entry.id 为 key）
2. `Map<string, string>` reverseKeyMap（keys → entry.id 快速查找）
3. `register(entry)` — 写入 registry + reverseKeyMap，冲突检测（同 keys 不同 id → conflict）
4. `unregister(id)` — 从两个 Map 移除
5. `remap(id, newKeys)` — 更新 reverseKeyMap，检查新 keys 是否有冲突
6. `loadKeymap(map)` / `exportKeymap()` — JSON 序列化 { id: keys }
7. `resetDefaults()` — 恢复所有 entry 的默认 keys
8. `getConflicts()` — 返回所有冲突
9. `getHelpList()` — 按 group 分组返回帮助列表
10. 单例 `getInstance()` / `resetInstance()`（测试用）

**验收标准：**
- `register` 同 keys 不同 id → 返回 conflict
- `register` 同 id → 覆盖（静默）
- `remap` 新 keys 有冲突 → 返回 conflict 且不生效
- `remap` 无冲突 → 生效，`getHelpList()` 反映新 keys
- `exportKeymap()` 只返回被修改过的映射

---

### Task 2: 创建全局 keydown listener（统一点）

**文件：** `src/canvas/core/plugins/ShortcutManager.ts`（同一文件）

从 PluginContext 中移除 `ensureShortcutListener`，改为在 ShortcutManager 中统一管理：

1. `private listener: ((e: KeyboardEvent) => void) | null`
2. `private startListening()` — 当 registry 非空时，创建单个 `document.addEventListener('keydown', ...)`
3. `private stopListening()` — 当 registry 空时，移除 listener
4. listener 逻辑：遍历 reverseKeyMap，parseShortcut 匹配 → 找到 entry → 执行 `entry.handler()`
5. 支持 `entry.when` 条件（预留字段）
6. 保留 `isInputDOMNode` 输入框保护

**验收标准：**
- 无论多少插件注册，只有 1 个 document keydown listener
- 输入框内不触发快捷键
- handler 异常不影响其他快捷键
- listener 在第一个 entry 注册时创建，最后一个注销时移除

---

### Task 3: 重构 PluginContext 委托到 ShortcutManager

**文件：** `src/canvas/core/plugins/PluginContext.ts`

改动点：
1. 移除私有 `shortcuts` Map 和 `shortcutListener`
2. `registerShortcut(keys, handler, description?)` → 构建 ShortcutEntry → `ShortcutManager.getInstance().register(entry)`
3. `unregisterShortcut(keys)` → `ShortcutManager.getInstance().unregister(id)`
4. pluginId 从 `createPluginContext(pluginName)` 的参数获取
5. 移除 `ensureShortcutListener`、`cleanupShortcutListener`、`parseShortcut` 函数
6. 更新 `PluginContext` 接口（types.ts）：快捷键签名不变，但内部行为改变

**向后兼容：**
- `registerShortcut(keys, handler, description?)` 签名**完全不变**
- 所有现有插件**零改动**

**验收标准：**
- 现有 3 个插件（clipboard/history/multi-select）的所有快捷键正常运行
- `pnpm dev` 启动无错误
- Ctrl+C/V/X/Z/Y/A/Escape 全部可用

---

### Task 4: 新增 `userKeymap` 持久化到 Store

**文件：** `src/canvas/core/useCanvasStore.ts`

1. 在 `state` 中新增 `shortcutKeymap` 字段（类型 `Record<string, string>`）
2. 在 `serializer` 中处理该字段的序列化/反序列化
3. Canvas.vue 初始化时：`ShortcutManager.getInstance().loadKeymap(canvas.state.shortcutKeymap)`
4. 当 keymap 变化时，同步写回 `canvas.state.shortcutKeymap`

**验收标准：**
- 用户改快捷键后刷新页面，修改仍然生效
- 导出的 keymap JSON 可导入恢复

---

### Task 5: 创建 ShortcutManagerPlugin（UI 面板）

**文件：** `src/canvas/core/plugins/shortcut-manager/`

5.1 **ShortcutManagerPlugin.ts**
- `install(context)`:
  - 注册 `Ctrl+/` → `context.shortcuts.register({ id: 'shortcut-manager.help', command: '快捷键帮助', keys: 'Ctrl+/', ... })`
  - 注册 `Escape` → 关闭帮助面板（仅当帮助面板打开时）
- `deactivate()`: 关闭面板

5.2 **ShortcutHelpPanel.vue**
- Ctrl+/ 弹出 Modal
- 搜索框：实时过滤快捷键列表
- 分组显示（编辑/画布/视图/系统）
- 每行：快捷键键位 + 命令描述 + [重映射按钮]
- 底部：冲突数量 + [查看详情] + [恢复默认] + [导入] + [导出]
- 点击重映射 → 打开 RemapDialog

5.3 **RemapDialog.vue**
- 显示当前快捷键
- "按下新组合键" 输入区域（捕获实际按键）
- 实时冲突检测提示
- [确认] [取消]

**验收标准：**
- Ctrl+/ 弹出面板，Escape 关闭
- 搜索过滤正确
- 重映射后实时生效，页面刷新后保持
- 冲突项红色标记
- 恢复默认清除所有自定义映射

---

### Task 6: 迁移 HistoryPlugin 的 Delete/Backspace 监听

**文件：** `src/canvas/core/plugins/history/HistoryPlugin.ts`

改动：
1. 移除 `document.addEventListener('keydown', handleKeyDown, true)` 的 capture 监听
2. 改为在 PluginContext 中注册 2 个快捷键：
   - `id: 'history.delete', keys: 'Delete', handler: deleteNodesHandler`
   - `id: 'history.backspace', keys: 'Backspace', handler: deleteNodesHandler`
3. handler 中不再需要手动 `e.preventDefault()`（ShortcutManager 统一处理）
4. 如果有需要的额外事件（如 click 触发），保留相关逻辑

**验收标准：**
- Delete/Backspace 删除选中节点功能不变
- 不再有独立的 document capture 监听器
- 两个新 entry 在帮助面板中可见、可重映射

---

### Task 7: VueFlow 内置键位集成

**文件：** `src/canvas/core/plugins/shortcut-manager/ShortcutManagerPlugin.ts`（追加）

1. 在 `ShortcutManagerPlugin.activate()` 中注册 5 个 system-managed entry：
   - `vueflow.delete` — 对应 `deleteKeyCode`
   - `vueflow.selection` — 对应 `selectionKeyCode`
   - `vueflow.multi-selection` — 对应 `multiSelectionKeyCode`
   - `vueflow.zoom-activation` — 对应 `zoomActivationKeyCode`
   - `vueflow.pan-activation` — 对应 `panActivationKeyCode`
2. 监听 store 的键位值，当用户通过面板重映射时，同步调用 `store.deleteKeyCode.value = newKey`
3. 从 store 读取当前值作为 `entry.keys`

**验收标准：**
- 帮助面板中可见 VueFlow 的 5 个键位
- 用户重映射 `vueflow.delete` 到 `'d'` → VueFlow 实际行为跟着变
- 刷新后重映射保持

---

### Task 8: 回归验证 + 文档

1. 全量功能验证：
   - Ctrl+C/V/X 复制粘贴剪切
   - Ctrl+Z / Ctrl+Shift+Z 撤销重做
   - Ctrl+A 全选 / Escape 取消选中
   - Delete/Backspace 删除选中
   - Ctrl+/ 帮助面板 → 搜索 → 重映射 → 恢复默认
   - 修改快捷键 → 刷新 → 确认持久化
   - VueFlow 内置 Delete 键修改

2. 更新 `docs/04-implementation-plan.md` 中 Task 5.1 状态

3. 更新项目 MEMORY.md

**验收标准：**
- 所有现有功能无回归
- 新功能全部可用
- 无 console 错误

---

## 依赖关系

```
Task 1 (ShortcutManager 类)
  ↓
Task 2 (全局 listener)
  ↓
Task 3 (重构 PluginContext)  ← 关键：这一步之后所有现有行为不变
  ↓
Task 4 (持久化)
  ↓
Task 5 (UI 面板)            ← 可以与 Task 6/7 并行
  ├── Task 6 (HistoryPlugin 迁移)
  └── Task 7 (VueFlow 集成)
       ↓
Task 8 (回归验证)
```

## 风险点

| 风险 | 缓解 |
|------|------|
| Task 3 破坏现有快捷键 | 签名不变，逐个验证 8 个快捷键 |
| HistoryPlugin Delete 迁移遗漏 | 保留原有删除逻辑，仅改事件源 |
| VueFlow deleteKeyCode 修改影响原生行为 | 仅在用户主动重映射时才修改 store 值 |
| 序列化/反序列化 keymap 不兼容旧状态 | serializer 中加默认值兜底 |
