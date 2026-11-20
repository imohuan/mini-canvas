<script setup lang="ts">
/**
 * PromptActionSettings —— 旧的底栏「AI 按钮」配置页（已退役）。
 *
 * 用户 2026-11-20：设置入口从「画布 → 布局 → 控制栏」搬到了
 * 「集成 → 智能助手 → 底栏 AI 工具」，新页面见 BottomBarAiSettings.vue。
 *
 * 这里保留同名导出，避免旧文档 / 外部引用断链；内容直接转发到新页，
 * 不再维护第二套实现（两套清单编辑器迟早会走偏）。
 */
import BottomBarAiSettings from './BottomBarAiSettings.vue'
</script>

<template>
  <BottomBarAiSettings />
</template>
