<script setup lang="ts">
/**
 * StyleCardView —— 素材库里的一张卡（风格 / 特效共用）。
 *
 * 纯展示件：收到一张卡的数据 + 一个"打开"回调；不取数、不筛选。
 * 默认皮这件由插件注册进 ui 目录的 `styleLibraryCard` 名下 —— 想换外观，
 * 另注册一件 order 更小的同名件即可（消费方按名取，零改动）。
 *
 * ## 媒体：有视频就放视频，没有就放图
 *
 * 用户口径（2026-10-07）：**素材类型不统一（有的只有图、有的带效果视频），有视频的直接
 * 显示并播放视频，不要等 hover**。所以：
 * - 有预览视频（`item.videos[0]`）→ 渲染 `<video>` 自动播放（静音循环）；
 * - 没有 → 显示封面图（风格库全是这种）。
 *
 * 但 22 条特效视频每个 20MB 上下，**一进页面全下**会拖垮首屏。所以用
 * **IntersectionObserver 做懒加载**：卡片进入视野才渲染 `<video>`（= 才开始下载），
 * 离开视野暂停。既满足"直接显示视频、不用 hover"，又不会一次性拉几百 MB。
 *
 * 视频就绪前先显示封面图（当 poster 用），就绪后淡入替换 —— 不闪、不跳布局。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckCircle2, Star, Expand, Flame, Film, Plus } from 'lucide-vue-next'
import type { StyleCard } from '../data/types'

const props = defineProps<{
  item: StyleCard
  /** 收藏态（受控；父组件持有） */
  starred?: boolean
  /** 是否显示"商用"徽章（特效库传 false 隐藏） */
  showCommercial?: boolean
  /** 正在加入画布（父组件在提交期间置 true，避免连点重复建节点） */
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', item: StyleCard): void
  (e: 'toggle-star', item: StyleCard): void
  /** 把这条素材加到画布（两个库共用；父组件决定落素材库里第一张） */
  (e: 'use', item: StyleCard): void
}>()

const loaded = ref(false)
const failed = ref(false)

/** 预览视频地址（没有就是空串 —— 风格库全都没有） */
const videoUrl = computed(() => props.item.videos?.[0] ?? '')
const hasVideo = computed(() => !!videoUrl.value)
/** 视频取不到（坏链接）：退回到图，别让卡片永远空着 */
const videoBroken = ref(false)
/** 视频能播了（就绪后把它顶上来替换封面图） */
const videoReady = ref(false)

/** 是否在视野内（IntersectionObserver 置位；决定视频要不要渲染/下载） */
const inView = ref(false)
/** 是否**曾经**进过视野 —— 进过就保留 <video>（滚动来回不重下） */
const everInView = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
let io: IntersectionObserver | null = null

/** 要渲染视频：有视频 + 没坏 + 曾经进过视野 */
const renderVideo = computed(() => hasVideo.value && !videoBroken.value && everInView.value)
/** 封面图：视频没就绪前一直显示（当 poster） */
const showImage = computed(() => !videoReady.value)

function onVideoReady(): void {
  videoReady.value = true
}
function onVideoError(): void {
  videoBroken.value = true
  videoReady.value = false
}

// 进视野播放、离开暂停（不卸载：来回滚动不重复下载）
watch(inView, (v) => {
  const el = videoEl.value
  if (!el) return
  if (v) void el.play?.().catch(() => { /* 浏览器可能拦自动播放：静默，用户可点卡片看全屏 */ })
  else el.pause?.()
})

// <video> 是懒渲染的（进视野才创建），所以 autoplay 属性在"元素刚被插进来"时不一定生效 ——
// 等它挂上后再显式 play 一次，保证进视野就真的在播（实测：首张卡偶发停在 paused）。
// videoEl 变化（元素出现/消失）与视频就绪时各试一次。
function tryPlay(): void {
  const el = videoEl.value
  if (!el) return
  if (!inView.value) return
  void el.play?.().catch(() => { /* 浏览器拦自动播放：静默降级为静帧 */ })
}
watch(videoEl, (el) => { if (el) tryPlay() })
watch(videoReady, (r) => { if (r) tryPlay() })

onMounted(() => {
  if (!hasVideo.value) return
  if (typeof IntersectionObserver === 'undefined') {
    // 没有 IntersectionObserver（极老环境）：直接当"在视野里"，退化成立即加载
    inView.value = true
    everInView.value = true
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      const e = entries[0]
      if (!e) return
      inView.value = e.isIntersecting
      if (e.isIntersecting) everInView.value = true
    },
    // 提前 300px 开始加载：滚到跟前时视频已经就绪，不用等
    { rootMargin: '300px' },
  )
  if (rootEl.value) io.observe(rootEl.value)
})
onBeforeUnmount(() => {
  io?.disconnect()
  io = null
})

/** 大数字口语化：12.3w / 547.9w / 8900 */
function human(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'w'
  return String(n)
}
</script>

<template>
  <article ref="rootEl" class="sc-card" :class="{ 'is-failed': failed, 'is-video': hasVideo && !videoBroken }">
    <div class="sc-media" @click="emit('open', props.item)">
      <!-- 骨架：图片 onload 前显示，撑住布局不跳 -->
      <div v-if="!loaded && !failed && showImage" class="sc-skeleton" aria-hidden="true"></div>

      <img
        v-if="!failed && showImage"
        class="sc-img"
        :class="{ 'is-in': loaded }"
        :src="item.cover"
        :alt="item.name"
        loading="lazy"
        decoding="async"
        @load="loaded = true"
        @error="failed = true"
      />
      <div v-else-if="failed && showImage" class="sc-fallback" aria-hidden="true">
        <span class="sc-fallback-mark">!</span>
      </div>

      <!--
        效果预览视频：**进视野才渲染**（= 才开始下载），自动播放。
        muted + loop + playsinline 是"能自动播放"的硬条件。
      -->
      <video
        v-if="renderVideo"
        ref="videoEl"
        class="sc-video"
        :class="{ 'is-in': videoReady }"
        :src="videoUrl"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        @canplay="onVideoReady"
        @loadeddata="onVideoReady"
        @error="onVideoError"
      ></video>

      <!-- 左上：模型/分类标签（悬停才出现）。多图角标已挪到左下角，避免与它重叠。 -->
      <span v-if="item.tags[0]" class="sc-pill sc-pill--model">{{ item.tags[0] }}</span>
      <!-- 右上：收藏 -->
      <button
        class="sc-iconbtn sc-star"
        :class="{ 'is-on': starred }"
        type="button"
        :aria-label="starred ? '取消收藏' : '收藏'"
        :aria-pressed="starred === true"
        @click.stop="emit('toggle-star', props.item)"
      >
        <Star :size="14" :fill="starred ? 'currentColor' : 'none'" />
      </button>
      <!-- 右下：放大（打开预览 / 详情） -->
      <button
        class="sc-iconbtn sc-expand"
        type="button"
        aria-label="查看大图"
        @click.stop="emit('open', props.item)"
      >
        <Expand :size="14" />
      </button>
      <!-- 右下：加入画布（两个库都有；素材走 media.put → media.addNode） -->
      <button
        class="sc-iconbtn sc-add"
        :class="{ 'is-busy': busy }"
        :disabled="busy"
        type="button"
        :aria-label="busy ? '正在加入画布' : '加入画布'"
        title="加入画布"
        @click.stop="emit('use', props.item)"
      >
        <Plus :size="14" />
      </button>
      <!-- 左下：多图数量角标（常显；挪到左下角后与左上角的标签不再叠加） -->
      <span v-if="item.images.length > 1" class="sc-count" aria-hidden="true">{{ item.images.length }}</span>
    </div>

    <div class="sc-body">
      <div class="sc-row sc-row--head">
        <strong class="sc-name" :title="item.name">{{ item.name }}</strong>
        <!-- 类型标识：有视频的标"视频"，一眼与纯图片素材区分（用户口径：类型不统一） -->
        <span v-if="hasVideo" class="sc-badge sc-badge--video">
          <Film :size="11" /> 视频
        </span>
        <span v-else-if="showCommercial !== false && item.commercial" class="sc-badge">
          <CheckCircle2 :size="11" /> 商用
        </span>
      </div>
      <div class="sc-row sc-row--meta">
        <span class="sc-author" :title="item.author">
          <span class="sc-avatar" aria-hidden="true">{{ (item.author || '?').slice(0, 1) }}</span>
          <span class="sc-author-name">{{ item.author || '未知作者' }}</span>
        </span>
        <span class="sc-run" :title="'运行 ' + item.runCount">
          <Flame :size="11" /> {{ human(item.runCount) || '0' }}
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sc-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  overflow: hidden;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.sc-card:hover {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent);
  box-shadow: 0 6px 20px var(--ui-scrim-soft, rgb(15 23 42 / 0.14));
}

.sc-media {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  cursor: pointer;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
}
.sc-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.sc-img.is-in { opacity: 1; }
/* 纯图片卡：悬停轻微放大；视频卡不缩放（放大视频会抖） */
.sc-card:not(.is-video):hover .sc-img.is-in { transform: scale(1.04); }

/* 预览视频：盖满整张卡（与图片同款铺法），就绪后淡入 */
.sc-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.25s ease;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
}
.sc-video.is-in { opacity: 1; }

.sc-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    var(--ui-veil, rgb(0 0 0 / 0.04)) 30%,
    var(--ui-hover, rgb(0 0 0 / 0.07)) 50%,
    var(--ui-veil, rgb(0 0 0 / 0.04)) 70%
  );
  background-size: 200% 100%;
  animation: sc-shimmer 1.4s ease-in-out infinite;
}
@keyframes sc-shimmer {
  from { background-position: 130% 0; }
  to { background-position: -30% 0; }
}

.sc-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.sc-fallback-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid var(--ui-danger, #ef4444);
  color: var(--ui-danger, #ef4444);
  font-size: 14px;
  font-weight: 700;
}

/* 悬停才出现的浮件（触屏无 hover：它们同时是常显可达的按钮，键盘也能 Tab 到） */
.sc-pill,
.sc-iconbtn {
  position: absolute;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.sc-card:hover .sc-pill,
.sc-card:hover .sc-iconbtn,
.sc-pill:focus-visible,
.sc-iconbtn:focus-visible {
  opacity: 1;
}
/* 键盘用户：Tab 到卡片内的按钮时也显形（焦点在按钮上即 hover 态） */
.sc-media:focus-within .sc-pill,
.sc-media:focus-within .sc-iconbtn { opacity: 1; }

.sc-pill--model {
  top: 8px;
  left: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-tip-ink, #fff);
  background: var(--ui-scrim, rgb(15 23 42 / 0.5));
  backdrop-filter: blur(6px);
  max-width: calc(100% - 80px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-iconbtn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: var(--ui-scrim, rgb(15 23 42 / 0.5));
  color: var(--ui-tip-ink, #fff);
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.sc-iconbtn:hover { background: var(--ui-scrim, rgb(15 23 42 / 0.72)); }
.sc-iconbtn:focus-visible {
  outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: 1px;
}
.sc-star { top: 8px; right: 8px; }
.sc-star.is-on { color: var(--ui-warn, #e3a25f); }
.sc-expand { right: 8px; bottom: 8px; }
/* 加入画布：与放大按钮同排（放大在右、加入在它左侧） */
/* 常显（不跟着悬停淡出）：这是两个库唯一的"落到画布"入口，触屏也要点得到 */
.sc-add { right: 42px; bottom: 8px; opacity: 1; }
.sc-add.is-busy { opacity: 0.5; cursor: progress; }

/* 多图数量角标：**左下角**（曾经在左上角，与悬停显示的标签重叠 —— 用户实测报的） */
.sc-count {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 2;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-tip-ink, #fff);
  background: var(--ui-scrim, rgb(15 23 42 / 0.5));
  backdrop-filter: blur(6px);
}

.sc-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 10px;
}
.sc-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.sc-row--head { justify-content: space-between; }
.sc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-ink, #18202b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-accent-hover, #0e7490);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}
/* 类型标识"视频"：用中性灰底，避免和"商用"（青色）抢眼 */
.sc-badge--video {
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
}
.sc-row--meta { justify-content: space-between; }
.sc-author {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
}
.sc-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ui-chip, rgb(0 0 0 / 0.07));
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-ink-dim, #6b7280);
}
.sc-author-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-run {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
}

@media (prefers-reduced-motion: reduce) {
  .sc-card, .sc-img, .sc-video, .sc-pill, .sc-iconbtn, .sc-skeleton { transition: none !important; animation: none !important; }
}
</style>
