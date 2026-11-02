<script setup lang="ts">
import type { TagMenuEntry } from '../tagMenu'

defineProps<{
  open: boolean
  entry: TagMenuEntry | null
  visible: boolean
  pos: { left: number; top: number; above: boolean }
  box: { width: number; height: number }
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && entry && visible"
      class="nb-tagpreview"
      :style="{
        left: pos.left + 'px',
        top: pos.top + 'px',
        width: box.width + 'px',
        height: box.height + 'px',
      }"
    >
      <video
        v-if="entry.kind === 'video' && entry.url"
        class="nb-tagpreview-media"
        data-media="video"
        :src="entry.url"
        autoplay
        muted
        loop
        playsinline
      />
      <img
        v-else-if="entry.url"
        class="nb-tagpreview-media"
        :src="entry.url"
        alt=""
      />
      <span v-else class="nb-tagpreview-empty">（无预览）</span>
    </div>
  </Teleport>
</template>
