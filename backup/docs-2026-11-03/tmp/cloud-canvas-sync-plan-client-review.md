# 云画布同步计划：客户端审阅

审阅对象：`docs/plan/2026-10-25-cloud-canvas-realtime-sync-plan.md`
范围：客户端重连、版本核对、三方合并、冲突处理、渲染落地
方式：只读取代码，没有改动源码

## P1：两份“云端基准”会各走各的，计划没规定如何对齐

当前同时存在：

- `CanvasDiffAdapter.submittedNodes` / `submittedEdges`：保存时算差异的基准，见 `packages/plugins/plugin-cloud-client/src/canvasDiffAdapter.ts:43-44`、`:82-83`、`:129-131`。
- `createRemoteSync()` 内部 `base`：三方合并的云端基准，见 `packages/plugins/plugin-cloud-client/src/remoteSync.ts:125`、`:153-157`。
- 恢复时读到的服务器快照：只喂给 `adapter.primeFromServer()`，见 `packages/plugins/plugin-cloud-client/src/plugin.ts:231-269`。

现在 `remoteSync` 合并远端变化后，只更新自己的 `base`，不会更新 adapter 的 `submittedNodes`。下一次本地保存时，adapter 会拿旧的提交基准做 `diffGraph`，把刚刚从云端合进来的节点当作“本地新增”再发一次，或者把远端更新当成自己的改动重发。计划第四节只写了“三方合并”和“knownRevision”，没有规定这两份基准必须一起推进。

建议在文档第四节补一条硬约束：

> **云端快照只有一个来源。** adapter 的提交基准与 `remoteSync` 的合并基准必须由同一个 `readCanonicalSnapshot()` 同时取得；远端合并成功、本地保存成功、启动恢复成功后，两者都必须推进到同一个 revision 与同一份节点/边快照。禁止出现“合并基准更新了、提交基准没更新”的中间态。只有本地尚未成功提交的节点变化可以只存在本地。

并把“两份 base 不一致”列入 Commit 2/4 的测试：先合一次远端新增，再触发一次本地保存，不允许把该节点重新当作 `add` 发出。

## P1：核对结果落地前，本地可能已经变化，计划没有“应用前重新判定”

计划第四节写的是先读快照、再拿 `mine` 合并。但两次 await 之间用户仍可拖动、输入、新建节点。当前实现也是这样，见 `remoteSync.ts:151-155`。若用读取时的 `mine` 产出计划，再异步落地，会覆盖这期间的新编辑。

建议补充：

> `snap` 返回后必须重新读取 `mine`，并用同一同步轮次的快照计算计划；应用计划前再确认目标节点没有在编辑中。若核对跨了 await，允许用 revision 再次确认，不能把过期的 `mine` 直接写成最终结果。

若把写入做成纯同步落地，至少要在应用前用最新 store 再算一次 `planRemoteMerge`，避免“读到旧 mine、稍后覆盖新编辑”。

## P1：`knownRevision` 的推进时机必须与“本地可重放”绑定

计划说“合并成功后记录 `knownRevision = snap.revision`”，但没有区分：

- 远端变化已经合进本地 store；
- 本地这些变化是否真的已经成功提交到后台。

如果远端快照里缺少用户刚建、还没提交的本地节点，而代码无条件把 `knownRevision` 推到了最新，这个节点的“云端基准”就丢了。之后不会再有事件提醒，保存失败或刷新时可能直接消失。

建议把状态拆成三个值：

```text
knownServerRevision   已确认的云端快照版本
pendingLocalChanges   本地尚未成功提交的节点/字段
lastAppliedRevision   已应用的本轮云端版本
```

规则：

- 云端合并成功可以推进 `knownServerRevision`；
- 只有在本地提交成功（服务端返回 `ok:true`）后，才能把 `pendingLocalChanges` 对应部分清空；
- 保存失败、核对失败，不推进或不回退 `knownServerRevision`，继续重试；
- 文档里不要把“读完云端”写成“全部同步完成”。

## P1：事件去重不能只用 `revision <= knownRevision` 判断

计划 4.3 写“客户端发现 `revision <= knownRevision` 直接忽略”。这条在“本地尚未提交的改动与云端同一 revision”时有歧义：已知版本相同不代表本地有未同步变化。

推荐事件去重条件是：

```text
忽略事件，当且仅当 revision 小于等于 lastAppliedEventRevision，
且该 revision 的快照已经核对过。
```

`knownRevision` 只用于“云端书签”，不要拿它代替本地是否脏的判断。事件只触发“去核对”，不应该直接代表本地已经同步。

## P1：服务端一次只返回一个快照，但“本地保存失败”后必须阻止后续核对把它当已同步

`CanvasDiffAdapter` 当前在保存失败时确实不会推进 `remember()`，见 `canvasDiffAdapter.ts:139-141`。但计划需要补：

- 保存失败后要保留“该节点/字段待提交”状态；
- 后续一次成功的远端核对不能把这个失败节点从本地删除或覆盖；
- 远端核对结果的 `updateNodes` 不能无条件覆盖“本地保存失败且仍在待提交集合”的节点。

否则会形成“保存失败 → 远端核对成功 → 本地待发内容被远端旧值覆盖 → 刷新后消失”。

## P1：同 id 碰撞方案需要明确“哪一边让路”

计划第五节提到“给本地未同步节点分配新 id，或标记冲突”，但没有给出可执行条件。现有实现见 `remoteMerge.ts:190-208`：

- 若 `base` 没有、`theirs` 有、`mine` 也有同 id，会直接忽略远端；
- 若 `base` 有、`theirs` 删除、`mine` 改过，会保留本地。

建议在文档中写死首版策略：

1. 若本地节点属于“从未成功提交”的集合，且远端同 id 已经存在：
   - 本地节点换新 id（保留本地内容与关系，必要时一起改 parentId / edge endpoints）；
   - 再把远端节点纳入本地；
   - 产生一条可见同步提示。
2. 若本地节点已成功提交过，且远端同 id 类型/内容不同：
   - 进入冲突状态，不静默覆盖；
   - 保留双方可恢复副本。
3. 若同 id 完全一致：视为已同步，不产生操作。

还要明确：换 id 后资源引用、连线、父节点引用必须同步改；只改节点 id 会留下悬挂边。

## P1：字段删除需要真正的“删除语义”，现有 updateNode 表达不出来

当前 `applyMerge.ts:82-87` 用浅合并写 `data`；`canvas-data` 的 `NodePatch` 只有 `data?: Record<string, unknown>`，见 `nodeStore.ts:43-45`，`applyPatch()` 执行的是 `{ ...node.data, ...patch.data }`，见 `nodeStore.ts:493`。`parentId` 支持 `undefined` 清除，见 `nodeStore.ts:505-508`，但 `data` 没有对等能力。

计划必须明确：

- 新增 `dataUnset?: string[]` 或等价字段，且只允许删除指定 key；
- `applyPatch` 先应用 `data`，再删除 `dataUnset`，最后刷新 size 镜像；
- 云端的 `data` 删除要体现在 `remoteMerge` 计划和提交层，不只是本地落地；
- 服务端批量写也要支持显式字段删除，否则本地删了、下次保存又写回来。

否则“远端删了字段、本地没改”永远无法真正同步，计划里写成“会修”但落地条件不完整。

## P2：运行期字段会造成无意义同步与撤销栈污染

`isRuntimeOnly()` 只把“唯一变化的 key 是 `runState`”识别为运行期帧，见 `applyMerge.ts:46-52`。若远端只改 `runState` 加另一个运行期字段（如进度、错误、耗时），就会被当成作品改动进入事务，用户撤销一次只退一格进度。

建议文档补：

- 明确运行期字段清单（至少 `runState` 及其内部进度、状态、错误；若存在其他运行期字段要列出）；
- 合并层按字段判定，只有运行期字段变化就走 `updateNodeRuntime`；
- 运行期字段变化不应推进 `knownRevision` 后的本地脏标记，或至少不影响“待提交”集合。

这不是本次根因，但会影响“核对频率提高”后的撤销体验。

## P2：`unknown type` 的跳过会让新节点永久不落地

`remoteMerge.ts:190-208` 在本地不认识类型时 `continue`，计划没有说明“类型稍后热装后怎么办”。用户打开画布时，group / mini-map 等类型可能还没注册；远端新节点被跳过，之后类型注册成功也不会自动重新合并，除非再有一次事件。

建议补：

- 未知类型节点先缓存为“待重试的远端快照”，不要直接丢弃；
- 节点类型注册变化（`nodeRegistry` 或 `doc.types` 变化）后触发一次核对；
- 若类型长期未知，至少在本地保留原始数据或明确提示，不能静默消失。

## P2：重连触发要覆盖 `onopen`、隐藏恢复、浏览器离线恢复三种路径

计划 4.4 写了这些触发，但客户端当前共享订阅不向外暴露连接状态：

- `subscribeChanges()` 只返回退订函数，见 `api.ts:363-437`；
- `subscribePath()` 只处理 `onmessage`，见 `kvEvents.ts:144-166`；
- `handleVisibility()` 在回前台关闭并重开连接，见 `kvEvents.ts:97-105`；
- `entryFor()` 只有在 `readyState === 2` 时才重开，见 `kvEvents.ts:113-123`。

建议计划明确：

- 共享层必须暴露“连接已恢复”或“可能漏事件”的回调，而不是只暴露消息；
- `EventSource.onopen`、页面可见恢复、`online` 都要触发一次核对；
- 回前台重开连接时要同时通知订阅者“重新核对”，不能依赖“下一条消息”；
- `entryFor()` 对死连接的重开策略要覆盖 `CLOSED` 以外的异常态，或者用一次显式重开替代 `readyState` 猜测；
- 不要让 `plugin-cloud-client` 和 `ui` 各开一条连接（现有共享机制要保持）。

## P2：页面不可见时暂停定时核对，但“恢复可见”必须先核对再更新 UI

计划写了隐藏页暂停，建议补充恢复顺序：

1. 回前台先读 revision；
2. 若落后，读完整快照并合并；
3. 合并完成前，不要先展示“已同步”状态；
4. 若隐藏期间用户本地的操作还在进行，按冲突规则处理。

这能避免“回到前台先触发一次普通渲染，随后又合并一次”的闪动。

## P2：定时核对必须支持取消与生命周期清理

当前 `remoteSync.stop()` 只清 timer 和退订，见 `remoteSync.ts:196-204`；没有“核对进行中”的 abort 机制。计划新增 15 秒核对后，需要补充：

- 插件卸载、画布切换、请求超时时取消在途核对；
- 用 `AbortController` 或 generation token，防止旧核对把新画布的合并结果写进当前画布；
- 每次核对开始记录 `canvasId`，返回时确认仍是同一画布，否则丢弃；
- `plugin-cloud-client` 的 `CID` 是启动时算的，见 `plugin.ts:200-205`，而 adapter 每次现算画布 id，见 `canvasDiffAdapter.ts:59-61`。计划要统一这一点：核对与保存必须绑定同一个画布 id。

这是一个实际风险：旧画布的核对回来时页面已经切到新画布，代码可能把旧快照应用到新 store。

## P2：快照读取失败与 HTTP 200 业务失败要分开处理

计划 Commit 1 已处理保存 `ok:false`，但客户端读快照也要检查：

- `GET /api/canvases/:id` 返回 200，但 `{ok:false}` 或字段缺失时，不能当成空画布；
- 空画布是合法的 `nodes: []`，网络失败不是；
- 解析异常不能让 `knownRevision` 推进；
- 版本接口与完整快照接口都要有“响应形状校验”，否则协议升级时静默错位。

## P2：CanvasHost 分批挂载窗口的修法需要写清楚

`CanvasHost.vue:270-308` 在 `mountRaf` 进行中只更新 `stagedTarget`，当前 `nodes.value` 不刷新新节点。计划只写“复现测试后决定是否修”，建议明确：

- 若该窗口只是 UI 延迟，数据已写入 store，刷新后能看到，那属于显示延迟；
- 若数据也在窗口中被丢掉，则是数据问题，必须优先修；
- 最小修法：在 `syncNodesFromStore()` 的“分批中”分支里，对已存在节点立刻更新其数据，对新节点单独排队；而不是整个 `target` 都延后。
- 测试要覆盖“分批挂载期间远端新增一个节点 / 修改一个已有节点”，检查 store、`nodes.value` 和最终 DOM 三层。

## P2：`restoreOrSeed` 与实时同步的先后关系要写进计划

当前启动流程是 `restoreOrSeed()` → `adapter.primeFromServer()` → `sync.refreshBase()` → `sync.start()`，见 `plugin.ts:231-273`、`:419-426`。计划 Commit 2 说“先建立订阅并缓冲触发”，但没有定义：

- 恢复期间的事件是否缓冲；
- 恢复完成后是否用同一快照同时初始化 adapter 与 remoteSync 的基准；
- 恢复失败时是否允许启动实时同步；
- “服务器为空、本地首次上云”时，上云成功后的 revision 如何设置。

建议写成明确状态机：`booting → restoring → seeding/ready → subscribing`，每一步失败都能回退并给用户可见状态。

## P3：`resources.restore()` 与远端只改 `resourceId` 的场景

启动恢复会重建媒体地址，见 `restore.ts:68-73` 与 `plugin.ts:245-252`；但实时合并只是把云端的 `data` 浅合并到本地，见 `applyMerge.ts:82-87`。若云端只更新 `resourceId`、旧的显示地址还在，本地合并后可能出现“ID 新、旧地址还在”。图片组件优先按 ID 解析，见 `packages/plugins/plugin-node-image/src/ImageContent.vue:40-57`，通常能显示；但解析失败时会回退旧地址，刷新后才会被恢复逻辑清掉。

计划 Commit 5 已提这一条，建议补充具体规则：

- 合并后若 `resourceId` 变化，必须让对应的媒体 URL 失效并重新解析；
- 不能把旧 `imageUrl`/`videoUrl` 当作新的显示来源；
- 测试要覆盖“resolve 失败”与“resolve 成功”两种，不只测正常图片。

## P3：边的冲突与节点 id 改写的联动

同 id 节点换新 id 后，所有引用它的边端点、子节点 `parentId`、可能存在的分组引用都必须一起改。计划提到“分配新 id”，但没有列出联动清单。建议在 Commit 5 写成检查表：

- 节点 id；
- 该节点作为 source/target 的边；
- 以它为 `parentId` 的子节点；
- `data` 中可能存在的引用字段；
- 选中态、剪贴板或临时态是否需要清理。

否则会产生“节点保留了，但线断了/分组散了”。

## P3：测试还缺关键场景

建议在计划第七节补以下客户端用例：

1. 远端合并后下一次本地保存不重发远端节点；
2. 保存失败后远端核对不覆盖待提交节点；
3. 页面在核对进行中切画布，旧快照不能应用到新画布；
4. 同 id 本地新节点 + 远端新节点，换 id 后边与分组引用一起改；
5. `data` 字段删除后刷新与本地显示一致；
6. 未知类型节点在类型注册后能被补同步；
7. 隐藏页恢复先核对再渲染，不出现旧画面闪回；
8. 运行期字段变化不进撤销栈，也不阻塞普通内容合并。

## 总结

计划方向正确：**版本号只发号、前端只记录、落后拉最新全量、三方合并**。但客户端部分还缺三件硬约束：

1. 保存基准与合并基准必须来自同一份规范化快照；
2. `knownRevision` 的推进必须和“本地待提交内容”分开管理；
3. 核对结果落地前要重读本地状态并绑定画布生命周期，避免用过期 `mine` 或旧画布快照覆盖当前编辑。

P1 项应在动手前补进计划；P2 项建议并入 Commit 2/4/5 的验收条件；P3 作为回归测试补足。
