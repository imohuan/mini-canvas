/**
 * capabilityTypes —— 后台能力段的**类型**（声明合并回框架的 PluginCapabilities）。
 *
 * 与前端对称（见 canvas-data 的 canvas/capabilityTypes.ts）：
 * 框架（@mini-canvas/kernel）只声明通用段（tools）；后台独有的段（routes，
 * 将来还有 agent/store/jobs/mcp）由本文件经声明合并补上。
 *
 * 只要本文件被加载，`ctx.routes` 就有完整类型提示；框架包保持干净（不认识"路由"这种后台概念）。
 */
import type { Handler } from 'hono'
import type { RouteRegistrar } from './routes.js'
import type { AgentRegistrar } from './agent.js'
import type { StoreRegistrar } from './store.js'
import type { JobsRegistrar } from './jobs.js'
import type { McpRegistrar } from './mcp.js'

declare module '@mini-canvas/kernel' {
  interface PluginCapabilities {
    /**
     * 后台路由注册（用户点 1：**后台新增一个接口 = 装一个插件**）。
     * 条目归注册方插件，卸载自动摘除；注册须在 start() 之前（装载期）。
     */
    routes: RouteRegistrar
    /**
     * Agent 中间件（用户点 2：**拦截 / 改写一次对话轮次**）。
     * 中间件在 runtime.run 之前跑（pre-turn），空链零开销；注册随插件卸载回收。
     */
    agent: AgentRegistrar
    /** 插件私有持久化存储（一个插件一个命名空间，卸载即清） */
    store: StoreRegistrar
    /** 定时/延时任务（注册随插件卸载回收） */
    jobs: JobsRegistrar
    /** 给 AI 加一个可调用的 MCP 工具（随插件卸载回收） */
    mcp: McpRegistrar
  }
}

/** 便于业务代码直接引用 Handler 类型（写路由处理函数时用） */
export type { Handler, RouteRegistrar }
