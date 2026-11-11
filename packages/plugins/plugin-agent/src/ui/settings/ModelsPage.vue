<script setup lang="ts">
/**
 * ModelsPage —— 「模型接入」：一个渠道配一批模型。
 *
 * 结构（用户口径 2026-11-11：列表 → 二级编辑页）：
 *   列表：一行一个渠道（名字 / 地址 / 模型数），右上「添加渠道」；
 *   编辑：整页换成这个渠道的配置页，左上「返回渠道列表」，操作条固定在底部；
 *
 * 这一版补的三件事（用户 2026-11-11 续）：
 *   1. 检测：用表单**当前**填的地址与密钥真发一条短对话（不是只列 /models）；
 *   2. 自定义模型：拉取清单失败 / 上游漏列时，可以手输模型 ID 加进候选池；
 *   3. 选中某个模型再「测试」：只测这一个，看它能不能真的聊。
 *
 * 协议：清单来自 SDK 内置目录（第三方端点通用的是 openai-chat / openai-responses /
 * ant-messages）；用户不确定时可选「自动检测」，后端依次试通用协议。
 *
 * 密钥只写不回读：服务端只给 hasKey / apiKeyMask；留空或保留掩码 = 不改。
 */
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, Plus, XCircle } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import type { ModelProbeView } from '../../api/agentApi.js'
import SettingsDetailHeader from './components/SettingsDetailHeader.vue'
import { probeModelsConcurrently } from './modelProbeBatch.js'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Badge = useUiComponent('Badge')
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

/**
 * 接入协议。
 *
 * 通用三种来自 SDK 文档（第三方端点用它们）：openai-chat / openai-responses / ant-messages。
 * 厂商专属（deepseek-v4 / minimax-m3 / openai-chat-vllm-adapter）来自 SDK 目录，
 * 只有确实用那个厂商时才选；不确定就用「自动检测」。
 */
const DEFAULT_CLIENT = 'openai-chat'
const AUTO_CLIENT = 'auto'
const clientOptions = computed(() => {
  const list = (s.clientTypes.length ? s.clientTypes : [DEFAULT_CLIENT]).filter((c) => c !== AUTO_CLIENT)
  return [AUTO_CLIENT, DEFAULT_CLIENT, ...list.filter((c) => c !== DEFAULT_CLIENT)]
})
const clientChoices = computed(() =>
  clientOptions.value.map((c) => ({ label: clientLabel(c), value: c })),
)

/** 协议名称写清楚它是什么：第三方端点通常是前三种通用协议，后面几种只属于特定厂商。 */
function clientLabel(c: string): string {
  if (c === AUTO_CLIENT) return '自动检测（推荐）'
  if (c === 'openai-chat') return 'openai-chat · OpenAI Chat（通用）'
  if (c === 'openai-responses') return 'openai-responses · OpenAI Responses（通用）'
  if (c === 'ant-messages') return 'ant-messages · Anthropic Messages（通用）'
  if (c === 'openai-chat-vllm-adapter') return 'openai-chat-vllm-adapter · vLLM（专属）'
  if (c === 'deepseek-v4') return 'deepseek-v4 · DeepSeek（专属）'
  if (c === 'minimax-m3') return 'minimax-m3 · MiniMax（专属）'
  return c
}

/** false = 列表态；true = 正在编辑（editingExisting=false 表示新建） */
const editing = ref(false)
const editingExisting = ref(false)

const form = ref({
  provider: '',
  apiKey: '',
  baseUrl: '',
  clientType: AUTO_CLIENT as string,
  vision: true,
})
/** 已存密钥的掩码（编辑已有渠道时显示；原样回传 = 不改） */
const savedKeyMask = ref('')
const candidates = ref<string[]>([])
const picked = ref<Set<string>>(new Set())
/** 编辑模型清单：true = 多选「保留哪些」；false = 已保存后的正常态 */
const modelEditing = ref(false)
/** 正常态里勾选「要测试哪些」（与保存无关） */
const testSelected = ref<Set<string>>(new Set())
/** 每个模型的测试结果（正常态可一次测多个） */
const probeResults = ref<Record<string, ModelProbeView>>({})
/** 并发测试进度：已回来 / 本次共测几个 */
const probeProgress = ref<{ done: number; total: number }>({ done: 0, total: 0 })
/** 正在跑的那一批（每次测试换一个编号：上一批晚到的结果不能写进新一批） */
let probeRun = 0
const customModel = ref('')
const upstreamHint = ref('')
const notice = ref('')

/* —— 检测结果 —— */
const probing = ref(false)

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

/** 已保存的模型（正常态展示它；编辑态才看候选池） */
const savedModels = computed(() => candidates.value.filter((m) => picked.value.has(m)))

/** 已保存模型的真实测试结果：正常态逐条显示（不用 v-for 里的索引推断） */
const probeEntries = computed(() =>
  savedModels.value.flatMap((m) => (probeResults.value[m] ? [{ model: m, result: probeResults.value[m]! }] : [])),
)

function resetProbe(): void {
  // 取消在途批次的写回（换协议 / 改输入后，旧结论不能落进新状态）
  probeRun += 1
  probeResults.value = {}
  probeProgress.value = { done: 0, total: 0 }
}

/** 进入「编辑模型」：才能多选保留哪些、手写模型 ID */
function startModelEdit(): void {
  modelEditing.value = true
  testSelected.value = new Set()
  resetProbe()
}

/** 结束编辑：回到正常态，交给上面的「保存」落盘 */
function finishModelEdit(): void {
  modelEditing.value = false
  testSelected.value = new Set()
  resetProbe()
  s.error = ''
}

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
  modelEditing.value = false
  testSelected.value = new Set()
  upstreamHint.value = ''
  notice.value = ''
  resetProbe()
}

function startNew(): void {
  form.value = {
    provider: '',
    baseUrl: '',
    apiKey: '',
    clientType: AUTO_CLIENT,
    vision: true,
  }
  savedKeyMask.value = ''
  candidates.value = []
  picked.value = new Set()
  customModel.value = ''
  editingExisting.value = false
  editing.value = true
  modelEditing.value = true
  upstreamHint.value = ''
  notice.value = ''
  resetProbe()
}

function backToList(): void {
  editing.value = false
  editingExisting.value = false
  notice.value = ''
  s.error = ''
  resetProbe()
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
    upstreamHint.value = '拉取失败：' + (r.error ?? '') + '（可以在下面手动填写模型 ID）'
    return
  }
  upstreamHint.value = '拉到 ' + r.models.length + ' 个模型'
  candidates.value = [...new Set([...r.models, ...candidates.value])]
  if (!editingExisting.value) picked.value = new Set()
  // 拉到清单 = 正在挑模型，自动进入编辑态
  modelEditing.value = true
}

/** 上游没列出来的模型：手输 ID 加进候选池（并默认勾上，省一次点击） */
function addCustomModel(): void {
  const id = customModel.value.trim()
  if (!id) return
  if (!candidates.value.includes(id)) candidates.value = [...candidates.value, id]
  picked.value = new Set([...picked.value, id])
  customModel.value = ''
  s.error = ''
}

function togglePick(id: string): void {
  const next = new Set(picked.value)
  const wasOn = next.has(id)
  if (wasOn) next.delete(id)
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

/** 正常态：点一下切换「测试选中」 */
function toggleTest(id: string): void {
  const next = new Set(testSelected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  testSelected.value = next
  const copy = { ...probeResults.value }
  delete copy[id]
  probeResults.value = copy
}

const testAllSaved = (): void => {
  testSelected.value = new Set(savedModels.value)
  resetProbe()
}
const clearTest = (): void => {
  testSelected.value = new Set()
  resetProbe()
}

/**
 * 检测：用表单**当前**的值真发一条短请求。
 *
 * 没勾任何模型时测的是「手写的那一个」；检测不会保存配置，所以填错了不会污染已存渠道。
 */
/** 正常态：**并发**测试选中的模型（可多选），结果分别落在每个模型下面 */
async function testSelectedModels(): Promise<void> {
  const ids = [...testSelected.value]
  if (!ids.length) {
    s.error = '先勾选要测试的模型'
    return
  }
  probing.value = true
  s.error = ''
  // 先清结果，再写进度：resetProbe 也会清进度，顺序反了会显示成 0/0（2026-11-11 实测）
  resetProbe()
  probeProgress.value = { done: 0, total: ids.length }
  const run = ++probeRun
  // 按本次点击时的表单值发请求：测试途中用户改输入框不影响已经发出去的那批。
  const snapshot = {
    provider: form.value.provider || undefined,
    ...(form.value.baseUrl ? { baseUrl: form.value.baseUrl } : {}),
    ...(form.value.apiKey ? { apiKey: form.value.apiKey } : {}),
    clientType: form.value.clientType || AUTO_CLIENT,
  }
  try {
    // **并发**：每个模型各自发一条，谁先回来谁先落到卡片上；
    // 一个失败不拦住其它模型（旧写法是 for-await，慢模型会把整批拖成串行）。
    await probeModelsConcurrently(
      ids,
      (modelId) => agent.probeModel({ ...snapshot, modelId }),
      (modelId, result) => {
        if (run !== probeRun) return
        probeResults.value = { ...probeResults.value, [modelId]: result }
        // 自动检测通了：把表单协议切到实测值（保存时就用它）
        if (result.ok && result.clientType && result.clientType !== AUTO_CLIENT) {
          form.value.clientType = result.clientType
        }
      },
      () => {
        if (run !== probeRun) return
        probeProgress.value = { ...probeProgress.value, done: probeProgress.value.done + 1 }
      },
    )
  } finally {
    // 只有这一批还是“当前批”时才收起 loading：连点两次不会让先结束的旧批提前解锁
    if (run === probeRun) probing.value = false
  }
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
      ...(form.value.clientType && form.value.clientType !== AUTO_CLIENT
        ? { clientType: form.value.clientType }
        : {}),
      vision: form.value.vision,
      removeMissing: editingExisting.value,
      ...(editingExisting.value ? {} : { makeDefault: modelIds[0] }),
    })
    const savedProvider = form.value.provider.trim()
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
        :description="editingExisting ? '改完保存会回到列表；取消勾选等于从渠道里删掉这个模型' : '填地址、拉模型或手动添加，勾选后保存'"
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
            <Input v-model="form.baseUrl" class="ap-input" aria-label="接口地址" placeholder="https://{接口地址}/v1" @input="resetProbe" />
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
              @input="resetProbe"
            />
          </ShadcnSettingsRow>
          <ShadcnSettingsRow
            label="接入协议"
            description="不确定就选「自动检测」：会依次试通用协议。第三方端点通用的是 openai-chat / openai-responses / ant-messages。"
          >
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
          :description="modelEditing
            ? '编辑中：点标签决定保留哪些模型，完成后点「完成编辑」'
            : savedModels.length + ' 个已保存模型 · 勾选后可以一次测多个'"
          class="ap-flush-card"
        >
          <!-- ===== 编辑模型清单（多选 1）：决定保留哪些模型 ===== -->
          <template v-if="modelEditing">
            <div class="ap-model-pull">
              <Button variant="outline" size="sm" type="button" @click="pullUpstream">拉取模型清单</Button>
              <span class="ap-hint">{{ upstreamHint || '向上游要模型清单，再勾选要留下的模型' }}</span>
            </div>

            <div class="ap-custom-row">
              <Input
                v-model="customModel"
                class="ap-input"
                aria-label="自定义模型 ID"
                placeholder="上游没列出来？直接输入模型 ID"
                @keydown.enter.prevent="addCustomModel"
              />
              <Button variant="outline" size="sm" type="button" :disabled="!customModel.trim()" @click="addCustomModel">
                <Plus :size="13" aria-hidden="true" /> 添加模型
              </Button>
            </div>

            <div v-if="candidates.length" class="ap-picker">
              <div class="ap-picker-head">
                <span class="ap-hint">保留 {{ picked.size }} / {{ candidates.length }} 个</span>
                <span class="ap-quick">
                  <Button variant="outline" size="xs" type="button" @click="pickAll">全选</Button>
                  <Button variant="outline" size="xs" type="button" @click="invertPick">反选</Button>
                  <Button variant="outline" size="xs" type="button" @click="clearPick">清空</Button>
                </span>
              </div>
              <div class="ap-tagpool" role="listbox" aria-multiselectable="true" aria-label="选择要保留的模型">
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
            <p v-else class="ap-hint">还没有候选模型 —— 点「拉取模型清单」，或在上面手填模型 ID。</p>

            <div class="ap-edit-foot">
              <Button variant="outline" size="sm" type="button" @click="finishModelEdit">完成编辑</Button>
            </div>
          </template>

          <!-- ===== 正常态（多选 2）：勾选要测的模型，逐个真实请求 ===== -->
          <template v-else>
            <div class="ap-test-toolbar">
              <span class="ap-hint">勾选模型后点「测试选中」——每个都会真发一句请求</span>
              <Button variant="outline" size="sm" type="button" @click="startModelEdit">编辑模型</Button>
            </div>

            <div v-if="savedModels.length" class="ap-saved-list">
              <label v-for="m in savedModels" :key="m" class="ap-saved-row" :class="{ 'is-test-on': testSelected.has(m) }">
                <input
                  type="checkbox"
                  class="ap-saved-check"
                  :checked="testSelected.has(m)"
                  :aria-label="'选择测试 ' + m"
                  @change="toggleTest(m)"
                />
                <span class="ap-saved-name">{{ m }}</span>
                <span v-if="probeResults[m]" class="ap-saved-result" :class="{ 'is-ok': probeResults[m].ok }">
                  <template v-if="probeResults[m].ok">通 · {{ probeResults[m].clientType }} · {{ probeResults[m].latencyMs }}ms</template>
                  <template v-else>没通</template>
                </span>
              </label>
            </div>
            <p v-else class="ap-hint">还没有模型 —— 点「编辑模型」添加。</p>

            <div class="ap-test-actions">
              <span class="ap-quick">
                <Button variant="outline" size="xs" type="button" @click="testAllSaved">全选</Button>
                <Button variant="outline" size="xs" type="button" @click="clearTest">清空</Button>
              </span>
              <Button variant="outline" size="sm" type="button" :disabled="probing || !testSelected.size" @click="testSelectedModels">
                {{ probing
                  ? '测试中…（' + probeProgress.done + '/' + probeProgress.total + '）'
                  : '测试选中（' + testSelected.size + '）' }}
              </Button>
            </div>

            <div v-if="probeEntries.length" class="ap-probe-results">
              <div v-for="e in probeEntries" :key="e.model" class="ap-probe-result" :class="{ 'is-ok': e.result.ok }">
                <p class="ap-probe-title">
                  <CheckCircle2 v-if="e.result.ok" :size="14" aria-hidden="true" />
                  <XCircle v-else :size="14" aria-hidden="true" />
                  <span class="ap-probe-model">{{ e.model }}</span>
                  <span class="ap-probe-state" :class="e.result.ok ? 'is-ok' : 'is-bad'">{{ e.result.ok ? '通了' : '没通' }}</span>
                </p>
                <p class="ap-probe-desc">
                  <template v-if="e.result.ok">{{ e.result.clientType }} · {{ e.result.latencyMs }}ms</template>
                  <template v-else>{{ e.result.error || '请求失败' }}</template>
                </p>
                <p v-if="e.result.reply" class="ap-probe-reply">回复「{{ e.result.reply }}」</p>
                <p v-if="e.result.fallback === 'non-stream'" class="ap-hint">
                  这个网关的流式返回缺少用量字段，检测改用了一次普通请求确认连通。
                </p>
              </div>
            </div>
          </template>
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
.ap-custom-row { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; }
.ap-custom-row .ap-input { flex: 1; min-width: 0; }
.ap-input { width: 100%; }
.ap-select { width: 200px; }
.ap-detail-actions { display: flex; align-items: center; gap: 8px; }
.ap-tagchip { height: 24px; max-width: 100%; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; }
/* 当前要测的那个：在选中态之外再加一圈虚线，用户一眼知道「测试」测的是谁 */
.ap-edit-foot { display: flex; justify-content: flex-end; padding-top: 10px; }
.ap-test-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0 8px; }
.ap-test-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; }
.ap-saved-list { display: flex; flex-direction: column; gap: 1px; }
/* 正常态的行：复选框 + 模型名 + 测试结果；选中只靠复选框，不再额外描边 */
.ap-saved-row { display: flex; align-items: center; gap: 8px; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
.ap-saved-row:hover { background: var(--ui-hover, #f4f6f9); }
.ap-saved-check { flex: none; width: 14px; height: 14px; accent-color: var(--ui-accent, #0891b2); }
.ap-saved-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace); color: var(--ui-ink, #18202b); }
/* 状态色固定：成功绿、失败红。这里不跟主题强调色走 —— 强调色可能本身就是红色，
   会把「成功」也画成红框（2026-11-11 截图）。
   写成组件私有色板：默认块给亮色值，暗色块给提亮一档的值，避免暗画布上看不清。 */
.ap-models {
  --ap-state-ok: #16a34a;
  --ap-state-bad: #dc2626;
}
html.dark .ap-models {
  --ap-state-ok: #4ade80;
  --ap-state-bad: #f87171;
}
.ap-saved-result { flex: none; font-size: 10px; color: var(--ap-state-bad); }
.ap-saved-result.is-ok { color: var(--ap-state-ok); }
.ap-probe-results { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; }
.ap-probe-model { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
/* 信息卡片：默认灰框；成功绿框、失败红框。只有这一块用状态色，选中效果仍用主题色。 */
.ap-probe-result { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; }
.ap-probe-result.is-ok { border-color: var(--ap-state-ok); }
.ap-probe-result.is-ok .ap-probe-title > svg { color: var(--ap-state-ok); }
.ap-probe-result:not(.is-ok) { border-color: var(--ap-state-bad); }
.ap-probe-result:not(.is-ok) .ap-probe-title > svg { color: var(--ap-state-bad); }
.ap-probe-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-ink, #18202b); }
.ap-probe-title .ap-probe-model { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-probe-state { margin-left: auto; font-size: 10px; font-weight: 600; }
.ap-probe-state.is-ok { color: var(--ap-state-ok); }
.ap-probe-state.is-bad { color: var(--ap-state-bad); }
/* 描述放第二行：协议 / 耗时（或失败原因） */
.ap-probe-desc { margin: 0; font-size: 11px; line-height: 1.5; color: var(--ui-ink-dim, #6b7280); }
.ap-probe-reply { margin: 0; font-size: 10px; line-height: 1.5; color: var(--ui-ink-mute, #8c95a3); }
.ap-flush-card :deep(.shadcn-settings-section__body) { border: 0; background: transparent; padding: 0; overflow: visible; }
</style>
