<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { RefTile } from '../refTiles'
import { ICON_EXPAND } from './icons'

defineProps<{
  livePreviewTile: RefTile | null
  previewPos: { left: number; top: number; above: boolean }
  previewBox: { width: number; height: number }
  cardImageOf: (tile: { url?: string; kind?: string | null }) => string
}>()

const emit = defineEmits<{
  enter: []
  leave: []
  mediaReady: [tileKey: string, width: number, height: number]
  openFullscreen: [tile: RefTile]
}>()

const Button = useUiComponent('Button')
</script>

<template>
  <Teleport to="body">
    <div
      v-if="livePreviewTile"
      class="nb-hover-preview"
      :class="{ 'is-below': !previewPos.above }"
      :style="{
        left: previewPos.left + 'px',
        top: previewPos.top + 'px',
        width: previewBox.width + 'px',
        height: previewBox.height + 'px',
        transform: previewPos.above ? 'translateY(-100%)' : undefined,
      }"
      @pointerenter="emit('enter')"
      @pointerleave="emit('leave')"
    >
      <video
        v-if="livePreviewTile.kind === 'video' && livePreviewTile.url"
        class="nb-hover-preview-media"
        data-media="video"
        :src="livePreviewTile.url"
        :style="{ height: previewBox.height + 'px' }"
        @loadedmetadata="(ev: Event) => emit('mediaReady', livePreviewTile!.key, (ev.target as HTMLVideoElement).videoWidth, (ev.target as HTMLVideoElement).videoHeight)"
        autoplay
        muted
        loop
        playsinline
      />
      <img
        v-else-if="cardImageOf(livePreviewTile)"
        class="nb-hover-preview-media"
        data-media="image"
        :src="cardImageOf(livePreviewTile)"
        :alt="livePreviewTile.label"
        @load="(ev: Event) => emit('mediaReady', livePreviewTile!.key, (ev.target as HTMLImageElement).naturalWidth, (ev.target as HTMLImageElement).naturalHeight)"
      />
      <span v-else class="nb-hover-preview-empty">（无预览）</span>
      <!--
        全屏按钮（用户 2026-11-07）：secondary + icon-xs + rounded-full。
        底栏只负责摆到右下角；形状/底色/悬停一律交给组件库。
      -->
      <Button variant="secondary" size="icon-xs"
        class="nb-hover-preview-open rounded-full"
        type="button"
        :aria-label="'全屏预览 ' + livePreviewTile.label"
        :title="'全屏预览 ' + livePreviewTile.label"
        @click.stop="emit('openFullscreen', livePreviewTile)"
      >
        <span aria-hidden="true" v-html="ICON_EXPAND" />
      </Button>
    </div>
  </Teleport>
</template>
