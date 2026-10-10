<!-- 文件：packages/docs/public/examples/resources/plugin-photo-note/src/PhotoContent.vue -->
<!-- 格式：Vue 单文件组件（节点卡片的"内容区"组件） -->
<!-- 位置：插件包内的展示组件，由 index.ts 经 ctx.nodes.register 的 in 字段挂上去 -->

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

/** 外壳（BaseNode）会给每个内容组件注入这两个 props：节点 id 与节点数据 */
const props = defineProps<{ id: string; data: Record<string, unknown> }>()

// 内容组件在渲染子树里，用 useCanvasRender() 拿内核 ctx（它是**裸值**，不用判空）
const { ctx } = useCanvasRender()

const busy = ref(false)
const error = ref('')

/** 节点里存的显示地址（临时地址，刷新后由宿主用 resourceId 重建） */
const imageUrl = computed(() => (typeof props.data.imageUrl === 'string' ? props.data.imageUrl : ''))
/** 节点里存的持久引用（跨刷新活下来的那个） */
const resourceId = computed(() => (typeof props.data.resourceId === 'string' ? props.data.resourceId : ''))

/** 挑一个本地图片文件 */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

async function replaceImage() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const file = await pickFile()
    if (!file) return

    const resources = ctx.get('resources')
    const doc = ctx.get('doc')

    // ① 字节进资源库 → 拿**持久引用**（本地是 res-xxx 的 id，云端是同源 URL）
    const nextRef = await resources.put(file, { kind: 'image', name: file.name })
    // ② 引用换**当前可显示的地址**（本地这里是新建的临时 objectURL）
    const nextUrl = await resources.resolve(nextRef)
    if (!nextUrl) {
      error.value = '资源库读不回刚存的图'
      return
    }

    const before = resourceId.value
    // ③ 一次写回：引用 + 地址一起落下（走 doc 唯一写入口 → 自动进撤销 + 自动落盘）
    doc.updateNode(props.id, {
      data: { ...props.data, resourceId: nextRef, imageUrl: nextUrl, imageName: file.name },
    })

    // ④ 旧引用只在本节点用着，换完就没别人用了 → 顺手回收，别让它一直占内存。
    //    注意先写节点再回收：顺序反了会让界面短暂读到已经失效的地址。
    if (before && before !== nextRef) resources.revoke(before)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="photo-note">
    <img v-if="imageUrl" :src="imageUrl" alt="节点图片" />
    <div v-else class="photo-note__empty">还没有图片</div>
    <button type="button" :disabled="busy" @click="replaceImage">
      {{ busy ? '处理中…' : imageUrl ? '换一张' : '选一张图' }}
    </button>
    <p v-if="error" class="photo-note__err">{{ error }}</p>
  </div>
</template>

<style scoped>
.photo-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 8px;
}
.photo-note img {
  max-width: 100%;
  max-height: calc(100% - 40px);
  object-fit: contain;
  display: block;
}
.photo-note__empty {
  color: var(--ui-ink-dim, #94a3b8);
  font-size: 13px;
}
.photo-note__err {
  margin: 0;
  color: var(--ui-danger, #dc2626);
  font-size: 12px;
}
</style>

