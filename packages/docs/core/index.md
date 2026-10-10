# 前端 API 清单

一页看全：**哪些服务、哪些注册场、哪些语法糖**。每个服务的方法签名在 [内置服务](/services/) 各篇。

两类东西，别混：

| 类别 | 是什么 | 从哪拿 |
| --- | --- | --- |
| **服务** | 一个会做事的对象，按**名字**取 | `ctx.get('名字')` |
| **注册场** | 一张表，按**种类**放一串条目 | `ctx.registryOf('种类')` |

## 服务清单（`ctx.get` 能手到谁）

### 内核内置（永远在）

| 名字 | 类型 | 干什么 | 文档 |
| --- | --- | --- | --- |
| `tools` | `ToolRegistry` | 外部能力注册表（文生图 / 图生文…） | [看](/services/tools) |
| `slots` | `SlotRegistry` | 通用 UI 槽容器 | [看](/services/slots) |
| `settings` | `SettingsStore` | 配置的单一数据源 | [看](/services/settings) |

### 画布基础（装上基础插件就有）

| 名字 | 干什么 | 文档 |
| --- | --- | --- |
| `doc` | 数据那一格只有它：节点 + 边 + 事务 + 撤销 + 快照 + 订阅 | [看](/services/doc) |
| `save` | 键值持久化（适配器可插拔：内存 / localStorage / 云端） | [看](/services/save) |
| `selection` | 选中集（节点 + 边两桶） | [看](/services/selection) |
| `command` | 命令注册表 | [看](/services/command) |
| `resources` | 资源生命周期（object URL 的登记与回收） | [看](/services/resources) |
| `nodeRegistry` | 节点展示注册表（哪种节点的哪个区域用哪个组件） | [看](/services/node-registry) |
| `themeRegistry` | 主题 / 外观槽注册表 | [看](/services/theme-registry) |
| `nodeFactory` | 统一建节点工厂 | [看](/services/node-factory) |
| `settingsPersist` | 配置落盘桥（条件注入） | [看](/services/settings-persist) |

### 渲染宿主注入（要 DOM / 要后端才能做）

| 名字 | 干什么 | 文档 |
| --- | --- | --- |
| `nodeLayout` | 实测尺寸 / 绝对坐标（要量 DOM） | [看](/services/node-layout) |
| `viewport` | 视口（缩放 / 定位 / 聚焦） | [看](/services/viewport) |
| `pluginManager` | 插件管理器：装卸 / 重载 / 诊断 | [看](/services/plugin-manager) |

> **旧名字已下线**：`nodeStore` / `edgeStore` / `graph` / `history` 四个服务名 `ctx.get` 取不到，
> 合并成了 `doc`。写 `inject: ['nodeStore']` 会让插件永远停在 PENDING。

## 注册场清单（`ctx.registryOf` 能放到哪）

| 种类 | 装什么 | 谁在放（真实例子） |
| --- | --- | --- |
| `node/type` | 节点类型的声明摘要 | 文本 / 图片 / 视频节点 |
| `node/region` | 往某节点某区域挂组件 | 状态栏覆盖层 |
| `selection/region` | 往多选框挂组件 | 加入资产库、引用到 Agent |
| `node/bar` | 节点状态栏的动作 | 下载 / 旋转 / 删除 |
| `node/bar-applier` | 动作的执行体 | 图片类动作怎么跑 |
| `node/creator` | "建一个该类型节点" | 各节点插件 |
| `command` | 命令 | 删除 / 对齐 / 复制 |
| `theme` | 主题槽（壳 / 边 / 背景 / UI 件） | 默认主题、状态栏 |
| `slot` | 通用 UI 槽 | 小地图、设置页签 |
| `ui` | 设计系统组件目录 | 按钮 / 下拉 / 滑块 |
| `capability` | 组件能力包 | `node` / `zoom` / `selection` |
| `setting` | 配置项声明 | 各插件自己的配置 |
| `tool` | 模型可调用工具（function calling） | AI 工具插件 |

注册场的完整方法（add / list / top / wrap / resolve / subscribe…）见 [注册场](/api/registry)。

## 语法糖（落点是对应注册场）

| 短写法 | 落点种类 | 干什么 |
| --- | --- | --- |
| `ctx.nodes.register(def)` | `node/type` + `node/region` + `node/creator` | 注册一个节点类型（数据 + 展示 + 建节点，一次搞定） |
| `ctx.nodes.attach(type, req)` | `node/region` | 往某节点的某区域挂组件 |
| `ctx.selectionRegion.attach(req)` | `selection/region` | 往多选框挂组件 |
| `ctx.theme.register(slot, comp)` | `theme` | 往主题槽叠组件 |
| `ctx.commands.register(def)` | `command` | 注册命令 |
| `ctx.slots.register(slot, req)` | `slot` | 往通用 UI 槽叠组件 |
| `ctx.settings` | `setting` | 读 / 订阅配置 |
| `ctx.tools` | （`tools` 服务） | 注册 / 调用外部能力 |

节点类型的完整字段见 [注册节点类型](/canvas-data/node-types)。

## 命令

```ts
ctx.commands.register({
  id: 'my:clear',
  title: '清空',
  keys: ['mod+shift+k'],                        // 可选快捷键
  group: '编辑',                                 // 可选分组
  when: () => ctx.get('selection').size > 0,     // 可选：不满足就不给执行
  run: () => ctx.get('doc').removeNodes([...ctx.get('selection').ids]),
})
```

字段与分发规则见 [`command`](/services/command)。菜单项、快捷键、按钮最后都指向这条命令。

## 想看真实数据

上面是"这套系统能有什么"。想知道**你这台画布现在实际有什么** → [活快照](/plugins/live)（读 `ctx.surface()`）。

