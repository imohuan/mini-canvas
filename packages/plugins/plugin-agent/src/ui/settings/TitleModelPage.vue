<script setup lang="ts">
/**
 * TitleModelPage —— 「会话标题模型」：配置自动给会话起名用哪个模型。
 *
 * 用户口径（2026-10-06）：「标题应该是 AI 来生成的，在配置页面里配置这个生成标题的模型」。
 * 两个下拉 + 保存；两个都留空 = 用会话默认模型。保存后立即生效。
 *
 * 下拉直接用 ui-kit-shadcn（不再经 useUiComponent 转接）。
 */
import { computed, onMounted, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Save } from 'lucide-vue-next'
import { useAgent } from '../../plugin/useAgent.js'
import './settings.css'

const Button = useUiComponent('Button')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

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
/** 空值 = 用会话默认模型（后台的既有语义）。 */
const DEFAULT_VALUE = '__default__'
const providerChoices = computed(() => [
  { label: '（用会话默认模型）', value: DEFAULT_VALUE },
  ...usableProviders.value.map((p) => ({ label: p.provider, value: p.provider })),
])
const modelChoices = computed(() => [
  { label: '（用会话默认模型）', value: DEFAULT_VALUE },
  ...modelsOf.value.map((m) => ({ label: m, value: m })),
])

function pickProvider(value: string): void {
  const p = value === DEFAULT_VALUE ? '' : value
  provider.value = p
  // 换渠道时把模型选到该渠道的第一个（不硬留上一个渠道的模型 id）
  modelId.value = modelsOf.value[0] ?? ''
  saved.value = false
}

function pickModel(value: string): void {
  modelId.value = value === DEFAULT_VALUE ? '' : value
  saved.value = false
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

    <ShadcnSettingsSection
      title="会话标题模型"
      description="新会话第一轮结束后，用这个模型总结对话内容生成标题（替代「首句截断」）。两个都留空 = 用会话默认模型；起名失败时仍回落首句截断，不影响对话。"
    >
      <ShadcnSettingsRow label="渠道" description="只有配了密钥的渠道能选">
        <Select :model-value="provider || DEFAULT_VALUE" @update:model-value="pickProvider(String($event))">
          <SelectTrigger class="ap-select" size="sm" aria-label="会话标题渠道">
            <SelectValue placeholder="选择渠道" />
          </SelectTrigger>
          <!-- 设置弹窗里的浮层：popper + 抬高到遮罩之上 -->
          <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
            <SelectItem v-for="c in providerChoices" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
          </SelectContent>
        </Select>
      </ShadcnSettingsRow>

      <ShadcnSettingsRow label="模型" description="留空 = 跟随会话默认模型">
        <Select :model-value="modelId || DEFAULT_VALUE" :disabled="!provider" @update:model-value="pickModel(String($event))">
          <SelectTrigger class="ap-select" size="sm" aria-label="会话标题模型">
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
            <SelectItem v-for="c in modelChoices" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
          </SelectContent>
        </Select>
      </ShadcnSettingsRow>

      <ShadcnSettingsRow label="保存" description="保存后下一个新会话生效">
        <div class="ap-form-actions">
          <Button type="button" size="sm" :disabled="busy || (!provider && !modelId)" @click="save">
            <Save :size="13" aria-hidden="true" /> {{ busy ? '保存中…' : '保存' }}
          </Button>
          <span v-if="saved" class="ap-hint">已保存</span>
          <span v-else-if="!provider && !modelId" class="ap-hint">当前用会话默认模型</span>
        </div>
      </ShadcnSettingsRow>
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-select { width: 200px; }
.ap-form-actions { display: flex; align-items: center; gap: 8px; }
</style>
