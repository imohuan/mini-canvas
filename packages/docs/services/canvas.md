# `canvas` · 画布动作门面

**一句话定位**：`canvas` 是「对画布做一件事」的统一入口。建节点、选中、取景、进编辑模式、打组、提示、底栏动作、跑命令，都从这里调。

**它属于哪一档**：**渲染宿主**。由 `canvas-render` 注入；它只转发，不存数据。
源码：`packages/canvas-render/src/canvas/canvasService.ts`。

## 拿法

```ts
export const inject = ['canvas'] as string[]
const canvas = ctx.get('canvas')
```

## 动作

| 方法 | 说明 |
| --- | --- |
| `createNode(type, at, opts?)` | 建节点唯一入口；类型没注册时返回 `undefined` |
| `creatableTypes()` | 当前可建的类型 |
| `select(ids, mode?)` | `'replace'` / `'add'` / `'toggle'` |
| `focus(target, opts?)` | 调 `view.fitTo`；`'selection'` 先解析当前选中 |
| `enterMode` / `exitMode` / `activeMode` | 节点上下状态栏模式 |
| `group` / `ungroup` | 没装分组插件时安静返回 `null` / 不抛 |
| `notify(message, opts?)` | 提示队列，返回撤回函数 |
| `runBarAction` / `cancelBarAction` | 跑 / 取消底栏动作 |
| `runCommand` / `listCommands` / `hasCommand` | 执行、枚举、判断命令 |
| `remapCommandKeys` / `resetCommandKeys` / `originalCommandKeys` / `isCommandRemapped` | 快捷键改键 |

## 用法

```ts
const id = canvas.createNode('text', { x: 100, y: 100 }, { data: { text: '你好' } })
if (id) {
  canvas.select([id])
  canvas.focus([id], { heightRatio: 0.5 })
}

const stop = canvas.notify('正在生成…', { source: 'demo', followPointer: true })
stop() // 撤回这一条
```

## 注意事项

1. **命令的服务名已经下线**。注册用 `ctx.commands.register(def)`；执行与枚举用 `canvas.runCommand / listCommands`。
2. **`focus` 和 `view.fitTo` 不一样**：`focus` 多处理 `'selection'` 与 `select: true`；纯取景算法始终只有 `view.fitTo` 一份。
3. **`notify` 不是角落弹窗**。`followPointer` 缺省为真，空串只清自己的 source，多来源不会互相盖掉。
4. **底栏动作缺执行器会 reject**。这是用户已经触发的动作，不能假装成功；其它可选能力缺失时安静返回。
