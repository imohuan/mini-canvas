<script setup lang="ts">
/**
 * web2api-tools-demo —— web2api 预置表的活演示。
 *
 * 直接读插件源码里的 WEB2API_PRESETS（**唯一数据源**，见 presets.ts 的文件头说明），
 * 按节点类型分组列出来：动作 id / 底栏标题 / 平台 / web2api 工具名 / 参数 / 顺序。
 *
 * 底栏本身要靠画布宿主才画得出来（它读的是节点底栏那条缝），所以这里展示的是
 * "这条动作会被注册成什么"的声明本身 —— 数据是真的、来自源码，不是手抄。
 */
import { WEB2API_PRESETS, presetsFor } from '../../../../plugins/plugin-web2api-tools/src/presets'

const groups: Array<{ type: 'image' | 'video' | 'audio'; label: string }> = [
  { type: 'image', label: '图片节点（image）' },
  { type: 'video', label: '视频节点（video）' },
  { type: 'audio', label: '音频节点（audio）' },
]

const cell = 'padding:5px 10px;border-bottom:1px solid var(--vp-c-divider);font-size:12px;white-space:nowrap'
const head = 'padding:5px 10px;border-bottom:1px solid var(--vp-c-divider);text-align:left;font-size:12px;color:var(--vp-c-text-2)'
</script>

<template>
  <div style="padding: 14px 16px; border-radius: 12px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); overflow-x: auto">
    <p style="margin: 0 0 10px; font-size: 12px; color: var(--vp-c-text-2)">
      预置表共 <b>{{ WEB2API_PRESETS.length }}</b> 条动作（源码 <code>src/presets.ts</code> 的 <code>WEB2API_PRESETS</code>）。
      底栏按 <code>order</code> 从小到大排（每类各自从 10 起）。
    </p>
    <template v-for="g in groups" :key="g.type">
      <h4 style="margin: 12px 0 4px; font-size: 13px">{{ g.label }}（{{ presetsFor(g.type).length }} 条）</h4>
      <table style="width: 100%; border-collapse: collapse; background: var(--vp-c-bg)">
        <thead>
          <tr>
            <th :style="head">order</th>
            <th :style="head">底栏标题</th>
            <th :style="head">id</th>
            <th :style="head">web2api 工具</th>
            <th :style="head">烘焙模型</th>
            <th :style="head">参数（kind）</th>
            <th :style="head">模式</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in presetsFor(g.type)" :key="p.id">
            <td :style="cell">{{ p.order }}</td>
            <td :style="cell">{{ p.title }}</td>
            <td :style="cell"><code>{{ p.id }}</code></td>
            <td :style="cell"><code>{{ p.tool }}</code></td>
            <td :style="cell"><code>{{ p.model || '—' }}</code></td>
            <td :style="cell">
              <span v-if="!p.fields.length">—</span>
              <span v-else v-for="(f, i) in p.fields" :key="f.key">
                <code>{{ f.kind }}</code><span v-if="i < p.fields.length - 1"> · </span>
              </span>
            </td>
            <td :style="cell">
              <code>{{ p.promptMode }}</code>
              <span v-if="p.mediaMode"> / {{ p.mediaMode }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
