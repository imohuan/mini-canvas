// 文件：packages/docs/public/examples/kernel/topo-demo/src/main.ts
// 格式：TypeScript 模块（预检脚本，`npx tsx src/main.ts` 即可跑）
// 位置：验证清单合法 + 演示四种错误的报错长什么样
import { topoSort, depsOf } from '@mini-canvas/kernel'
import { KNOWN_SERVICES, manifest } from './manifest'

// ① 正常排序：依赖在前
const order = topoSort(manifest, KNOWN_SERVICES)
console.log('[topo] 合法顺序：', order)
// ['canvas-base', 'tool-registry', 'theme-default', 'agent']（同级保持登记序）

// ② depsOf 的优先级：inject 优先于 deps
console.log('[topo] depsOf 优先级：', depsOf({ name: 'x', inject: ['a'], deps: ['b'] }))  // ['a']

// ③ 环：三个插件互相依赖 → 成环，报出可读路径
try {
  topoSort([
    { name: 'a', inject: ['b'] },
    { name: 'b', inject: ['c'] },
    { name: 'c', inject: ['a'] },
  ])
} catch (err) {
  console.log('[topo] 环：', (err as Error).message)
  // [core] Circular dependency detected: a → b → c → a
}

// ④ 缺依赖（记得把 knownServices 传上，否则外部服务名也会被当成「缺失」）
try {
  topoSort([{ name: 'a', inject: ['ghost'] }])
} catch (err) {
  console.log('[topo] 缺依赖：', (err as Error).message)
  // [core] Plugin "a" depends on "ghost" which is not registered
}

// ⑤ 重名
try {
  topoSort([{ name: 'a' }, { name: 'a' }])
} catch (err) {
  console.log('[topo] 重名：', (err as Error).message)
  // [core] Duplicate plugin name: "a"
}

// ⑥ 自依赖
try {
  topoSort([{ name: 'a', inject: ['a'] }])
} catch (err) {
  console.log('[topo] 自依赖：', (err as Error).message)
  // [core] Plugin "a" cannot depend on itself
}

