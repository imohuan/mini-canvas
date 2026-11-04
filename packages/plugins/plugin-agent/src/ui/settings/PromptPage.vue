<script setup lang="ts">
/**
 * 提示词页 —— **模式提示词清单**（全能创作 / 剧本创编 + 用户自建），住后台 KV。
 *
 * 用户口径（2026-10-05）：
 * 1. 这是一个**列表**，每条有自己的名字；
 * 2. 支持自己新增；
 * 3. 内置的两条（我给的两个默认提示词）**不允许删除**；
 * 4. 自建的那些可以增删改。
 *
 * 交互：列表点一条 = 右边编辑它；「新增」建一条空白；「保存」整包写回后台。
 * 整包写回而不是逐条接口：清单不长，一次事务写完，不会出现写一半的半个列表。
 *
 * 用户口径（2026-10-14）追加两件：
 * 5. 编辑框旁边要能看到**这台后台的地址与目录**（有些时候要用到）；
 * 6. 能**点一下就插**这些值（见「可用占位符」），不用手抄路径。
 *
 * UI 全部来自 @mini-canvas/ui-kit-shadcn；业务调用与草稿逻辑保持不变。
 */
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { AlertTriangle, Check, Plus, Save, Trash2, Wrench } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import type { PromptPreset } from '../../service/agentService.js'
import type { ContextPlaceholderView } from '../../api/agentApi.js'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Textarea = useUiComponent('Textarea')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const agent = useAgent()
const s = agent.state

/** 本地编辑副本（保存前不改动 state，避免边打边写） */
const draft = ref<PromptPreset[]>([])
const selectedId = ref('')
const busy = ref(false)
const saved = ref(false)
const restoring = ref(false)
let seq = 0

/** 正文框；「插入占位符」要往光标处插，所以拿组件实例再取真实 DOM */
const textarea = ref<ComponentPublicInstance | null>(null)

function textareaElement(): HTMLTextAreaElement | null {
  const el = textarea.value?.$el
  return el instanceof HTMLTextAreaElement ? el : null
}

function clone(list: PromptPreset[]): PromptPreset[] {
  return list.map((p) => ({ ...p }))
}

function reset(): void {
  draft.value = clone(s.prompts)
  if (!draft.value.some((p) => p.id === selectedId.value)) {
    selectedId.value = draft.value[0]?.id ?? ''
  }
  saved.value = false
}

onMounted(async () => {
  await agent.refresh()
  reset()
})

const active = computed(() => draft.value.find((p) => p.id === selectedId.value))

/** 脏了没（决定「保存」是否可点） */
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(s.prompts))

/** 模板体检不通过（用户写什么提示词都进不了模型）——见 state.templateHealth */
const templateBroken = computed(() => !s.templateHealth.ok)

function addPreset(): void {
  const id = 'user-' + Date.now() + '-' + ++seq
  draft.value.push({ id, name: '新提示词', text: '' })
  selectedId.value = id
  saved.value = false
}

/** 删除：内置项不给删（按钮也隐藏，这里是第二道闸） */
function removePreset(p: PromptPreset): void {
  if (p.builtin) return
  draft.value = draft.value.filter((x) => x.id !== p.id)
  if (selectedId.value === p.id) selectedId.value = draft.value[0]?.id ?? ''
  saved.value = false
}

/**
 * 把占位符插到**光标处**（没聚焦就追加到末尾）。
 * 用户多半是在句子中间想插一个路径，插在光标处才顺手。
 */
function insertToken(token: string): void {
  const cur = active.value
  if (!cur) return
  const el = textareaElement()
  if (!el) {
    cur.text = cur.text + token
    saved.value = false
    return
  }
  const start = el.selectionStart ?? cur.text.length
  const end = el.selectionEnd ?? start
  cur.text = cur.text.slice(0, start) + token + cur.text.slice(end)
  saved.value = false
  // 插完把光标放到记号后面（连插两个时不会挤在一起）
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

async function save(): Promise<void> {
  busy.value = true
  try {
    await agent.savePrompts(clone(draft.value))
    reset()
    saved.value = true
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function restore(): Promise<void> {
  restoring.value = true
  try {
    await agent.restoreTemplate()
  } finally {
    restoring.value = false
  }
}

/** 占位符分两组显示：本服务加的在前（用户多半要的是这些） */
const ownPlaceholders = computed<ContextPlaceholderView[]>(() =>
  (s.agentContext?.placeholders ?? []).filter((p) => p.source === 'mini-canvas'),
)
const harnessPlaceholders = computed<ContextPlaceholderView[]>(() =>
  (s.agentContext?.placeholders ?? []).filter((p) => p.source === 'harness'),
)
</script>

<template>
  <div class="ap ap-prompt">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <!-- 模板坏了的时候，「编辑提示词」这件事本身就是无效的 —— 必须先说清楚 -->
    <div v-if="templateBroken" class="ap-warnblock">
      <p class="ap-warnline">
        <AlertTriangle :size="13" />
        <span>提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
          这会让你写的提示词一个字都进不到模型。</span>
      </p>
      <p class="ap-hint">恢复出厂模板后即刻生效（不影响上面这份清单，也不动 MCP）。</p>
      <Button variant="outline" size="sm" type="button" :disabled="restoring" @click="restore">
        <Wrench :size="13" aria-hidden="true" /> {{ restoring ? '恢复中…' : '恢复出厂模板' }}
      </Button>
    </div>

    <ShadcnSettingsSection title="模式提示词" :description="draft.length + ' 套 · 选中一套即可编辑它的名字与正文'">
      <div class="ap-prompt-toolbar">
        <Button variant="outline" size="sm" type="button" @click="addPreset">
          <Plus :size="13" aria-hidden="true" /> 新增
        </Button>
      </div>

      <!-- 行列表：**role=listitem + 行内一个真 button**（规范 §5 第 2 条：不要在 role=button
           容器里再嵌真实 button —— 读屏会冲突）。选中动作放在那个 button 上。 -->
      <div role="list">
        <ShadcnSettingsRow
          v-for="p in draft"
          :key="p.id"
          :label="p.name"
          :description="p.builtin ? '内置 · 不可删除' : '自建'"
        >
          <div class="pp-actions">
            <Button
              :variant="p.id === selectedId ? 'default' : 'outline'"
              size="sm"
              type="button"
              :aria-pressed="p.id === selectedId"
              :aria-label="'编辑 ' + p.name"
              @click="selectedId = p.id"
            >编辑</Button>
            <Button
              v-if="!p.builtin"
              variant="destructive"
              size="icon-sm"
              type="button"
              :aria-label="'删除 ' + p.name"
              @click.stop="removePreset(p)"
            >
              <Trash2 :size="13" aria-hidden="true" />
            </Button>
          </div>
        </ShadcnSettingsRow>
        <p v-if="!draft.length" class="ap-empty">还没有提示词</p>
      </div>

      <div v-if="active" class="ap-prompt-edit">
        <ShadcnSettingsRow label="名称">
          <Input v-model="active.name" class="ap-input" aria-label="模式名称" placeholder="模式名（显示在下拉里）" @input="saved = false" />
        </ShadcnSettingsRow>
        <div class="pp-text-head">
          <span class="ap-hint">选中这个模式时，追加到「Agent 提示词」后面</span>
          <span class="ap-count">{{ active.text.length }} 字</span>
        </div>
        <Textarea
          ref="textarea"
          v-model="active.text"
          class="pp-textarea"
          aria-label="模式提示词正文"
          placeholder="写这个模式的追加指令…"
          @input="saved = false"
        />

        <!-- 可用占位符：点一下插到光标处（用户口径：有些时候要用到后台地址与目录） -->
        <details class="pp-ph" :open="!!s.agentContext">
          <summary>
            <span>可用占位符（点一下就插进正文）</span>
            <span class="ap-count">{{ ownPlaceholders.length + harnessPlaceholders.length }} 个</span>
          </summary>
          <div class="pp-ph-body">
            <p class="ap-hint">这些记号会在建会话时换成当时的值 —— 端口换了、目录挪了，下一句就跟着变。</p>
            <div class="pp-ph-group">
              <span class="pp-ph-title">这台后台（本站提供）</span>
              <div class="pp-chips">
                <Button
                  v-for="p in ownPlaceholders"
                  :key="p.token"
                  variant="outline"
                  size="xs"
                  type="button"
                  class="pp-chip"
                  :title="p.description + (p.value ? '（当前：' + p.value + '）' : '')"
                  @click="insertToken(p.token)"
                ><code>{{ p.token }}</code></Button>
              </div>
            </div>
            <div class="pp-ph-group">
              <span class="pp-ph-title">运行时环境（SDK 提供，无需本站展开）</span>
              <div class="pp-chips">
                <Button
                  v-for="p in harnessPlaceholders"
                  :key="p.token"
                  variant="outline"
                  size="xs"
                  type="button"
                  class="pp-chip"
                  :title="p.description"
                  @click="insertToken(p.token)"
                ><code>{{ p.token }}</code></Button>
              </div>
            </div>
          </div>
        </details>

        <div class="pp-foot">
          <span v-if="saved" class="ap-hint pp-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">存在后台，换台机器也在</span>
          <Button type="button" size="sm" :disabled="busy || !dirty" @click="save">
            <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </div>
      </div>
    </ShadcnSettingsSection>

    <!-- 后台地址与目录：摆在这页，用户写提示词时一眼能看到 -->
    <ShadcnSettingsSection
      v-if="s.agentContext"
      title="运行环境"
      :description="s.agentContext.baseUrl || '未监听'"
    >
      <ShadcnSettingsRow
        v-for="d in s.agentContext.dirs"
        :key="d.label"
        :label="d.label"
        :description="d.path"
      />
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-prompt-toolbar { display: flex; justify-content: flex-end; padding: 6px 0 2px; }
.pp-actions { display: flex; align-items: center; gap: 6px; }
.ap-prompt-edit { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 4px; }
.pp-text-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-input { width: 100%; }
.pp-textarea { height: 180px; min-height: 140px; overflow-y: auto; field-sizing: fixed; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; line-height: 1.6; }
.pp-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pp-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnblock { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px 10px; border: 1px solid var(--ui-warn, #b45309); border-radius: var(--radius-control, 8px); }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
.pp-ph { border: 1px solid var(--ui-line-soft, #eef0f4); border-radius: var(--radius-control, 8px); }
.pp-ph > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; font-size: 11px; color: var(--ui-ink-dim, #6b7280); cursor: pointer; list-style: none; }
.pp-ph > summary::-webkit-details-marker { display: none; }
.pp-ph-body { display: flex; flex-direction: column; gap: 8px; padding: 0 10px 10px; }
.pp-ph-group { display: flex; flex-direction: column; gap: 5px; }
.pp-ph-title { font-size: 10px; letter-spacing: 0.02em; color: var(--ui-ink-dim, #6b7280); }
.pp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pp-chip { height: 22px; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); }
.pp-chip code { font-size: 10px; }
</style>
