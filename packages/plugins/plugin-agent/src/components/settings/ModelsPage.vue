<script setup lang="ts">
/**
 * ModelsPage —— 「Provider」页：**一个渠道配一批模型**。
 *
 * 用户口径（2026-10-02）：
 *   「我这边可以通过一个拉取来获取它支持的所有模型，然后我可以选中某些模型来进行操作。
 *     我可以编辑我的 provider，比如说我这边已经设置过的 provider，我可以进行一个编辑，
 *     我可以重新拉取它的模型，然后重新选择它的模型列表。使用这种 tag 的方式自动布局优化，
 *     同时支持多选、反选和全选。」
 *
 * 于是这一页只有**一张表 + 一个编辑区**：
 *   ① 上表按 provider 聚合（不是按模型散着列）—— 一个渠道一行，显示已配几个模型、哪个是默认；
 *      每行右侧「编辑」= 把该渠道整个载入下面的编辑区（含已勾选的模型），可重新拉取、重选后保存。
 *   ② 编辑区：填 Base URL / 密钥 → 「拉取」拿上游清单 → 用 **tag** 勾选要留的模型
 *      （支持 全选 / 反选 / 清空 + 单个点选）→ 保存。
 *
 * 密钥只写不回读：服务端只给 hasKey；编辑时留空 = 不改动已存的。
 */
import { computed, onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state
const busy = ref(false)

// 协议清单从后台读（SDK 的真实契约），不在界面里写死 ——
// 写死的那份实测有两个是错的：anthropic-messages 会被 SDK 拒绝、openai-responses 返回空。
//
// **默认必须是 openai-chat**（实测教训）：deepseek-v4 虽然能吐「思考」载荷，
// 但拿它跑聊天流会让 Node 进程**静默崩溃**（退出码 -1，连 uncaughtException 都不触发），
// 表现就是「发消息 → 前端 Failed to fetch」。所以默认走稳的 openai-chat。
const DEFAULT_CLIENT = 'openai-chat'
const clientOptions = computed(() => {
  const list = s.clientTypes.length ? s.clientTypes : ['openai-chat', 'deepseek-v4']
  return [DEFAULT_CLIENT, ...list.filter((c) => c !== DEFAULT_CLIENT)]
})

/** 编辑区表单。provider 一旦落定就是这一批模型的归属渠道名。 */
const form = ref({
  provider: 'local',
  apiKey: '',
  baseUrl: 'http://127.0.0.1:3000/v1',
  clientType: DEFAULT_CLIENT as string,
  vision: true,
})
/**
 * 该渠道**已存密钥的掩码**（编辑已有渠道时填进输入框）。
 *
 * 用户口径：「编辑的时候，APIKey 也会跟随显示」——不回显的话，用户看到空框
 * 会以为没存，点「拉取」时又不带密钥 → 401；或者重新输入时把旧密钥覆盖掉。
 * 明文永不回传，这里给的是服务端算好的掩码（`sk-0…6390`）。
 * 保存时原样回传，服务端认得出来并当作「没改」。
 */
const savedKeyMask = ref('')
/** 上游拉回来的候选模型 ID（tag 池） */
const candidates = ref<string[]>([])
/** 勾中的模型 ID（Set 便于反选/全选） */
const picked = ref<Set<string>>(new Set())
/** 本次编辑的是不是「已存在的渠道」（决定保存时要不要删掉取消勾选的旧模型） */
const editingExisting = ref(false)
const upstreamHint = ref('')
const notice = ref('')

onMounted(() => void agent.refresh())

/** 按 provider 聚合已配置的模型（上表一行 = 一个渠道） */
interface ProviderGroup {
  provider: string
  baseUrl: string
  clientType: string
  hasKey: boolean
  /** 已存密钥的掩码，编辑时回显到输入框（明文不回读） */
  apiKeyMask: string
  models: string[]
  defaultModel?: string
}
const groups = computed<ProviderGroup[]>(() => {
  const map = new Map<string, ProviderGroup>()
  for (const m of s.models) {
    if (!m.hasKey) continue // 内置目录里那上百个无密钥条目不进表（它们不是「你配的渠道」）
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
    // 同一渠道里 baseUrl 以**有值的第一个**为准（同一 provider 的模型共享一个地址）
    if (!g.baseUrl && m.baseUrl) g.baseUrl = m.baseUrl
    if (!g.apiKeyMask && m.apiKeyMask) g.apiKeyMask = m.apiKeyMask
  }
  return [...map.values()]
})

/** 把某个渠道整个载入编辑区（编辑已有 Provider） */
function editGroup(g: ProviderGroup): void {
  form.value.provider = g.provider
  form.value.baseUrl = g.baseUrl
  form.value.clientType = g.clientType || DEFAULT_CLIENT
  // 密钥回显**掩码**：让用户看得出「这个渠道已经有密钥了」。
  // 明文永不回传；保存/拉取时原样回传掩码，服务端认得出来当"没改"（见 isSecretMask）。
  form.value.apiKey = g.apiKeyMask
  savedKeyMask.value = g.apiKeyMask
  candidates.value = [...g.models]
  picked.value = new Set(g.models)
  editingExisting.value = true
  upstreamHint.value = ''
  notice.value = '正在编辑「' + g.provider + '」：共 ' + g.models.length + ' 个模型。可重新拉取后再选。'
}

/** 重开一个空白渠道 */
function newProvider(): void {
  form.value.provider = ''
  form.value.baseUrl = ''
  form.value.apiKey = ''
  savedKeyMask.value = ''
  form.value.clientType = DEFAULT_CLIENT
  candidates.value = []
  picked.value = new Set()
  editingExisting.value = false
  upstreamHint.value = ''
  notice.value = ''
}

/** 拉上游清单：用**表单里此刻填的** baseUrl/密钥，所以填完就能拉，不必先保存 */
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
  // 并进候选池而不是覆盖：编辑已有渠道时，之前配过但上游没列的模型不该凭空消失
  candidates.value = [...new Set([...r.models, ...candidates.value])]
  // 新渠道默认**不勾**（让用户自己选）；编辑已有渠道时保持原勾选
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
    s.error = '请先填渠道名（provider）'
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
      // 取消勾选的旧模型要真的删掉 —— 只在「编辑已有渠道」时做，避免误删
      removeMissing: editingExisting.value,
      // 该渠道还没默认模型时，把勾选的第一个设为默认
      ...(editingExisting.value ? {} : { makeDefault: modelIds[0] }),
    })
    // 保存成功后把输入框切回**新的掩码**（服务端刚写进去的那个密钥）。
    // 不能清空：清空后用户停在编辑态会以为密钥没了；也不能留着旧的用户手输值。
    form.value.apiKey = savedKeyMask.value
    notice.value = '已保存「' + form.value.provider + '」：' + modelIds.length + ' 个模型'
    editingExisting.value = true
    // refresh 已由 service 做完，用最新数据里的掩码刷新回显
    const g = groups.value.find((x) => x.provider === form.value.provider.trim())
    if (g?.apiKeyMask) {
      savedKeyMask.value = g.apiKeyMask
      form.value.apiKey = g.apiKeyMask
    }
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

    <!-- ① 已配置的渠道（一行 = 一个 provider） -->
    <section class="ap-block">
      <header class="ap-block-head">
        <h4>渠道（Provider）</h4>
        <span class="ap-count">{{ groups.length }} 个渠道 · {{ s.models.filter((m) => m.hasKey).length }} 个模型</span>
      </header>
      <div class="ap-table ap-scroll">
        <div class="ap-tr is-head">
          <span>渠道</span><span>Base URL / 模型</span><span></span>
        </div>
        <div v-for="g in groups" :key="g.provider" class="ap-tr">
          <span class="ap-td" :title="g.provider">{{ g.provider }}</span>
          <span class="ap-td ap-td-meta" :title="g.baseUrl">
            <template v-if="g.baseUrl">{{ g.baseUrl }} · </template>
            {{ g.models.length }} 个模型<template v-if="g.defaultModel"> · 默认 {{ g.defaultModel }}</template>
          </span>
          <span class="ap-td-act">
            <button class="ap-mini" @click="editGroup(g)">编辑</button>
          </span>
        </div>
        <p v-if="!groups.length" class="ap-empty">还没有配置渠道 —— 用下面的表单拉取并勾选模型</p>
      </div>
    </section>

    <!-- ② 编辑区：拉取 → tag 选择 → 保存 -->
    <section class="ap-block">
      <header class="ap-block-head">
        <h4>{{ editingExisting ? '编辑渠道' : '添加渠道' }}</h4>
        <button class="ap-mini" @click="newProvider">新建渠道</button>
      </header>
      <div class="ap-block-body">
        <form class="ap-fields" @submit.prevent="save">
          <label class="ap-field">渠道名（provider）<input v-model="form.provider" placeholder="local" /></label>
          <label class="ap-field">Base URL<input v-model="form.baseUrl" placeholder="http://127.0.0.1:3000/v1" /></label>
          <!-- 钥匙：编辑已有渠道时回显**掩码**（不是明文），所以这里是 text 而不是 password ——
               用 password 会把掩码也打成一排圆点，用户还是看不出「已配置」。
               掩码原样回传 = 不改；清空 = 也不改；只有输入别的内容才会覆盖。 -->
          <label class="ap-field">API Key
            <input v-model="form.apiKey" type="text" spellcheck="false" autocomplete="off"
              :placeholder="editingExisting ? '已配置（' + (savedKeyMask || '已保存') + '）· 改就输入新密钥，留空 = 不变' : '粘贴密钥'" />
            <small v-if="editingExisting && savedKeyMask" class="ap-hint">已存密钥：{{ savedKeyMask }}（回显的是掩码，明文不会下发）</small>
          </label>
          <label class="ap-field">客户端协议
            <select v-model="form.clientType">
              <option v-for="c in clientOptions" :key="c" :value="c">{{ c }}</option>
            </select>
            <small class="ap-hint">默认 openai-chat（稳）。deepseek-v4 会出「思考」但实测会让服务崩溃，谨慎切换。</small>
          </label>

          <!-- 拉取 + tag 选择器 -->
          <div class="ap-field">
            <span class="ap-field-row">
              <button type="button" class="ap-mini" @click="pullUpstream">拉取模型清单</button>
              <span class="ap-hint">{{ upstreamHint || '点「拉取」向上游要模型清单（V1/models）' }}</span>
            </span>
          </div>

          <div v-if="candidates.length" class="ap-picker">
            <div class="ap-picker-head">
              <span class="ap-hint">已选 {{ picked.size }} / {{ candidates.length }}</span>
              <span class="ap-quick">
                <button type="button" class="ap-mini" @click="pickAll">全选</button>
                <button type="button" class="ap-mini" @click="invertPick">反选</button>
                <button type="button" class="ap-mini" @click="clearPick">清空</button>
              </span>
            </div>
            <!-- tag 自动布局：flex-wrap，点一下即切换选中 -->
            <div class="ap-tagpool" role="listbox" aria-multiselectable="true" aria-label="选择模型">
              <button
                v-for="m in candidates"
                :key="m"
                type="button"
                class="ap-tagchip"
                :class="{ 'is-on': picked.has(m) }"
                role="option"
                :aria-selected="picked.has(m)"
                :title="m"
                @click="togglePick(m)"
              >{{ m }}</button>
            </div>
          </div>
          <p v-else class="ap-hint">还没有候选模型 —— 点上面的「拉取模型清单」。</p>

          <small v-if="notice" class="ap-hint">{{ notice }}</small>
          <button class="ap-submit" type="submit" :disabled="busy">
            {{ busy ? '保存中…' : editingExisting ? '保存修改' : '添加渠道' }}
          </button>
        </form>
      </div>
    </section>
  </div>
</template>
