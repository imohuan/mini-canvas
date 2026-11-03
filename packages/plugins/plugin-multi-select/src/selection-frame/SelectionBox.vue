<script setup lang="ts">
defineProps<{
  outerStyle: Record<string, string> | null
  innerStyle: Record<string, string> | null
  showInner: boolean
}>()
</script>

<template>
  <div class="selection-frame-outer" :style="outerStyle" role="presentation" />
  <div v-if="showInner" class="selection-frame-inner" :style="innerStyle" />
</template>

<style scoped>
.selection-frame-outer {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
  overflow: visible;
  transition: background 180ms ease, border-color 180ms ease;
}
.selection-frame-inner {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}
</style>
