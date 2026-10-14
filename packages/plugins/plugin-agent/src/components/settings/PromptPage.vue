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
 * 交互：左边列表点一条 = 右边编辑它；「新增」建一条空白；「保存」整包写回后台。
 * 整包写回而不是逐条接口：清单不长，一次事务写完，不会出现写一半的半个列表。
 *
 * 用户口径（2026-10-14）追加两件：
 * 5. 编辑框旁边要能看到**这台后台的地址与目录**（有些时候要用到）；
 * 6. 能**点一下就插**这些值（见「可用占位符」），不用手抄路径。
 *
 * 另加一条体检提示：模板坏了的时候「写什么提示词都没用」，那种情况必须当面说清楚。
 */
import { computed, onMounted, ref } from 'vue'
import { Plus, Trash2, Check, AlertTriangle, Wrench } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import type { PromptPreset } from '../../agentService.js'
import type { ContextPlaceholderView } from '../../agentApi.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

/** 本地编辑副本（保存前不改动 state，避免边打边写） */
const draft = ref<PromptPreset[]>([])
const selectedId = ref('')
const busy = ref(false)
const saved = ref(false)
const restoring = ref(false)
let seq = 0

/** 正文框；「插入占位符」要往光标处插，所以拿 DOM 引用 */
const textarea = ref<HTMLTextAreaElement | null>(null)

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
 *
 * 为什么按光标而不是一律追加：用户多半是在句子中间想插一个路径，追加到末尾还要自己
 * 再剪过去；插在光标处才是他要的那一下（与编辑器里的常规手感一致）。
 */
function insertToken(token: string): void {
  const cur = active.value
  if (!cur) return
  const el = textarea.value
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
    <section v-if="templateBroken" class="ap-block ap-warnblock">
      <div class="ap-block-body ap-warnbody">
        <p class="ap-warnline">
          <AlertTriangle :size="13" />
          <span>提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
            这会让你写的提示词一个字都进不到模型。</span>
        </p>
        <p class="ap-hint">恢复出厂模板后即刻生效（不影响上面这份清单，也不动 MCP）。</p>
        <button class="ap-submit ap-restore" :disabled="restoring" @click="restore">
          <Wrench :size="12" /> {{ restoring ? '恢复中…' : '恢复出厂模板' }}
        </button>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head">
        <h4>模式提示词</h4>
        <span class="ap-quick">
          <span class="ap-count">{{ draft.length }} 套</span>
          <button class="ap-mini" @click="addPreset"><Plus :size="12" /> 新增</button>
        </span>
      </header>

      <!-- 行列表：**role=listitem + 行内一个真 button**（规范 §5 第 2 条：不要在 role=button
           容器里再嵌真实 button —— 读屏会冲突）。选中动作放在那个 button 上。 -->
      <div class="ap-table ap-scroll" role="list">
        <div v-for="p in draft" :key="p.id" class="ap-tr pp-row" role="listitem"
          :class="{ 'is-active': p.id === selectedId }">
          <span class="ap-td">{{ p.name }}</span>
          <span class="ap-td ap-td-meta">{{ p.builtin ? '内置 · 不可删除' : '自建' }}</span>
          <span class="ap-td-act">
            <button class="ap-mini" :aria-pressed="p.id === selectedId"
              :aria-label="'编辑 ' + p.name" @click="selectedId = p.id">编辑</button>
            <!-- 内置项不显示删除按钮（用户口径：我给的两个默认提示词不允许删除） -->
            <button v-if="!p.builtin" class="ap-mini danger" aria-label="删除" @click.stop="removePreset(p)">
              <Trash2 :size="12" />
            </button>
          </span>
        </div>
        <p v-if="!draft.length" class="ap-empty">还没有提示词</p>
      </div>

      <div v-if="active" class="ap-block-body pp-edit">
        <label class="ap-field">名称
          <input v-model="active.name" class="ap-input" placeholder="模式名（显示在下拉里）" @input="saved = false" />
        </label>
        <div class="pp-text-head">
          <span class="ap-hint">选中这个模式时，追加到「Agent 提示词」后面</span>
          <span class="ap-count">{{ active.text.length }} 字</span>
        </div>
        <textarea ref="textarea" v-model="active.text" class="pp-textarea" rows="14"
          aria-label="模式提示词正文" placeholder="写这个模式的追加指令…" @input="saved = false"></textarea>

        <!-- 可用占位符：点一下插到光标处（用户口径：有些时候要用到后台地址与目录） -->
        <details class="pp-ph" :open="!!s.agentContext">
          <summary>
            <span>可用占位符（点一下就插进正文）</span>
            <span class="ap-count">{{ ownPlaceholders.length + harnessPlaceholders.length }} 个</span>
          </summary>
          <div class="pp-ph-body">
            <p class="ap-hint">
              这些记号会在建会话时换成当时的值 —— 端口换了、目录挪了，下一句就跟着变，
              不用回来改。
            </p>
            <div class="pp-ph-group">
              <span class="pp-ph-title">这台后台（本站提供）</span>
              <div class="pp-chips">
                <button v-for="p in ownPlaceholders" :key="p.token" class="ap-tagchip pp-chip"
                  :title="p.description + (p.value ? '（当前：' + p.value + '）' : '')"
                  @click="insertToken(p.token)">
                  <code>{{ p.token }}</code>
                </button>
              </div>
            </div>
            <div class="pp-ph-group">
              <span class="pp-ph-title">运行时环境（SDK 提供，无需本站展开）</span>
              <div class="pp-chips">
                <button v-for="p in harnessPlaceholders" :key="p.token" class="ap-tagchip pp-chip"
                  :title="p.description" @click="insertToken(p.token)">
                  <code>{{ p.token }}</code>
                </button>
              </div>
            </div>
          </div>
        </details>

        <div class="pp-foot">
          <span v-if="saved" class="ap-hint pp-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">存在后台，换台机器也在</span>
          <button class="ap-submit" :disabled="busy || !dirty" @click="save">保存</button>
        </div>
      </div>
    </section>

    <!-- 后台地址与目录：摆在这页，用户写提示词时一眼能看到 -->
    <section v-if="s.agentContext" class="ap-block">
      <header class="ap-block-head">
        <h4>运行环境</h4>
        <span class="ap-count">{{ s.agentContext.baseUrl || '未监听' }}</span>
      </header>
      <div class="ap-block-body pp-env">
        <div v-for="d in s.agentContext.dirs" :key="d.label" class="pp-envrow">
          <span class="pp-envlabel">{{ d.label }}</span>
          <code class="pp-envpath">{{ d.path }}</code>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pp-row { cursor: default; }
.pp-row.is-active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.pp-edit { display: flex; flex-direction: column; gap: 8px; }
.pp-text-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pp-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; line-height: 1.6; resize: vertical; outline: none; font-family: inherit; }
.pp-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
/* 不用新彩色：规范 §2.1「颜色只表语义（青/琥珀/红），不引入新彩色」—— 用强调色表示「已保存」。 */
.pp-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }

/* —— 模板坏了：琥珀提醒（规范 §2.1：琥珀 = 警告） —— */
.ap-warnblock { border-color: var(--ui-warn, #b45309); }
.ap-warnbody { display: flex; flex-direction: column; gap: 6px; }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
.ap-restore { display: inline-flex; align-items: center; justify-content: center; gap: 5px; align-self: flex-start; padding: 0 12px; }

/* —— 可用占位符 —— */
.pp-ph { border: 1px solid var(--ui-line-soft, #eef0f4); border-radius: 8px; }
.pp-ph > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; font-size: 11px; color: var(--ui-ink-dim, #6b7280); cursor: pointer; list-style: none; }
.pp-ph > summary::-webkit-details-marker { display: none; }
.pp-ph-body { display: flex; flex-direction: column; gap: 8px; padding: 0 10px 10px; }
.pp-ph-group { display: flex; flex-direction: column; gap: 5px; }
.pp-ph-title { font-size: 10px; letter-spacing: 0.02em; color: var(--ui-ink-dim, #6b7280); }
.pp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pp-chip { height: 22px; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); }
.pp-chip code { font-size: 10px; }

/* —— 运行环境（地址 + 目录） —— */
.pp-env { display: flex; flex-direction: column; gap: 4px; }
.pp-envrow { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: baseline; gap: 8px; }
.pp-envlabel { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.pp-envpath { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; color: var(--ui-ink, #18202b); overflow-wrap: anywhere; }
</style>
