# 注册糖（作者入口）

> 插件：底部状态栏 bottom-bar · [返回总览](/plugins/parsed/bottom-bar/)

**一句话**：别的插件往底栏加东西，**只用这三条糖** —— 条目归你自己的插件，卸载自动摘除、同 id 替换。

## 三条糖

| 糖 | 签名 | 干什么 |
| --- | --- | --- |
| `registerBarAction` | `(ctx, action: BarAction): void` | 注册一条底栏动作 |
| `registerBarApplier` | `(ctx, kind: string, fn: BarApplier): void` | 注册某节点类型的结果写入器（**同 kind 重复抛错**） |
| `publishToolActions` | `(ctx, { types, produces, needsPrompt, promptBinding?, ... }): () => void` | 把 `ctx.tools` 里某类工具**自动发布**成底栏动作 |

> 三条都是"**落场用调用方 ctx**" —— 条目归你，插件卸载时自动摘除。

## 两条注册场

| 场名 | 键 | 值 |
| --- | --- | --- |
| `node/bar` | 动作 id | `BarAction` |
| `node/bar-applier` | 节点 kind | `BarApplier` |

## `BarAction` 常用字段

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一 id（**同 id 重复注册 = 替换**，用于热更） |
| `types` | 给哪些节点类型用；省略 = 所有类型 |
| `title` / `description` / `icon` / `group` | 显示与归类 |
| `fields` | 可视化配置（复用内核 `ToolParamDef` 词表，底栏据此自动长控件） |
| `templates` | 预设提示词模板（选中即填进输入框） |
| `needsPrompt` | 要不要底栏那个大输入框（默认 `false`） |
| `promptBinding` | 输入框绑哪个字段：`'none'`（默认，临时） / `'text'`（= `data.text`） |
| `apply` | 结果怎么落到节点：`'applier'`（默认，交给同 kind 写入器） / `'self'`（本动作自己已写好节点） |
| `run` | `(input: BarRunInput, runCtx: BarRunContext) => BarRunResult | Promise<...>` |

## 使用方式与示例

```ts
// 文件：packages/my-plugin/src/myPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：往底栏加一个自己的动作 + 一个写入器
import { registerBarAction, registerBarApplier } from '@mini-canvas/plugin-bottom-bar'

// 取不到 nodeBar 说明 bottom-bar 还没装 → 等它上架再补注册（装配顺序无关）
const registerBar = (): boolean => {
  if (!ctx.tryGet('nodeBar')) return false
  registerBarAction(ctx, {
    id: 'my.image.brighten', types: ['image'], title: '提亮', apply: 'self', order: 92,
    description: '把图片调亮一点（可撤销）',
    needsPrompt: false,
    async run(_input, runCtx) {
      // runCtx: { nodeId, nodeType, canvasId?, signal, onProgress, readData() }
      return { ok: true }
    },
  })
  // 写入器：生成结果回来时怎么落到节点（一个 kind 只能注册一个）
  registerBarApplier(ctx, 'image', (nodeId, result) => {
    const url = result.urls?.[0]
    if (url) ctx.get('doc').updateNode(nodeId, { data: { imageUrl: url } })
  })
  return true
}
if (!registerBar()) {
  const off = ctx.on('ctx:plugin-installed', () => { if (registerBar()) off.dispose() })
}
```

## 注意事项

1. **写入器一个 kind 只能一个**：`registerBarApplier` 对同 kind 重复注册会**抛错**（防止两条路各写一半）。
2. **同 id 重复注册 = 替换**：动作 id 是热更入口，不是追加。
3. **`publishToolActions` 会跟着工具表自动增量同步**：装了新的工具插件，底栏自动多一个模型按钮 —— 这就是"加一个模型 = 装一个工具插件"的落地点。
4. **写入器写数据要经 `doc`**：不要直接改 store（那样不进历史、不落盘）。

