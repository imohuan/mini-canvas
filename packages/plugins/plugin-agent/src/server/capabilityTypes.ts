/**
 * 后台能力段的**类型**：让插件后台半（本包的 src/server/**）能看到 `ctx.routes`。
 *
 * 形状与 @plume-canvas/cloud-server 的 serverFramework/capabilityTypes.ts **对齐**，
 * 但只声明本包真正用到的那一段（routes）—— 插件不该从宿主包里 import 类型，
 * 那会让「后台半属于插件」这件事又退回到「嵌在 cloud-server 里」。
 *
 * 为什么只做类型、不做实现：实现（Hono 表 + 请求代理）由宿主提供，
 * 插件只是在 apply 里往那个段上挂路由。类型在这里，运行时仍由宿主注入。
 * 两份声明必须**同名同义**；漂移的话插件编译通过、运行时却挂不上，
 * 因此形状照抄宿主那份的公开成员，不多不少。
 */
import type { Hono, Handler } from 'hono'

/** 一条路由的处理函数（与宿主的路由注册段同一签名） */
export type RouteHandler = Handler

/** 路由注册段：与宿主的 RouteRegistrar 同名同义。 */
export interface RouteRegistrar {
  get(path: string, handler: Handler): void
  post(path: string, handler: Handler): void
  put(path: string, handler: Handler): void
  patch(path: string, handler: Handler): void
  delete(path: string, handler: Handler): void
  /** 所有方法都收（含 HEAD/OPTIONS） */
  all(path: string, handler: Handler): void
  /** 挂中间件（对该 path 前缀生效；先于方法路由执行） */
  use(path: string, mw: Handler): void
  /** 挂子应用（先把子应用路由建齐，再 mount）；按前缀整段转发 */
  mount(prefix: string, app: Hono): void
  /** 把已建好的子应用的路由逐条摊平进来（前缀由子应用自己写在 path 里） */
  adopt(app: Hono): void
}

declare module '@plume-canvas/kernel' {
  interface PluginCapabilities {
    /** 后台路由注册（插件卸载时自动摘除） */
    routes: RouteRegistrar
  }
}

