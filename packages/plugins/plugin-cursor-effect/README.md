# 光标特效

> `@plume-canvas/plugin-cursor-effect` - v0.0.0

画布光标样式 + 跟随特效 + 点击特效（烟花/星芒/彩纸…），带可视化设置页.

## 功能说明

plugin-cursor-effect —— 画布光标特效插件。
效果（三个维度）：
- **光标指针**：图标跟随（会动）/ 系统内置 / 图片；统一用"透明原生指针 + 跟随元素"实现；
- **跟随特效**：鼠标划过的拖尾（彩虹 / 仙女尘 / 雪花 / 气泡 / 幽灵 / 蚂蚁…）；
- **点击特效**：单击炸开的粒子（烟花 / 星芒 / 涟漪 / 彩纸 / 爱心 / 冲击波 / 雪爆）。
分层（照本仓库插件的标准做法）：
- **渲染**：一个 overlay 组件（`CursorEffectOverlay.vue`）注册进 `overlay` 槽，画布之上的一层；
- **逻辑**：纯函数全在 `engine.ts`（粒子配方 / 帧推进 / 图标 → SVG），Node 可单测；
- **目录**：可选清单 + Config schema 全在 `catalog.ts`（单一事实源）；
- **配置页**：左导航项注册进 `settingsNav`、整页注册进 `settingsGroup/光标`（自绘 UI）。
配置（内核 Config，见 catalog.ts）：扁平分组「光标」→ 设置面板里独占一个一级页；
自绘页直接以 Config 为唯一默认来源，改动写回 settings（随 settingsPersist 自动持久化、实时生效）。
/

## 注册项

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `overlay`
- `settings.nav`
- `settingsGroup/`

## 安装

```bash
npm i @plume-canvas/plugin-cursor-effect
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
