<script setup lang="ts">
// BaseNode —— 节点"壳"（M2 最小版）。作为 VueFlow nodeTypes 的统一入口，
// 消费 NodeRenderer：给 node.type 问出 content/title/top-toolbar/bottom-toolbar 组件并路由渲染。
//
// M2 范围（runbook）：壳 = 标题(可选) + content + top/bottom toolbar(可选)，含连接点 Handle。
// 【明确不做】MovingHandle 吸附 / ResizeHandle 高级 resize / overlay + _toolbarGroup 六插槽(等 M6)。
import { computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { resolveSegment } from '../core/registry/nodeRenderer'
import { NODE_REGISTRY_KEY } from './nodeRegistryKey'

const props = defineProps<{ id: string; type: string; data: Record<string, unknown> }>()
// 节点类型都是本组件(VueFlow nodeTypes 全指到 BaseNode)，透传的 selected 等内部 prop 不落到根
defineOptions({ inheritAttrs: false })

const registry = inject(NODE_REGISTRY_KEY)
if (!registry) throw new Error('[BaseNode] 缺少节点注册表（CanvasDemo 未 provide NODE_REGISTRY_KEY）')

const pos = Position

// 该 type 的 content / title / 工具栏组件句柄（未注册段 = undefined → 不渲染该段）
const content = computed(() => resolveSegment(registry, props.type, 'content'))
const title = computed(() => resolveSegment(registry, props.type, 'title'))
const topToolbar = computed(() => resolveSegment(registry, props.type, 'top-toolbar'))
const bottomToolbar = computed(() => resolveSegment(registry, props.type, 'bottom-toolbar'))
</script>

<template>
  <div class="base-node">
    <!-- 连接点：target(左进) + source(右出)，所有节点经壳统一可连 -->
    <Handle :type="'target'" :position="pos.Left" />
    <Handle :type="'source'" :position="pos.Right" />

    <!-- top-toolbar（注册了才渲染，缺省空） -->
    <div v-if="topToolbar" class="top-toolbar">
      <component :is="topToolbar" :id="id" :data="data" />
    </div>

    <!-- title（注册了才渲染，缺省空） -->
    <div v-if="title" class="title-row">
      <component :is="title" :id="id" :data="data" />
    </div>

    <!-- content（核心；未注册时给占位，不该发生——宿主 seed 时必须给每个 type content） -->
    <div v-if="content" class="content-area">
      <component :is="content" :id="id" :data="data" />
    </div>
    <div v-else class="content-area missing">（type "{{ type }}" 未注册 content 段）</div>

    <!-- bottom-toolbar（注册了才渲染，缺省空） -->
    <div v-if="bottomToolbar" class="bottom-toolbar">
      <component :is="bottomToolbar" :id="id" :data="data" />
    </div>
  </div>
</template>

<style scoped>
.base-node {
  display: flex;
  flex-direction: column;
  min-width: 120px;
  min-height: 40px;
}
.title-row {
  padding: 4px 10px;
  border-bottom: 1px solid #e5e7eb;
  background: #fafafa;
  border-radius: 8px 8px 0 0;
}
.content-area {
  flex: 1;
}
.content-area.missing {
  color: #b45309;
  padding: 8px;
  font-size: 12px;
}
.top-toolbar,
.bottom-toolbar {
  padding: 2px 6px;
}
</style>
