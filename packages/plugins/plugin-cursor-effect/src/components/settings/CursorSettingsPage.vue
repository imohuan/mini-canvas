<script setup lang="ts">
/**
 * CursorSettingsPage —— 设置面板里「光标」这一页的整页（本插件自绘，mode: replace）。
 *
 * 结构：总开关 → 光标指针（四个分类页签：指针/彩色/系统/图片）→ 跟随特效 → 点击特效 → 参数 → 恢复默认。
 * 数据全经 useCursorSettings 读写内核 settings（改动实时生效、随 settingsPersist 持久化）。
 */
import { ref } from 'vue'
import { CURSOR_GROUPS, CUSTOM_CURSOR_ID, FOLLOWS, EFFECTS, cursorById, type CursorItem, type CursorSrc } from '../../catalog'
import { svgIcon } from '../../engine'
import { useCursorSettings } from '../../useCursorSettings'
import {
  loadCustomCursors, addCustomCursor, removeCustomCursor, updateCustomCursor, normalizeUpload, isPersistent, type CustomCursor,
} from '../../customCursors'
import './settings.css'

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
function setCustomFps(c: CustomCursor, e: Event): void {
  const fps = Math.max(2, Math.min(30, Number((e.target as HTMLInputElement).value) || 12))
  customs.value = updateCustomCursor(customs.value, c.id, { fps })
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
function onRange(key: 'cursorFxSize' | 'cursorFxTrailSize' | 'cursorFxPower' | 'cursorFxParticleCap', e: Event): void {
  set(key, Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="ce-page">
    <!-- 总开关 -->
    <div class="ce-block">
      <div class="ce-block-body">
        <div class="ce-switch-row">
          <span>
            <strong>启用光标特效</strong>
            <small>关闭 = 完全不动画布光标（用回系统指针、不画任何特效）。</small>
          </span>
          <button class="ce-switch" :class="{ 'is-on': get('cursorFxEnabled') }" role="switch"
            :aria-checked="get('cursorFxEnabled')" aria-label="启用光标特效"
            @click="set('cursorFxEnabled', !get('cursorFxEnabled'))" />
        </div>
      </div>
    </div>

    <!-- 光标指针 -->
    <section class="ce-block">
      <div class="ce-block-head">
        <h4>光标指针</h4>
        <small>当前：{{ cursorById(get('cursorFxCursor')).name }}</small>
      </div>
      <div class="ce-block-body">
        <div class="ce-tabs" role="tablist" aria-label="光标指针分类">
          <button v-for="g in tabs" :key="g.key" class="ce-tab" role="tab"
            :class="{ 'is-active': cursorTab === g.key }" :aria-selected="cursorTab === g.key"
            @click="cursorTab = g.key">{{ g.label }}</button>
        </div>
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
            <button class="ce-mini" :disabled="uploading" @click="fileInput && fileInput.click()">
              {{ uploading ? '读取中…' : '上传图片 / SVG（多选=帧序列）' }}
            </button>
            <span v-if="uploadError" class="ce-custom-err">{{ uploadError }}</span>
            <span v-if="uploadNote" class="ce-custom-note">{{ uploadNote }}</span>
          </div>
          <p v-if="!persistent" class="ce-custom-note">当前环境不支持本地存储：上传的素材只在本会话有效，刷新后会丢。</p>
          <p v-if="!customs.length" class="ce-hint">还没有自定义素材。上传一张图片或 SVG 即可作为光标；一次多选几张图片就是**帧序列**（逐帧动画）。</p>
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
          <label v-if="activeCustom() && activeCustom().frames.length > 1" class="ce-field">
            <span class="ce-field-top">
              <span>帧率（这条 {{ activeCustom().frames.length }} 帧序列）</span>
              <span class="ce-bubble">{{ activeCustom().fps }} 帧/秒</span>
            </span>
            <input class="ce-range" type="range" min="2" max="30" step="1" :value="activeCustom().fps"
              aria-label="帧率" @input="setCustomFps(activeCustom(), $event)" />
          </label>
          <p class="ce-hint">
            上传<b>一张</b>图片/SVG = 静态光标；<b>多选几张</b> = 帧序列动画（用上面的「帧率」调快慢）。素材只存本机浏览器。
          </p>
        </div>
        <p class="ce-hint">
          <b>指针</b>是单色真鼠标形状（白填充+描边，落在任何底色上都看得清）；<b>彩色</b>用真实彩色素材；
          <b>系统</b>是浏览器内置光标；<b>图片</b>是 CSS 图片光标（静态，GIF 不会播）；<b>自定义</b>上传你自己的素材。
        </p>
      </div>
    </section>

    <!-- 跟随特效 -->
    <section class="ce-block">
      <div class="ce-block-head">
        <h4>跟随特效（会动的光标）</h4>
        <small>鼠标划过时出现</small>
      </div>
      <div class="ce-block-body">
        <div class="ce-grid">
          <button v-for="f in FOLLOWS" :key="f.id" class="ce-tile"
            :class="{ 'is-on': get('cursorFxFollow') === f.id }"
            :title="f.name" :aria-pressed="get('cursorFxFollow') === f.id" @click="pickFollow(f.id)">
            <span class="ce-thumb" :class="{ 'is-mono': f.src === 'mono' }" v-html="thumb(f)" />
            <span class="ce-name">{{ f.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 点击特效 -->
    <section class="ce-block">
      <div class="ce-block-head">
        <h4>点击特效</h4>
        <small>点击画布时炸开</small>
      </div>
      <div class="ce-block-body">
        <div class="ce-grid">
          <button v-for="e in EFFECTS" :key="e.id" class="ce-tile"
            :class="{ 'is-on': get('cursorFxEffect') === e.id }"
            :title="e.name" :aria-pressed="get('cursorFxEffect') === e.id" @click="pickEffect(e.id)">
            <span class="ce-thumb" :class="{ 'is-mono': e.src === 'mono' }" v-html="thumb(e)" />
            <span class="ce-name">{{ e.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 参数 -->
    <section class="ce-block">
      <div class="ce-block-head"><h4>参数</h4></div>
      <div class="ce-block-body">
        <label class="ce-field">
          <span class="ce-field-top"><span>指针大小</span><span class="ce-bubble">{{ get('cursorFxSize') }}</span></span>
          <input class="ce-range" type="range" min="14" max="96" step="1" :value="get('cursorFxSize')"
            aria-label="指针大小" @input="onRange('cursorFxSize', $event)" />
        </label>
        <label class="ce-field">
          <span class="ce-field-top"><span>特效大小</span><span class="ce-bubble">{{ get('cursorFxTrailSize') }}</span></span>
          <input class="ce-range" type="range" min="8" max="64" step="1" :value="get('cursorFxTrailSize')"
            aria-label="特效大小" @input="onRange('cursorFxTrailSize', $event)" />
        </label>
        <label class="ce-field">
          <span class="ce-field-top"><span>特效强度</span><span class="ce-bubble">{{ get('cursorFxPower') }}</span></span>
          <input class="ce-range" type="range" min="20" max="200" step="5" :value="get('cursorFxPower')"
            aria-label="特效强度" @input="onRange('cursorFxPower', $event)" />
        </label>
        <label class="ce-field">
          <span class="ce-field-top"><span>粒子上限（护帧率）</span><span class="ce-bubble">{{ get('cursorFxParticleCap') }}</span></span>
          <input class="ce-range" type="range" min="200" max="1600" step="100" :value="get('cursorFxParticleCap')"
            aria-label="粒子上限" @input="onRange('cursorFxParticleCap', $event)" />
        </label>
        <div class="ce-switch-row">
          <span><strong>悬停放大</strong><small>鼠标移到节点/按钮上时指针放大发光。</small></span>
          <button class="ce-switch" :class="{ 'is-on': get('cursorFxHoverScale') }" role="switch"
            :aria-checked="get('cursorFxHoverScale')" aria-label="悬停放大"
            @click="set('cursorFxHoverScale', !get('cursorFxHoverScale'))" />
        </div>
        <div class="ce-switch-row">
          <span><strong>点击回弹</strong><small>点击时指针缩一下再弹回。</small></span>
          <button class="ce-switch" :class="{ 'is-on': get('cursorFxClickPunch') }" role="switch"
            :aria-checked="get('cursorFxClickPunch')" aria-label="点击回弹"
            @click="set('cursorFxClickPunch', !get('cursorFxClickPunch'))" />
        </div>
      </div>
    </section>

    <div class="ce-foot">
      <span class="ce-hint">改动立即生效，并随画布配置一起保存。</span>
      <button class="ce-mini" @click="reset()">恢复默认</button>
    </div>
  </div>
</template>
