<script setup lang="ts">
/**
 * TextPreview —— 文本**预览**组件（注册件，目录名 textPreview）。
 *
 * 从 TextContent（text 节点内容段）抽出的纯展示件：只读展示文本（超出裁掉）。
 * 与节点内容段的差异：没有编辑态、不读写节点 data —— 只吃 props.text。
 * 注册进 ui 目录后，任何宿主（生成历史卡片、全屏预览、其它插件）都能 useUiComponent 按名取用。
 */
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    /** 文本内容 */
    text?: string
    /** 文件名（空则不显示） */
    name?: string
  }>(),
  { text: "", name: "" },
)

const shown = computed(() => (typeof props.text === "string" ? props.text : ""))
</script>

<template>
  <div class="tpv-root" :title="name || undefined">
    <div class="tpv-body">{{ shown || '（空）' }}</div>
  </div>
</template>

<style scoped>
.tpv-root { width: 100%; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
.tpv-body { flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 12px 14px; box-sizing: border-box; font-size: 13px; line-height: 1.6; color: var(--ui-ink, inherit); white-space: pre-wrap; word-break: break-word; }
</style>
