<script setup lang="ts">
/**
 * TitleModelPage —— 「会话标题模型」：配置**自动给会话起名**用哪个模型。
 *
 * 用户口径（2026-10-06）：「标题应该是 AI 来生成的，在配置页面里配置这个生成标题的模型」。
 *
 * 交互：两个下拉（Provider / 模型）+ 保存。两个都留空 = 用会话默认模型（默认状态）。
 * 保存后立即生效 —— 下一轮新会话的标题就由这个模型生成。
 */
import { computed, onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

const provider = ref('')
const modelId = ref('')
const busy = ref(false)
const saved = ref(false)

onMounted(async () => {
  await agent.refresh()
  await agent.loadTitleModel()
  provider.value = s.titleModel.provider
  modelId.value = s.titleModel.modelId
})

/** 有密钥的渠道才能选（与对话用的模型同一口径：没密钥的跑不起来） */
const usableProviders = computed(() => {
  const seen = new Map<string, string[]>()
  for (const m of s.models) {
    if (!m.hasKey) continue
    const list = seen.get(m.provider) ?? []
    list.push(m.modelId)
    seen.set(m.provider, list)
  }
  return [...seen.entries()].map(([p, models]) => ({ provider: p, models }))
})
const modelsOf = computed(() => usableProviders.value.find((p) => p.provider === provider.value)?.models ?? [])

function pickProvider(p: string): void {
  provider.value = p
  // 换渠道时把模型选到该渠道的第一个（不硬留上一个渠道的模型 id）
  modelId.value = modelsOf.value[0] ?? ''; saved.value = false
}

async function save(): Promise<void> {
  busy.value = true
  try {
    await agent.saveTitleModel(provider.value, modelId.value)
    saved.value = true
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-title-model">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <section class="ap-block">
      <header class="ap-block-head">
        <h4>会话标题模型</h4>
        <span class="ap-quick"><span class="ap-count">自动命名</span></span>
      </header>
      <div class="ap-block-body">
        <p class="ap-hint">
          新会话第一轮结束后，用这个模型总结对话内容生成标题（替代「首句截断」）。
          两个都留空 = 用会话默认模型；起名失败时仍回落首句截断，不影响对话。
        </p>
        <form class="ap-fields" @submit.prevent="save">
          <label class="ap-field">Provider
            <select v-model="provider" @change="pickProvider(provider)">
              <option value="">（用会话默认模型）</option>
              <option v-for="p in usableProviders" :key="p.provider" :value="p.provider">{{ p.provider }}</option>
            </select>
          </label>
          <label class="ap-field">模型
            <select v-model="modelId" :disabled="!provider">
              <option value="">（用会话默认模型）</option>
              <option v-for="m in modelsOf" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
          <div class="ap-field-row">
            <button class="ap-submit" type="submit" :disabled="busy || (!provider && !modelId)">保存</button>
            <span v-if="saved" class="ap-hint">已保存 · 下一个新会话生效</span>
            <span v-else-if="!provider && !modelId" class="ap-hint">当前用会话默认模型</span>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

