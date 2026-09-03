# @ 引用资源 id/name 问题 — 已实现方案

## 结论
- `UpstreamResource` 增加 `id` = 上游图节点唯一 id（`edge.source`）。
  `seen` 已按 edge.source 去重 → 天然保证 id 唯一。
- `name` 仅作 @ 下拉菜单 / 文档内展示文案，不参与身份。
- 序列化 token 用节点 id：纯文本（promptText / 剪贴板 / 回退解析）输出 `@<节点id>`，
  resolver 按 id 回查。
- resource 节点的 doc identity 也用节点 id（原为 `connected-i` 下标，现为真实节点 id）。

## 改动文件
- `canvas-core/.../composables/useUpstreamResources.ts`
  - 加 `id` 字段；三种资源都填 `edge.source`。
- `canvas-core/.../nodes/image/ImageBottomToolbar.vue`
  - `connectedImages` 的 ResourceItem.id = res.id（弃用 `connected-i`）。
  - `resolveResource` 改按 item.id 匹配。
- `prosemirror-editor-bundle/src/useEditor.ts`
  - `getPlainText`/`exportText`/`clipboardTextSerializer`：资源 token `@name` → `@id`。
  - `parsePlainTextToContent`：@token 语义改为节点 id，按 id 经 resolver 还原。

## 说明 / 取舍
- 纯文本 token 现为 `@<uuid>`（节点 id），会出现在发送的 promptText 里；
  显示靠文档内 data-name / 下拉 name，不受改名影响。
- 文档 JSON（promptDoc）本就携带 attrs.id，现在 id 稳定 = 节点 id。
