# ButtonGroup 按钮组

@@VUE@@
<script setup lang="ts">
import { ButtonGroup, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="btngroup-demo">
    <ButtonGroup aria-label="贴合一组">
      <Button variant="secondary">复制</Button>
      <Button variant="ghost">剪切</Button>
      <Button variant="ghost">粘贴</Button>
    </ButtonGroup>
    <ButtonGroup orientation="vertical" aria-label="纵向组">
      <Button>上</Button>
      <Button>下</Button>
    </ButtonGroup>
    <ButtonGroup block aria-label="整行组">
      <Button>取消</Button>
      <Button variant="primary">确认</Button>
    </ButtonGroup>
  </div>
</template>
<style scoped>
.btngroup-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
</style>
@@ENDVUE@@

attached：按钮贴合、共用圆角；attached=false 时按钮之间留 gap。

