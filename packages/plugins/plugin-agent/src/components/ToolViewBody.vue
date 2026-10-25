<!--
  ToolViewBody —— 工具展开区的渲染层（数据在 toolViews.ts，纯函数已单测）。

  用户口径（2026-10-07）：
  1. 画布 MCP 工具 = 自定义卡片 UI（卡片头 + 统计瓦片 / 胶囊 / 行 / 缩略图 / 进度条）；
  2. 卡片直接展示；卡内提供「详情」折叠：展开 = 执行工具名 + 输入 + 输出；
  3. 不认识的工具 = 直接「输入 / 输出」两块（没有多余的原始 JSON 折叠）。

  用户口径（2026-10-08）：卡片缩略图**点开看大图** —— 组件自己不画预览层，
  只 emit 出「点了哪张」（src），由宿主交给主题注册的 MediaViewer
  （与「生成历史」弹窗同一只，不新增第二只）。

  用户口径（2026-10-08 定稿，卡片紧凑化 —— 用户在 demo 里选定「B 卡片 + C 资源列表」）：
  1. 卡片 = **紧凑两行**：头行（图标 + 人话标题 + 标记）+ 一行内容
     （缩略图条 / 媒体行 / 胶囊 / 进度条 / 提示）。不再有 88px 网格与大数字瓦片。
  2. 缩略图条**最多 3 张** + 「+N」，右侧接一句类型统计。
  3. 「详情」在**卡片下方**折叠（不是头部小图标）：点开显示 工具名称 / 输入 / 输出，
     三块都在、不省略；输入为空也写「（无输入）」。悬停**不加任何底色**，只有箭头变亮。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronRight, LayoutGrid, CircleDot, Image as ImageIcon, ImageOff, Video, Music, Type, Folder, Briefcase, Wand2, FileText,
} from 'lucide-vue-next'
import type { CardBlock, CardIcon, ToolView } from '../toolViews.js'

const props = defineProps<{ view: ToolView; args: string; output?: string; name?: string }>()

/**
 * 点画面 → 把「哪个地址 + 什么媒体」报给宿主（宿主用 MediaViewer 弹大图 / 播放）。
 *
 * 为什么要带 kind（用户口径 2026-10-13）：read_file 现在也读视频 / 音频 ——
 * 宿主那只 MediaViewer 靠 kind 决定挂图片舞台还是插件登记的播放器。
 * 只给一个地址的话，视频会被当图片打开。省略时按 image 处理（老调用点行为不变）。
 */
const emit = defineEmits<{ preview: [src: string, kind?: 'image' | 'video' | 'audio'] }>()

/** 卡内「详情」折叠：展开 = 执行工具名 + 输入 + 输出 */
const showDetails = ref(false)

/**
 * 已加载失败的图（src → true）——失败后不再渲染 <img>，改用一块占位（用户口径 2026-10-08）。
 * 为什么要有它：数据层现在尽量给对的地址，但字节仍可能取不到（资源被删 / 服务端没这条资源），
 * 浏览器默认只给一个裂图小图标，用户看到的是「坏了但不知道为什么」。占位把原因写清楚。
 */
const failed = ref<Record<string, true>>({})
function markFailed(src: string): void {
  failed.value[src] = true
}

/** 块渲染分组：卡片族按顺序渲染 blocks；fallback 出输入/输出两块 */
const isFallback = computed(() => props.view.family === 'fallback')
const blocks = computed<CardBlock[]>(() => props.view.blocks)

/** 图标语义 → 组件 */
const ICONS: Record<CardIcon, unknown> = {
  canvas: LayoutGrid,
  node: CircleDot,
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: Type,
  group: Folder,
  job: Briefcase,
  action: Wand2,
  file: FileText,
}
function iconOf(name: CardIcon | undefined): unknown {
  return name ? ICONS[name] : CircleDot
}

/** 缩略图条最多画几张（用户口径 2026-10-08：列表别占地方）—— 多出来的走「+N」 */
const STRIP_MAX = 3

/** 清单最多画几行（同上）—— 多出来的走「还有 N 条…」 */
function visibleRows<T>(items: T[]): T[] {
  return items.slice(0, STRIP_MAX)
}
</script>

<template>
  <!-- fallback（不认识的工具）：直接输入 / 输出两块 -->
  <div v-if="isFallback" class="tvb">
    <div class="tvb-io">
      <span class="tvb-io-label">输入</span>
      <pre class="tvb-pre">{{ args || '（无输入）' }}</pre>
    </div>
    <div class="tvb-io">
      <span class="tvb-io-label">输出</span>
      <pre class="tvb-pre">{{ view.raw || output || '（无输出）' }}</pre>
    </div>
  </div>

  <!-- 自定义卡片（紧凑两行）：头行（图标 + 标题 + 标记）+ 内容块；
       底部「详情」折叠出 工具名称 + 输入 + 输出 -->
  <div v-else class="tvc">
    <div v-if="view.heading" class="tvc-head">
      <span class="tvc-head-icon"><component :is="iconOf(view.icon)" :size="13" /></span>
      <span class="tvc-title">{{ view.heading }}</span>
      <span v-if="view.badge" class="tvc-badge">{{ view.badge }}</span>
    </div>

    <!-- 内容区：一行内容为主（用户口径 2026-10-08：卡片别太高）；
         超过 200px 时才滚动（改版后基本到不了） -->
    <div class="tvc-body">
    <template v-for="(b, bi) in blocks" :key="bi">
      <!-- 胶囊组 -->
      <div v-if="b.kind === 'chips'" class="tvc-chips-wrap">
        <span v-if="b.label" class="tvc-chips-label">{{ b.label }}</span>
        <div class="tvc-chips">
          <span v-for="(c, ci) in b.items" :key="ci" class="tvc-chip">
            <b v-if="c.count" class="tvc-chip-count">{{ c.count }}</b>{{ c.text }}
          </span>
        </div>
      </div>

      <!-- 单条媒体行：40px 画面 + 标题 + 副标题（节点详情 / 文件预览）。
           画面两种：图片给缩略图；视频 / 音频给播放位（地址塞进 <img> 必然裂图）。
           两者都点开全屏预览 —— 由宿主交给主题注册的 MediaViewer（视频 / 音频在那边真播） -->
      <div v-else-if="b.kind === 'media'" class="tvc-media">
        <img v-if="b.thumb && !failed[b.thumb]" class="tvc-media-thumb" :src="b.thumb"
          :alt="b.title || '缩略图'" loading="lazy" role="button" tabindex="0"
          :aria-label="'查看图片 ' + (b.title || '')"
          @click="emit('preview', b.thumb!, 'image')"
          @keydown.enter.prevent="emit('preview', b.thumb!, 'image')"
          @keydown.space.prevent="emit('preview', b.thumb!, 'image')"
          @error="markFailed(b.thumb!)" />
        <span v-else-if="b.thumb" class="tvc-media-broken" role="img" :aria-label="'图片加载失败：' + (b.title || '')" title="图片加载失败">
          <ImageOff :size="16" />
        </span>
        <!-- 视频 / 音频：没有静态画面，给一个带播放角的媒体位，点开全屏播放
             （全屏那只 MediaViewer 里有节点插件登记的真播放器） -->
        <button v-else-if="b.src" class="tvc-media-play" type="button"
          :aria-label="'播放 ' + (b.title || '')" :title="'播放 ' + (b.title || '')"
          @click="emit('preview', b.src!, b.mediaKind === 'audio' ? 'audio' : 'video')">
          <component :is="b.mediaKind === 'audio' ? Music : Video" :size="15" />
          <span class="tvc-media-play-badge" aria-hidden="true">▶</span>
        </button>
        <span class="tvc-media-text">
          <span v-if="b.title" class="tvc-media-title">{{ b.title }}</span>
          <span v-if="b.sub" class="tvc-media-sub">{{ b.sub }}</span>
        </span>
      </div>

      <!-- 带图标 / 副标题的行（清单：最多 3 条 + 「还有 N 条…」） -->
      <div v-else-if="b.kind === 'rows'" class="tvc-rows">
        <div v-for="(r, ri) in visibleRows(b.items)" :key="ri" class="tvc-row">
          <span class="tvc-row-icon"><component :is="iconOf(r.icon)" :size="13" /></span>
          <span class="tvc-row-text">
            <span class="tvc-row-title">{{ r.title }}</span>
            <span v-if="r.sub" class="tvc-row-sub">{{ r.sub }}</span>
          </span>
          <span v-if="r.tag" class="tvc-row-tag">{{ r.tag }}</span>
        </div>
        <p v-if="b.items.length > STRIP_MAX" class="tvc-more">还有 {{ b.items.length - STRIP_MAX }} 条…</p>
      </div>

      <!-- 缩略图条（最多 3 张 + 「+N」；右侧可跟一句类型统计） -->
      <div v-else-if="b.kind === 'images'" class="tvc-imgs">
        <figure v-for="(im, ii) in b.items.slice(0, STRIP_MAX)" :key="ii" class="tvc-img">
          <!-- 点开看大图（用户口径 2026-10-08）：键盘可达 —— Enter / Space 同点 -->
          <img v-if="!failed[im.src]" :src="im.src" :alt="im.label || '缩略图'" loading="lazy"
            role="button" tabindex="0" :aria-label="'查看图片 ' + (im.label || ii + 1)"
            @click="emit('preview', im.src)"
            @keydown.enter.prevent="emit('preview', im.src)"
            @keydown.space.prevent="emit('preview', im.src)"
            @error="markFailed(im.src)" />
          <!-- 取不到字节时的占位（别再给一张必然裂开的 <img>） -->
          <span v-else class="tvc-img-broken" role="img" :aria-label="'图片加载失败：' + (im.label || '')" title="图片加载失败">
            <ImageOff :size="16" />
          </span>
        </figure>
        <span v-if="b.items.length > STRIP_MAX" class="tvc-img-more">+{{ b.items.length - STRIP_MAX }}</span>
        <span v-if="b.summary" class="tvc-img-sum">{{ b.summary }}</span>
      </div>

      <!-- 进度条 -->
      <div v-else-if="b.kind === 'progress'" class="tvc-progress-wrap">
        <div class="tvc-progress"><div class="tvc-progress-fill" :style="{ width: Math.max(0, Math.min(100, b.value)) + '%' }"></div></div>
        <span class="tvc-progress-text">{{ b.text || b.value + '%' }}</span>
      </div>

      <!-- 提示行 -->
      <p v-else-if="b.kind === 'note'" class="tvc-note" :class="'is-' + b.tone">{{ b.text }}</p>
    </template>
    </div>

    <!-- 卡内「详情」折叠（用户口径 2026-10-08 定稿）：卡片下方一块；
         展开 = 工具名称 / 输入 / 输出，三块都在、内容不省略 -->
    <button class="tvc-details-toggle" :aria-expanded="showDetails" @click="showDetails = !showDetails">
      <ChevronRight :size="12" class="tvc-details-caret" :class="{ 'is-open': showDetails }" />
      详情
    </button>
    <div v-if="showDetails" class="tvc-details">
      <div class="tvc-details-row">
        <span class="tvc-details-label">工具名称</span>
        <code class="tvc-details-tool">{{ name || view.heading }}</code>
      </div>
      <div class="tvc-details-block">
        <span class="tvc-details-label">输入</span>
        <pre class="tvc-pre">{{ args || '（无输入）' }}</pre>
      </div>
      <div class="tvc-details-block">
        <span class="tvc-details-label">输出</span>
        <pre class="tvc-pre">{{ output || '（无输出）' }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* —— fallback（输入 / 输出）：直接给内容 —— */
.tvb { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tvb-io { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tvb-io-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--ui-ink-dim, #919191); }
.tvc-pre, .tvb-pre { margin: 0; max-width: 100%; max-height: 320px; overflow: auto; padding: 8px; border-radius: 8px; background: var(--ui-code-bg, rgb(0 0 0 / 0.25)); font-size: 12px; line-height: 18px; white-space: pre-wrap; word-break: break-all; color: var(--ui-ink-dim, #919191); font-family: ui-monospace, Menlo, Consolas, monospace; }

/* —— 自定义卡片（紧凑两行，用户口径 2026-10-08 定稿）—— */
.tvc { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
 .tvc-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-height: 200px; overflow: auto; }
.tvc-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* 头行左侧的小图标（语义色走次要文字色，不抢标题） */
.tvc-head-icon { display: grid; place-items: center; flex: none; color: var(--ui-ink-dim, #919191); }
.tvc-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--ui-ink, #f7f7f7); }
/* 徽章 = 单行胶囊（用户口径 2026-10-22）：名字可能是一整句，必须限宽 + 省略号，
   否则它会把标题挤成两行、自己越出卡片右缘（截图里那团紫色）。
   flex-shrink 保留：极端窄卡片里先缩徽章，标题至少还能看到开头。 */
.tvc-badge { flex: 0 1 auto; min-width: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 7px; border-radius: 999px; background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); color: var(--ui-accent-hover, #0e7490); font-size: 11px; line-height: 16px; }
/* 徽章靠右（与 demo 一致）：标题在前、标记贴右缘 */
.tvc-badge { margin-left: auto; }

/* 胶囊组 —— 计数画在文字前（「4 新增」） */
.tvc-chips-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.tvc-chips-label { flex: none; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--ui-ink-dim, #919191); margin-right: 2px; }
.tvc-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.tvc-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 8px; border-radius: 999px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); font-size: 11px; line-height: 17px; color: var(--ui-ink, #f7f7f7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tvc-chip-count { flex: none; color: var(--ui-ink, #f7f7f7); font-weight: 700; font-variant-numeric: tabular-nums; }

/* 单条媒体行（节点详情 / 文件预览）：40px 缩略图 + 标题/副标题 */
.tvc-media { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tvc-media-thumb { display: block; flex: none; width: 40px; height: 40px; object-fit: cover; border-radius: 8px; border: 1px solid var(--ui-line, #363636); background: var(--ui-veil, rgb(255 255 255 / 0.04)); cursor: zoom-in; }
.tvc-media-thumb:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 1px; }
.tvc-media-broken { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 8px; border: 1px dashed var(--ui-line, #363636); background: var(--ui-veil, rgb(255 255 255 / 0.04)); color: var(--ui-ink-dim, #919191); }
/* 视频 / 音频的播放位：与图片缩略图同尺寸（40px），一眼看出「这里点一下会播」 */
.tvc-media-play { position: relative; display: grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border-radius: 8px; border: 1px solid var(--ui-line, #363636); background: var(--ui-veil, rgb(255 255 255 / 0.06)); color: var(--ui-ink-dim, #919191); cursor: pointer; }
.tvc-media-play:hover { color: var(--ui-ink, #f7f7f7); border-color: var(--ui-ink-dim, #919191); }
.tvc-media-play:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 1px; }
.tvc-media-play-badge { position: absolute; right: 2px; bottom: 1px; font-size: 8px; line-height: 1; color: var(--ui-ink, #f7f7f7); }
.tvc-media-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.tvc-media-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--ui-ink, #f7f7f7); }
.tvc-media-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #919191); }

/* 行（清单：最多 3 条 + 「还有 N 条…」） */
.tvc-rows { display: flex; flex-direction: column; gap: 2px; }
.tvc-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 4px; border-radius: 8px; }
.tvc-row-icon { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 6px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); color: var(--ui-ink-dim, #919191); }
.tvc-row-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.tvc-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--ui-ink, #f7f7f7); }
.tvc-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #919191); font-family: ui-monospace, Menlo, Consolas, monospace; }
.tvc-row-tag { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 7px; border-radius: 999px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); font-size: 11px; line-height: 16px; color: var(--ui-ink-dim, #919191); }
.tvc-more { margin: 0; padding: 0 4px; font-size: 11px; color: var(--ui-ink-dim, #919191); }

/* 缩略图条（最多 3 张 40px + 「+N」+ 类型统计） */
.tvc-imgs { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.tvc-img { margin: 0; }
/* 缩略图点开看大图：可点光标 + 键盘 focus 环（ui-style-guide §5：交互要给出可见的焦点环） */
.tvc-img img { display: block; width: 40px; height: 40px; object-fit: cover; border-radius: 8px; border: 1px solid var(--ui-line, #363636); background: var(--ui-veil, rgb(255 255 255 / 0.04)); cursor: zoom-in; }
.tvc-img img:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 1px; }
/* 加载失败的占位：与缩略图同尺寸（40px），虚线框 —— 一眼能认出是「这张没取到」 */
.tvc-img-broken { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; border: 1px dashed var(--ui-line, #363636); background: var(--ui-veil, rgb(255 255 255 / 0.04)); color: var(--ui-ink-dim, #919191); }
/* 「+N」：与缩略图同尺寸的虚线格 */
.tvc-img-more { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; border: 1px dashed var(--ui-line, #363636); font-size: 11px; color: var(--ui-ink-dim, #919191); }
.tvc-img-sum { min-width: 0; margin-left: 2px; font-size: 11px; color: var(--ui-ink-dim, #919191); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 进度条 */
.tvc-progress-wrap { display: flex; align-items: center; gap: 8px; }
.tvc-progress { flex: 1; height: 6px; border-radius: 999px; background: var(--ui-veil, rgb(255 255 255 / 0.08)); overflow: hidden; }
.tvc-progress-fill { height: 100%; border-radius: 999px; background: var(--ui-accent, #0891b2); transition: width 0.24s ease; }
/* 进度文字来自任务的 message，可能是一整句：限宽单行省略，不能把进度条挤成 0 */
.tvc-progress-text { flex: 0 1 auto; min-width: 0; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #919191); font-variant-numeric: tabular-nums; }

/* 提示行 */
.tvc-note { margin: 0; font-size: 12px; line-height: 20px; white-space: pre-wrap; word-break: break-word; }
.tvc-note.is-ok { color: var(--ui-accent-hover, #0e7490); }
.tvc-note.is-error { color: var(--ui-danger, #ef4444); }
.tvc-note.is-info { color: var(--ui-ink-dim, #919191); }

/* 卡内「详情」折叠 */
.tvc-details-toggle { display: inline-flex; align-items: center; gap: 3px; align-self: flex-start; padding: 0; border: 0; background: transparent; color: var(--ui-ink-dim, #919191); font-size: 11px; cursor: pointer; }
.tvc-details-toggle:hover { color: var(--ui-ink, #f7f7f7); }
.tvc-details-caret { flex: none; transition: transform 0.18s ease; }
.tvc-details-caret.is-open { transform: rotate(90deg); }
/* 详情展开后的整体高度上限（用户口径 2026-10-25）：工具名 + 输入 + 输出三块
   合计限高，超出在块内滚动。变量由 AgentConversation 的 .ac-root 提供；
   独立使用本组件时退回同一数值。 */
.tvc-details { display: flex; flex-direction: column; gap: 8px; max-height: var(--ac-expand-max-height, min(360px, 50vh)); overflow-y: auto; }
/* 外层详情已经限高并在滚动：里面的两段 pre 只跟随外层滚动。
   不能把 max-height 直接设 none —— 外层一旦被放到普通块（不是 flex 容器）里，
   内容仍会撑开它；这里只放开内层滚动，外层仍有 360px 上下的硬上限。 */
.tvc-details .tvc-pre { max-height: max(240px, calc(var(--ac-expand-max-height, min(360px, 50vh)) - 60px)); }
.tvc-details-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tvc-details-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tvc-details-label { flex: none; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--ui-ink-dim, #919191); }
.tvc-details-tool { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 6px; background: var(--ui-veil, rgb(255 255 255 / 0.06)); font-size: 11px; color: var(--ui-ink, #f7f7f7); font-family: ui-monospace, Menlo, Consolas, monospace; }
@media (prefers-reduced-motion: reduce) {
  .tvc-progress-fill { transition: none; }
  .tvc-details-caret { transition: none; }
}
</style>
