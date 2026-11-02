<script setup lang="ts">
/**
 * CursorSettingsPage —— 设置面板里「光标」这一页（本插件自绘，mode: replace）。
 *
 * 结构：总开关 → 光标指针（分类页签）→ 跟随特效 → 点击特效 → 参数 → 恢复默认。
 * 数据全经 useCursorSettings 读写内核 settings（改动实时生效、随 settingsPersist 持久化）。
 *
 * UI 全部来自画布 ui 注册表登记的 shadcn 原始件（默认主题插件负责登记）。
 * 导航项不再自绘，实际入口由设置面板统一渲染。
 */
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { RotateCcw, Upload } from 'lucide-vue-next'
import { CURSOR_GROUPS, CUSTOM_CURSOR_ID, FOLLOWS, EFFECTS, cursorById, type CursorItem, type CursorSrc } from '../../catalog'
import { svgIcon } from '../../engine'
import { useCursorSettings } from '../../useCursorSettings'
import {
  loadCustomCursors, addCustomCursor, removeCustomCursor, updateCustomCursor, normalizeUpload, isPersistent, type CustomCursor,
} from '../../customCursors'
import './settings.css'

const Button = useUiComponent('Button')
const Slider = useUiComponent('Slider')
const Switch = useUiComponent('Switch')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

const { get, set, reset } = useCursorSettings()

/** 当前光标分类页签 */
const cursorTab = ref<string>('pointer')
const activeGroup = () => CURSOR_GROUPS.find((g) => g.key === cursorTab.value) ?? CURSOR_GROUPS[0]
/** 页签 = 四个内置分类 + 自定义 */
const tabs = [...CURSOR_GROUPS.map((g) => ({ key: g.key, label: g.label })), { key: 'custom', label: '自定义' }]

// ==================== 自定义素材（图片 / SVG / 帧序列） ====================
const customs = ref<CustomCursor[]>(loadCustomCursors())
const uploading = ref(false)
const uploadError = ref('')
const uploadNote = ref('')
/** 当前环境能不能把素材存到本地（不能就提示"刷新会丢"） */
const persistent = isPersistent()
const fileInput = ref<HTMLInputElement | null>(null)

function refreshCustoms(): void { customs.value = loadCustomCursors() }
function pickCustom(c: CustomCursor): void { set('cursorFxCursor', CUSTOM_CURSOR_ID); set('cursorFxCustomId', c.id) }
/** 当前选中的自定义素材（用于显示"帧率"滑杆） */
const activeCustom = () => customs.value.find((c) => c.id === get('cursorFxCustomId')) ?? null
/** 改某条素材的帧率（立即生效：写回 localStorage + 广播，渲染层重读） */
function setCustomFps(c: CustomCursor, fps: number): void {
  const next = Math.max(2, Math.min(30, Number(fps) || 12))
  customs.value = updateCustomCursor(customs.value, c.id, { fps: next })
}
function dropCustom(c: CustomCursor): void {
  customs.value = removeCustomCursor(customs.value, c.id)
  if (get('cursorFxCustomId') === c.id) set('cursorFxCustomId', customs.value[0] ? customs.value[0].id : '')
}
async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return
  uploading.value = true; uploadError.value = ''
  uploadNote.value = ''
  try {
    const frames: string[] = []
    for (const f of files) {
      if (!/^image\//.test(f.type) && !/\.svg$/i.test(f.name)) { uploadError.value = '只支持图片或 SVG：' + f.name; continue }
      frames.push(await normalizeUpload(f))
    }
    if (frames.length) {
      const base = files[0].name.replace(/\.[^.]+$/, '')
      const name = frames.length > 1 ? base + '（' + frames.length + ' 帧）' : base
      const res = addCustomCursor(customs.value, { name, frames, fps: Number(get('cursorFxCustomFps')) || 12, hx: 0.5, hy: 0.5 })
      if (res.warning) uploadNote.value = res.warning
      refreshCustoms()
      pickCustom(res.item)
    }
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    uploading.value = false
    if (input) input.value = ''
  }
}

/** 缩略图：彩色素材用原色，单色图标用 currentColor（跟随文字色） */
function thumb(item: { icon: string; src: CursorSrc }): string {
  return item.src === 'color' ? svgIcon(item.icon) : svgIcon(item.icon)
}
function pickCursor(c: CursorItem): void { set('cursorFxCursor', c.id) }
function pickFollow(id: string): void { set('cursorFxFollow', id) }
function pickEffect(id: string): void { set('cursorFxEffect', id) }

/** 数字参数：滑块回调是 number 或 number[]，统一取第一个 */
function firstOf(value: number | number[] | undefined): number {
  if (Array.isArray(value)) return value[0] ?? 0
  return typeof value === 'number' ? value : 0
}
function setRange(key: 'cursorFxSize' | 'cursorFxTrailSize' | 'cursorFxPower' | 'cursorFxParticleCap', value: number | number[] | undefined): void {
  set(key, firstOf(value))
}

/** Slider 的 v-model 回调：帧率滑杆只改当前自定义素材 */
function setCustomFpsFrom(value: number | number[] | undefined): void {
  const current = activeCustom()
  if (current) setCustomFps(current, firstOf(value))
}

function setSizeFrom(value: number | number[] | undefined): void {
  setRange('cursorFxSize', value)
}
function setTrailSizeFrom(value: number | number[] | undefined): void {
  setRange('cursorFxTrailSize', value)
}
function setPowerFrom(value: number | number[] | undefined): void {
  setRange('cursorFxPower', value)
}
function setParticleCapFrom(value: number | number[] | undefined): void {
  setRange('cursorFxParticleCap', value)
}
</script>

<template>
  <div class="ce-page">
    <ShadcnSettingsSection title="总开关" description="关闭 = 完全不动画布光标（用回系统指针、不画任何特效）">
      <ShadcnSettingsRow label="启用光标特效">
        <Switch
          :model-value="!!get('cursorFxEnabled')"
          aria-label="启用光标特效"
          @update:model-value="set('cursorFxEnabled', $event)"
        />
      </ShadcnSettingsRow>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection
      title="光标指针"
      :description="'当前：' + cursorById(String(get('cursorFxCursor'))).name"
    >
      <Tabs v-model="cursorTab" class="ce-tabs">
        <TabsList variant="line" class="ce-tab-list" aria-label="光标指针分类">
          <TabsTrigger v-for="g in tabs" :key="g.key" :value="g.key" class="ce-tab">{{ g.label }}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div v-if="cursorTab !== 'custom'" class="ce-grid">
        <button v-for="c in activeGroup().items" :key="c.id" class="ce-tile"
          :class="{ 'is-on': get('cursorFxCursor') === c.id }"
          :title="c.name" :aria-pressed="get('cursorFxCursor') === c.id" @click="pickCursor(c)">
          <span class="ce-thumb" :class="{ 'is-mono': c.src === 'mono' }" v-html="thumb(c)" />
          <span class="ce-name">{{ c.name }}</span>
        </button>
      </div>

      <div v-else class="ce-custom">
        <div class="ce-custom-actions">
          <input ref="fileInput" class="ce-file" type="file" accept="image/*,.svg" multiple
            aria-label="上传光标素材（图片或 SVG，多个文件=帧序列）" @change="onFiles" />
          <Button variant="outline" size="sm" type="button" :disabled="uploading" @click="fileInput && fileInput.click()">
            <Upload :size="13" aria-hidden="true" /> {{ uploading ? '读取中…' : '上传图片 / SVG' }}
          </Button>
          <span class="ap-hint">多选几张 = 帧序列动画</span>
        </div>
        <p v-if="uploadError" class="ce-custom-err">{{ uploadError }}</p>
        <p v-if="uploadNote" class="ce-custom-note">{{ uploadNote }}</p>
        <p v-if="!persistent" class="ce-custom-note">当前环境不支持本地存储：上传的素材只在本会话有效，刷新后会丢。</p>
        <p v-if="!customs.length" class="ap-hint">还没有自定义素材。上传一张图片或 SVG 即可作为光标；一次多选几张图片就是一帧序列。</p>
        <div v-else class="ce-grid">
          <div v-for="c in customs" :key="c.id" class="ce-tile ce-custom-tile"
            :class="{ 'is-on': get('cursorFxCursor') === CUSTOM_CURSOR_ID && get('cursorFxCustomId') === c.id }"
            :title="c.name" @click="pickCustom(c)">
            <span class="ce-thumb"><img :src="c.frames[0]" alt="" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" /></span>
            <span class="ce-name">{{ c.name }}</span>
            <span v-if="c.frames.length > 1" class="ce-frames">{{ c.frames.length }}帧</span>
            <button class="ce-del" title="删除" aria-label="删除" @click.stop="dropCustom(c)">×</button>
          </div>
        </div>
        <div v-if="activeCustom() && activeCustom()!.frames.length > 1" class="ce-range-row">
          <span class="ap-hint">帧率（{{ activeCustom()!.frames.length }} 帧序列）</span>
          <Slider
            class="ce-range"
            :model-value="[activeCustom()!.fps]"
            :min="2"
            :max="30"
            :step="1"
            aria-label="帧率"
            @update:model-value="setCustomFpsFrom"
          />
          <span class="ce-bubble">{{ activeCustom()!.fps }} 帧/秒</span>
        </div>
        <p class="ap-hint">
          上传<b>一张</b>图片/SVG = 静态光标；<b>多选几张</b> = 帧序列动画。素材只存本机浏览器。
        </p>
      </div>

      <p class="ap-hint">
        <b>指针</b>是单色真鼠标形状；<b>彩色</b>用真实彩色素材；<b>系统</b>是浏览器内置光标；<b>图片</b>是 CSS 图片光标；<b>自定义</b>上传你自己的素材。
      </p>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="跟随特效" description="鼠标划过时出现">
      <div class="ce-grid">
        <button v-for="f in FOLLOWS" :key="f.id" class="ce-tile"
          :class="{ 'is-on': get('cursorFxFollow') === f.id }"
          :title="f.name" :aria-pressed="get('cursorFxFollow') === f.id" @click="pickFollow(f.id)">
          <span class="ce-thumb" :class="{ 'is-mono': f.src === 'mono' }" v-html="thumb(f)" />
          <span class="ce-name">{{ f.name }}</span>
        </button>
      </div>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="点击特效" description="点击画布时炸开">
      <div class="ce-grid">
        <button v-for="e in EFFECTS" :key="e.id" class="ce-tile"
          :class="{ 'is-on': get('cursorFxEffect') === e.id }"
          :title="e.name" :aria-pressed="get('cursorFxEffect') === e.id" @click="pickEffect(e.id)">
          <span class="ce-thumb" :class="{ 'is-mono': e.src === 'mono' }" v-html="thumb(e)" />
          <span class="ce-name">{{ e.name }}</span>
        </button>
      </div>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="参数">
      <ShadcnSettingsRow label="指针大小" stacked>
        <div class="ce-range-row">
          <Slider class="ce-range" :model-value="[Number(get('cursorFxSize'))]" :min="14" :max="96" :step="1"
            aria-label="指针大小" @update:model-value="setSizeFrom" />
          <span class="ce-bubble">{{ get('cursorFxSize') }}</span>
        </div>
      </ShadcnSettingsRow>
      <ShadcnSettingsRow label="特效大小" stacked>
        <div class="ce-range-row">
          <Slider class="ce-range" :model-value="[Number(get('cursorFxTrailSize'))]" :min="8" :max="64" :step="1"
            aria-label="特效大小" @update:model-value="setTrailSizeFrom" />
          <span class="ce-bubble">{{ get('cursorFxTrailSize') }}</span>
        </div>
      </ShadcnSettingsRow>
      <ShadcnSettingsRow label="特效强度" stacked>
        <div class="ce-range-row">
          <Slider class="ce-range" :model-value="[Number(get('cursorFxPower'))]" :min="20" :max="200" :step="5"
            aria-label="特效强度" @update:model-value="setPowerFrom" />
          <span class="ce-bubble">{{ get('cursorFxPower') }}</span>
        </div>
      </ShadcnSettingsRow>
      <ShadcnSettingsRow label="粒子上限" description="护帧率" stacked>
        <div class="ce-range-row">
          <Slider class="ce-range" :model-value="[Number(get('cursorFxParticleCap'))]" :min="200" :max="1600" :step="100"
            aria-label="粒子上限" @update:model-value="setParticleCapFrom" />
          <span class="ce-bubble">{{ get('cursorFxParticleCap') }}</span>
        </div>
      </ShadcnSettingsRow>
      <ShadcnSettingsRow label="悬停放大" description="鼠标移到节点/按钮上时指针放大发光">
        <Switch :model-value="!!get('cursorFxHoverScale')" aria-label="悬停放大" @update:model-value="set('cursorFxHoverScale', $event)" />
      </ShadcnSettingsRow>
      <ShadcnSettingsRow label="点击回弹" description="点击时指针缩一下再弹回">
        <Switch :model-value="!!get('cursorFxClickPunch')" aria-label="点击回弹" @update:model-value="set('cursorFxClickPunch', $event)" />
      </ShadcnSettingsRow>
    </ShadcnSettingsSection>

    <div class="ce-foot">
      <span class="ap-hint">改动立即生效，并随画布配置一起保存。</span>
      <Button variant="outline" size="sm" type="button" @click="reset()">
        <RotateCcw :size="13" aria-hidden="true" /> 恢复默认
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* 只保留选择网格与缩略图；开关、滑块、按钮、卡片都由 ui-kit-shadcn 提供。 */
.ce-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ce-tabs { display: flex; }
.ce-tab-list { flex-wrap: wrap; gap: 2px; padding: 0; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.ce-tab { height: 30px; padding: 0 10px; font-size: 12px; font-weight: 600; }
.ce-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; padding: 10px 0; }
.ce-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px 8px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: var(--radius-row, 10px); background: var(--ui-panel, transparent); color: var(--ui-ink, #18202b); cursor: pointer; transition: border-color 0.16s ease, background 0.16s ease; }
.ce-tile:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.ce-tile.is-on { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); }
.ce-thumb { display: grid; place-items: center; width: 30px; height: 30px; }
.ce-thumb :deep(svg) { width: 100%; height: 100%; display: block; }
.ce-thumb.is-mono { color: var(--ui-ink, #18202b); }
.ce-tile.is-on .ce-thumb.is-mono { color: var(--ui-accent-hover, #0e7490); }
.ce-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.ce-frames { position: absolute; top: 4px; left: 5px; font-size: 9px; color: var(--ui-accent-hover, #0e7490); font-weight: 700; }
.ce-del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 1; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--ui-ink-dim, #6b7280); font-size: 14px; cursor: pointer; opacity: 0; transition: opacity 0.14s ease, color 0.14s ease; }
.ce-custom-tile:hover .ce-del { opacity: 1; }
.ce-del:hover { color: var(--ui-danger, #ef4444); background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.ce-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ce-tile.is-on .ce-name { color: inherit; font-weight: 600; }
.ce-custom { display: flex; flex-direction: column; gap: 10px; padding: 10px 0; }
.ce-custom-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ce-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ce-custom-err { margin: 0; font-size: 11px; color: var(--ui-danger, #ef4444); }
.ce-custom-note { margin: 0; font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ce-range-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.ce-range { flex: 1; min-width: 120px; }
.ce-bubble { flex: none; padding: 1px 7px; border-radius: 999px; background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ce-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-hint { font-size: 10px; line-height: 1.6; color: var(--ui-ink-dim, #6b7280); }
</style>
