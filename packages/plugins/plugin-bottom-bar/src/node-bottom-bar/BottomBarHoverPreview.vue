<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { RefTile } from '../refTiles'

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
        全屏按钮：只用组件库默认外观（用户 2026-11-06：不要自己加任何 UI 样式）。
        位置由 .nb-hover-preview-open 负责，外观交给 Button 的 variant / size。
      -->
      <Button variant="default" size="sm"
        class="nb-hover-preview-open"
        type="button"
        :aria-label="'全屏预览 ' + livePreviewTile.label"
        @click.stop="emit('openFullscreen', livePreviewTile)"
      >全屏</Button>
    </div>
  </Teleport>
</template>
