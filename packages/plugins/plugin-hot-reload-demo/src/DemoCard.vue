<script setup lang="ts">
/**
 * DemoCard —— 试验台的"靶子"：一块足够显眼的卡片。
 *
 * 热重载验证方法（给用户的一句话）：改下面 TEMPLATE_VERSION 或文字 → pnpm build:watch（或手动 build）
 * → 几秒内这块卡片应自己变样，右上角还会弹一条「热重载完成」的通知。
 */
// 版本号：改这里 = 最省事的"显眼变化"（卡片上的大字直接变）
const VERSION = 'v4'
const TITLE = '热重载 v4 + 通知'
const HINT = '卡片变了 + 右下角弹了通知 = 全链路完成'
</script>

<template>
  <div class="hrdemo" data-testid="hot-reload-demo-card">
    <div class="hrdemo-badge">{{ VERSION }}</div>
    <div class="hrdemo-main">
      <strong class="hrdemo-title">{{ TITLE }}</strong>
      <span class="hrdemo-hint">{{ HINT }}</span>
    </div>
  </div>
</template>

<style scoped>
.hrdemo {
  pointer-events: auto;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 14px;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-primary-ink, #fff);
  box-shadow: var(--ui-shadow-lg, 0 6px 18px rgb(0 0 0 / 0.25));
}
.hrdemo-badge { flex: none; display: grid; place-items: center; min-width: 40px; height: 40px; padding: 0 8px; border-radius: 10px; background: var(--ui-primary-ink-soft, rgb(255 255 255 / 0.22)); font-size: 14px; font-weight: 800; }
.hrdemo-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hrdemo-title { font-size: 14px; font-weight: 800; letter-spacing: 0.02em; }
.hrdemo-hint { font-size: 11px; opacity: 0.9; }
</style>
