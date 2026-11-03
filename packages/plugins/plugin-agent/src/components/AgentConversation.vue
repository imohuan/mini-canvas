<script setup lang="ts">
/**
 * AgentConversation —— 对话内容（消息流 + 输入区）的编排入口。
 *
 * 纯拆分：原逻辑、事件、class、文案和样式数值原样保留，只把块搬进
 * agent-conversation/；行为仍由 useAgentConversation 这一份控制器驱动。
 * 外壳在 packages/ui：外壳管位置/尺寸/拖拽/停靠，本组件只管红框里那一块。
 */
import { provide } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgentConversation } from './agent-conversation/useAgentConversation'
import AgentMessageList from './agent-conversation/AgentMessageList.vue'
import AgentComposer from './agent-conversation/AgentComposer.vue'

defineOptions({ inheritAttrs: false })

const c = useAgentConversation()
provide('agentConversation', c)

const { agent, s, MediaViewer, previewItem, previewImage } = c
const Button = useUiComponent('Button')
</script>

<template>
  <div class="ac-root" aria-label="Agent 对话">
    <!-- ① 未配模型：引导 -->
    <div v-if="s.needsModel" class="ac-onboard">
      <Sparkles :size="22" class="ac-onboard-icon" />
      <strong>还没有可用的模型</strong>
      <p>先去设置里加一个带 API Key 的模型，回来就能对话了。</p>
      <p class="ac-onboard-path">{{ s.models.length ? '现有模型都没有密钥' : '当前没有任何模型' }}</p>
    </div>

    <!-- ② 连不上后台 -->
    <div v-else-if="s.offline" class="ac-onboard">
      <strong>连不上后台</strong>
      <p>{{ s.error || '请确认 cloud-server 已经启动。' }}</p>
      <p class="ac-onboard-path">{{ s.baseUrl || '同源（当前页面所在地址）' }}</p>
      <Button size="sm" @click="agent.refresh()">重试连接</Button>
    </div>

    <!-- ③ 消息流 -->
    <AgentMessageList v-else />

    <AgentComposer />

    <!-- 看大图：主题注册的 MediaViewer（Esc / 点遮罩 / 右上角关闭；与全站预览同款交互） -->
    <MediaViewer :item="previewItem" @close="previewImage = null" />
  </div>
</template>

<style scoped>
/* 数值全部来自 Chrome MCP 对参考页的实测；颜色一律走 --ui-*（实测与本项目暗色主题同值）。 */
/* position: relative 是给「回到底部」的绝对定位做参照（它挂在消息区右下角） */
.ac-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--ui-ink, #f7f7f7);
  /* 展开内容的统一高度上限（用户口径 2026-10-25）：思考过程、工具输入 /
     输出、工具分组、卡片详情共用一个值。不设上限时，长日志会把整段对话
     一路撑长；超出后在各自块内滚动，面板高度保持稳定。 */
  --ac-expand-max-height: min(360px, 50vh);
}

/* 拆分后这两块挂在本入口里，样式必须留在同一组件内：scoped 只作用于自己的元素。 */
.ac-onboard {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.ac-onboard strong {
  font-size: 15px;
}

.ac-onboard p {
  margin: 0;
  font-size: 13px;
  color: var(--ui-ink-dim, #919191);
}

.ac-onboard-icon {
  color: var(--ui-accent, #0891b2);
}

.ac-onboard-path {
  font-size: 12px;
  opacity: 0.75;
  word-break: break-all;
}
</style>
