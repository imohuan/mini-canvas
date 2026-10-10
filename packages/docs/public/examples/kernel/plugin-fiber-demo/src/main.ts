// 文件：packages/docs/public/examples/kernel/plugin-fiber-demo/src/main.ts
// 格式：TypeScript 模块（诊断脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把四个插件装进同一个内核，逐个诊断
import { Context } from '@mini-canvas/kernel'
import { badConfigPlugin, healthyPlugin, throwingPlugin, waitingPlugin } from './demoPlugins'

const ctx = new Context({ dev: true })

// ① 先装两个「正常 / 缺依赖」的，启动看结果
ctx.plugin(healthyPlugin)
ctx.plugin(waitingPlugin)
await ctx.start()
console.log('[main] 启动后：healthy =', ctx.fiber('healthy')?.stateName, ' waiting =', ctx.fiber('waiting')?.stateName)

// ② 热装一个 config 越界的：installPlugin 会把错误抛出来（fiber 留在 failed）
try {
  ctx.installPlugin(badConfigPlugin, { width: 999 })
} catch (err) {
  console.log('[main] 装 bad-config 抛出来的错误：', (err as Error).message)
  // → [config] invalid config: "width" = 999 exceeds max 6
}

// ③ 再热装一个 apply 里抛错的：同样抛出来，fiber 也是 failed
try {
  ctx.installPlugin(throwingPlugin)
} catch (err) {
  console.log('[main] 装 throwing 抛出来的错误：', (err as Error).message)   // boom-apply
}

// ④ 一眼看全：谁 active、谁 pending（缺什么）、谁 failed（错什么）
console.log('\n=== 诊断表 ===')
for (const s of ctx.inspectPlugins()) {
  const deps = s.missingDeps.join(',') || '-'
  console.log(s.name + '  state=' + s.state + '  缺依赖=' + deps + '  error=' + (s.error ?? '-'))
}

// ⑤ 拿到单个 fiber 看细节
const w = ctx.fiber('waiting')
console.log('\nwaiting 的 deps：', w?.deps)          // ['never-provided-svc']
console.log('waiting 当前态：', w?.stateName)         // 'pending'

const b = ctx.fiber('bad-config')
console.log('bad-config 的原始错误：', (b?.error as Error)?.message)

// ⑥ 修好配置，重装同名的（FAILED 的已经被移出可装载表，名字空出来了）
ctx.uninstallPlugin('bad-config')
ctx.installPlugin(badConfigPlugin, { width: 3 })
console.log('\n重装后 bad-config：', ctx.fiber('bad-config')?.stateName)   // 'active'

// ⑦ 等稳定态：FAILED 时 settle() 会 reject
const t = ctx.fiber('throwing')
if (t) {
  try {
    await t.settle()
  } catch (err) {
    console.log('settle 捕获到：', (err as Error).message)             // boom-apply
  }
}

// ⑧ 先问再卸
console.log('\n能不能卸 healthy：', JSON.stringify(ctx.canUninstall('healthy')))   // {"ok":true}
console.log('能不能卸没装的：', JSON.stringify(ctx.canUninstall('ghost')))         // {"ok":false,"reason":"not-found"}

ctx.stop()

