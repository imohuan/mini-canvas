<script setup lang="ts">
/**
 * AgentConfirmation —— 工具调用的授权确认卡（AI Elements Confirmation 结构）。
 *
 * 用户口径（2026-11-17，方案 B）：
 * 1. 确认卡排在工具组**折叠层外面**（位置由 AgentMessageList 负责）；
 * 2. 文字分四层 —— 标题一行、命令独立代码块、说明单独一行、按钮单独一行；
 *    以前标题里塞整条命令、说明和图标挤在同一基线，长命令被按钮挤成「Firs t 2」；
 * 3. 按钮：拒绝（outline）+ 允许（primary），与文档里的 Deny / Approve 一致。
 */
import { computed } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { approvalCommand, approvalDescription, approvalTitle } from '../../model/toolMeta.js'
import type { ApprovalCard } from '../../model/sessionModel.js'

const props = defineProps<{ approval: ApprovalCard }>()
defineEmits<{ decide: [decision: 'allow' | 'deny'] }>()

const Item = useUiComponent('Item')
const ItemMedia = useUiComponent('ItemMedia')
const ItemDescription = useUiComponent('ItemDescription')
const Button = useUiComponent('Button')

const title = computed(() => approvalTitle(props.approval.toolName, props.approval.arguments))
const description = computed(() => approvalDescription(props.approval.toolName, props.approval.arguments))
const command = computed(() => approvalCommand(props.approval.toolName, props.approval.arguments))
const isCommand = computed(() => /^(exec|input)_command$/.test(props.approval.toolName.replace(/^mcp__[A-Za-z0-9_-]+__/, '')))
const commandLabel = computed(() => (isCommand.value ? '要运行的命令' : '要操作的文件'))
</script>

<template>
  <Item variant="outline" size="sm" class="ac-approval" role="group" aria-label="需要授权的工具调用">
    <!-- 第一层：图标 + 标题（只回答“要干什么”，不含命令原文） -->
    <div class="ac-approval-head">
      <ItemMedia variant="icon" class="ac-approval-media">
        <ShieldAlert />
      </ItemMedia>
      <p class="ac-approval-title">{{ title }}</p>
    </div>

    <!-- 第二层：命令 / 路径独占一块（等宽、可换行、超长在块内滚动） -->
    <div v-if="command" class="ac-approval-block">
      <span class="ac-approval-label">{{ commandLabel }}</span>
      <pre class="ac-approval-cmd">{{ command }}</pre>
    </div>

    <!-- 第三层：一句后果说明，单独成行 -->
    <ItemDescription class="ac-approval-desc">{{ description }}</ItemDescription>

    <!-- 第四层：按钮自己一行，靠右 -->
    <div class="ac-approval-foot">
      <Button variant="outline" size="sm" @click="$emit('decide', 'deny')">拒绝</Button>
      <Button size="sm" @click="$emit('decide', 'allow')">允许</Button>
    </div>
  </Item>
</template>

<style scoped>
/* 视觉全用组件库的 Item / Button；这里只处理分层排版与超长文字的收敛。 */
.ac-approval {
  /* Item 默认是横向 flex + 居中；这里改成纵向四层。 */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin: 4px 0 10px;
  max-width: 100%;
}

.ac-approval-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ac-approval-media {
  flex: none;
  color: var(--ui-warn, #e3a25f);
}

.ac-approval-title {
  margin: 0;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--ui-ink, #f7f7f7);
  word-break: break-word;
}

.ac-approval-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ac-approval-label {
  font-size: 11px;
  line-height: 16px;
  color: var(--ui-ink-dim, #919191);
}

.ac-approval-cmd {
  margin: 0;
  max-width: 100%;
  max-height: 96px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--ui-line, #363636);
  background: var(--ui-code-bg, rgb(0 0 0 / 0.25));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ui-ink, #f7f7f7);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ac-approval-desc {
  min-width: 0;
  max-width: 100%;
  word-break: break-word;
}

.ac-approval-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
