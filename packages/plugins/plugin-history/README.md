# plugin-history

> `@plume-canvas/plugin-history` - v0.0.0

## 功能说明

plugin-history —— 历史记录/撤销重做兼容薄插件（v2 独立包，复刻老版 canvas-core/plugins/history）。
老版 HistoryPlugin 做了什么：命令式撤销/重做栈、批量记录(beginBatch/endBatch)、
自动记录拖拽/连线/删除、Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键、history:state-change 事件。
v2 分工（薄适配包，不重复造、零耦合）：
- 撤销/重做本体：画布文档门面 doc（ctx.get('doc')；内部就是 History 的快照式 withRecord/undo/redo）。
- 自动记录：内核命令/操作经 withRecord 自动入历史；拖拽/连线由渲染层 CanvasHost 处理。
- 快捷键：canvas-commands 插件已注册 command:undo(mod+z) / command:redo(mod+shift+z)，
  渲染层统一分发 → 本包**不再注册带 keys 的撤销/重做命令**，避免键位/命令冲突。
本包存在的价值：给「只想要老版 history 命令名、不想依赖 canvas-commands 的宿主」一个
独立可装配的撤销/重做命令入口，并把内核缺口显式列出。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc'`

## 安装

```bash
npm i @plume-canvas/plugin-history
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
