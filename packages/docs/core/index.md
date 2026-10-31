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
| `resources` | 资源生命周期（object URL 的登记与回收） | [看](/services/resources) |

### 渲染宿主注入（要 DOM / 要后端才能做）

| 名字 | 干什么 | 文档 |
| --- | --- | --- |
| `view` | 实测尺寸 / 绝对坐标 / 视口 / 唯一取景 `fitTo` | [看](/services/view) |
| `canvas` | 画布动作门面：建节点/选中/取景/模式/提示/命令执行 | [看](/services/canvas) |
| `nodeToolbar` | 节点上下状态栏（辅助服务，不算基础七名） | [看](/services/node-toolbar) |

> **旧名字已下线**：`nodeStore` / `edgeStore` / `graph` / `history` 合并成了 `doc`；
> `nodeLayout` / `viewport` / `command` / `nodeFactory` / `nodeRegistry` / `themeRegistry` /
> `settingsPersist` / `pluginManager` 也都不再是服务名。写进 `inject` 会让插件永远停在 PENDING。
> 对照表见 [服务与注册场现状](/services/map)。

## 注册场清单（`ctx.registryOf` 能放到哪）

| 种类 | 装什么 | 谁在放（真实例子） |
| --- | --- | --- |
| `command` | 命令 | 删除 / 对齐 / 复制 |
| `node/shell` | 节点壳组件 | 主题装配 |
| `node/region` | 往某节点某区域挂组件 | 状态栏覆盖层 |
| `node/bar` | 底栏动作与结果写入器（`appliers/<kind>`） | 下载 / 旋转 / 删除 |
| `selection/region` | 往多选框挂组件 | 加入资产库、引用到 Agent |
| `ui` | 设计系统组件目录 | 按钮 / 下拉 / 滑块 |
| `capability` | 组件能力包 | `node` / `zoom` / `selection` |
| `tool` | 模型可调用工具（function calling） | AI 工具插件 |
| `clipboard/copy` / `clipboard/paste` | 剪贴板处理器 | 复制 / 粘贴 |
| `media/creator` | 媒体创建器 | 图片 / 视频 / 音频 |

注册场的完整方法（add / list / top / wrap / resolve / subscribe…）见 [注册场](/api/registry)。

## 语法糖（落点是对应注册场）

| 短写法 | 落点种类 | 干什么 |
| --- | --- | --- |
| `ctx.nodes.register(def)` | 真实容器（`doc` 类型表 + 展示容器；不写已删的 `node/type` / `node/creator`） | 注册一个节点类型（数据 + 展示 + 建节点，一次搞定） |
| `ctx.nodes.attach(type, req)` | `node/region` | 往某节点的某区域挂组件 |
| `ctx.selectionRegion.attach(req)` | `selection/region` | 往多选框挂组件 |
| `ctx.theme.register(slot, comp)` | 真实容器 `ThemeRegistry`（`theme` 场已删） | 往主题槽叠组件 |
| `ctx.commands.register(def)` | `command` | 注册命令 |
| `ctx.slots.register(slot, req)` | 真实容器 `SlotRegistry`（`slot` 场已删） | 往通用 UI 槽叠组件 |
| `ctx.settings` | 真实容器 `SettingsStore`（`setting` 场已删） | 读 / 订阅配置 |
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

执行与枚举走 `ctx.get('canvas').runCommand / listCommands`。菜单项、快捷键、按钮最后都指向这条命令。

## 想看真实数据

上面是"这套系统能有什么"。想知道**你这台画布现在实际有什么** → [活快照](/plugins/live)（读 `ctx.surface()`）。

