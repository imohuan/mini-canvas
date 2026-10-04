<script setup lang="ts">
// 系统提示词页：写进 agent_state/AGENTS.md，下一轮对话即生效。
import { onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state
const text = ref('')
const saved = ref('')
const busy = ref(false)

onMounted(async () => {
  await agent.refresh()
  text.value = s.systemPrompt
  saved.value = s.systemPrompt
})

async function save(): Promise<void> {
  busy.value = true
  try {
    await agent.saveSystemPrompt(text.value)
    saved.value = s.systemPrompt
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-prompt">
    <section class="ap-block">
      <header class="ap-block-head">
        <h4>Agent 系统提示词</h4>
        <span class="ap-count">{{ text.length }} 字</span>
      </header>
      <div class="ap-block-body">
        <textarea v-model="text" class="ap-textarea" rows="12"
          aria-label="Agent 系统提示词"
          placeholder="例如：你是这个画布的助手，回答请简短，优先用画布上的节点信息。"></textarea>
        <div class="ap-prompt-foot">
          <span class="ap-hint">写进 agent_state/AGENTS.md，下一轮对话生效</span>
          <button class="ap-submit" :disabled="busy || text === saved" @click="save">保存</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ap-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; line-height: 1.6; resize: vertical; outline: none; font-family: inherit; }
.ap-prompt-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
</style>
