# P6 收尾(P2b2)· 服务依赖语义补全 —— 交付结论

## 改动文件清单（两个 commit，全部 LF，分支 feat/cordis-plugin-system 原地）
commit 0df5348（缺口A）：
- packages/canvas-core-v2/src/core/Context.ts —— get() 缺服务返 undefined（不抛），更新 docstring
- packages/canvas-core-v2/src/core/types.ts —— PluginScope.get docstring 同步 cordis 语义
- core/__tests__/context.test.ts / service.test.ts —— 断言 toThrow→toBeUndefined（4+1 处）
- canvas-render host 3 个 test —— 同理迁移（createMiniCanvasHost/fullchain/pluginManager）

commit 572f294（缺口B）：
- packages/canvas-core-v2/src/core/Context.ts —— uninstallPlugin 末尾加 retractUnsatisfiedActives + retractPlugin
- packages/canvas-core-v2/src/core/fiber.ts —— 新增 markPending()
- core/__tests__/context.test.ts —— 新增 5 用例

## 验证结果
- 内核 vitest：196 passed（191 + 5 新）
- 内核 tsc EXIT=0
- render vitest：37 passed
- 6 包 typecheck_all：canvas-base / canvas-render / commands / node-image / node-text / theme-default 全 PASS（4 迁移插件未改源码，未红）
- demo vite build：EXIT=0（仅有第三方 @vueuse pure 注解 warning，非错误）

## 关键设计取舍
### 缺口A：get 返 undefined 但返回类型仍 `Service`（未加 `| undefined`）
为什么：strict 下若把 PluginScope.get/Context.get 类型改成 `Service | undefined`，
会波及 registerNodeType.ts/capabilities.ts(nodeFactory/command) 及 4 个已迁移插件
里"直读恒在宿主服务"的调用点（nodeStore/nodeRegistry/themeRegistry/command…均为宿主
先注入、插件才 apply，运行时保证存在），需在 5+ 个非任务文件加非空断言，违反"最小文件集 +
别让插件变红"。故只改运行时语义（缺返 undefined 不抛）+ docstring 明确 cordis 用法：
恒在服务放心直读；真可选依赖靠运行时判 undefined。测试断言已用 toBeUndefined() 覆盖。

### 缺口B：提供方被卸 → "回退 PENDING + 保留登记"而非"删登记"
- 判定依赖方：不做"服务名→owner"反向索引，而是卸载目标 P 并清干净后，迭代扫描所有仍 ACTIVE
  插件，凡其 deps 中任一项现在 depSatisfied=false（= 依赖的是 P 的插件名，或 P 提供的服务名，
  两者在 P 的 scope.dispose 后都从满足集消失）→ 回退。天然同时覆盖"依赖插件名"与"依赖其服务名"，
  实现最小。
- 回退动作 = dispose 该依赖方 scope（副作用/它提供的服务一并回收）+ fiber.markPending()
  （ACTIVE→PENDING），**保留 plugins/fibers/configs 登记**——它仍是已装插件，只是待依赖恢复。
- 传递链：用 while 循环迭代，D 回退时摘除 D 提供的服务 → 下一轮 E(依赖 D 服务)也被回退。
- 恢复重载：不新增触发，复用既有 installPlugin/重新 provide 的 wakePending→drain，把 PENDING
  依赖方按依赖序重新 activate（apply 再跑）。与 cordis "callback 随依赖提供方变化卸载并重跑"一致。
- 不与状态机打架：只对 ACTIVE 回退；fiber 保留非 DISPOSED（dispose 不可逆，故新加 markPending
  而非 dispose）；FAILED/已卸载插件不受影响；P 自己已被完整移除不会误载回。
- 不发射 plugin-uninstalled 给被回退者（它仍是已装插件，仅 ACTIVE→PENDING，避免语义混淆）。

## 权威核对（deepseek-harness 本地文档）
- docs/cordis-tutorial/03-services.zh.md L74-78：inject 非一次性，提供方消失→依赖方随之卸载、
  服务恢复再加载（我的缺口B语义一致）。
- L82-90：可选依赖用 get 探测，undefined 时插件照跑（缺口A一致）。
- vendor/cordis/src/reflect.ts L10-19：get 缺提供方返 undefined 不抛（缺口A一致）。
- vendor/cordis/src/registry.ts L167-170：callback 随所需服务变化卸载并重跑（缺口B一致）。
