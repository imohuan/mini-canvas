# Messages 轻提示

顶部居中的一条短反馈：没有标题、没有按钮，只说明「刚刚发生了什么」。
重要的事请用 `Notify`，这里有说明和操作按钮。

真实页面只挂一次 `<MessagesHost />`，放在根组件里：

```vue
<!-- 文件：src/App.vue -->
<template>
  <RouterView />
  <MessagesHost />
</template>
```

## 基础

顶部居中一条，几秒后自己消失，不打断操作。深色半透明底在亮色和深色主题下都看得清。

@@VUE@@
<script setup lang="ts">
import { message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button variant="secondary" @click="message('已复制到剪贴板')">普通</Button>
    <Button variant="secondary" @click="message({ text: '保存成功', tone: 'success' })">成功</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 语义语气

左侧色条和图标一起表达语气：绿色成功、蓝色信息、琥珀警告、红色失败。

@@VUE@@
<script setup lang="ts">
import { message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button variant="ghost" @click="message({ text: '已加入队列', tone: 'info' })">信息</Button>
    <Button variant="ghost" @click="message({ text: '缓存快满了', tone: 'warning' })">警告</Button>
    <Button variant="ghost" @click="message({ text: '导出失败', tone: 'danger' })">错误</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 长文本与常驻

`duration=0` 不自动消失；长文本会在卡片里换行，不撑破顶部。

@@VUE@@
<script setup lang="ts">
import { message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <Button variant="secondary" @click="message({ text: '内容包含较长的中文与 English mixed text，看看换行表现。', tone: 'info' })">长文本</Button>
    <Button variant="secondary" @click="message({ text: '这条不会自己消失', duration: 0 })">常驻</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

