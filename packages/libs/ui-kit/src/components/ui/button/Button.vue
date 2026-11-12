<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { ButtonVariants } from '.'
import { cn } from 'cn'
import { Primitive } from 'reka-ui'
import { buttonVariants } from '.'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
})
</script>

<template>
  <!--
    data-variant / data-size 一定要写出实际档位，不能留空。

    用户口径 2026-11-04：同样是标准尺寸，主按钮的圆角明显比其它按钮圆。
    原因就是 variant 缺省时这里根本没渲染这两个属性，而统一圆角的 CSS 选择器
    是 `[data-slot='button'][data-variant]` —— 主按钮匹配不上，只能退回构建期
    写死的 rounded-4xl（20.8px）；其它变体反而正常读到 --radius。
  -->
  <Primitive
    data-slot="button"
    :data-variant="variant ?? 'default'"
    :data-size="size ?? 'default'"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>
