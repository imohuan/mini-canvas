<script setup lang="ts">
/**
 * ModelsPage —— 「模型接入」页：**一个渠道配一批模型**。
 *
 * 结构（用户口径 2026-11-11：编辑像切换二级菜单，不要列表和表单挤在一页）：
 *   列表态：一行一个渠道（名字 / 地址 / 模型数），右上「添加渠道」；
 *   编辑态：整页换成这个渠道的配置页，左上「返回渠道列表」；
 * 不再同时显示「上表 + 下方长表单」。
 *
 * 密钥只写不回读：服务端只给 hasKey / apiKeyMask；编辑时留空或保留掩码 = 不改。
 * UI 全部来自 @mini-canvas/ui-kit-shadcn。
 */
import { computed, onMounted, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import SettingsDetailHeader from './components/SettingsDetailHeader.vue'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Select = useUiComponent('Select')
const SelectContent = useUiComponent('SelectContent')
const SelectItem = useUiComponent('SelectItem')
const SelectTrigger = useUiComponent('SelectTrigger')
const SelectValue = useUiComponent('SelectValue')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state
const busy = ref(false)

// 协议清单从后台读（SDK 的真实契约），不在界面里写死。
// 默认必须是 openai-chat：deepseek-v4 虽能吐思考载荷，但实测会让 Node 进程静默崩溃。
const DEFAULT_CLIENT = 'openai-chat'
const clientOptions = computed(() => {
  const list = s.clientTypes.length ? s.clientTypes : ['openai-chat', 'deepseek-v4']
  return [DEFAULT_CLIENT, ...list.filter((c) => c !== DEFAULT_CLIENT)]
})
const clientChoices = computed(() => clientOptions.value.map((c) => ({ label: c, value: c })))

/** false = 列表态；true = 正在编辑（editingExisting=false 表示新建） */
const editing = ref(false)
const editingExisting = ref(false)

const form = ref({
  provider: '',
  apiKey: '',
  baseUrl: '',
  clientType: DEFAULT_CLIENT as string,
  vision: true,
})
/** 已存密钥的掩码（编辑已有渠道时显示；原样回传 = 不改） */
const savedKeyMask = ref('')
const candidates = ref<string[]>([])
const picked = ref<Set<string>>(new Set())
const upstreamHint = ref('')
const notice = ref('')

onMounted(() => void agent.refresh())

interface ProviderGroup {
  provider: string
  baseUrl: string
  clientType: string
  hasKey: boolean
  apiKeyMask: string
  models: string[]
  defaultModel?: string
}

const groups = computed<ProviderGroup[]>(() => {
  const map = new Map<string, ProviderGroup>()
  for (const m of s.models) {
    if (!m.hasKey) continue
    let g = map.get(m.provider)
    if (!g) {
      g = {
        provider: m.provider,
        baseUrl: m.baseUrl ?? '',
        clientType: m.clientType ?? DEFAULT_CLIENT,
        hasKey: true,
        apiKeyMask: m.apiKeyMask ?? '',
        models: [],
      }
      map.set(m.provider, g)
    }
    g.models.push(m.modelId)
    if (m.isDefault) g.defaultModel = m.modelId
    if (!g.baseUrl && m.baseUrl) g.baseUrl = m.baseUrl
    if (!g.apiKeyMask && m.apiKeyMask) g.apiKeyMask = m.apiKeyMask
  }
  return [...map.values()]
})

const editingTitle = computed(() =>
  editingExisting.value ? '配置渠道 · ' + form.value.provider : '添加渠道',
)

function editGroup(g: ProviderGroup): void {
  form.value.provider = g.provider
  form.value.baseUrl = g.baseUrl
  form.value.clientType = g.clientType || DEFAULT_CLIENT
  form.value.apiKey = g.apiKeyMask
  form.value.vision = true
  savedKeyMask.value = g.apiKeyMask
  candidates.value = [...g.models]
  picked.value = new Set(g.models)
  editingExisting.value = true
  editing.value = true
  upstreamHint.value = ''
  notice.value = ''
}

function startNew(): void {
  form.value = {
    provider: '',
    baseUrl: '',
    apiKey: '',
    clientType: DEFAULT_CLIENT,
    vision: true,
  }
  savedKeyMask.value = ''
  candidates.value = []
  picked.value = new Set()
  editingExisting.value = false
  editing.value = true
  upstreamHint.value = ''
  notice.value = ''
}

function backToList(): void {
  editing.value = false
  editingExisting.value = false
  notice.value = ''
  s.error = ''
}

async function pullUpstream(): Promise<void> {
  upstreamHint.value = '正在拉取…'
  notice.value = ''
  const r = await agent.loadUpstreamModels({
    provider: form.value.provider,
    baseUrl: form.value.baseUrl,
    apiKey: form.value.apiKey,
  })
  if (!r.ok) {
    upstreamHint.value = '拉取失败：' + (r.error ?? '')
    return
  }
  upstreamHint.value = '拉到 ' + r.models.length + ' 个模型'
  candidates.value = [...new Set([...r.models, ...candidates.value])]
  if (!editingExisting.value) picked.value = new Set()
}

function togglePick(id: string): void {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}
const pickAll = (): void => {
  picked.value = new Set(candidates.value)
}
const invertPick = (): void => {
  const next = new Set<string>()
  for (const c of candidates.value) if (!picked.value.has(c)) next.add(c)
  picked.value = next
}
const clearPick = (): void => {
  picked.value = new Set()
}

async function save(): Promise<void> {
  if (!form.value.provider.trim()) {
    s.error = '请先填渠道名'
    return
  }
  if (!picked.value.size) {
    s.error = '至少勾选一个模型'
    return
  }
  busy.value = true
  s.error = ''
  try {
    const modelIds = [...picked.value]
    await agent.saveModelsBulk({
      provider: form.value.provider.trim(),
      modelIds,
      ...(form.value.apiKey ? { apiKey: form.value.apiKey } : {}),
      ...(form.value.baseUrl ? { baseUrl: form.value.baseUrl } : {}),
      ...(form.value.clientType ? { clientType: form.value.clientType } : {}),
      vision: form.value.vision,
      removeMissing: editingExisting.value,
      ...(editingExisting.value ? {} : { makeDefault: modelIds[0] }),
    })
    const savedProvider = form.value.provider.trim()
    // 保存成功回到列表：刚改完的渠道就在第一屏。
    editing.value = false
    editingExisting.value = false
    notice.value = '已保存「' + savedProvider + '」：' + modelIds.length + ' 个模型'
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-models">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <!-- ==================== 列表态 ==================== -->
    <template v-if="!editing">
      <div class="ap-list-head">
        <span class="ap-hint">{{ groups.length }} 个渠道 · {{ s.models.filter((m) => m.hasKey).length }} 个模型</span>
        <Button size="sm" type="button" @click="startNew">
          <Plus :size="13" aria-hidden="true" /> 添加渠道
        </Button>
      </div>

      <ul class="ap-list">
        <li v-for="g in groups" :key="g.provider" class="ap-list-row">
          <div class="ap-list-main">
            <div class="ap-list-title">
              <span class="ap-list-name">{{ g.provider }}</span>
              <span v-if="g.defaultModel" class="ap-badge">默认 {{ g.defaultModel }}</span>
            </div>
            <div class="ap-list-desc">{{ g.baseUrl || '未填接口地址' }}</div>
            <div class="ap-list-meta">{{ g.models.length }} 个模型 · {{ g.clientType }}</div>
          </div>
          <Button variant="outline" size="sm" type="button" :aria-label="'配置 ' + g.provider" @click="editGroup(g)">配置</Button>
        </li>
      </ul>
      <p v-if="!groups.length" class="ap-empty">还没有渠道 —— 点右上「添加渠道」，填地址、拉模型、勾选后保存</p>
      <p v-if="notice" class="ap-hint">{{ notice }}</p>
    </template>

    <!-- ==================== 编辑态（二级页） ==================== -->
    <template v-else>
      <SettingsDetailHeader
        back-label="返回渠道列表"
        :title="editingTitle"
        :description="editingExisting ? '改完保存会回到列表；取消勾选等于从渠道里删掉这个模型' : '填地址、拉模型清单、勾选要用的模型，然后保存'"
        @back="backToList"
      >
        <template #actions>
          <div class="ap-detail-actions">
            <Button variant="outline" size="sm" type="button" @click="backToList">取消</Button>
            <Button type="button" size="sm" :disabled="busy" @click="save">
              {{ busy ? '保存中…' : editingExisting ? '保存修改' : '添加渠道' }}
            </Button>
          </div>
        </template>
      </SettingsDetailHeader>

      <form class="ap-form-stack ap-model-form" @submit.prevent="save">
        <ShadcnSettingsSection title="渠道信息" class="ap-flush-card">
          <ShadcnSettingsRow label="渠道名" description="给这批模型起个名字，例如 deepseek、token01">
            <Input v-model="form.provider" class="ap-input" aria-label="渠道名" placeholder="例如 deepseek" />
          </ShadcnSettingsRow>
          <ShadcnSettingsRow label="接口地址" description="上游 OpenAI 兼容地址，通常以 /v1 结尾">
            <Input v-model="form.baseUrl" class="ap-input" aria-label="接口地址" placeholder="https://{接口地址}/v1" />
          </ShadcnSettingsRow>
          <ShadcnSettingsRow
            label="密钥"
            :description="editingExisting && savedKeyMask ? '已存密钥：' + savedKeyMask + '（只显示掩码，明文不会下发）' : '只写不回读，保存后界面只会看到掩码'"
          >
            <Input
              v-model="form.apiKey"
              class="ap-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              aria-label="密钥"
              :placeholder="editingExisting ? '留空 = 不改动已存密钥' : '粘贴密钥'"
            />
          </ShadcnSettingsRow>
          <ShadcnSettingsRow label="接入协议" description="默认 openai-chat（稳）。deepseek-v4 会出思考但实测会让服务崩溃，谨慎切换。">
            <Select v-model="form.clientType">
              <SelectTrigger class="ap-select" size="sm" aria-label="接入协议">
                <SelectValue />
              </SelectTrigger>
              <SelectContent class="settings-floating-layer" position="popper" side="bottom" :side-offset="4">
                <SelectItem v-for="c in clientChoices" :key="c.value" :value="c.value">{{ c.label }}</SelectItem>
              </SelectContent>
            </Select>
          </ShadcnSettingsRow>
        </ShadcnSettingsSection>

        <ShadcnSettingsSection
          title="模型清单"
          class="ap-flush-card"
          :description="'已选 ' + picked.size + ' / ' + candidates.length + ' 个 · 点标签切换选中'"
        >
          <div class="ap-model-pull">
            <Button variant="outline" size="sm" type="button" @click="pullUpstream">拉取模型清单</Button>
            <span class="ap-hint">{{ upstreamHint || '向上游要模型清单，再勾选要留下的模型' }}</span>
          </div>

          <div v-if="candidates.length" class="ap-picker">
            <div class="ap-picker-head">
              <span class="ap-quick">
                <Button variant="outline" size="xs" type="button" @click="pickAll">全选</Button>
                <Button variant="outline" size="xs" type="button" @click="invertPick">反选</Button>
                <Button variant="outline" size="xs" type="button" @click="clearPick">清空</Button>
              </span>
            </div>
            <div class="ap-tagpool" role="listbox" aria-multiselectable="true" aria-label="选择模型">
              <Button
                v-for="m in candidates"
                :key="m"
                :variant="picked.has(m) ? 'default' : 'outline'"
                size="xs"
                type="button"
                class="ap-tagchip"
                :class="{ 'is-on': picked.has(m) }"
                role="option"
                :aria-selected="picked.has(m)"
                :title="m"
                @click="togglePick(m)"
              >{{ m }}</Button>
            </div>
          </div>
          <p v-else class="ap-hint">还没有候选模型 —— 点上面的「拉取模型清单」。</p>
        </ShadcnSettingsSection>

      </form>
    </template>
  </div>
</template>

<style scoped>
.ap-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ap-list-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 10px; }
.ap-list-row:hover { background: var(--ui-hover, #f4f6f9); }
.ap-list-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ap-list-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ap-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-badge { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); font-size: 10px; color: var(--ui-accent-hover, #0e7490); }
.ap-list-desc, .ap-list-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ap-list-meta { font-size: 10.5px; color: var(--ui-ink-mute, #8c95a3); }
.ap-model-form { padding-bottom: 4px; }
.ap-model-pull { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0 10px; }
.ap-input { width: 100%; }
.ap-select { width: 180px; }
.ap-detail-actions { display: flex; align-items: center; gap: 8px; }
.ap-tagchip { height: 24px; max-width: 100%; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; }
/* 渠道的字段已经由 SettingsRow 自己排好了：卡片不要再包一层内框，
   否则同一个「渠道信息」会出现两层边框（2026-11-11 截图里那种套娃观感）。 */
.ap-flush-card :deep(.shadcn-settings-section__body) { border: 0; background: transparent; padding: 0; overflow: visible; }
</style>
