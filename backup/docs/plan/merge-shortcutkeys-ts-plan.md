# 合并 shortcutKeys.ts 进 ShortcutKeys.vue 计划

## 任务概述
用户指出 `shortcut-manager/shortcutKeys.ts` 单独成文件不划算：
- `splitShortcutKeys` 仅被 `ShortcutKeys.vue` 一处使用；
- `normalizeKeysForDisplay` 全仓库零调用（死代码）。

结论：合并逻辑进 `ShortcutKeys.vue` 的 `<script setup>`，删除 `shortcutKeys.ts`。

## 改动文件
- 改：`packages/canvas-core/src/plugins/shortcut-manager/ShortcutKeys.vue`
- 删：`packages/canvas-core/src/plugins/shortcut-manager/shortcutKeys.ts`

## 步骤
1. 把 `splitShortcutKeys` 移到 `ShortcutKeys.vue` 的 `<script setup>`（`<script setup>` 顶层函数天然在模板作用域可用）。
2. 移除第 3 行 `import { splitShortcutKeys } from './shortcutKeys'`。
3. 删除 `normalizeKeysForDisplay`（死代码，无人调用）。
4. 删除 `shortcutKeys.ts` 文件。
5. 验证：确认无残留引用（codegraph_search / grep），跑该包 type-check 或 build。
6. commit。

## 验证
- codegraph/搜索确认两个函数无其它引用。
- 跑 packages/canvas-core 的 type-check。

## 风险
- 极低：函数仅本组件内用，无外部契约。
