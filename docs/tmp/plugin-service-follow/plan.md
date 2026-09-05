# P6 收尾(P2b2)· 服务依赖语义补全 —— 实施计划

> 任务源：docs/plan/plugin-cordis-migration-plan.md P2 验收(99行) + P6(103行)。
> 分支 feat/cordis-plugin-system 原地 commit，LF。基线：内核 191 绿 / render 37 绿 / 内核 tsc EXIT=0 / 6 包 typecheck PASS。

## 缺口 A —— ctx.get 缺服务返 undefined（cordis 可选探测语义）
改动文件：
1. `packages/canvas-core-v2/src/core/Context.ts` `get()`：缺服务不再 throw，返回 `undefined`。
   保留内置 'slots'/'settings' 恒返实例。更新 docstring（cordis 语义：硬依赖用 inject 声明进 PENDING，可选依赖用 get 探测缺返 undefined）。
2. `packages/canvas-core-v2/src/core/types.ts` PluginScope.get docstring 同步。
3. 测试断言迁移：
   - `core/__tests__/context.test.ts` L57 / L181 / L196 / L217
   - `core/__tests__/service.test.ts` L48
   - 由 `toThrow(/not injected/)` → `toBeUndefined()`；用例核心意图(卸载后服务回收/作用域看不到)不变。

不动：capabilities.ts 里 theme()/uiSlots() 的 try/catch（get 改 undefined 后等价无害，保留）；settingsStore()/其它恒在服务读取。configSchema.test/capabilities.test 里 settings.get 是 SettingsStore 自己的 get，不误伤。

## 缺口 B —— 提供方被卸/换，依赖方随之卸载回收并置 PENDING，服务恢复后自动重载
改动文件：
1. `core/Context.ts`：
   - `uninstallPlugin`：dispose 完目标 P 并从 plugins/fibers/configs 移除后，调用新私有 `retractUnsatisfiedActives()`。
   - 新私有 `retractUnsatisfiedActives()`：迭代扫描「仍在 plugins 表且 fiber=ACTIVE 的插件」，凡其 deps 现不再全满足者 → `retract(name)`（dispose 其 scope/副作用、pluginScopes.delete、fiber 置回 PENDING、保留 plugins/fibers/configs 登记），循环直到无新回退（覆盖传递依赖：D 被回退会连带移除 D 提供的服务 → E 也不满足）。
   - 服务恢复路径：installPlugin/重新 provide 已有 wakePending→drain 重载，无需新增。
2. `core/fiber.ts`：新增 `markPending()`（ACTIVE→PENDING，清 error），供 rollback 复用 fiber（不 dispose，保持可重载）。

测试（新增 describe 于 `core/__tests__/context.test.ts`）：
- ① 依赖服务名：consumer inject['B服务'] + B provide → 双 ACTIVE；uninstall B → consumer 副作用被回收 + fiber 回 pending；重装 B → consumer 自动重载(apply 再跑)。
- ② 换版本(reload=先卸后装)：依赖方跟下再跟上。
- ③ 依赖插件名 inject['B']：同样跟随。
- ④ ctx.get 可选：无提供方时 get('x') 返 undefined 且插件照跑。

## 核验
- 内核 vitest（191+新增）绿、内核 tsc EXIT=0。
- render vitest 37 绿。
- typecheck_all 6 包 PASS。
- 4 插件不红（未改插件代码，只验 typecheck）。
