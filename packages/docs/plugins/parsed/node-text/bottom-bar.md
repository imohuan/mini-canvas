# 底栏动作与写入器

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：往节点底栏加按钮、并把生成结果写回节点 —— 都用插件 `bottom-bar` 提供的缝。

## 注册了哪些

本插件"取得到 `nodeBar` 就注册"，取不到就等 `ctx:plugin-installed` 事件后再补一次（装配顺序无关）。

| 类型 | id | 标题 | apply | 何时触发 | 干什么 |
| --- | --- | --- | --- | --- | --- |
| 动作 | `text.duplicate` | 复制 | `self` | 点底栏"复制" | 调 `duplicateTextNode` |
| 动作 | `text.delete` | 删除 | `self` | 点底栏"删除" | 调 `doc.removeNodes` |
| 动作 | `tool:<工具名>` | 工具 title | `applier` | 点底栏里某个模型 | 由 `publishToolActions` 从 `ctx.tools.list({ produces: 'text' })` 自动派生 |
| 写入器 | kind `'text'` | — | — | 生成成功回来时 | 把 `result.text` 写进 `data.text`（经 `doc.updateNode`，可撤销） |

## 注册函数的签名

来自 `@mini-canvas/plugin-bottom-bar`：

```ts
registerBarAction(ctx, action: BarAction): void
registerBarApplier(ctx, kind: string, fn: (nodeId: string, result: ToolResult) => void): void
publishToolActions(ctx, { types, produces, needsPrompt, promptBinding?, ... }): () => void
```

`BarAction` 常用字段：`id`（唯一，同 id 重复注册 = 替换）、`types`（适用节点类型）、
`title`、`description`、`icon`、`group`、`needsPrompt`、
`promptBinding`（`'text'` = 输入框就是 `data.text`）、`apply`、`run(input, runCtx)`。

## 使用方式与示例

```ts
// 文件：packages/my-plugin/src/myPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：往文本节点底栏加一个自己的动作
import { registerBarAction } from '@mini-canvas/plugin-bottom-bar'

const registerBar = (): boolean => {
  if (!ctx.tryGet('nodeBar')) return false          // bottom-bar 还没装
  registerBarAction(ctx, {
    id: 'my.text.say-hi', types: ['text'], title: '打个招呼', apply: 'self', order: 95,
    description: '在控制台打印这个节点的内容',
    run: (_input, runCtx) => {
      console.log(runCtx.readData().text)
      return { ok: true }
    },
  })
  return true
}
if (!registerBar()) {
  const off = ctx.on('ctx:plugin-installed', () => { if (registerBar()) off.dispose() })
}
```

`run` 收到的 `runCtx`（`BarRunContext`）：`nodeId`、`nodeType`、`canvasId?`、
`signal`（取消信号）、`onProgress(p)`、`readData()`。

## 注意事项

1. **`nodeBar` 是插件服务，不进 `inject`**：没装底栏插件的宿主也要能正常工作，所以走 `tryGet` 加事件补注册。
2. **写入器一个 kind 只能一个**：`registerBarApplier` 对同 kind 重复注册会**抛错**。

