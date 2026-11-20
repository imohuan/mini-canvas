# 旋转与镜像

> `@plume-canvas/plugin-node-rotate` - v0.1.3

图片节点顶栏的「旋转与镜像」模式：向右旋转 90°、水平翻转、垂直翻转.

## 功能说明

plugin-node-rotate —— 图片节点的「旋转与镜像」插件。
按 docs/examples/node-toolbar.md（案例 9）的机制写：
- 方式 A：往图片默认顶栏按钮组插一条「旋转与镜像」入口（slots.register('image.topToolbar')）；
- 方式 C：注册功能模式 node-rotate/mode，进入后顶栏整格换成 RotatePanel
  （退出 / 右转 90° / 水平翻转 / 垂直翻转），底栏整格隐藏（bottomBar: null）；
- 点击入口 = 复制当前图片节点 + 建连接线，**副本**进入该模式（见 rotateCopy.ts）。
旋转复用图片插件的 image:rotate 命令（同一实现，不重复写）；翻转在本包 flipImage.ts 实现
（走 doc/resources 公共契约，不 import 其它插件）。nodeToolbar 是主题的服务：可选依赖
用 tryGet + ctx:plugin-installed 两腿走路（案例 7 同款），不赌装配顺序。
/

## 注册项

### 提供的服务 (ctx.inject / provide)

- `settings`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `image.topToolbar`

## 安装

```bash
npm i @plume-canvas/plugin-node-rotate
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
