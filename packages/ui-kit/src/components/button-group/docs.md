# ButtonGroup 按钮组

## 贴合组

`attached` 默认开启：按钮共用一个外圆角，中间不留缝。这是工具栏最常用的形态。

@@VUE@@
<script setup lang="ts">
import { ButtonGroup, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <ButtonGroup aria-label="编辑操作">
    <Button variant="secondary">复制</Button>
    <Button variant="ghost">剪切</Button>
    <Button variant="ghost">粘贴</Button>
  </ButtonGroup>
</template>
@@ENDVUE@@

## 留缝组

`attached=false` 时每个按钮保留自己的圆角，视觉上是并列关系，不是同一件东西。

@@VUE@@
<script setup lang="ts">
import { ButtonGroup, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <ButtonGroup :attached="false" aria-label="独立按钮">
    <Button variant="secondary">收藏</Button>
    <Button variant="ghost">分享</Button>
    <Button variant="ghost">更多</Button>
  </ButtonGroup>
</template>
@@ENDVUE@@

## 纵向

`orientation="vertical"` 堆成一列，适合卡片右侧的加减或步进。

@@VUE@@
<script setup lang="ts">
import { ButtonGroup, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <ButtonGroup orientation="vertical" aria-label="缩放">
    <Button variant="secondary">放大</Button>
    <Button variant="ghost">缩小</Button>
  </ButtonGroup>
</template>
@@ENDVUE@@

## 占满一行

`block` 让整组铺满宽度，组内按钮平分。

@@VUE@@
<script setup lang="ts">
import { ButtonGroup, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <ButtonGroup block aria-label="底部操作">
    <Button variant="ghost">取消</Button>
    <Button variant="primary">确认</Button>
  </ButtonGroup>
</template>
@@ENDVUE@@

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| orientation | horizontal | horizontal / vertical |
| attached | true | 按钮贴合、共用圆角 |
| block | false | 整组占满父级宽度 |
| size | Provider 的 size | 统一传给组内按钮 |

