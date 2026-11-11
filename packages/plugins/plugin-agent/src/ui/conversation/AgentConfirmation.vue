<script setup lang="ts">
/**
 * AgentConfirmation —— 工具调用的授权确认条（AI Elements Confirmation 结构）。
 *
 * 用户口径（2026-11-07）：
 * 1. 确认条要**跟在对话里的那条工具调用后面**，不要飘在面板底部；
 * 2. 标题说人话（「运行 Get-ChildItem …？」），说明写一句后果，不再把整段 JSON 当标题；
 * 3. 按钮：拒绝（outline）+ 允许（primary），与文档里的 Deny / Approve 一致。
 */
import { computed } from 'vue'
import { Terminal } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { approvalDescription, approvalTitle } from '../../model/toolMeta.js'
import type { ApprovalCard } from '../../model/sessionModel.js'

const props = defineProps<{ approval: ApprovalCard }>()
defineEmits<{ decide: [decision: 'allow' | 'deny'] }>()

const Item = useUiComponent('Item')
const ItemMedia = useUiComponent('ItemMedia')
const ItemContent = useUiComponent('ItemContent')
const ItemTitle = useUiComponent('ItemTitle')
const ItemDescription = useUiComponent('ItemDescription')
const ItemActions = useUiComponent('ItemActions')
const Button = useUiComponent('Button')

const title = computed(() => approvalTitle(props.approval.toolName, props.approval.arguments))
const description = computed(() => approvalDescription(props.approval.toolName, props.approval.arguments))
</script>

<template>
  <Item variant="outline" size="sm" class="ac-approval" role="group" aria-label="需要授权的工具调用">
    <ItemMedia variant="icon">
      <Terminal />
    </ItemMedia>
    <ItemContent>
      <ItemTitle class="ac-approval-title">{{ title }}</ItemTitle>
      <ItemDescription class="ac-approval-desc">{{ description }}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button variant="outline" size="sm" @click="$emit('decide', 'deny')">拒绝</Button>
      <Button size="sm" @click="$emit('decide', 'allow')">允许</Button>
    </ItemActions>
  </Item>
</template>

<style scoped>
/* 视觉全用组件库的 Item / Button；这里只处理「跟在工具行后面」的间距与超长文字。 */
.ac-approval {
  margin: 4px 0 10px;
  max-width: 100%;
}

.ac-approval-title,
.ac-approval-desc {
  min-width: 0;
  max-width: 100%;
  word-break: break-word;
}
</style>
