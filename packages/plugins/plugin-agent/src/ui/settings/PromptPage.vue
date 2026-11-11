<script setup lang="ts">
/**
 * PromptPage —— **模式提示词**：一套模式一段追加指令（全能创作 / 剧本创编 + 自建）。
 *
 * 结构（用户口径 2026-11-11：选中后进入二级编辑页，不要再左右分栏/列表下塞表单）：
 *   列表态：一行一套模式（名字 / 是否内置 / 字数），右上「新建模式」；
 *   编辑态：整页换成这一套的编辑页，左上「返回模式列表」，变量面板与 Agent 提示词共用。
 *
 * 数据仍住后台 KV；整包写回，避免半个列表。
 */
import { computed, onMounted, ref } from 'vue'
import { useCanvasContextOrRender } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import { AlertTriangle, Check, Plus, RotateCcw, Save, Trash2, Wrench } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useAgent } from '../../plugin/useAgent.js'
import type { PromptPreset } from '../../service/agentService.js'
import SettingsDetailHeader from './components/SettingsDetailHeader.vue'
import PromptEditor from './components/PromptEditor.vue'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')

const agent = useAgent()
const s = agent.state
const feedback = useCanvasContextOrRender().ctx.tryGet<FeedbackService>('feedback')

const draft = ref<PromptPreset[]>([])
const selectedId = ref('')
const busy = ref(false)
const saved = ref(false)
const restoring = ref(false)
let seq = 0

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
/** 空串 = 列表态；有值 = 正在编辑这一套 */
const editingId = ref('')

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(s.prompts))
const templateBroken = computed(() => !s.templateHealth.ok)

function openPreset(p: PromptPreset): void {
  selectedId.value = p.id
  editingId.value = p.id
  saved.value = false
}

function backToList(): void {
  editingId.value = ''
  saved.value = false
}

/**
 * 恢复这一条到出厂内容（用户口径 2026-11-11：「不然很容易被改坏掉」）。
 *
 * 只改**本地草稿**，不立刻写后台：用户还能在保存前反悔（点返回或再编辑）。
 * 自建模式没有出厂版，按钮不出现。
 */
async function restoreActive(): Promise<void> {
  const p = active.value
  if (!p || !p.builtin) return
  const ok = await feedback?.confirm({
    title: '恢复「' + p.name + '」的默认内容？',
    description: '会把名字和正文换回出厂版本。现在的修改会丢掉（点保存后才写回后台）。',
    confirmText: '恢复默认',
    cancelText: '取消',
  })
  if (!ok) return
  p.name = p.defaultName ?? p.name
  p.text = p.defaultText ?? ''
  saved.value = false
}

function addPreset(): void {
  const id = 'user-' + Date.now() + '-' + ++seq
  draft.value.push({ id, name: '新模式', text: '' })
  selectedId.value = id
  editingId.value = id
  saved.value = false
}

function removeActive(): void {
  const p = active.value
  if (!p || p.builtin) return
  draft.value = draft.value.filter((x) => x.id !== p.id)
  selectedId.value = draft.value[0]?.id ?? ''
  editingId.value = ''
  saved.value = false
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

function markDirty(): void {
  saved.value = false
}

/** 列表里的一行预览：压掉换行，截一小段，避免长提示词把行撑高 */
function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > 64 ? flat.slice(0, 64) + '…' : flat
}
</script>

<template>
  <div class="ap ap-prompt">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <div v-if="templateBroken" class="ap-warnblock">
      <p class="ap-warnline">
        <AlertTriangle :size="13" />
        <span>提示词模板坏了：缺 <code>{{ s.templateHealth.missing.join('、') }}</code>，
          这会让这里写的提示词一个字都进不到模型。</span>
      </p>
      <Button variant="outline" size="sm" type="button" :disabled="restoring" @click="restore">
        <Wrench :size="13" aria-hidden="true" /> {{ restoring ? '恢复中…' : '恢复出厂模板' }}
      </Button>
    </div>

    <!-- ==================== 列表态 ==================== -->
    <template v-if="!editingId">
      <div class="ap-list-head">
        <span class="ap-hint">{{ draft.length }} 套模式 · 选中哪套，就把它那一段接在 Agent 提示词后面</span>
        <div class="ap-list-actions">
          <Button v-if="dirty" type="button" size="sm" :disabled="busy" @click="save">
            <Save :size="13" aria-hidden="true" /> 保存修改
          </Button>
          <Button size="sm" type="button" @click="addPreset">
            <Plus :size="13" aria-hidden="true" /> 新建模式
          </Button>
        </div>
      </div>

      <ul class="ap-list">
        <li v-for="p in draft" :key="p.id" class="ap-list-row">
          <div class="ap-list-main">
            <div class="ap-list-title">
              <span class="ap-list-name">{{ p.name || '未命名模式' }}</span>
              <span class="ap-badge">{{ p.builtin ? '内置 · 不可删除' : '自建' }}</span>
              <span v-if="p.id === s.activePromptId" class="ap-badge is-on">当前使用</span>
            </div>
            <div class="ap-list-desc">{{ p.text ? previewOf(p.text) : '还没有正文' }}</div>
            <div class="ap-list-meta">{{ p.text.length }} 字</div>
          </div>
          <Button variant="outline" size="sm" type="button" :aria-label="'编辑 ' + p.name" @click="openPreset(p)">编辑</Button>
        </li>
      </ul>
      <p v-if="!draft.length" class="ap-empty">还没有模式提示词</p>
    </template>

    <!-- ==================== 编辑态（二级页） ==================== -->
    <template v-else-if="active">
      <SettingsDetailHeader
        back-label="返回模式列表"
        :title="'编辑模式 · ' + (active.name || '未命名模式')"
        description="选中这套模式时，这段内容会接在 Agent 提示词后面一起进模型；变量在下面点一下就能插入。"
        @back="backToList"
      >
        <template #actions>
          <Button
            v-if="active.builtin"
            variant="outline"
            size="xs"
            type="button"
            aria-label="恢复这条模式的默认内容"
            @click="restoreActive"
          >
            <RotateCcw :size="12" aria-hidden="true" /> 恢复默认
          </Button>
          <Button v-if="!active.builtin" variant="destructive" size="xs" type="button" :aria-label="'删除 ' + active.name" @click="removeActive">
            <Trash2 :size="12" aria-hidden="true" /> 删除
          </Button>
        </template>
      </SettingsDetailHeader>

      <div class="ap-detail-form">
        <label class="ap-field">
          <span class="ap-field-label">模式名称</span>
          <Input v-model="active.name" class="ap-input" aria-label="模式名称" placeholder="显示在模式选择里" @input="markDirty" />
        </label>

        <div class="ap-field">
          <div class="ap-field-head">
            <span class="ap-field-label">追加提示词</span>
            <span class="ap-count">{{ active.text.length }} 字</span>
          </div>
          <PromptEditor
            v-model="active.text"
            label="模式提示词正文"
            placeholder="写这套模式的追加指令…"
            :height="240"
            @update:model-value="markDirty"
          />
        </div>

        <div class="ap-detail-foot is-sticky">
          <span v-if="saved" class="ap-hint ap-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">存在后台，换台机器也在</span>
          <Button type="button" size="sm" :disabled="busy || !dirty" @click="save">
            <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ap-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-list-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.ap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ap-list-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 10px; }
.ap-list-row:hover { background: var(--ui-hover, #f4f6f9); }
.ap-list-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ap-list-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.ap-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-badge { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--ui-hover, #f4f6f9); font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ap-badge.is-on { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); }
.ap-list-desc, .ap-list-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ap-list-meta { font-size: 10.5px; color: var(--ui-ink-mute, #8c95a3); }
.ap-detail-form { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.ap-field { display: flex; flex-direction: column; gap: 6px; }
.ap-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-field-label { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.ap-input { width: 100%; }
.ap-count { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ap-detail-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px; }
.ap-ok { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-accent, #0891b2); }
.ap-warnblock { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px 10px; border: 1px solid var(--ui-warn, #b45309); border-radius: var(--radius-control, 8px); }
.ap-warnline { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; color: var(--ui-warn, #b45309); }
.ap-warnline code { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
