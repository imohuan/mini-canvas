# UiKitProvider 全局参数

## 完整案例

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { UiKitProvider, Button, Input, Switch, Select } from '@mini-canvas/ui-kit'

const dark = ref(false)
const size = ref<'sm'|'md'|'lg'>('md')
const accent = ref('#16a34a')
</script>

<template>
  <div class="provider-demo">
    <div class="provider-demo__controls">
      <Switch v-model="dark" label="深色" description="主题立即生效" />
      <Select v-model="size" :options="[{ value:'sm',label:'小' },{ value:'md',label:'中' },{ value:'lg',label:'大' }]" aria-label="尺寸" />
      <label class="provider-demo__color"><input v-model="accent" type="color" aria-label="主题色" /></label>
    </div>
    <UiKitProvider :dark="dark" :size="size" :accent="accent" class="provider-demo__surface">
      <Button variant="primary">主操作</Button>
      <Input placeholder="示例输入" clearable />
      <Button variant="ghost">轻量操作</Button>
    </UiKitProvider>
  </div>
</template>
<style scoped>
.provider-demo { display: flex; flex-direction: column; gap: 14px; width: 100%; }
.provider-demo__controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.provider-demo__color { display: inline-flex; align-items: center; gap: 6px; color: var(--mck-ink-muted); font-size: 12px; }
.provider-demo__surface { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px; border-radius: 12px; background: var(--mck-panel); }
</style>
@@ENDVUE@@

Provider 只包一层：内部所有组件都会用同一份尺寸、密度、圆角、主题色。上面改任何一项都立刻反映到按钮和输入框。

## Props

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

