# 主题画布外观

> `@plume-canvas/plugin-theme-canvas` - v0.1.2

默认主题的画布半边：节点壳 / 连线 / 背景 / 节点上下工具栏（进画布才启动）.

## 功能说明

@plume-canvas/plugin-theme-canvas —— 默认主题的**画布外观**半边（进入画布才启动）。
注册的全是"有画布才看得见"的东西：节点壳、连线、背景、拖线临时线，
以及节点上下工具栏的挂载点。项目页不需要它们，也不该为它们启动画布。
为什么 inject: ['doc']：这些槽最终都要挂在节点/画布上；没有 doc 时启动
只会注册一堆取不到数据的组件，反而让 PENDING 状态更清楚。
与通用组件半边的关系：互不 import。启动默认值与设置键在引擎 @plume-canvas/canvas-render；
本包自己的 Config 只声明画布相关字段（端口 / 标题 / 吸附带 / 连线）。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc'`

## 安装

```bash
npm i @plume-canvas/plugin-theme-canvas
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
