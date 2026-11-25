<script setup lang="ts">
/**
 * MCP 工具详情卡：标题 / 说明 / 支持参数。
 *
 * 两处共用同一张卡（下拉工具行、输入框里的 `.ac-tag` 标签）。
 * 定位由 `useMcpToolHover` 算好后以 fixed 坐标传进来，卡片自己不猜方向 ——
 * 下拉菜单贴着屏幕右缘、标签在输入框中间，两种情况要分别翻边与夹取。
 */
import { computed } from 'vue'
import { ICON_MCP } from '../shared/agentResources.js'
import { mcpToolParamRows, type McpToolMeta } from '../shared/mcpToolMeta.js'
import { toolTitleText } from '../../model/toolMeta.js'

const props = defineProps<{
  tool: McpToolMeta | null
  left: number
  top: number
  maxHeight: number
  side: 'top' | 'bottom' | 'left' | 'right'
  ready: boolean
  pending: boolean
}>()

const params = computed(() => mcpToolParamRows(props.tool?.parameters))
const fullName = computed(() => props.tool?.fullName ?? '')
/** 人话动作（canvas_get → 查看节点）。认不出时为空串，卡片只显示工具名。 */
const action = computed(() => (props.tool ? toolTitleText(props.tool.name) : ''))
</script>

<template>
  <Teleport to="body">
    <div v-if="tool" class="ac-toolcard" role="tooltip" :data-side="side"
      :class="{ 'is-ready': ready }"
      :style="{ left: left + 'px', top: top + 'px', maxHeight: maxHeight + 'px' }"
      >
      <div class="ac-toolcard-head">
        <span class="ac-toolcard-icon" aria-hidden="true" v-html="ICON_MCP"></span>
        <span class="ac-toolcard-titles">
          <span class="ac-toolcard-name">{{ tool.name }}</span>
          <span class="ac-toolcard-server">
            <template v-if="action && action !== tool.name">{{ action }} · </template>{{ tool.server }} · MCP 工具
          </span>
        </span>
      </div>
      <p v-if="pending" class="ac-toolcard-desc is-muted">正在读取工具详情…</p>
      <p v-else-if="tool.description" class="ac-toolcard-desc">{{ tool.description }}</p>
      <p v-else class="ac-toolcard-desc is-muted">这个工具没有写说明。</p>

      <div v-if="!pending" class="ac-toolcard-section">
        <span class="ac-toolcard-label">参数</span>
        <p v-if="!params.length" class="ac-toolcard-empty">不需要参数</p>
        <ul v-else class="ac-toolcard-params">
          <li v-for="p in params" :key="p.name" class="ac-toolcard-param">
            <div class="ac-toolcard-param-top">
              <code class="ac-toolcard-param-name">{{ p.name }}</code>
              <span class="ac-toolcard-param-type">{{ p.type }}</span>
              <span v-if="p.required" class="ac-toolcard-required">必填</span>
            </div>
            <p v-if="p.description" class="ac-toolcard-param-desc">{{ p.description }}</p>
            <p v-if="p.defaultValue" class="ac-toolcard-param-meta">默认：{{ p.defaultValue }}</p>
            <p v-if="p.enumValues.length" class="ac-toolcard-param-meta">可选：{{ p.enumValues.join(' / ') }}</p>
          </li>
        </ul>
      </div>

      <p v-if="fullName" class="ac-toolcard-fullname" :title="fullName">{{ fullName }}</p>
    </div>
  </Teleport>
</template>

<style scoped src="./McpToolCard.css"></style>
