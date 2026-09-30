/**
 * @mini-canvas/plugin-web2api-tools —— 把自建 Web2API 服务的平台能力做成节点底栏动作。
 *
 * **只导出插件本身**。其余（配置 schema / 预置表 / MCP 客户端 / 纯函数）都是**内部实现**：
 * 别的插件或宿主若要协作，走服务与注册场（见 docs/design/core-layers-and-registry.md）——
 * 把内部零件当公共 API 导出，会让实现被外部钉死、以后改不动。
 *
 * 本插件对外的面：
 *   · 插件：`web2apiToolsPlugin`（装配清单里装它即可）
 *   · 配置：模块级 `Config`（内核按名登记进设置面板，无需导出）
 */
export { web2apiToolsPlugin } from './web2apiPlugin'

/** 预置表的一条声明（类型；给写测试/文档的人看，不是运行时 API） */
export type { Web2ApiPreset } from './presets'
