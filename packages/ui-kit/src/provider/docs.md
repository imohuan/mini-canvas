# UiKitProvider 全局参数

顶部预览可以调尺寸、密度、圆角、主题色；下面把每个维度单独隔离出来，方便对比。

## 尺寸

同一个 Provider 下，内部组件默认都用这一档；单个组件仍可自己覆盖。

@@VUE@@
<script setup lang="ts">
import { UiKitProvider, Button, Input } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="stack">
    <UiKitProvider size="sm" class="surface">
      <span class="tag">size="sm"</span>
      <Button variant="primary">主要</Button>
      <Input placeholder="输入框" aria-label="小尺寸输入" />
      <Button variant="ghost">轻量</Button>
    </UiKitProvider>
    <UiKitProvider size="lg" class="surface">
      <span class="tag">size="lg"</span>
      <Button variant="primary">主要</Button>
      <Input placeholder="输入框" aria-label="大尺寸输入" />
      <Button variant="ghost">轻量</Button>
    </UiKitProvider>
  </div>
</template>
<style scoped>
.stack { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.surface { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border-radius: 12px; background: var(--mck-panel); }
.tag { color: var(--mck-ink-muted); font-size: 11px; }
</style>
@@ENDVUE@@

## 密度

只改间距和留白，不改控件高度。

@@VUE@@
<script setup lang="ts">
import { UiKitProvider, Button, Switch } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="stack">
    <UiKitProvider density="compact" class="surface">
      <span class="tag">compact</span>
      <Button variant="secondary">紧凑</Button>
      <Switch :model-value="true" label="开关" />
    </UiKitProvider>
    <UiKitProvider density="spacious" class="surface">
      <span class="tag">spacious</span>
      <Button variant="secondary">宽松</Button>
      <Switch :model-value="true" label="开关" />
    </UiKitProvider>
  </div>
</template>
<style scoped>
.stack { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.surface { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border-radius: 12px; background: var(--mck-panel); }
.tag { color: var(--mck-ink-muted); font-size: 11px; }
</style>
@@ENDVUE@@

## 圆角与主题色

`radius` 作用到所有控件；`accent` 只换品牌色，语义色不动。

@@VUE@@
<script setup lang="ts">
import { UiKitProvider, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="stack">
    <UiKitProvider :radius="0" accent="#0891b2" class="surface">
      <span class="tag">radius=0</span>
      <Button variant="primary">方角</Button>
    </UiKitProvider>
    <UiKitProvider :radius="999" accent="#16a34a" class="surface">
      <span class="tag">radius=999 · 绿色</span>
      <Button variant="primary">胶囊</Button>
    </UiKitProvider>
  </div>
</template>
<style scoped>
.stack { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.surface { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border-radius: 12px; background: var(--mck-panel); }
.tag { color: var(--mck-ink-muted); font-size: 11px; }
</style>
@@ENDVUE@@

## 深色

`dark` 切一整套明暗，不是给每个组件单独改色。

@@VUE@@
<script setup lang="ts">
import { UiKitProvider, Button, Input } from '@mini-canvas/ui-kit'
</script>

<template>
  <UiKitProvider dark class="surface">
    <Button variant="primary">主操作</Button>
    <Input placeholder="深色输入" aria-label="深色输入" />
    <Button variant="ghost">轻量</Button>
  </UiKitProvider>
</template>
<style scoped>
.surface { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border-radius: 12px; }
</style>
@@ENDVUE@@

## 自定义尺寸

`sizes` 可以只覆盖某一档的高度、字号、内边距和图标，其余继承默认。

@@VUE@@
<script setup lang="ts">
import { UiKitProvider, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="stack">
    <UiKitProvider :sizes="{ md: { height: 44, fontSize: 15, paddingX: 22 } }" class="surface">
      <span class="tag">md 高度 44 / 字号 15</span>
      <Button variant="primary">更大的中号</Button>
    </UiKitProvider>
  </div>
</template>
<style scoped>
.stack { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.surface { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; border-radius: 12px; background: var(--mck-panel); }
.tag { color: var(--mck-ink-muted); font-size: 11px; }
</style>
@@ENDVUE@@

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| size | 'md' | 内部组件默认尺寸 |
| density | 'comfortable' | 间距密度：compact / comfortable / spacious |
| radius | 8 | 控件圆角，px |
| dark | false | 深色主题 |
| accent / accentHover | 内置青色 | 主题色和悬停色 |
| danger / success / warning / info | 内置语义色 | 通知、提示等使用 |
| sizes | 无 | 覆盖某档尺寸的高度、字号、内边距、图标尺寸 |
| zIndexBase | 90000 | 浮层层级基准 |





