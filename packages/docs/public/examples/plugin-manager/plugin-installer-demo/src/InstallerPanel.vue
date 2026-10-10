<script setup lang="ts">
// 文件：packages/docs/public/examples/packages\docs\public\examples\plugin-manager\plugin-installer-demo\src\src/InstallerPanel.vue
// 格式：Vue 单文件组件（setup 语法糖）
// 位置：overlay 槽上的管理小面板：列已装插件 + 装卸演示插件
import { onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { demoTargetPlugin } from './demoTarget'

// ① 槽位组件不接收自定义 props：自己经 useCanvasRender() 拿 ctx，
//    再按名取宿主注入的 pluginManager 服务（与真实插件同款做法）
const { ctx } = useCanvasRender()
const manager = ctx.get('pluginManager')

const rows = ref(manager.list())
/** 最近一次操作的提示语（成功/报错都显示在这里） */
const note = ref('')

function refresh(): void {
  rows.value = manager.list()
}

// ② 内核广播插件装/卸事件 → 重读清单（面板不需要轮询）
const off1 = ctx.on('ctx:plugin-installed', refresh)
const off2 = ctx.on('ctx:plugin-uninstalled', refresh)
onBeforeUnmount(() => {
  off1.dispose()
  off2.dispose()
})

const TARGET = 'installer-demo-target'

// ③ 装：来源就是内存里的插件对象（源码 import 来的，属于 sourceKind === 'inline'）
async function install(): Promise<void> {
  try {
    const name = await manager.install(demoTargetPlugin)
    note.value = '已装上：' + name
  } catch (err) {
    note.value = '装失败：' + (err instanceof Error ? err.message : String(err))
  }
  refresh()
}

// ④ 卸：核心插件会在这里抛错（应用层句柄不静默失败），所以我们自己 try/catch 给用户看
function uninstall(): void {
  try {
    const ok = manager.uninstall(TARGET)
    note.value = ok ? '已卸下：' + TARGET : '没卸到（可能本来就没装）'
  } catch (err) {
    note.value = '卸失败：' + (err instanceof Error ? err.message : String(err))
  }
  refresh()
}

const installed = () => rows.value.some((r) => r.name === TARGET)
</script>

<template>
  <div class="installer-demo-panel">
    <div class="title">已装插件（{{ rows.length }}）</div>
    <ul>
      <li v-for="r in rows" :key="r.name">
        {{ r.name }}
        <span v-if="r.state && r.state !== 'active'" class="warn">（{{ r.state }}
          <template v-if="r.missingDeps?.length">缺：{{ r.missingDeps.join(', ') }}</template>
        </span>
      </li>
    </ul>
    <div class="actions">
      <button type="button" :disabled="installed()" @click="install">装上演示插件</button>
      <button type="button" :disabled="!installed()" @click="uninstall">卸下演示插件</button>
    </div>
    <p v-if="note" class="note">{{ note }}</p>
  </div>
</template>

<style scoped>
.installer-demo-panel {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 240px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(20, 20, 20, 0.82);
  color: #eee;
  font-size: 12px;
}
.installer-demo-panel .title {
  font-weight: 600;
  margin-bottom: 6px;
}
.installer-demo-panel ul {
  margin: 0 0 8px;
  padding-left: 16px;
  max-height: 120px;
  overflow: auto;
}
.installer-demo-panel .warn {
  color: #ffb454;
}
.installer-demo-panel .actions {
  display: flex;
  gap: 6px;
}
.installer-demo-panel .note {
  margin: 8px 0 0;
  opacity: 0.85;
  word-break: break-all;
}
</style>

