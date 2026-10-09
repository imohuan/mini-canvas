<script setup lang="ts">
// AxMenu / AxMenuItem —— 菜单 UI。菜单本体只负责外观，定位交给外层 AxDropdown。
// 用法：
//   <AxMenu><AxMenuItem @click="…">重命名</AxMenuItem></AxMenu>
</script>

<template>
  <div class="ax-menu" role="menu"><slot /></div>
</template>

<style>
/* 非 scoped：菜单项也用在 AxDropdown 里，且菜单会被 Teleport 到 body。 */
.ax-menu { display: flex; flex-direction: column; gap: 0.25rem }
.ax-menu-title { padding: 6px 8px; color: var(--ui-ink-dim); font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.ax-menu-item { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 34px; padding: 0 8px; color: var(--ui-ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-family: inherit; font-size: 12px; text-align: left; transition: background .14s ease, color .14s ease; }
.ax-menu-item:hover { background: var(--ui-hover); }
.ax-menu-item.is-danger { color: var(--ui-danger); }
.ax-menu-item.is-danger:hover { color: var(--ui-tip-ink, #fff); background: var(--ui-danger-soft, rgb(248 113 113 / .18)); }
.ax-menu-item.is-active { background: var(--ui-hover); }
.ax-menu-item.is-disabled { cursor: not-allowed; opacity: .38; }
.ax-menu-item.is-disabled:hover { background: transparent; }
.ax-menu-item .ax-menu-hint { margin-left: auto; color: var(--ui-ink-dim); font-size: 10px; }
.ax-menu-sep { height: 1px; margin: 4px 0; background: var(--ui-line); }
</style>
