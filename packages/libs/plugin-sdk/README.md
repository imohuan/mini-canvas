# 插件作者 SDK

> `@plume-canvas/plugin-sdk`

写一个 plume 插件只需要这一条依赖（重导出 kernel 与 canvas-data）。

## 特性

- 最小插件：export const myPlugin: PluginModule = { name, apply(ctx) }
- ctx 能力：inject/get（服务）、on（事件）、effect（副作用回收）、slots.register（插槽）、nodes.register（节点）、commands.register（命令）、settings（设置）、tools.register（AI 工具）
- 依赖声明：export const inject = [doc, selection]，未就绪自动 PENDING 等待

## 安装

```bash
npm i @plume-canvas/plugin-sdk
```
