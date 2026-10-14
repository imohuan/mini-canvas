<script setup lang="ts">
/**
 * style-library-demo —— 风格库卡片（styleLibraryCard）的活演示。
 *
 * 这里渲染的是**真组件**：插件的 StyleCardView.vue（登记进 ui 目录的默认卡）。
 * 它是纯展示件（只吃 item / starred / showCommercial 三个 props），所以能在文档页独立跑。
 *
 * 演示用的封面是一张内联 SVG 的 data URL（不联网、不依赖仓库里的素材目录），
 * 只为让"卡片长什么样"看得见；真实素材由后台半按目录扫出来（见 server.md）。
 */
import StyleCardView from '../../../../plugins/plugin-style-library/src/components/StyleCardView.vue'

/** 一张 3:4 的占位封面（内联 SVG，data URL —— 文档页不联网也能看） */
function cover(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 70% 62%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 60% 38%)"/>
    </linearGradient>
  </defs>
  <rect width="300" height="400" fill="url(#g)"/>
  <circle cx="220" cy="90" r="52" fill="rgba(255,255,255,.35)"/>
  <rect x="0" y="300" width="300" height="100" fill="rgba(0,0,0,.18)"/>
</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const cards = [
  {
    id: 1,
    name: '电影感人像',
    author: '阿槑',
    category: '摄影写真',
    tags: ['Seedream 5.0', '人像'],
    commercial: true,
    exclusive: false,
    runCount: 123456,
    likeCount: 8900,
    imageCount: 4,
    cover: cover(200),
    images: [cover(200)],
    videos: [] as string[],
  },
  {
    id: 2,
    name: '粒子消散转场',
    author: '豆子',
    category: '创意玩法',
    tags: ['特效'],
    commercial: false,
    exclusive: true,
    runCount: 20480,
    likeCount: 1200,
    imageCount: 1,
    cover: cover(280),
    images: [cover(280)],
    videos: ['/not-real-preview.mp4'],
  },
  {
    id: 3,
    name: '极简商业海报',
    author: '山丘',
    category: '平面设计',
    tags: ['海报'],
    commercial: true,
    exclusive: false,
    runCount: 7300,
    likeCount: 300,
    imageCount: 1,
    cover: cover(20),
    images: [cover(20)],
    videos: [] as string[],
  },
]

/** 视频地址是假的（演示里故意给一个取不到的地址），卡片会自行退回到封面图 */
const starredId = 1
</script>

<template>
  <div style="padding: 16px; border-radius: 12px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft)">
    <div style="display: flex; gap: 14px; flex-wrap: wrap">
      <div v-for="c in cards" :key="c.id" style="width: 210px">
        <StyleCardView :item="c" :starred="c.id === starredId" @open="() => {}" @toggle-star="() => {}" />
      </div>
    </div>
    <p style="margin: 12px 0 0; font-size: 12px; color: var(--vp-c-text-2)">
      三张都是真的 <code>StyleCardView</code>：左 = 普通图 + 收藏态；中 = 带预览视频（地址故意取不到，
      卡片自动退回封面图，这是它"不乱裂图"的行为）；右 = 可商用徽章。悬停还能看到左上角模型标签与
      左下角的"4 张"角标。
    </p>
  </div>
</template>
