# 2 · 给画布加一种节点

> 目标：新增一种叫 `audio` 的节点，带个自定义界面，能点出来放上画布。
> 建立在第 1 篇「第一个插件」跑通的基础上。

## 前提

- 第 1 篇跑通：`cd packages/canvas-core-v2 && pnpm dev` → http://localhost:5199 无报错。
- 会新建一个 `.ts` + 一个 `.vue`（节点的长相）。

## 做

1. 新建 `packages/canvas-core-v2/demo-web/AudioContent.vue`（节点的界面，就是一段 Vue 组件）：

```vue
<template>
  <div class="audio-content">
    <div class="title">🔊 我的节点</div>
    <div class="sub">{{ label }}</div>
  </div>
</template>

<script setup lang="ts">
// 节点能拿到自己的 data；这里直接展示，不做编辑
withDefaults(defineProps<{ data?: { label?: string } }>(), { data: () => ({ label: '双击我' }) })
</script>

<style scoped>
.audio-content { font-size: 14px; color: #333; }
.audio-content .title { font-weight: 600; margin-bottom: 4px; }
.audio-content .sub { color: #888; }
</style>
```

2. 新建 `packages/canvas-core-v2/demo-web/audioPlugin.ts`，**把这文件替换成**这段：

```ts
import type { Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService } from '@mini-canvas/canvas-core-v2'
import AudioContent from './AudioContent.vue'

export const name = 'audio'
export const inject = []

export function apply(ctx: Context) {
  const nodeStore = ctx.get<NodeStoreService>('nodeStore') // 取内核的节点数据服务(带上类型好补全)

  // ctx.nodes.register 一次注册：数据(尺寸/名字) + UI(content) + 点菜单怎么建它
  ctx.nodes.register({
    type: 'audio',
    label: '音频',
    size: { w: 220, h: 90 },
    content: AudioContent,
    create(position) {
      const id = nodeStore.addNode('audio', position) // 放一个节点
      nodeStore.updateNodeData(id, { label: '我的音频' }) // 给个默认 data
      return id
    },
  })
}

export const audioPlugin = { name, inject, apply }
```

3. 把它加进 demo 装配（同第 1 篇第 2 步）：`CanvasDemo.vue` 里 import `audioPlugin`，并把
   `audioPlugin` 加进 `plugins` 数组。这样一进画布，audio 类型就已注册。

4. 想让"从菜单点出来"：在 `CanvasDemo.vue` 的工具栏加一个按钮，复用已有的建节点命令——
   它已经在第 1 步里能用了。也可以直接照"现有 + 文本 按钮"的样子补一个调用 `host.command.execute('command:create-node', { type:'audio', position })`。

## 你会看到

- 刷新页面：往画布里放一个 `audio` 节点，它显示成你在 `AudioContent.vue` 里写的样子（🔊 我的节点）。
- 拖动它 / 拖它的圆点连线——和其他节点行为一致（连接约束由内核 connection 那套管，跟第 3 篇以后的自定义端口不同）。

## 这背后发生了什么（一句话）

`ctx.nodes.register` 把三件事一次做完：① 让内核"认识" audio 这个类型（能建、能存）；
② 把 `content: AudioContent` 挂到节点的展示层——渲染宿主读到它就用你那个 .vue 画这个节点；
③ 可选 `create` 建节点逻辑。三者都随插件卸载自动回收。

## 下一步

你的节点能上画布了。想让它的**颜色/线宽/圆角能被用户调** → 学「让插件可配置」。
想让节点有**多个输入口、限定只能连某种类型** → 见后面自定义端口/吸附的验证示例（等主题设置与安装系统就绪后一并补齐）。

---
> 想看一个"生产级"的同类示例？`packages/plugins/plugin-node-text` 就是按完全一样的
> `name/inject/apply` + `ctx.nodes.register` 写的真实插件，代码可当样板。
