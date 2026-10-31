# `nodeToolbar` · 节点状态栏

**一句话定位**：`nodeToolbar` 记住某个节点此刻进了哪个编辑模式，并列出所有可用的状态栏模式。

**它属于哪一档**：**渲染层辅助服务**。由 `canvas-render` 注入，不出现在基础七名里。
源码：`packages/canvas-render/src/toolbar/nodeToolbarService.ts`。

## 拿法

```ts
const toolbar = ctx.tryGet('nodeToolbar')
```

一般不用直接拿：进/出模式走 `ctx.get('canvas').enterMode / exitMode / activeMode`。

## 方法

| 方法 | 说明 |
| --- | --- |
| `registerMode(mode)` | 注册一个模式（图片裁剪、视频剪辑、宫格等） |
| `unregisterMode(id)` | 移除模式 |
| `enter(nodeId, modeId)` | 让节点进入某模式 |
| `exit(nodeId?)` | 退出；不传节点 id 时退出当前会话 |
| `activeModeId(nodeId)` | 读某节点当前模式；没进模式返回空串 |

## 注意事项

1. **模式注册不随主题卸载消失**。它住在渲染层；换主题、卸载主题都还在。
2. **一个节点同时只在一个模式里**。这是会话状态，不写成注册场。
3. **主题只负责画**。模式里的按钮与面板由具体节点插件注册，主题不保存会话。
