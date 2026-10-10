# 插件示例

这一组是**抄作业用的**。每篇 = 一个真实插件的做法 + 一个完整可照抄的最小示例 +
大量注释解释每一行在干什么。不读 [入门 · 核心概念](/intro/plugin-system)（七个原语）
也能抄，读完再抄会更快。

## 先懂三句话（懂了就可以直接抄）

**1. 插件 = 一个文件，裸导出几样东西。**

```ts
export const name = 'my-plugin'      // 名字，全画布唯一
export const inject = ['doc']        // 硬依赖：没这些服务我就不启动
export const Config = { /* 可选：可配置项 */ }
export function apply(ctx) { /* 在这里注册你的东西 */ }
```

**2. `apply(ctx)` 里，你只做一件事：往画布上「注册」。**

| 你想要什么效果 | 调哪个 | 真实参照 |
| --- | --- | --- |
| 画布上多一种节点 | `ctx.nodes.register` | `plugin-node-text` |
| 画布上叠一层 UI（浮层/面板） | `ctx.slots.register('overlay', …)` | `plugin-cursor-effect` |
| 快捷键 / 菜单项能触发一个动作 | `ctx.commands.register` | `plugin-mini-map` |
| 设置面板里出现你的配置 | 模块级 `Config` schema | `plugin-mini-map` |
| 别的插件能调用你的能力 | `ctx.inject('名字', 实现)` | `plugin-file-drop` |
| AI 能调你的生成能力 | `ctx.tools.register` | `plugin-tool-text-generation` |
| 节点底部多一个按钮 | `registerBarAction` | `plugin-node-text` |
| 监听鼠标/键盘/粘贴 | `ctx.effect(() => …)` | `plugin-file-drop` |

**3. 卸载不用你管。** 你在 `apply` 里注册的一切 —— 节点、UI、命令、服务、监听 ——
插件卸载时**全部自动回收**。你不写任何清理代码。

## 案例列表

| 案例 | 学什么 | 难度 |
| --- | --- | --- |
| [案例速查](/examples/recipe-map) | 「我想做 X 该抄哪个」对照表 + 装配顺序 | — |
| [1 · 最小节点插件](/examples/first-node) | `ctx.nodes.register` 全字段 + content 组件 | ⭐⭐ |
| [2 · 往画布叠 UI](/examples/ui-slot) | `ctx.slots.register`：overlay / settingsNav / 专用槽 | ⭐ |
| [3 · 命令与快捷键](/examples/command-shortcut) | `ctx.commands.register` + `keys`，服务状态做单一事实源 | ⭐ |
| [4 · 配置与设置面板](/examples/config-panel) | 模块级 `Config` schema，改配置实时生效 | ⭐ |
| [5 · 提供服务给别人用](/examples/provide-service) | `ctx.inject` + 类型增强，别人怎么消费你 | ⭐⭐ |
| [6 · 注册生成工具](/examples/register-tool) | `ctx.tools.register`，让节点面板能调你的能力 | ⭐⭐ |
| [7 · 节点底部动作](/examples/bottom-bar) | 跨插件注册：往别的插件的注册场放动作 | ⭐⭐⭐ |
| [8 · 监听浏览器事件](/examples/file-drop) | `ctx.effect` 包 window 监听 + 坐标换算 | ⭐⭐ |

## 插件之间怎么嵌套（读案例 7 前先看这段）

插件不是孤岛，有两种协作方式，仓库里都有真实用法：

**方式一：`tryGet` 可选探测（推荐，松耦合）。**
比如所有节点插件都想往 `plugin-bottom-bar` 的底栏上放按钮，但没人想硬依赖它 ——
bottom-bar 没装，节点插件照样工作。真实写法（节选自 `plugin-node-text`）：

```ts
// 在 apply 里：底栏服务装了就注册动作；没装就等它「装好」的事件再注册
if (!ctx.tryGet('nodeBar')) {
  const off = ctx.on('ctx:plugin-installed', () => { /* 现在再注册 */ off.dispose() })
}
```

**方式二：`inject` 硬依赖（紧耦合，仅用于「缺它就没意义」的场景）。**
比如 `plugin-node-image` 依赖 `@mini-canvas/plugin-bottom-bar` 的服务 ——
在 `package.json` 里加依赖、模块级 `inject` 里写服务名，内核会保证装载顺序。

这个仓库真实的嵌套关系（从各插件 `package.json` 的依赖扫出来的）：

```
plugin-bottom-bar ←── plugin-node-text / node-image / node-video / web2api-tools
       ↑ 这些插件往底栏注册动作（方式一 tryGet，node-image 走方式二）

plugin-theme-default（默认皮）←── 不依赖任何节点插件（刻意解耦）
plugin-tool-*-generation（生成工具）←── 不依赖节点插件（节点面板反向调它）
plugin-file-drop ←── 不依赖节点插件；运行时检测 nodeStore 里注册了哪些类型，能建才建
```

## 每篇案例的结构

1. **这个案例能做到什么效果**（一句话 + 你会看到什么）。
2. **完整代码**（带「文件：」头和逐行注释，照抄能跑）。
3. **每一行在干什么**（关键步骤逐条讲）。
4. **仓库里的真实出处**（哪个插件的哪个文件就是这么写的）。
5. **常见坑**。
