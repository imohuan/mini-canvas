# 核心 API 总览

这一页是"查表用"的：插件手上到底有哪些能力、每种能力归谁提供。

## 先分清两个词

整套 API 只有两类东西，先把它们分清，后面就不会乱：

| 类别 | 是什么 | 从哪拿 | 判据 |
| --- | --- | --- | --- |
| **服务** | 一个**会做事的对象**，按**名字**取 | `ctx.get('名字')` | 换实现要改行为 |
| **注册场** | 一**张表**，按**种类**放一串条目 | `ctx.registryOf('种类')` | 只是一堆同类条目 |

> 一句话：**"一个能手"是服务，"一张表"是场。**

## 服务清单（`ctx.get` 能手到谁）

### 内核 / 能力层自带（永远在）

| 名字 | 类型 | 干什么 |
| --- | --- | --- |
| `tools` | `ToolRegistry` | 外部能力注册表（文生图 / 图生文…） |
| `slots` | `SlotRegistry` | 通用 UI 槽容器（`ctx.slots` 写这里） |
| `settings` | `SettingsStore` | 配置的单一数据源 |

### 画布基础服务（装上画布基础插件就有）

| 名字 | 干什么 |
| --- | --- |
| `doc` | **数据那一格只有它**：节点 + 边 + 事务 + 撤销 + 快照 + 订阅 |
| `save` | 键值持久化（适配器可插拔：内存 / localStorage / 云端） |
| `resources` | 资源生命周期（object URL 的登记与回收） |
| `nodeRegistry` | 节点展示注册表（哪种节点的哪个区域用哪个组件） |
| `themeRegistry` | 主题 / 外观槽注册表 |
| `selection` | 选中集（节点 + 边两桶） |
| `command` | 命令注册表 |
| `nodeFactory` | 统一建节点工厂 |
| `settingsPersist` | 配置落盘桥（条件注入） |

### 渲染宿主注入（要 DOM / 要后端才能做的两件）

| 名字 | 干什么 |
| --- | --- |
| `nodeLayout` | **实测**尺寸 / 绝对坐标（要量 DOM，数据层给不了） |
| `viewport` | 视口（要 attach VueFlow 后端，能缩放 / 定位 / 聚焦） |

> **旧名字已下线**：`nodeStore` / `edgeStore` / `graph` / `history` 这四个服务名
> 现在 `ctx.get` **取不到**，它们合并成了 `doc`。写 `inject: ['nodeStore']`
> 会让插件永远停在 PENDING。

## 注册场清单（`ctx.registryOf` 能放到哪）

| 种类 | 装什么 | 谁在放（真实例子） |
| --- | --- | --- |
| `node/type` | 节点类型的声明摘要 | 文本 / 图片 / 视频节点 |
| `node/region` | 往某节点某**区域**挂组件 | 状态栏覆盖层 |
| `selection/region` | 往**多选框**挂组件 | 加入资产库、引用到 Agent |
| `node/bar` | 节点**状态栏的动作** | 下载 / 旋转 / 删除 |
| `node/bar-applier` | 动作的"执行体" | 图片类动作怎么跑 |
| `node/creator` | "建一个该类型节点" | 各节点插件 |
| `command` | 命令 | 删除 / 对齐 / 复制 |
| `theme` | 主题槽（壳 / 边 / 背景 / UI 件） | 默认主题、状态栏 |
| `slot` | 通用 UI 槽 | 小地图、设置页签 |
| `ui` | 设计系统组件目录 | 按钮 / 下拉 / 滑块 |
| `capability` | 组件能力包 | `node` / `zoom` / `selection` |
| `setting` | 配置项声明 | 各插件自己的配置 |
| `tool` | 模型可调用工具 | AI 工具插件 |

## 语法糖：六个 `ctx.子对象`

上表那些种类，绝大多数不用你手写 `registryOf`。`ctx` 上挂了几个短写法，
**落点就是对应的注册场**：

| 短写法 | 落点种类 | 干什么 |
| --- | --- | --- |
| `ctx.nodes.register(def)` | `node/type` + `node/region` + `node/creator` | 注册一个节点类型（数据 + 展示 + 建节点，一次搞定） |
| `ctx.nodes.attach(type, req)` | `node/region` | 往某节点的某区域挂组件 |
| `ctx.selectionRegion.attach(req)` | `selection/region` | 往多选框挂组件 |
| `ctx.theme.register(slot, comp)` | `theme` | 往主题槽叠组件 |
| `ctx.commands.register(def)` | `command` | 注册命令 |
| `ctx.slots.register(slot, req)` | `slot` | 往通用 UI 槽叠组件 |
| `ctx.settings` | `setting` | 读 / 订阅配置 |

## 命令：菜单、快捷键、按钮都收敛成"一条命令"

命令是画布上"能执行的一件事"。注册一条：

```ts
ctx.commands.register({
  id: 'my:clear',
  title: '清空',
  keys: ['mod+shift+k'],              // 可选快捷键
  group: '编辑',                       // 可选分组
  when: () => ctx.get('selection').size > 0,   // 可选：不满足就不给执行
  run: () => {
    ctx.get('doc').removeNodes([...ctx.get('selection').ids])
  },
})
```

菜单项、快捷键、按钮最后都指向这条命令。所以**注册一次，到处都是入口**。

## 想看真实数据

上面这些清单是"这套系统**能**有什么"。想知道**你这台画布现在实际有什么**，
去 [活快照](/plugins/live) —— 那一页直接读运行中应用的自省 API。
