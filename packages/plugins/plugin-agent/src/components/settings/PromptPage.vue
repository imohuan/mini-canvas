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
 */
import { computed, onMounted, ref } from 'vue'
import { Plus, Trash2, Check } from 'lucide-vue-next'
import { useAgent } from '../../useAgent.js'
import type { PromptPreset } from '../../agentService.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state

/** 本地编辑副本（保存前不改动 state，避免边打边写） */
const draft = ref<PromptPreset[]>([])
const selectedId = ref('')
const busy = ref(false)
const saved = ref(false)
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

/** 脏了没（决定「保存」是否可点） */
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(s.prompts))

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
</script>

<template>
  <div class="ap ap-prompt">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

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
          <span class="ap-hint">系统提示词正文（选中这个模式时发给 Agent）</span>
          <span class="ap-count">{{ active.text.length }} 字</span>
        </div>
        <textarea v-model="active.text" class="pp-textarea" rows="14"
          aria-label="系统提示词正文" placeholder="写这个模式的系统提示词…" @input="saved = false"></textarea>
        <div class="pp-foot">
          <span v-if="saved" class="ap-hint pp-ok"><Check :size="12" /> 已保存</span>
          <span v-else-if="dirty" class="ap-hint">有未保存的修改</span>
          <span v-else class="ap-hint">存在后台，换台机器也在</span>
          <button class="ap-submit" :disabled="busy || !dirty" @click="save">保存</button>
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
</style>
