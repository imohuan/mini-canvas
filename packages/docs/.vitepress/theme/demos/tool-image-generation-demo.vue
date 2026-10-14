<script setup lang="ts">
/**
 * tool-image-generation-demo —— 图片生成工具的活演示。
 *
 * 它是**真的在跑**插件源码：调 createImageGenerationTools() 把要注册进 ctx.tools 的
 * 工具全列出来（名字 / 显示名 / 产出 / 接受 / 参数 / 模板）。
 *
 * 为什么用相对路径直接 import 插件源码（而不是包名）：文档站的 package.json 没声明这个
 * 插件包（那份文件不许改）；而演示要展示的正是"源码里那张表长什么样"，直接引源码最准确
 * —— 与 node-text 页直接引 TextPreview.vue 是同一个思路。
 */
import {
  createImageGenerationTools,
  IMAGE_GENERATION_GROUP,
  TOOL_NAME_PREFIX,
} from '../../../../plugins/plugin-tool-image-generation/src/imageGenerationTools'
import { IMAGE_TEMPLATES } from '../../../../plugins/plugin-tool-image-generation/src/imageModels'

const tools = createImageGenerationTools()
const templates = [...IMAGE_TEMPLATES]

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
      分组：<code>{{ IMAGE_GENERATION_GROUP }}</code> · 工具名前缀：<code>{{ TOOL_NAME_PREFIX }}</code> ·
      共 <b>{{ tools.length }}</b> 个工具（内置表）
    </p>
    <table style="width: 100%; border-collapse: collapse; background: var(--vp-c-bg)">
      <thead>
        <tr>
          <th :style="head">name</th>
          <th :style="head">title</th>
          <th :style="head">produces</th>
          <th :style="head">accepts</th>
          <th :style="head">参数</th>
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
                  （{{ p.label }} · {{ (p.options || []).length }} 档 · 默认 {{ p.default }}）
                </span>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p style="margin: 10px 0 0; font-size: 12px; color: var(--vp-c-text-2)">
      每个工具都带同一份「模板提示词」下拉（{{ templates.length }} 条）：
      <span v-for="(tp, i) in templates" :key="tp.id">
        <code>{{ tp.name }}</code><span v-if="i < templates.length - 1"> · </span>
      </span>
    </p>
  </div>
</template>
