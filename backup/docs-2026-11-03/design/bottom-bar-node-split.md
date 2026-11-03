# NodeBottomBar 拆分记录（暂缓施工）

日期：2026-11-01。状态：**只记录，不开发**。

关联文件：`packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue`（当前 4828 行）。
相关施工单：`docs/design/plugin-contract-migration-plan.md` 第 26 项。

## 为什么现在不拆

底栏同时承担生成输入、参考素材、媒体预览、动作选择、任务执行和全局设置。
它又直接依赖节点契约、上游素材解析、富文本标签和主题登记组件，改动面很大。
在契约还没稳定时拆包，最容易把同一份逻辑复制到两处，最后出现两套行为。

所以先记录边界，等后续专门安排一轮“只搬代码、不改行为”的施工。

## 当前职责清单

| 区域 | 现在做什么 | 是否应该独立 |
|---|---|---|
| 动作与参数 | 选动作、读 `fields`、维护 `barValues`、算参数摘要 | 是，纯逻辑 |
| 提示词输入 | 富文本、标签、`barPrompt` / `text` 落盘、防抖 | 是，纯逻辑 + 输入组件 |
| 参考素材 | 收上游素材、解析资源地址、缩略图、排序、拖入参考格 | 是，数据与视图分开 |
| 发送与任务 | 防连点、组装输入、调用 `nodeTask.run`、读运行状态 | 是，保留服务接口 |
| 媒体预览 | 点卡片看大图/全文，浮层定位与缩放 | 已有 `MediaPreviewOverlay.vue`，继续独立 |
| 底栏外壳 | 显示条件、展开成大弹窗、设置区、键盘处理 | 保留在 `NodeBottomBar.vue` |
| 样式 | 约 1750 行 scoped 样式 + 两段全局样式 | 跟随所属子组件走 |

## 拆分后的形状

只保留**一个**底栏宿主组件。拆出来的是内部职责，不是再复制一根底栏。

```
NodeBottomBar.vue                 外壳：可见性、展开、设置区、组合子组件
  composables/useBarActions.ts    动作列表、当前动作、参数值与落盘
  composables/usePromptDraft.ts   提示词、富文本快照、标签、防抖保存
  composables/useMaterials.ts     上游素材、资源地址解析、排序、缩略图
  components/GenerationPanel.vue  输入框 + 参数 + 发送按钮
  components/MaterialStrip.vue    参考标签与素材卡
  components/ReferencePicker.vue  参考选择态（可继续复用现有浮层）
  components/MediaPreview.vue     媒体预览（优先复用现有浮层）
```

拆完后 `NodeBottomBar.vue` 只负责“把东西摆在一起”，不再知道资源怎么解析、
提示词怎么落盘、任务怎么轮询。目标是外壳控制在 500 行以内，纯逻辑都可单测。

## 必须保留的对外接口

这些名字和语义不能变，否则节点插件、工具插件和主题会一起坏：

- `pluginBottomBar` 插件出口。
- `BOTTOM_BAR_SLOT = 'bottomBar'` 与主题登记名。
- `BAR_FIELD = 'node/bar'`。
- `NodeBarService` 的 `list/get/applierOf/state/register/registerApplier/publishTools`。
- `NodeTaskService` 的 `run/cancel/restoreAll`。
- `registerBarAction`、`registerBarApplier`、`publishToolActions`。
- `NodeBottomBar` 的 props：`{ id, data }`。
- 节点 `data` 字段：`barValues`、`barPrompt`、`promptDoc`、`refOrder`、`runState`。
- `runAction/resumeAction` 以及 `TaskDeps` 的现有形状。

## 施工顺序

1. 先搬纯函数：动作选择、参数摘要、素材排序、缩略图选择。每搬一块补一组等价的单测。
2. 再搬提示词状态与防抖保存，验证“收起再打开、刷新、撤销”三条路径。
3. 抽 `GenerationPanel.vue` 和 `MaterialStrip.vue`，模板逐段搬，不改 DOM 结构和类名。
4. 最后瘦身样式。scoped 样式跟着组件走；全局样式先确认没有别的插件依赖，再收口。
5. 每一步单独提交，保证任一步都能回滚。

## 回归清单

- 选中单个节点才显示底栏；多选、点空白、切画布都不显示。
- 文本节点的输入写 `data.text`，生成节点写 `data.barPrompt`；收起后重开内容还在。
- 富文本标签在重开后仍是标签，不退化成纯文本。
- 连线上游的图片/视频/文本都能出现在素材行；`@` 引用与素材行顺序一致。
- 参数拖动只落一次历史（防抖有效），发送时参数完整传给任务。
- 连点发送只起一个任务；取消、刷新续查、任务完成写回都正常。
- 展开成大弹窗后状态与内嵌态一致；Esc 能关。
- 浅色/深色主题下按钮、下拉、提示、素材卡样式一致，只用主题变量。

## 改动前必读

- `docs/tmp/canvas-core-v2-survey/core-node-contract.md`
- `docs/规则/节点区域与连接线拖拽规范.md`
- `docs/design/ui-style-guide.md`

核心节点壳相关文件在红线清单里，拆底栏时不要顺手改 `BaseNode.vue`、`MovingHandle.vue`、
`BaseTitle.vue`、`CustomEdge.vue`、`ConnectionLine.vue`、`DefaultBackground.vue`。
