# 分组

> `@plume-canvas/plugin-group` - v0.1.3

选中多个 Ctrl+G 打组 / Ctrl+Shift+G 解组.

## 功能说明

plugin-group —— 分组插件。
核心模型（对齐用户拍板的分组语义）：
- 快捷键建组：选中 ≥2 顶层节点 Ctrl+G → 按选中节点包围盒 + 四边 padding（settings 可配）
  建 group 节点，子节点**绝对→相对**坐标修复后挂 parentId（组内以分组左上角为 0,0）。
- 拖拽归组：节点拖拽结束 → 引擎 resolveGroupChanges 决策（相交进组/离开出组），
  进组 = 绝对→相对 + 挂父；出组 = 相对→绝对 + 解父。坐标换算全走引擎
  toRelativePosition / toAbsolutePosition 一对函数（建组/解组/重算/拖拽共用）。
- 解组 Ctrl+Shift+G：子节点还原绝对坐标、删组节点，一条 graph 事务可撤销。
写模型：所有图变更统一走 ctx.get('doc')（唯一写入口，历史 + 落盘自动）。
分层：只依赖内核(canvas-base/canvas-data) + 渲染层类型/事件，不直碰 VueFlow，不碰老版 src/。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc', 'selection', 'view'`

### 注册的插槽 (slots.register)

- `overlay`

### 快捷键

- `ctrl`

## 安装

```bash
npm i @plume-canvas/plugin-group
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
