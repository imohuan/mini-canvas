# 宫格切分

> `@plume-canvas/plugin-image-grid-split` - v0.1.3

图片节点顶栏的宫格切分：预设/自定义行列、勾选格子、发布到画布与分镜组.

## 功能说明

plugin-image-grid-split —— 图片节点的宫格切分（按 docs/examples/node-toolbar.md 写法）。
三件事：
① 方式 A：往 image.topToolbar 按钮组里插一条「宫格切分」下拉
   （与上传/裁剪/扩展同排；预设 + 二级菜单在本插件自己组件里）；
② 方式 C：注册一个功能模式 image-grid-split/workbench
   —— 进入后底栏整格换成切分操作面板（topBar 不接管：仍由图片默认顶栏显示）；
③ 进入/退出模式时清掉自己的会话（onSplitChange 两腿同步，双保险防旧 UI 残留）。
卸载本插件：插槽条目与模式注册自动回收；会话跟着包作用域一起清。
/

## 注册项

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `image.topToolbar`

## 安装

```bash
npm i @plume-canvas/plugin-image-grid-split
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
