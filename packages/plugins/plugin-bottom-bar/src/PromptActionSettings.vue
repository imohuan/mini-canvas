<script setup lang="ts">
/**
 * PromptActionSettings —— 底栏「AI 按钮」的配置界面（自定义页，挂设置面板「底栏」组）。
 *
 * 为什么不用 schema 平铺字段：清单（增删改 + 模板文本域 + 图标选择）是**结构化编辑**，
 * 标量控件铺不出这个形状。设置面板对「有内容插槽的分组」直接渲染插槽内容（同 Agent 页），
 * 所以这里注册进 settingsGroup/常规/底栏（左树：常规 → 底栏），并声明 mode:'append'
 * 追加在 Config 的标量字段之后 —— 否则同组的「AI 后台地址」会被整组顶掉。
 *
 * 数据源：云端 KV config/bottomBarAiActions（loadAiActions / saveAiActions）。
 * 本地编辑副本 + 整包保存（与 Agent 模式提示词同一套手感）：
 * - 新增 / 删除 / 上下移（列表顺序 = 底栏按钮顺序）；
 * - 每条：名称 / 描述 / 图标（预设四选一）/ 提示词模板（{{变量}} chips 点一下插入）；
 * - 「恢复默认」= 把内置两条放回编辑副本（保存后才生效）。
 */
import { computed, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import {
  loadAiActions,
  saveAiActions,
  normalizeAiActions,
  DEFAULT_AI_ACTIONS,
  TEMPLATE_VARS,
  AI_ICON_PRESETS,
  DEFAULT_AI_ICON,
  type AiActionConfig,
} from './aiActions'

const { ctx } = useCanvasRender()

/** 本地编辑副本（保存前不动云端） */
/**
 * 首屏就摆**内置默认**（与"云端没配过"时的实际生效值一致）。
 * 为什么不是空表 + 「配置加载中…」：那一瞬间用户看到的是「这里什么都没有」，
 * 正是 2026-10-27 反馈「设置界面里看不到你的配置」的观感。云端配置回来再整体替换。
 */
const draft = ref<AiActionConfig[]>(DEFAULT_AI_ACTIONS.map((a) => ({ ...a })))
const selectedId = ref(draft.value[0]?.id ?? '')
const busy = ref(false)
const saved = ref(false)
const error = ref('')
/** 正在读云端那一份（读到之前下面显示的是内置默认，按钮先别按） */
const syncing = ref(true)
let seq = 0

/** 模板文本域（插入变量要往光标处插） */
const textarea = ref<HTMLTextAreaElement | null>(null)

/** 插件自己的 agentBaseUrl 配置（与 Agent 插件同一口径；缺省 = 同源） */
function backendBase(): string {
  const settings = ctx.tryGet<{ get(key: string): string | number | boolean }>('settings')
  const v = settings?.get('bottomBarAiBaseUrl')
  return typeof v === 'string' ? v : ''
}

async function reload(): Promise<void> {
  syncing.value = true
  try {
    draft.value = normalizeAiActions(await loadAiActions({ baseUrl: backendBase() }))
    if (!draft.value.some((a) => a.id === selectedId.value)) {
      selectedId.value = draft.value[0]?.id ?? ''
    }
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    syncing.value = false
  }
}

const active = computed(() => draft.value.find((a) => a.id === selectedId.value))

/**
 * 立即拉一次（不放在 onMounted：设置页在 SSR 里也走这个组件，onMounted 不跑会一直停在
 * 「配置加载中」；而且真机上想看到表也不该依赖一个生命周期钩子）。
 * 拉取期间下面照常显示内置默认，读到云端那份再替换 —— 打开即见完整表格。
 */
void reload()

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(cloudSnapshot.value))
/** 云端当前那份（脏比对基准；保存成功后同步） */
const cloudSnapshot = ref<AiActionConfig[]>([])

function touch(): void {
  saved.value = false
}

function pick(id: string): void {
  selectedId.value = id
}

function addAction(): void {
  const id = 'action-' + Date.now() + '-' + ++seq
  draft.value.push({ id, name: '新按钮', description: '', icon: DEFAULT_AI_ICON, template: '对下面的内容：\n\n{{prompt}}', enabled: true })
  selectedId.value = id
  touch()
}

function removeAction(id: string): void {
  draft.value = draft.value.filter((a) => a.id !== id)
  if (selectedId.value === id) selectedId.value = draft.value[0]?.id ?? ''
  touch()
}

/** 上移 / 下移（列表顺序 = 底栏按钮顺序） */
function move(id: string, dir: -1 | 1): void {
  const i = draft.value.findIndex((a) => a.id === id)
  const to = i + dir
  if (i < 0 || to < 0 || to >= draft.value.length) return
  const next = [...draft.value]
  const [item] = next.splice(i, 1)
  next.splice(to, 0, item)
  draft.value = next
  touch()
}

/** 恢复默认：编辑副本放回内置两条（云端不动，保存才生效） */
function restoreDefaults(): void {
  draft.value = DEFAULT_AI_ACTIONS.map((a) => ({ ...a }))
  selectedId.value = draft.value[0]?.id ?? ''
  touch()
}

/** 把变量插到模板光标处（与 Agent 提示词页同一手感） */
function insertToken(token: string): void {
  const cur = active.value
  if (!cur) return
  const el = textarea.value
  if (!el) {
    cur.template += token
    touch()
    return
  }
  const start = el.selectionStart ?? cur.template.length
  const end = el.selectionEnd ?? start
  cur.template = cur.template.slice(0, start) + token + cur.template.slice(end)
  touch()
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

function pickPresetIcon(key: string, svg: string): void {
  const cur = active.value
  if (!cur) return
  cur.icon = svg
  touch()
}

async function save(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const r = await saveAiActions(draft.value, { baseUrl: backendBase() })
    if (!r.ok) {
      error.value = r.error ?? '保存失败'
      return
    }
    cloudSnapshot.value = JSON.parse(JSON.stringify(draft.value)) as AiActionConfig[]
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pas">
    <p v-if="error" class="pas-error">{{ error }}</p>
    <p v-if="syncing" class="pas-hint">正在读取云端配置…（下面先显示内置默认，读到后自动替换）</p>

    <section class="pas-block">
      <header class="pas-head">
        <h4>底栏 AI 按钮</h4>
        <span class="pas-quick">
          <span class="pas-count">{{ draft.length }} 个</span>
          <button class="pas-mini" :disabled="syncing" @click="addAction">新增</button>
          <button class="pas-mini" :disabled="syncing" @click="restoreDefaults">恢复默认</button>
        </span>
      </header>

      <div class="pas-list" role="list">
        <div v-for="(a, i) in draft" :key="a.id" class="pas-row" role="listitem"
          :class="{ 'is-active': a.id === selectedId, 'is-off': !a.enabled }">
          <span class="pas-icon" aria-hidden="true" v-html="a.icon || DEFAULT_AI_ICON" />
          <span class="pas-name">{{ a.name }}<small v-if="a.builtin" class="pas-builtin">内置</small></span>
          <span class="pas-desc">{{ a.description }}</span>
          <span class="pas-acts">
            <button class="pas-mini" :aria-pressed="a.id === selectedId" @click="pick(a.id)">编辑</button>
            <button class="pas-mini" :disabled="i === 0" aria-label="上移" @click="move(a.id, -1)">↑</button>
            <button class="pas-mini" :disabled="i === draft.length - 1" aria-label="下移" @click="move(a.id, 1)">↓</button>
            <label class="pas-toggle" :title="a.enabled ? '点击隐藏' : '点击显示'">
              <input type="checkbox" :checked="a.enabled" @change="a.enabled = !a.enabled; touch()" />
              <span>{{ a.enabled ? '显示' : '隐藏' }}</span>
            </label>
            <button class="pas-mini danger" aria-label="删除" @click="removeAction(a.id)">删除</button>
          </span>
        </div>
        <p v-if="!draft.length" class="pas-hint">还没有按钮，点「新增」或「恢复默认」。</p>
      </div>

      <div v-if="active" class="pas-edit">
        <label class="pas-field">名称
          <input v-model="active.name" class="pas-input" @input="touch()" />
        </label>
        <label class="pas-field">描述（悬停提示）
          <input v-model="active.description" class="pas-input" @input="touch()" />
        </label>

        <div class="pas-field">
          <span class="pas-label">图标</span>
          <div class="pas-icons">
            <button v-for="p in AI_ICON_PRESETS" :key="p.key" class="pas-icon-btn"
              :class="{ 'is-on': active.icon === p.svg }" :title="p.label"
              @click="pickPresetIcon(p.key, p.svg)">
              <span aria-hidden="true" v-html="p.svg" />
            </button>
          </div>
        </div>

        <div class="pas-field">
          <div class="pas-label-row">
            <span class="pas-label">提示词模板</span>
            <span class="pas-count">{{ active.template.length }} 字</span>
          </div>
          <textarea ref="textarea" v-model="active.template" class="pas-textarea" rows="8"
            placeholder="写这条按钮的系统提示词…可用 {{prompt}} 等变量" @input="touch()"></textarea>
          <div class="pas-chips">
            <button v-for="v in TEMPLATE_VARS" :key="v.token" class="pas-chip" :title="v.description"
              @click="insertToken(v.token)">
              <code>{{ v.token }}</code>
            </button>
          </div>
          <p class="pas-hint">AI 返回的正文会直接替换输入框内容；思考段会被自动过滤。</p>
        </div>
      </div>

      <div class="pas-foot">
        <span v-if="saved" class="pas-ok">已保存 · 底栏按钮即时生效</span>
        <span v-else-if="dirty" class="pas-hint">有未保存的修改</span>
        <span v-else class="pas-hint">与云端一致</span>
        <button class="pas-submit" :disabled="busy || !dirty" @click="save">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 观感对齐 Agent 设置页 settings.css（数值照 ui-style-guide；颜色全走 --ui-* token） */
.pas { display: flex; flex-direction: column; gap: 12px; }
.pas-block { display: flex; flex-direction: column; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 10px; overflow: hidden; }
.pas-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: var(--ui-veil, rgb(0 0 0 / 0.03)); border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.pas-head h4 { margin: 0; font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.pas-quick { display: flex; align-items: center; gap: 6px; }
.pas-count { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.pas-list { display: flex; flex-direction: column; }
.pas-row { display: grid; grid-template-columns: 24px minmax(0, 0.8fr) minmax(0, 1.4fr) auto; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.pas-row.is-active { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.pas-row.is-off { opacity: 0.55; }
.pas-icon { display: inline-flex; width: 16px; height: 16px; color: var(--ui-ink-dim, #6b7280); }
.pas-icon :deep(svg) { width: 100%; height: 100%; }
.pas-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: var(--ui-ink, #18202b); }
.pas-builtin { font-size: 9px; padding: 0 5px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 999px; color: var(--ui-ink-dim, #6b7280); }
.pas-desc { min-width: 0; font-size: 11px; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pas-acts { display: flex; align-items: center; gap: 4px; }
.pas-mini { height: 24px; padding: 0 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 7px; background: transparent; color: var(--ui-ink, #18202b); font-size: 11px; cursor: pointer; white-space: nowrap; }
.pas-mini:disabled { opacity: 0.4; cursor: default; }
.pas-mini.danger { color: var(--ui-danger, #ef4444); border-color: color-mix(in srgb, var(--ui-danger, #ef4444) 40%, transparent); }
.pas-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--ui-ink-dim, #6b7280); cursor: pointer; user-select: none; }
.pas-toggle input { accent-color: var(--ui-accent, #0891b2); margin: 0; }
.pas-edit { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--ui-line-soft, #eef0f4); }
.pas-field { display: flex; flex-direction: column; gap: 5px; }
.pas-label { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.pas-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pas-input, .pas-textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; outline: none; font-family: inherit; }
.pas-textarea { line-height: 1.6; resize: vertical; }
.pas-icons { display: flex; gap: 4px; }
.pas-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #6b7280); cursor: pointer; }
.pas-icon-btn.is-on { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent, #0891b2); }
.pas-icon-btn :deep(svg) { width: 15px; height: 15px; }
.pas-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pas-chip { height: 22px; padding: 0 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 999px; background: transparent; color: var(--ui-ink-dim, #6b7280); font-size: 10px; cursor: pointer; }
.pas-chip:hover { border-color: var(--ui-ink-mute, #8c95a3); color: var(--ui-ink, #18202b); }
.pas-chip code { font-family: var(--font-mono, ui-monospace, monospace); }
.pas-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--ui-line-soft, #eef0f4); }
.pas-ok { font-size: 10px; color: var(--ui-accent, #0891b2); }
.pas-hint { margin: 0; font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.pas-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }
.pas-submit { height: 30px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--ui-accent, #0891b2); color: var(--ui-primary-ink, #fff); font-size: 12px; cursor: pointer; }
.pas-submit:disabled { opacity: 0.5; cursor: default; }
</style>
