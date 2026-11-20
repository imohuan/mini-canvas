# Agent 对话助手

> `@plume-canvas/plugin-agent` - v0.1.3

画布内对话助手：消息流 + 工具调用 + 设置页.

## 注册项

### 提供的服务 (ctx.inject / provide)

- `agent`
- `modelIcons`
- `agentReady`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `agent-conversation`
- `settings.nav`
- `settingsGroup/集成/Agent`

### 快捷键

- `mod+j`

## 安装

```bash
npm i @plume-canvas/plugin-agent
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
