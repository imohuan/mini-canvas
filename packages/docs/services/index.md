# 内置服务

这一组是**API 参考**：每个内置服务一篇，只讲**怎么拿、有哪些方法、怎么用**，不铺教学。
服务就是「按名字取的一个会做事的对象」——`ctx.get('名字')` 拿到它，缺了返回 `undefined`、不抛。

```ts
const doc = ctx.get('doc')          // 按名字取
ctx.doc.createNode('text', { x: 0, y: 0 })   // 插件作用域里也能属性直读（Proxy 糖）
```

## 三种依赖写法

```ts
export const inject = ['doc']        // 硬依赖：没有它，插件停在 PENDING（不启动）
const doc = ctx.get('doc')          // 可选：缺了返回 undefined
const view = ctx.tryGet('view')          // 显式可选：缺了返回 undefined
```

## 服务分三档来源

| 档 | 谁提供的 | 有哪些 | 装了画布就有？ |
| --- | --- | --- | --- |
| **内核内置** | 框架自己 | `tools`、`slots`、`settings` | 是（纯 `new Context()` 也有） |
| **画布基础** | `canvas-base` 基础插件 | `doc`、`save`、`selection`、`resources` | 装了基础插件才有 |
| **渲染宿主** | `canvas-render` 宿主 | `view`、`canvas` | 起了渲染宿主才有 |

## 全部服务（一句话 + 链接）

| 服务 | 一句话 | |
| --- | --- | --- |
| `doc` | 画布数据门面：节点 + 边 + 事务 + 撤销 + 快照 + 订阅 | [看](/services/doc) |
| `save` | 键值持久化：换适配器就能换存储 | [看](/services/save) |
| `selection` | 选中集：当前选中了哪些节点和边 | [看](/services/selection) |
| `canvas` | 画布动作门面：建节点/选中/取景/模式/提示/命令执行 | [看](/services/canvas) |
| `slots` | 通用 UI 槽：往画布的固定位置叠 UI | [看](/services/slots) |
| `settings` | 配置的单一数据源：所有可调项登记在这里 | [看](/services/settings) |
| `resources` | 资源生命周期：object URL 的登记与回收 | [看](/services/resources) |
| `upstream` / `media` | 能力包（不是服务名）：读上游、加媒体；用 `useCapability('upstream' / 'media')` 取 | [看](/canvas-data/upstream) |
| `view` | 实测尺寸 / 绝对坐标 / 视口 / 唯一取景 `fitTo` | [看](/services/view) |
| `nodeToolbar` | 节点上下状态栏的会话与模式注册（辅助服务） | [看](/services/node-toolbar) |
| `tools` | 外部能力注册表：文生图 / 图生文这类"生成工具" | [看](/services/tools) |

> **旧名已下线**：`nodeLayout` / `viewport` / `command` / `nodeFactory` /
> `nodeRegistry` / `themeRegistry` / `settingsPersist` / `auto-save` / `pluginManager`
> 都不能再按名取。对照表见 [服务与注册场现状](/services/map)。

> 想看**你这台画布上实际有哪些服务、谁提供的、方法名是什么** → [活快照](/plugins/live)（真数据）。
> 后台（cloud-server）的服务走 **`ctx.routes` / `ctx.store` / `ctx.jobs` / `ctx.mcp` / `ctx.agent`**，
> 见 [后端 API](/api/server)。

> `upstream` 与 `media` 是**能力包**（`registryOf('capability')` 里的条目），不是 `ctx.get` 的服务名；
> 在节点区域组件里用 `useCapability('upstream')` / `useCapability('media')`，并在 `ctx.nodes.attach` 的 `needs` 里声明。

## 每篇的结构

统一两节，读的时候直接跳：

1. **一句话定位 + 属于哪一档**（谁提供的、源码在哪、缺了会怎样）。
2. **用法** —— 怎么拿、方法逐个（**真实签名** + 一句话 + 什么时候用）、关键形状、真实消费点。
3. **注意事项** —— 真实限制，每条说清"为什么"。

