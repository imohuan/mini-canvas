# 底部状态栏

> `@plume-canvas/plugin-bottom-bar` - v0.1.13

节点底部状态栏：可替换底栏 + 注册式动作 + 任务进度.

## 功能说明

@plume-canvas/plugin-bottom-bar —— 节点底部状态栏：可替换底栏 + 注册式动作 + 进度覆盖层。
作者入口（三条糖都是「落场用调用方 ctx」—— 条目归你，卸载自动摘除）：
  registerBarAction(ctx, action)
  registerBarApplier(ctx, kind, fn)
  publishToolActions(ctx, { types, produces, ... })   // Task 6c 实现
消费入口（组件里用 ctx.get，不要直访 ctx.nodeBar —— 根 ctx 没有服务代理）：
  ctx.get('nodeBar').list({ type }) / get(id) / state(nodeId)
  ctx.get('canvas').runBarAction(nodeId, actionId, input) / cancelBarAction(nodeId)
底栏自己的组件要取消任务时，仍可用内部执行器 `nodeTask.cancel`（它不是基础服务）。
整体换皮（像主题那样）：ctx.theme.add('bottomBar', MyBar, { order: -1 })
任务只由后台执行（用户口径 2026-11-10）：这里没有「前端自己轮询」那条路，
进度与终态由后台写节点、SSE 推回来，断线由 cloud-client 的一条全局定时器批量对账。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc'`

## 安装

```bash
npm i @plume-canvas/plugin-bottom-bar
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
