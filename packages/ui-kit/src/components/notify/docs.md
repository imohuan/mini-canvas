# Notify 通知

右上角可关闭的消息卡片。底层用 [`vue-sonner`](https://vue-sonner.vercel.app/) 管队列、堆叠、
悬停暂停和滑动关闭；卡片外观由 ui-kit 自己画，颜色跟着 Provider 的语义色走。

`vue-sonner` 是 peer 依赖：安装 ui-kit 时项目里也要有它，<NotifyHost /> 才会显示。

整个应用只需要挂一次 `<NotifyHost />`；真实页面把它放在根组件里：

```vue
<!-- 文件：src/App.vue -->
<template>
  <RouterView />
  <NotifyHost />
</template>
```

关闭用 `dismiss(id)`（单条）或 `clearNotify()`（全部）。

## 三种语气

`tone` 用语义色，不用自定义颜色；成功、进行中、失败各一条。每张卡左侧有一条颜色条，
图标和操作按钮跟它同色。

@@VUE@@
<script setup lang="ts">
import { notify, Button } from '@mini-canvas/ui-kit'
let index = 0
</script>

<template>
  <div class="wall">
    <Button variant="secondary" @click="notify({ title: '已保存', description: '画布刚刚保存到云端。', tone: 'success' })">成功</Button>
    <Button variant="secondary" @click="notify({ title: '上传中', description: '第 ' + (++index) + ' 个文件上传中。', tone: 'primary' })">进行中</Button>
    <Button variant="secondary" @click="notify({ title: '同步失败', description: '网络不稳定，稍后自动重试。', tone: 'danger' })">失败</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 不自动关闭 + 操作按钮

`duration=0` 需要手动关；`action` 给用户一个即时的补救入口。底部细线是剩余时间，
悬停会暂停，移开后继续走。

@@VUE@@
<script setup lang="ts">
import { notify, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button
      variant="secondary"
      @click="notify({
        title: '已移入回收站',
        description: '30 天内可以恢复。',
        duration: 0,
        action: { label: '撤销', onClick: () => notify({ title: '已恢复', tone: 'success' }) },
      })"
    >可撤销</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 连续堆叠

多条通知会在右上角向上叠，最新的在最上面。

@@VUE@@
<script setup lang="ts">
import { notify, Button } from '@mini-canvas/ui-kit'
let n = 0
function burst(): void {
  for (let i = 0; i < 3; i += 1) {
    n += 1
    notify({ title: '第 ' + n + ' 条', description: '连续点击看看堆叠。', tone: 'info' })
  }
}
</script>

<template>
  <div class="wall">
    <Button variant="secondary" @click="burst">连发三条</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

