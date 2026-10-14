<script setup lang="ts">
/**
 * tool-text-generation-demo —— 文本生成工具的活演示（与图片侧同构）。
 *
 * 真的调 createTextGenerationTools()，把内置 3 个模型声明成的工具列出来：
 * 名字 / 显示名 / 产出 / 接受 / 参数 / 模板。参数一栏能直接看出"按能力显隐"
 * —— 没声明 thinking 的模型就没有那一项。
 */
import {
  createTextGenerationTools,
  TEXT_GENERATION_GROUP,
  TOOL_NAME_PREFIX,
} from '../../../../plugins/plugin-tool-text-generation/src/textGenerationTools'
import { TEXT_TEMPLATES } from '../../../../plugins/plugin-tool-text-generation/src/textModels'

const tools = createTextGenerationTools()
const templates = [...TEXT_TEMPLATES]

const cell = 'padding:6px 10px;border-bottom:1px solid var(--vp-c-divider);vertical-align:top;font-size:12px'
const head = 'padding:6px 10px;border-bottom:1px solid var(--vp-c-divider);text-align:left;font-size:12px;color:var(--vp-c-text-2)'
</script>

<template>
  <div
    style="
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid var(--vp-c-divider);
      background: var(--vp-c-bg-soft);
      overflow-x: auto;
    "
  >
    <p style="margin: 0 0 10px; font-size: 12px; color: var(--vp-c-text-2)">
      分组：<code>{{ TEXT_GENERATION_GROUP }}</code> · 工具名前缀：<code>{{ TOOL_NAME_PREFIX }}</code> ·
      共 <b>{{ tools.length }}</b> 个工具（内置表）
    </p>
    <table style="width: 100%; border-collapse: collapse; background: var(--vp-c-bg)">
      <thead>
        <tr>
          <th :style="head">name</th>
          <th :style="head">title</th>
          <th :style="head">produces</th>
          <th :style="head">accepts</th>
          <th :style="head">参数（按能力显隐）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tools" :key="t.name">
          <td :style="cell"><code>{{ t.name }}</code></td>
          <td :style="cell">{{ t.title }}</td>
          <td :style="cell"><code>{{ t.produces }}</code></td>
          <td :style="cell"><code>{{ (t.accepts || []).join(' + ') }}</code></td>
          <td :style="cell">
            <span v-if="!t.params || !t.params.length" style="color: var(--vp-c-text-3)">（无）</span>
            <template v-else>
              <div v-for="p in t.params" :key="p.key" style="white-space: nowrap">
                <code>{{ p.key }}</code>
                <span style="color: var(--vp-c-text-3)">
                  （{{ p.label }} ·
                  {{ (p.options || []).map((o: { label?: string }) => o.label).join(' / ') }} ·
                  默认 {{ p.default }}）
                </span>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0; font-size: 12px; color: var(--vp-c-text-2)">
      模板提示词下拉（{{ templates.length }} 条）：
      <span v-for="(tp, i) in templates" :key="tp.id">
        <code>{{ tp.name }}</code><span v-if="i < templates.length - 1"> · </span>
      </span>
    </p>
  </div>
</template>
