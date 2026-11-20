# 插件框架内核

> `@plume-canvas/kernel`

插件运行时：装载、依赖等待、事件、作用域回收、注册表。纯框架，无画布概念，不依赖 Vue。

## 特性

- PluginModule：name + inject（依赖服务声明）+ apply(ctx)
- 生命周期：PENDING（等依赖）→ ACTIVE，卸载时 Scope 自动回收全部副作用
- 服务注册表：ctx.inject 上架 / ctx.get 取用，按依赖拓扑排序激活
- 事件：ctx:ready / ctx:plugin-installed / ctx:lifecycle-change，可 declare module 扩展
- 一般不直接安装，写插件用 @plume-canvas/plugin-sdk

## 安装

```bash
npm i @plume-canvas/kernel
```
