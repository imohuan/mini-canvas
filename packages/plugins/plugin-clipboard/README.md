# 复制粘贴

> `@plume-canvas/plugin-clipboard` - v0.1.2

Ctrl/Cmd+C/V/X/D.

## 功能说明

plugin-clipboard —— 复制/粘贴/剪切/复制一份（v2 复刻老版 canvas-core/src/plugins/clipboard）。
数据流（v2 铁律：只经内核服务读写，不碰 VueFlow/宿主内部；整段原子进 history 一次撤销）：
- 复制：读 ctx.selection.ids(节点桶) → doc 取节点 + "两端都在选中集"的边
        → 存本画布实例的剪贴板快照（P2-4：按 Context 隔离，不再模块级 static 跨画布串数据）；
- 粘贴：克隆快照 → 新 id 重映射(节点 + 边 source/target) → 偏移(有鼠标锚点居中/无则级联 +20)
        → doc.transaction（唯一写入口）→ 选中切到新粘贴节点；
- 剪切：复制 + 删选中(节点 + 触碰边)，整段 history 一次；
- 复制一份：copy + paste 组合（快捷键 mod+d）。
快捷键：不用插件自绑 window，命令 keys 字段由渲染层 CanvasHost 统一分发（masterplan 铁律 7）。
类型缝：declare module 给 ctx.clipboard 直访（对齐 multi-select 的 'multi-select' 服务写法）。
依赖注入：doc/selection 为宿主恒在硬依赖（canvas-data 能力层内置 + 宿主注入）;
viewport 由 canvas-render 宿主注入、本插件只做"可选读取"（复制时把最近鼠标屏幕坐标经它换成 flow 锚点）。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc', 'selection'`

### 快捷键

- `mod+c`
- `mod+v`
- `mod+x`
- `mod+d`

## 安装

```bash
npm i @plume-canvas/plugin-clipboard
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
