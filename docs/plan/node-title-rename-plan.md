# 节点标题重命名（F2 / 双击标题）实现计划

## 任务概述
让普通节点（基于 `BaseNode.vue` 渲染的节点）的标题可以被就地编辑：
- 选中节点后按 `F2` 进入编辑；或双击标题文字进入编辑。
- 编辑时，标题区域替换成输入框。
- 输入框失焦 → 保存新标题；按 `ESC` → 取消编辑。

## 涉及文件
- `packages/canvas-core/src/components/Decoration/BaseNode.vue`（主要改动）
- 无需改动 `BaseTitle.vue`（复用其 `editing` / `interactive` props 与现有结构）。

## 参考实现
`packages/canvas-core/src/plugins/group/GroupNode.vue` 已有完整同名交互
（`_editingTitle` + draft + input + commit/cancel），本文案照此模式移植到
通用节点上，但把编辑态放在 BaseNode 本地（generic 节点无需持久化 `_editingTitle`）。

## 实现步骤
1. **编辑态与草稿状态**
   - `isEditingTitle = ref(false)`、`draftTitle = ref('')`、`titleInputRef`。
   - `nodeLabel` 已存在（显示用文字），编辑起点用它。

2. **标题标签 slot 换成 input**
   - BaseNode 的 `<template #title-label>` 内：编辑中渲染 `<input>`，
     否则渲染原默认 `<span>`/外部传入的 slot。
   - 原因：ImageNode / VideoNode 等会覆盖 `#title-label`，编辑时必须统一
     用本地 input 覆盖，标题来源统一写回 `data.label`。

3. **双击标题触发编辑**
   - `.custom-node-title` 现有 `@dblclick.stop` 改为 `@dblclick.stop="startEdit"`。

4. **F2 触发编辑**
   - `watch(props.selected)`：选中时给 `document` 挂 `keydown`，失选移除。
   - 处理器：仅当事件目标是 body（非输入框/文本域/可编辑区）且按 `F2` 时 `startEdit`。
   - 进入编辑后（isEditingTitle 为真）F2 不再重复触发。

5. **编辑交互**
   - 进入编辑：`draftTitle = nodeLabel`，`nextTick` 后 `focus() + select()`。
   - 回车 → commit；ESC → cancel；失焦 blur → commit。
   - commit：`vf.updateNode(id, { data: { ...props.data, label: 清洗后的值 } })`，
     若为空字符串则回退删除 label（让显示回落到 nodeType/默认）。
   - cancel：仅关闭编辑态，不改 label。

6. **样式**
   - 编辑输入框样式放在 `<style scoped>`，失焦/回车/取消行为与 GroupNode 输入框一致。

## 测试方案
- 运行 pnpm dev / build（若项目有）做类型检查。
- 手动验证：双击标题进入编辑可改；F2 选中后进入编辑；
  失焦保存生效、ESC 取消不落盘；ImageNode / VideoNode / 通用节点均可用。

## 风险与注意
- 多选时按 F2 语义有歧义；按"当前选中即编辑"处理，符合常见单节点重命名场景。
- 编辑中输入框需可选中文字，需保证不被外部 `select-none` 覆盖。
- 不触碰无关文件；改动仅限 BaseNode.vue。
