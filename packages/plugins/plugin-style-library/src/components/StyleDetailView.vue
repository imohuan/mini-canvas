<script setup lang="ts">
/**
 * StyleDetailView —— 点卡片打开的风格详情（图 3）。
 *
 * 布局：左 = 大图舞台（多图时左右切换 + 缩略图条），右 = 信息栏（名称 / 作者 / 标签 /
 * 首选推荐模型 / 收藏 / 使用）。纯展示件：数据来自 props，动作经 emit 交回父组件。
 *
 * 浮层规范照 docs/design/ui-style-guide.md §3.1：Teleport 到 body、点遮罩关闭、Esc 关闭、
 * 进面板聚焦、z-index 100000、发丝边 + 柔和阴影。所有颜色走 --ui-* token（亮暗自动切换）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, Star, ChevronLeft, ChevronRight, CheckCircle2, Sparkles, Flame, Heart } from 'lucide-vue-next'
import type { StyleCard } from '../data/types'

const props = defineProps<{
  item: StyleCard | null
  starred?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-star', item: StyleCard): void
  (e: 'use', item: StyleCard, index: number): void
}>()

const index = ref(0)
const loaded = ref(false)
const failed = ref(false)
const panel = ref<HTMLElement | null>(null)

const open = computed(() => props.item !== null)
const images = computed(() => props.item?.images ?? [])
const current = computed(() => images.value[index.value] ?? props.item?.cover ?? '')

/** 首选推荐模型：有 modelTypeName 用它，否则退第一个标签 */
const modelName = computed(() => props.item?.tags[0] || '通用')

watch(
  () => props.item?.id,
  () => {
    index.value = 0
    loaded.value = false
    failed.value = false
  },
)
watch(current, () => {
  loaded.value = false
  failed.value = false
})

function prev(): void {
  if (index.value > 0) index.value -= 1
  else index.value = images.value.length - 1
}
function next(): void {
  if (index.value < images.value.length - 1) index.value += 1
  else index.value = 0
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))

watch(open, async (v) => {
  if (v) {
    await nextTick()
    panel.value?.focus()
  }
})

function human(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'w'
  return String(n)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && item" class="sd-layer" @pointerdown.self="emit('close')" @contextmenu.prevent>
      <div ref="panel" class="sd-panel" tabindex="-1" @pointerdown.stop>
        <header class="sd-head">
          <span class="sd-title">风格详情</span>
          <button class="sd-x" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="16" />
          </button>
        </header>

        <div class="sd-body">
          <!-- 左：图舞台 -->
          <div class="sd-stage">
            <div class="sd-image-wrap">
              <div v-if="!loaded && !failed" class="sd-skeleton" aria-hidden="true"></div>
              <img v-if="!failed" class="sd-image" :class="{ 'is-in': loaded }" :src="current" :alt="item.name"
                decoding="async" @load="loaded = true" @error="failed = true" />
              <div v-else class="sd-fallback"><span>图片加载失败</span></div>

              <template v-if="images.length > 1">
                <button class="sd-nav sd-nav--prev" type="button" aria-label="上一张" @click="prev">
                  <ChevronLeft :size="18" />
                </button>
                <button class="sd-nav sd-nav--next" type="button" aria-label="下一张" @click="next">
                  <ChevronRight :size="18" />
                </button>
                <span class="sd-page">{{ index + 1 }} / {{ images.length }}</span>
              </template>
            </div>

            <!-- 缩略图条（多图时） -->
            <div v-if="images.length > 1" class="sd-thumbs" role="tablist" aria-label="图片列表">
              <button v-for="(img, i) in images" :key="img" class="sd-thumb" :class="{ 'is-on': i === index }"
                type="button" role="tab" :aria-selected="i === index" :aria-label="'第 ' + (i + 1) + ' 张'"
                @click="index = i">
                <img :src="img" alt="" loading="lazy" decoding="async" />
              </button>
            </div>
          </div>

          <!-- 右：信息栏 -->
          <aside class="sd-side">
            <div class="sd-side-top">
              <h3 class="sd-name" :title="item.name">{{ item.name }}</h3>
              <span v-if="item.commercial" class="sd-badge"><CheckCircle2 :size="12" /> 生成内容可商用</span>
            </div>

            <div class="sd-author">
              <span class="sd-avatar" aria-hidden="true">{{ (item.author || '?').slice(0, 1) }}</span>
              <span class="sd-author-name">{{ item.author || '未知作者' }}</span>
            </div>

            <div class="sd-stats">
              <span class="sd-stat"><Flame :size="12" /> {{ human(item.runCount) }} 次运行</span>
              <span class="sd-stat"><Heart :size="12" /> {{ human(item.likeCount) }} 收藏</span>
              <span class="sd-stat">{{ item.imageCount }} 张素材</span>
            </div>

            <div class="sd-field">
              <span class="sd-field-label">首选推荐模型</span>
              <div class="sd-model"><Sparkles :size="13" /> {{ modelName }}</div>
            </div>

            <div v-if="item.tags.length" class="sd-field">
              <span class="sd-field-label">标签</span>
              <div class="sd-tags">
                <span v-for="t in item.tags.slice(0, 12)" :key="t" class="sd-tag">{{ t }}</span>
              </div>
            </div>

            <div class="sd-spacer"></div>

            <div class="sd-actions">
              <button class="sd-btn" type="button" :aria-pressed="starred === true"
                @click="emit('toggle-star', item)">
                <Star :size="14" :fill="starred ? 'currentColor' : 'none'" /> {{ starred ? '已收藏' : '收藏' }}
              </button>
              <button class="sd-btn sd-btn--primary" type="button" @click="emit('use', item, index)">使用</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sd-layer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ui-scrim-soft, rgb(15 23 42 / 0.22));
  backdrop-filter: blur(2px);
}
.sd-panel {
  display: flex;
  flex-direction: column;
  /* 尺寸照用户口径放大：几乎占满视口（上下各留 20px 遮罩边），不再是小窗。
     高度用 vh 保证各种屏幕比例下都吃满可用高度。 */
  width: min(1400px, 100%);
  height: min(92vh, 940px);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
  overflow: hidden;
  outline: none;
  animation: sd-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes sd-in {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to { opacity: 1; transform: none; }
}

.sd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 12px 14px 12px 18px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.sd-title { font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.sd-x {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.sd-x:hover { background: var(--ui-danger-soft, rgb(239 68 68 / 0.1)); color: var(--ui-danger, #ef4444); }
.sd-x:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.sd-body { display: flex; flex: 1; min-height: 0; }

/* 左：图舞台 */
.sd-stage {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 10px;
  padding: 16px;
  background: var(--ui-canvas-bg, #f5f6f8);
}
.sd-image-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  overflow: hidden;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
}
.sd-image {
  /* 绝对定位 + 撑满容器 + contain：图片永远被约束在舞台内、按比例完整显示（竖图上下留白，
     不裁切）。为什么不用 max-width/max-height:100% —— 舞台是 grid 容器，grid item 的
     百分比 max-height 会因轨道高度 auto 而解析失败（实测：663×1183 的竖图按原尺寸渲染，
     超出舞台的 576px 被 overflow:hidden 裁掉 → 用户看到的"图片显示不完整"）。
     绝对定位把尺寸基准钉死在舞台盒上，绕开这个循环依赖。 */
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.sd-image.is-in { opacity: 1; }
.sd-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, var(--ui-veil, rgb(0 0 0 / 0.04)) 30%, var(--ui-hover, rgb(0 0 0 / 0.07)) 50%, var(--ui-veil, rgb(0 0 0 / 0.04)) 70%);
  background-size: 200% 100%;
  animation: sd-shimmer 1.4s ease-in-out infinite;
}
@keyframes sd-shimmer { from { background-position: 130% 0; } to { background-position: -30% 0; } }
.sd-fallback { color: var(--ui-ink-dim, #6b7280); font-size: 12px; }

.sd-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: var(--ui-scrim, rgb(15 23 42 / 0.42));
  color: var(--ui-tip-ink, #fff);
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.18s ease;
}
.sd-nav:hover { background: var(--ui-scrim, rgb(15 23 42 / 0.68)); }
.sd-nav:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.sd-nav--prev { left: 10px; }
.sd-nav--next { right: 10px; }
.sd-page {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-tip-ink, #fff);
  background: var(--ui-scrim, rgb(15 23 42 / 0.5));
}

.sd-thumbs {
  display: flex;
  flex: none;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.sd-thumb {
  flex: none;
  width: 54px;
  height: 54px;
  padding: 0;
  border: 1.5px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
  cursor: pointer;
  transition: border-color 0.18s ease;
}
.sd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sd-thumb.is-on { border-color: var(--ui-accent, #0891b2); }
.sd-thumb:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

/* 右：信息栏 */
.sd-side {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 300px;
  gap: 14px;
  padding: 16px;
  border-left: 1px solid var(--ui-line-soft, #eef0f4);
  overflow-y: auto;
}
.sd-side-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.sd-name { margin: 0; font-size: 15px; font-weight: 700; color: var(--ui-ink, #18202b); line-height: 1.35; }
.sd-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-accent-hover, #0e7490);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}
.sd-author { display: flex; align-items: center; gap: 6px; color: var(--ui-ink-dim, #6b7280); font-size: 12px; }
.sd-avatar {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  font-size: 11px;
  font-weight: 700;
}
.sd-stats { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.sd-stat { display: inline-flex; align-items: center; gap: 3px; }

.sd-field { display: flex; flex-direction: column; gap: 6px; }
.sd-field-label { font-size: 11px; font-weight: 700; color: var(--ui-ink-mute, #8c95a3); letter-spacing: 0.02em; }
.sd-model {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: var(--ui-veil, rgb(0 0 0 / 0.03));
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #18202b);
}
.sd-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.sd-tag {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  font-size: 10px;
  color: var(--ui-ink-dim, #6b7280);
}

.sd-spacer { flex: 1; }

.sd-actions { display: flex; gap: 8px; }
.sd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  height: 36px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease;
}
.sd-btn:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.sd-btn--primary {
  flex: 1.4;
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent, #0891b2);
  color: var(--ui-primary-ink, #fff);
}
.sd-btn--primary:hover { background: var(--ui-accent-hover, #0e7490); }
.sd-btn:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

@media (max-width: 860px) {
  .sd-body { flex-direction: column; }
  .sd-side { width: auto; border-left: none; border-top: 1px solid var(--ui-line-soft, #eef0f4); }
}

@media (prefers-reduced-motion: reduce) {
  .sd-panel, .sd-image, .sd-skeleton { transition: none !important; animation: none !important; }
}
</style>
