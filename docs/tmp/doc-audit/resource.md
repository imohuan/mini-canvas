# 资源方案审核：只存 resourceId，地址统一现取

审核日期：2026-10-18。范围：docs/插件开发规范.md（§1.4 / §2.2 / §2.3 / §3 / §4.3）、
docs/design/node-data-and-upstream-contract.md、docs/design/plugin-contracts-proposal.md 的 media 方案。
结论以源码为准，行号按审核时的文件版本；没有跑过实现的地方标「待验证」。

## 一、结论

用户的方案方向正确，但现在落不了地：本地后端已经是「只存 ID、地址现算」，云端后端却是
「引用本身就是同源 URL」。文档把两套后端写成同一种行为，读者照着做会在云端语义下得到相反结果。

更直接的问题是文档自相矛盾：规范说「解析结果不写回 data」
（docs/插件开发规范.md:44），但数据层每次载入画布都会把 resolve 出的地址写回
data.imageUrl / data.videoUrl（packages/canvas-data/src/resourceService.ts:178-198）；
存档前再清掉（同文件 :126-139）。所以现行系统的真实形态是
「持久 resourceId + 会话内临时地址副本」，不是「节点里只有 ID」。

建议保留用户的目标，但把契约写成三段，别混成一句：

1. 持久层：节点、存档、剪贴板载荷、注册场条目只保存 resourceId；不保存解析结果。
2. 运行层：渲染组件按 resourceId 调 resources.resolve() 得到地址，结果放组件本地
   （或一个不落盘的内存视图），不写回 nodeStore 的 data。
3. 兼容层：旧存档里的 imageUrl 等字段只读，载入时迁移成 resourceId + 内存地址；
   新写入不再产生这些字段。

第 2 条与今天的实现相反，必须一起改，否则文档写了也没人遵守。

## 二、逐项核对

### 2.1 ctx.get('resources') 能不能「只存 ID」

接口本身可以，put 已经声明返回「持久引用」：packages/canvas-data/src/resourceService.ts:69-77。
但两套后端的返回值不一样：

| 后端 | putResource 返回 | 证据 |
|---|---|---|
| 本地 IndexedDB | res-<n>-<uuid>，纯 id | packages/canvas-data/src/storage/indexedDbResourceAdapter.ts:55-61、:72-89 |
| 云端画布文件夹 | 同源 URL /api/canvases/<id>/resources/<哈希> | packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:41-60 |

本地文件头就写着「节点里只存 ref，绝不存 URL」：
packages/canvas-data/src/storage/indexedDbResourceAdapter.ts:8-10。
云端文件头写的是相反的一条「回的就是持久引用，云端引用本身是个稳定地址，节点里直接存 URL」：
packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:9-11。

ResourceStore 不区分环境，它把后端返回值原样当 id 存表：
packages/canvas-data/src/resourceService.ts:253-268。所以「只存 ID」不是改一个类型就能成立，
必须让云端也返回逻辑 id，并把「id → 路由」的映射放进 resolve。

云端已有一条特例：调用方给 opts.ref（缩略图/帧图这类派生资源）时返回裸引用，
靠 resolve 去服务端 HEAD 探测：
packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:52-59、:70-82。
这说明「逻辑 id」这条路在派生资源上已经存在，只是主资源没走。

register / restore 不是问题：register 是会话内旧接口，明确不写后端
（packages/canvas-data/src/resourceService.ts:294-318）；restore 只是 resolve 的别名
（同文件 :396-404）。要删的是「引用可以是 URL」这个隐含假设。

### 2.2 三个兼容函数与「只存 ID」的冲突

sanitizeTransientResourceUrls 存档前删两类地址：blob:，以及「带 resourceId 的 data:」；
它刻意不删没有 resourceId 的大 dataURL，因为那是图片唯一的一份
（packages/canvas-data/src/resourceService.ts:109-139）。
这跟「只存 ID」不冲突，它正是把临时地址从存档清掉的那一步；但它反过来说明：
系统默认节点里会有地址副本，否则不需要清。

mediaUrlFieldsOf 按节点类型决定「恢复时写回哪个 URL 字段」
（packages/canvas-data/src/resourceService.ts:141-162）。
restoreNodeMediaUrls 拿到 resourceId 后调 restore，再把结果写进 data
（同文件 :172-198）。这与规范 :44 和契约 :116 的「不写回 data」直接矛盾。
pendingMediaRestoreFields 也印证「地址会缺失、靠载入时补」（同文件 :164-170）。

调用点有两处，都在真实启动路径上：

- 本地载入：packages/canvas-render/src/host/createMiniCanvasHost.ts:281-288。
- 云端覆盖本地前的恢复：packages/plugins/plugin-cloud-client/src/plugin.ts:235-246。

另外 restoreNodeMediaUrls 把 kind 只分成 video 与 image 两类
（packages/canvas-data/src/resourceService.ts:189），音频与全景恢复时会拿到 image kind。
本地后端不看 kind，所以现在没暴露；云端若按 kind 选路由或校验，这里会出错（待验证）。

所以文档要么改成「允许会话内写回、存档前清掉」，要么把恢复流程改成「只建内存视图」。
现在这种「文档说不写、代码在写」的状态，会让后来的人按文档改坏。

### 2.3 云端改成逻辑 ID 的影响

上传：putResource 现在返回 uploaded.url，地址由服务端的 hashName 拼出
（packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:52-59、
packages/plugins/plugin-cloud-client/src/api.ts:152-198）。
服务端 save 返回的也是 URL 与 hashName
（packages/cloud-server/src/store/canvasResources.ts:90-111）。
改成逻辑 ID 后，put 只回 id，id 里仍要能推出 hashName（或另有一张 id→hash 表），
否则 resolve 没法拼路由。最省事的是 id 就取 hashName，resolve 用画布 id 拼地址。

resolve：云端现在是「已是 URL 就原样返回」
（packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:62-83）。
改成逻辑 ID 后必须真的探测/构造地址；探测失败要返回 undefined，
不能再「认不出就原样返回」，否则 res-1 会被当图片地址塞进 img。
现有测试已经要求本地引用在云端返回 undefined
（packages/plugins/plugin-cloud-client/src/__tests__/cloudResourceAdapter.test.ts:74-76），
说明这条分支存在，只是主资源没走。

资源清理：云端 removeResource 是 no-op，理由是内容哈希去重、单方面删会删坏别处
（packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:85-91）。
改成逻辑 ID 不改变这个结论；要回收就得做引用计数或定期清扫。
本地会真删（packages/canvas-data/src/storage/indexedDbResourceAdapter.ts:107-112）。

画布 diff / 存档：存档写的是 data，只要读的是 resourceId，diff 逻辑本身不变。
但旧存档里的 resourceId 仍是 URL；新写入若是裸 id，resolve 必须同时接受两种形态。
建议迁移期两者都认，并给新 id 加可识别前缀。

复制画布：云端复制靠字符串替换 URL 里的画布 id
（packages/cloud-server/src/store/canvasStore.ts:165-196）。
如果节点里只有裸 id，这段替换会失效 —— 副本会指向原画布的资源，原画布一删就裂。
改成逻辑 ID 时，复制要按 id 重新映射到新画布的资源：先把资源目录拷过去
（同文件 :179-186 已在做），再改 id 里的画布作用域。
这是最容易被漏掉的一处，现有测试也只按 URL 断言
（packages/cloud-server/src/__tests__/projectsAssetsRoute.test.ts:94-116）。

旧数据迁移：服务端 res:<hash> 已删除读取兼容
（packages/cloud-server/src/store/canvasResources.ts:8-10）。
客户端首次上云会把本地 res-… 的字节捞出来重传，并把云端 URL 写进媒体字段
（packages/plugins/plugin-cloud-client/src/plugin.ts:116-178）。
这段迁移只改 URL 字段、没改 resourceId（同文件 :171-175），会写出
「resourceId 仍是本地 id、imageUrl 是云端 URL」的混合体。改成逻辑 ID 后必须同时改两者。

### 2.4 文档里的 media 形状够不够覆盖场景

media.put 回 ID、media.resolve 回地址、addNode/applyToNode 只收 ID 的形状是对的
（docs/design/plugin-contracts-proposal.md:33-48）。
但下面几处覆盖不完整：

1. 上传/生成结果：现有生成结果写回是「先量尺寸、再写 URL + resourceId」
   （packages/plugins/plugin-node-image/src/imageRun.ts:84-123）。
   只收 ID 后，尺寸要在 put 之后、写节点之前量；applyToNode(nodeId, slot, id) 没有位置传尺寸
   （docs/design/plugin-contracts-proposal.md:42）。
   要么加 meta 参数，要么让节点自己的 applier 负责量尺寸。
2. 视频截图：现在是 createNode('image', pos, { imageUrl, resourceId })
   （packages/plugins/plugin-node-video/src/videoOps.ts:451-476）。
   改成 media.addNode('image', id) 后，截图的 at、裁剪矩形、尺寸都不在签名里
   （docs/design/plugin-contracts-proposal.md:40）。
   文档需要明确这些由谁传给图片节点创建器。
3. 资产导入/文件拖入：plugin-file-drop 自己判断类型、自己量宽高、自己建节点
   （packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:99-165 附近）。
   改 media 后，类型判断和尺寸测量应只有一份；文档只说「改调 media」，没写测量回调放在哪。
4. 剪贴板跨页：文档说「载荷里带 resourceId 而不是临时地址」
   （docs/design/node-data-and-upstream-contract.md:123），但实现会整份深拷贝 data，
   imageUrl 等地址一起进载荷（packages/plugins/plugin-clipboard/src/clipboardEngine.ts:252-269、
   packages/plugins/plugin-clipboard/src/clipboardPlugin.ts:200-202）。
   粘贴时再用 pendingMediaRestoreFields 重建地址
   （packages/plugins/plugin-clipboard/src/clipboardPlugin.ts:291-315）。
   所以这条文档现在与代码不符；「只存 ID」落地时要真正剥掉 URL 字段。
5. 缩略图/帧图（derived）：put(..., { derived: true }) 的资源不进节点 resourceId，
   靠可推算的 ref 复用（packages/canvas-data/src/storage/types.ts:87-93、
   packages/canvas-data/src/resourceService.ts:375-389）。
   media.put 的 opts 没有 ref/derived（docs/design/plugin-contracts-proposal.md:36），
   照文档实现会漏掉这条，导致每次打开重算缩略图。
   顺带：packages/docs/services/resources.md:31-32 还说 ResourcePutOptions 只有 kind/name，
   与 types.ts:69-94 的四个字段不符，是陈旧文档。
6. 外部 https 链接：文档允许 externalUrlField
   （docs/design/node-data-and-upstream-contract.md:53-54、:69），但 media 没有
   「登记外部地址」的入口。生成结果常先回外链（packages/plugins/plugin-node-image/src/imageRun.ts:70-79），
   要不要下载成资源由调用方决定；文档需要写清默认策略。
7. data: 内联地址：现有存档允许「没有 resourceId 的大 dataURL」活下来
   （packages/canvas-data/src/resourceService.ts:120-124）。
   规范 §2.2 又说「data: 可以存在 xxxUrl」（docs/插件开发规范.md:61），
   与「只存 ID」并列时读者会糊涂。要写成「仅旧存档兼容，新写入禁止」。

### 2.5 遗漏的场景

- 资源还没上传完：put 是 await 的，返回即写完后端
  （packages/canvas-data/src/resourceService.ts:253-268）；flush 现在几乎立刻返回，
  文档已提醒「别指望 flush 等后台任务」（packages/docs/services/resources.md:95-98）。
  若云端改成「先回 id、后补字节」，必须定义「id 已存在但字节未到」的状态。
  当前没有这个状态，建议保持「put 返回即可用」。
- 后台资源不存在：本地 resolve 返回 undefined
  （packages/canvas-data/src/storage/indexedDbResourceAdapter.ts:97-105），
  云端对认不出的 ref 也返回 undefined
  （packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:62-83）。
  组件要有「资源不可用」空态；规范写了，但没说图片组件在 src 为空时是否显示破图。
- 同一 ID 多节点共享：disposeUnreferenced 按存活节点集合回收
  （packages/canvas-data/src/resourceService.ts:375-389），共享不会误删。
  但「删一个节点就 revoke」的写法会误删；文档已要求只由宿主统一清理
  （docs/design/node-data-and-upstream-contract.md:122）。
- 删除节点后的回收：宿主在 flushSave 只扫 data.resourceId
  （packages/canvas-render/src/host/CanvasHost.vue:1334-1352）。
  文档目标字段表里还有 frameResourceId / leftResourceId / rightResourceId
  （docs/插件开发规范.md:72、:75），这些资源不会被收集，flush 时会被误回收。
  这是现存 bug，不是只存 ID 才出现；改契约时一并修。
- 后台半与前端半：云端资源路由依赖画布 id，后台 MCP 写节点时也要用同一套
  resourceId 规则；否则后台写 URL、前端写 id，两边格式打架（待验证，见
  packages/cloud-server/src/mcp/canvasDoc.ts:238-247）。
- 云/本地切换：首次上云依赖切换前抓住本地 adapter
  （packages/plugins/plugin-cloud-client/src/plugin.ts:210-217），
  并把本地 id 换成云端 URL（同文件 :149-176）。改成逻辑 ID 后要换成
  「本地 id → 云端 id」显式映射，不能靠「值长得像」猜。
- 导出 PNG 需要地址：导出走 DOM 截图 toDataURL
  （packages/plugins/plugin-canvas-export/src/canvasExportPlugin.ts:621-629），
  不直接读 data 地址；渲染层显示了图就不受影响。
  但「导出时图片还没 resolve 完」会截到空白，文档应要求导出前等待媒体就绪。
- 撤销/重做：resourceId 与地址在同一条 updateNode 里写，撤销一起退
  （packages/plugins/plugin-node-video/src/__tests__/videoOps.test.ts:190-197）。
  改成「只写 ID」后撤销仍是一步；若先写 ID、后异步补地址，会多一条历史，
  文档要提醒合并成一次事务。

## 三、必须修正的文档点

1. docs/插件开发规范.md:42-45（§1.4）把「节点只存 resourceId」「不写回 data」
   写成已成立的事实。改成「目标形态；本地已满足，云端仍以 URL 作引用；
   现行载入流程会写回 data，见 resourceService.ts:172-198」。
2. docs/插件开发规范.md:61（§2.2）与 docs/design/node-data-and-upstream-contract.md:53-54
   把 externalUrlField 与「只存 ID」并列。要明确 xxxUrl 只允许「没有资源实体的外部地址」，
   必须声明、不参与回收，新写入默认不产生。
3. docs/插件开发规范.md:67-79（§2.3 媒体表）的 3d-preview / image-compare 字段
   与现行源码不一致：对比节点读的是上游 imageUrl，自己并没有 leftResourceId/rightResourceId
   （packages/plugins/plugin-node-image-compare/src/imageCompareEngine.ts:35-63）。
   表头已写「目标形态」，但备注仍容易被当成现状；建议加一列「现行字段」。
4. docs/插件开发规范.md:107-112（§3.1）示例写 media.addNode(kind, { resourceId }, position)，
   提案签名是 addNode(kind, id, position)
   （docs/design/plugin-contracts-proposal.md:40）。两处必须统一。
5. docs/design/plugin-contracts-proposal.md:33-48 的 MediaCapability 缺 ref/derived
   与「尺寸/元数据」参数；补上后，「覆盖上传/截图/缩略图」才有依据。
6. docs/design/plugin-contracts-proposal.md:53-54 说「云端把 ID 映射到受控资源路由」，
   但没写逻辑 id 的形态、能否从 id 推出画布与文件名。
   结合 canvasStore.copyInto 的 URL 替换，必须写明「id 是画布作用域的，复制要重映射」。
7. docs/design/node-data-and-upstream-contract.md:114-117 与 :126-130 写「只写 ID、
   不写回 data」，与 restoreNodeMediaUrls 相反。要么改文档，要么改函数。
   另外该文件有两个「### 6.2」（:119 与 :126），小节号重复，需合并。
8. docs/design/node-data-and-upstream-contract.md:123 说剪贴板载荷带 resourceId 而不是临时地址，
   但 makeSnapshot 会深拷贝整份 data（clipboardEngine.ts:252-269）。这句要改成
   「目标：剥离 URL 字段」，或先改实现。
9. docs/design/node-data-and-upstream-contract.md:50-56 的 DataPortDef 同时有 refField
   与 externalUrlField，但没说谁优先。建议写「有 resourceId 时忽略外部地址」。
10. packages/docs/services/resources.md:31-32 说 ResourcePutOptions 只有 kind/name，
    实际还有 ref/derived（packages/canvas-data/src/storage/types.ts:69-94），需更正。

## 四、最小可行实现顺序

1. 先定 id 形态（只改文档与类型注释）：resourceId 统一为不透明字符串，
   禁止 http(s): / blob: / data: 当 id；云端建议取 <canvasId>/<hashName>
   或带前缀的 <hashName>，保证能从 id 拼路由。
   isResourceRef 现在只认 res- 前缀（packages/plugins/plugin-node-image/src/imageRun.ts:56-58），
   要换成「不是 URL 即引用」，否则云端逻辑 id 会被当成外链。
2. 改云端 adapter：putResource 回逻辑 id；resolveResource 接受
   「逻辑 id / 旧同源 URL / 旧 res-」三种，旧 URL 原样返回，逻辑 id 拼路由并做存在性检查。
   测试补三种输入。
3. 改恢复流程：restoreNodeMediaUrls 不再写 data，改成返回 Map<nodeId, url>
   或写进非持久化渲染视图；CanvasHost 与 plugin-cloud-client 两处调用一起改，
   同时把 kind 推导从「video/image 二选一」改成按节点类型表。
4. 改节点组件：ImageContent、VideoContent、AudioContent 从 props.data.resourceId
   取 id、异步 resolve 到本地 ref；imageUrl 等字段降级为兼容输入。
   组件卸载时丢弃本地地址，不 revoke（宿主统一回收）。
5. 改写入方：imageOps、videoOps、audioOps、plugin-file-drop 只写 resourceId
   与尺寸等元数据，删除 imageUrl: persisted.url 这类双写
   （packages/plugins/plugin-node-image/src/imageOps.ts:260、
   packages/plugins/plugin-node-video/src/videoOps.ts:279、:473-476）。
   剪贴板复制时剥掉 URL 字段（clipboardEngine.ts:252-269）。
6. 改 media 契约：补 put 的 ref/derived、补 applyToNode 的元数据参数，
   再让截图/文件拖入/资产导入改用 media。
7. 改云端迁移与复制：migrateLocalResources 改成「本地 id → 云端 id」映射并同时写
   resourceId；canvasStore.copyInto 改成按 id 重映射，不再做 URL 字符串替换。
8. 最后清兼容：旧 xxxUrl 只读一个版本，加弃用注释；sanitizeTransientResourceUrls
   保留为「清理历史遗留」，不再承担日常路径。

## 五、必须补的测试

- ResourceStore.put 的返回值在本地/云端都不含 ://、不以 blob:/data: 开头。
- resolve 对「逻辑 id / 旧同源 URL / 旧 res-…」三种输入都正确；认不出的返回 undefined。
- 载入画布后 nodeStore 的 data 里没有 imageUrl/videoUrl/audioUrl（新写入数据）。
- 旧存档（只有 URL、或 URL + resourceId）载入后仍能显示，且保存一次后只剩 resourceId。
- 旧存档里 audio/panorama 的 resourceId 恢复时 kind 正确（现在只会得到 image/video）。
- 复制画布后，副本节点的 resourceId 指向副本画布的资源；删除原画布不影响副本。
- 多节点共享同一 resourceId 时，删其中一个不回收；全部删掉后 flush 才回收。
- frameResourceId / leftResourceId / rightResourceId 参与存活扫描
  （补 CanvasHost.flushSave 的测试）。
- 剪贴板复制后的载荷不含 blob:/data: 地址，跨页粘贴仍按 id 显示。
- derived 资源（缩略图/帧图）在 disposeUnreferenced 后仍存活，且不写进节点 resourceId。
- 云端 put 指定 ref 与自动 id 两条路径都能 resolve，HEAD 失败返回 undefined。

## 六、风险

- 最大风险是「文档先行、代码没改」：规范已写成「只存 ID」，真实代码双写。
  有人照规范删掉 imageUrl 写入，云端恢复会立刻出问题（它依赖 URL 原样返回）。
- 云端 id 设计不当会让复制画布裂图：copyInto 靠 URL 替换，逻辑 id 必须带画布作用域。
- 恢复流程改动面大：restoreNodeMediaUrls 同时被本地宿主与云插件调用，
  改签名要一起改两处调用与它们的测试。
- 组件异步 resolve 会带来「先空后亮」：需保留旧地址作首帧兜底，
  否则大量节点会闪一下；文档应允许「会话内首帧用旧地址、随后被 resolve 覆盖」。
- 后台 MCP 也要遵守同一套 id 规则，否则前后端写出的资源格式不一致（待验证）。

