<script setup lang="ts">
/**
 * 下拉箭头（reka-ui 原生 DropdownMenuArrow 的一层薄封装）。
 *
 * 为什么单独包一层：reka-ui 的箭头必须在 DropdownMenuContent 里才拿得到
 * context（它读 --reka-dropdown-menu-content-transform-origin 决定朝向），
 * 各调用点直接写一遍 svg 容易抄错朝向与偏移。这里只统一外观。
 *
 * 外观跟菜单同一套 token：fill 用 popover 底色，描边用菜单边线，
 * 于是箭头看起来是菜单本身伸出来的一块，而不是贴了块白色三角形。
 */
import type { DropdownMenuArrowProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from 'cn'
import { DropdownMenuArrow } from 'reka-ui'

/**
 * 尺寸：16×8。
 *
 * 先说为什么不是 shadcn 默认的 10×5：底部 dock 的菜单离按钮有 24px 空隙，
 * 12×6 的箭头在 2 倍屏上也只剩一条细缝，用户第一眼看不出来（2026-11-02 实测截图）。
 * 16×8 才是「看得见的指向」；再大就会盖到菜单圆角，反而像贴了块三角。
 *
 * `rounded` 必须开：reka 默认的箭头路径是 `M0 0 L6 6 L12 0`，三段都描边 ——
 * 顶部那条 `M0 0 L12 0` 正好压在面板底边上，和面板 ring 叠成一条横线，
 * 远看就像给箭头套了个框（用户 2026-11-05 截图）。开 rounded 后路径变成
 * `M0 0 … 圆角 … L12 0` 的两侧斜边，没有顶边，箭头看起来是面板自己伸出来的一块。
 */
const props = withDefaults(
  defineProps<DropdownMenuArrowProps & { class?: HTMLAttributes['class'] }>(),
  { width: 16, height: 8, rounded: true },
)
</script>

<template>
  <DropdownMenuArrow
    data-slot="dropdown-menu-arrow"
    :width="props.width"
    :height="props.height"
    :rounded="props.rounded"
    :class="cn('fill-popover stroke-line', props.class)"
  />
</template>
