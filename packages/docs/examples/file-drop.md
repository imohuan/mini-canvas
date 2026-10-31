# 案例 8 · 监听浏览器事件（effect 式）

## 这个案例能做到什么

**装上这个插件，把一张图片拖到画布上，落点处就长出一张图片卡片**；按 Ctrl+V 粘贴截图，同样直接变成节点。

装上后你会看到：从桌面拖一个 .png/.jpg 文件进浏览器窗口，鼠标松开的位置出现图片节点；截屏后按 Ctrl+V，图片节点出现在你最近点过画布的位置附近。文件本体进了画布的资源库（刷新不丢），而不是一个临时链接。

本案例真正教的是 **`ctx.effect`**：插件「碰浏览器」的唯一姿势。把事件监听包进 effect，插件卸载时监听自动拆除 —— 不会留下幽灵监听。仓库的 file-drop 插件（拖入 + 粘贴全功能版）就是这条模式的放大版。

## 完整代码

```
my-drop-image/
├── package.json          # 插件身份证
└── src/dropImagePlugin.ts  # 监听 window 的拖放事件，落点建图片节点
```

```json
// 文件：my-drop-image/package.json
{
  "name": "@my/drop-image",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "拖图建卡",
    "description": "把图片文件拖进画布，落点处建图片节点",
    "pluginName": "drop-image",
    "installable": true
  },
  "main": "./src/dropImagePlugin.ts",
  "types": "./src/dropImagePlugin.ts",
  "exports": {
    ".": { "types": "./src/dropImagePlugin.ts", "default": "./src/dropImagePlugin.ts" },
    "./*": "./src/*"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*"
  }
}
```

```ts
// 文件：my-drop-image/src/dropImagePlugin.ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'drop-image'

/**
 * ① 硬依赖 doc（建节点的门）；view 不进 inject —— 它是渲染层服务，
 *    纯数据宿主（无头测试、后台）没有它。缺 view 时退化为「按原样建节点」，
 *    插件照常工作，所以用 tryGet 软探测。
 */
export const inject = ['doc'] as string[]

/** 拖进来的必须真的是图片，别的文件一律忽略。 */
function isImage(file: File | undefined | null): boolean {
  return Boolean(file && file.type.startsWith('image/'))
}

export function apply(ctx: Context): void {
  // ② 建节点的两个前提：
  //    - image 类型已注册（node-image 插件在场）。没有它，建出来的节点画布不认识。
  //    - 能拿到 doc。两个都是运行时探测，缺哪个就走「忽略」路线，不崩。
  function canBuild(): boolean {
    return ctx.tryGet('doc')?.types.has('image') ?? false
  }

  /** 屏幕坐标（鼠标在窗口里的位置）→ 画布坐标（节点用的 x/y）。 */
  function toFlow(x: number, y: number): { x: number; y: number } {
    // ③ view 服务的 screenToFlow 负责把「屏幕位置」换算成「画布上的位置」——
    //    画布平移/缩放之后，同一屏幕点对应的画布坐标完全不同，必须换算。
    const vp = ctx.tryGet('view')
    return vp ? vp.screenToFlow(x, y) : { x, y }
  }

  /** 存文件本体，返回持久引用。没有资源服务时返回 null（节点退化为临时链接）。 */
  async function putResource(file: File): Promise<string | null> {
    const resources = ctx.tryGet('resources')
    if (!resources) return null
    // ④ resources.put 把字节写进资源库（本地 IndexedDB / 云端画布文件夹，看宿主配置），
    //    返回「持久引用」；把引用写进节点 data.resourceId，刷新和云同步都认它。
    return await resources.put(file, { kind: 'image', name: file.name })
  }

  /** 一批文件按 24px 斜排展开，避免全叠在一个点。 */
  function spread(position: { x: number; y: number }, index: number) {
    return { x: position.x + index * 24, y: position.y + index * 24 }
  }

  /** 核心动作：把一批文件在指定画布坐标落成图片节点。返回建了几个。 */
  async function dropFiles(files: File[], at: { x: number; y: number }): Promise<number> {
    const doc = ctx.tryGet('doc')
    if (!doc || !canBuild()) return 0
    const picked = files.filter(isImage)
    if (picked.length === 0) return 0

    // ⑤ 一次事务 = 一条撤销记录。多个文件一起拖进来，Ctrl+Z 一次全撤。
    return await doc.transaction('drop-image-add', async (tx) => {
      let created = 0
      for (let i = 0; i < picked.length; i += 1) {
        const file = picked[i]
        const resourceId = await putResource(file)       // ⑥ 本体进资源库，拿持久引用
        // 节点只写 resourceId；显示地址由图片组件在渲染时现取（不写回 data）
        const data: Record<string, unknown> = { imageName: file.name }
        if (resourceId) data.resourceId = resourceId
        tx.createNode('image', spread(at, i), data)
        created += 1
      }
      return created
    })
  }

  // ⑦ 浏览器事件全部包进 ctx.effect：回调返回「清理函数」，
  //    插件卸载时内核自动执行清理 —— 监听器不拆就会变成幽灵监听。
  ctx.effect(() => {
    if (typeof window === 'undefined') return            // 无头环境（node 测试）没有 window，跳过

    // 粘贴锚点：记住用户最近一次在画布上按鼠标的位置（屏幕坐标）。
    let lastClient: { x: number; y: number } | null = null

    // ⑧ dragover 必须 preventDefault：不拦的话浏览器会打开文件，而不是让 drop 发生。
    function onDragOver(e: DragEvent): void {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    async function onDrop(e: DragEvent): Promise<void> {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      if (!canBuild()) return
      e.preventDefault()          // 挡住浏览器默认行为（直接打开图片）
      e.stopPropagation()         // 别让别的监听重复处理同一次拖放
      const at = toFlow(e.clientX, e.clientY)
      await dropFiles(Array.from(files), at)
    }

    // ⑨ 粘贴：截图/复制的图片在 clipboardData.items 里，形如 File。
    async function onPaste(e: ClipboardEvent): Promise<void> {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      const images: File[] = []
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) images.push(blob)
        }
      }
      if (images.length === 0) return      // 粘的是文字等 → 不归本插件管，不 preventDefault
      e.preventDefault()
      // ⑩ 粘贴没有鼠标坐标，用「最近一次点画布的位置」当锚点；实在没有就画布中心附近。
      const anchor = lastClient ? toFlow(lastClient.x, lastClient.y) : { x: 200, y: 200 }
      await dropFiles(images, anchor)
    }

    function onPointerMove(e: PointerEvent): void {
      const el = e.target as HTMLElement | null
      // 只在画布上移动才记坐标；正在输入框里打字不记（那些位置粘贴不该建节点）。
      if (!el || !el.closest('.vue-flow')) return
      lastClient = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    // ⑪ 清理函数：与添加严格一一对应。卸载时内核会调它。
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('pointermove', onPointerMove)
    }
  })
}
```

## 每一步在干什么

**② 类型探测（`doc.types.has('image')`）**：file-drop 自己不注册任何节点类型 —— 它只负责「把文件变成节点」，节点长什么样是 node-image 插件的事。所以建之前先问一句「image 类型在场吗」。这条解耦让两个插件可以各装各的：没装 node-image 时拖文件安静忽略（控制台提示），装上后立即生效，谁也不用改代码。

**③ 坐标换算（`view.screenToFlow`）**：事件给的是**屏幕坐标**（相对窗口），节点存的是**画布坐标**（世界系）。用户把画布缩小后拖文件，鼠标的屏幕位置和落点差得很远，不换算的话节点会出现在「错位」的地方。view 是渲染层服务，纯数据环境没有它 —— 所以这里用 `tryGet` 而不是 `inject`，拿不到时退回原样坐标（无头环境本来也不真的拖文件）。

**④ 资源登记（`resources.put`）**：`URL.createObjectURL` 生成的地址只在本次会话有效，刷新就变成死链接。`resources.put(file, …)` 把文件字节存进资源库（本地进 IndexedDB，云端上传到画布文件夹），返回持久引用；写进 `data.resourceId` 后，删除节点时资源库能按引用回收、云端画布能带着文件同步。节点数据长期只认这一个 ID；显示地址由内容组件按当前环境现取，刷新后照样能重建。

**⑤ 事务包一批**：一次 drop 十个文件 = 一条历史记录。用户后悔时 Ctrl+Z 一次全撤，而不是连按十次。事务回调允许是异步的（真实插件在事务里等读图尺寸、上传资源），doc 会等它跑完再提交。

### 真实插件多做的一步：读出图片真实宽高，卡片按比例长

上面示例建出来的图片节点是默认尺寸。真实插件在建节点前先用 `new Image()` 把图读一遍，拿到真实宽高再按画布卡片宽度适配 —— 拖一张竖图进来不会变成一张横卡。对应源码（`fileDropPlugin.ts` 的 `readImageDims` + `fileDropEngine.ts` 的 `buildImagePayload`，简化后照抄可用）：

```ts
// 文件：my-drop-image/src/dropImagePlugin.ts（追加）
/** 读图片真实宽高；失败返回 null（调用方退默认尺寸），绝不猜一个数字。 */
function readImageDims(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)          // 用完就还，别攒着临时地址
    }
    img.onerror = () => {
      resolve(null)                     // 解码失败不是错误路径，只是「不知道尺寸」
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

/** 真实宽高 → 卡片尺寸：宽最多 360px，等比缩放（与真实插件的适配规则一致）。 */
function fitImageSize(dims: { width: number; height: number }): { w: number; h: number } {
  const scale = Math.min(1, 360 / dims.width)
  return { w: Math.round(dims.width * scale), h: Math.round(dims.height * scale) }
}
```

然后在 `dropFiles` 里：`const dims = await readImageDims(file)`，`tx.createNode('image', pos, data)` 后面跟上尺寸 —— 用 doc 的尺寸写口（`ctx.nodes.setSize(id, w, h)`）把宽高写进去，它进历史并自动刷新卡片镜像。真实插件走的是另一条等价路：批量建节点时给每条载荷带 `size` 字段（`tx.addNodes` 直接消费），卡片尺寸只有一个正身 —— `size`，`data.cardWidth/cardHeight` 由 nodeStore 自动镜像，插件不手写。宽高也顺手写进 `data.imageWidth / imageHeight`，别的插件（比如裁剪、对比）可以直接读。

**⑦ effect 是监听器的「保险柜」**：`ctx.effect(setup)` 立刻执行 setup，把返回的清理函数登记进本插件的 scope。插件卸载 → 内核逐个调清理函数。不包 effect 直接 `window.addEventListener`，卸载后监听还活着：删掉的插件还在偷偷建节点，这种 bug 只在「卸载后」出现，极难排查。**所有 window/document 监听都必须走 effect** —— 这是仓库插件写监听的固定姿势。

**⑧ dragover 的 preventDefault**：浏览器规矩 —— 有 dragover 默认行为在，drop 事件根本不会发生（文件会被浏览器直接打开）。所以 dragover 里必须 `preventDefault()` 并给个 `dropEffect`。这也是真实插件把 dragover/drop 成对监听的原因。

**⑨ 粘贴事件**：剪贴板内容在 `e.clipboardData.items`，截图、复制的图片文件都是 `kind === 'file'` 的条目，`getAsFile()` 拿到 File 后走同一条 `dropFiles` 路径。只处理图片：粘纯文本时不 `preventDefault`，让别的插件（比如文本节点）接手。

**对可编辑输入框让路**：真实插件在每个事件开头先查目标元素 —— 用户正在输入框里选字/打字时，粘贴和拖放是「编辑器的日常操作」，必须让浏览器自己处理（把文字粘进输入框），画布绝不能截胡。判断写法是 `target.closest('input, textarea, select, [contenteditable="true"]')`，命中就 return。

**⑩ 粘贴锚点**：paste 事件没有可靠坐标（Ctrl+V 时鼠标一般在别处）。真实插件的做法是「pointermove 一直记最近一次画布内的鼠标位置，粘贴时用它换算画布坐标」；没有任何记录时退到默认位置。小细节，但决定了「粘贴出现在哪」的体验。

**⑪ 添加与清理一一对应**：加了四个监听，清理函数里就删同样的四个。多删无妨、少删漏 —— 写的时候对照着写，卸载就干净。

**撤回也安全（resourceId 与撤销栈）**：图片节点删掉后，资源库不会立刻撕掉文件 —— 它按「还有没有节点引用这个 resourceId」延迟回收。所以用户删了又 Ctrl+Z，图还在；真没有引用了才真正清掉。真实插件在文件头把这条写成语义承诺：resourceId 是长期的，撤销恢复节点不会破图。

**建完顺手选中**：真实插件批量建完节点会调用选中服务 —— `selection.set(ids)` 选中这批新节点、`selection.clearEdges()` 清掉旧的边选中。这样用户立刻能拖走/删除刚拖进来的节点，不用再点一下。`selection` 与 `doc` 同属数据层基础服务，要选中就把它加进 `inject`。

**id 也从内核要**：真实插件建节点前先用 `doc.nextNodeId()` 取号（先拿号才能选中/连边），id 统一是「1、2、3」这种短数字 —— 插件不自造 `fd-时间戳-序号` 这种花式 id。多个文件时按位置展开的间距也是内核约定（24px 斜排），避免全叠在一个点上。

## 仓库里的真实出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| ctx.effect 包 window 监听 + 返回清理函数 | `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts`（apply 内三段 effect） | dragover/drop/paste/pointermove 四组监听，每组 effect 返回对应的 removeEventListener |
| 建节点前探测类型（`doc.types.has(...)`） | 同上 `typeRegistered(type)` | `this.doc.types.has(type)`，缺类型时跳过该类文件并 console.warn |
| screenToFlow 坐标换算 + 无 view 退级 | 同上 `toFlow(client)` | `ctx.tryGet('view')` 拿不到返回 null，调用方退默认位置 |
| resources.put 登记资源 + data.resourceId | 同上 `addFiles` 内 | `resources.put(file, { kind: 'image', name })` → `payload.data.resourceId = resourceId` |
| 资源引用 + 显示字段的迁移期形态 | 同上 + `fileDropEngine.ts` 的 `buildImagePayload` | 载荷仍带一份显示地址（旧字段），同时写 `resourceId`；长期字段以 `resourceId` 为准 |
| 事务批量建节点 + 选中新节点 | 同上 `commitPayloads` | `doc.transaction('file-drop-add', tx => tx.addNodes(…))`，建完 `selection.set(ids)` |
| 粘贴锚点（记最近鼠标位置） | 同上 `trackClientPoint` + `onPointerMove` | 只在 `.vue-flow` 内记坐标；粘贴时 `flowAnchor()` 换算，没有则 `{x:200,y:200}` |
| 浏览器环境守卫 | 同上各 effect 开头 | `if (typeof window === 'undefined') return`，node 测试/无头宿主安全跳过 |

## 常见坑

1. **监听不包 effect**。插件卸载后监听还在：画布上「删掉的插件」继续建节点、继续弹警告。所有 window/document 监听一律 `ctx.effect(() => { … ; return 清理函数 })`，让卸载自动拆干净。
2. **忘写 dragover 的 preventDefault**。表现为「拖文件进窗口，浏览器直接把图打开了，drop 一次没触发」。必须监听 dragover 并 preventDefault（真实插件成对写 dragover + drop 就是这个原因）。
3. **把屏幕坐标直接当画布坐标**。画布一旦平移/缩放，节点就落在鼠标点的「远房亲戚」位置。落点必须经 `view.screenToFlow` 换算；view 拿不到时再退默认值，别跳过换算。
4. **只用 objectURL、不登记资源**。图片当场能看，刷新后全是死链。正确做法：`resources.put` 拿持久引用写进 `data.resourceId` —— 资源库负责「长期不丢」和「删节点后回收」；显示地址在渲染时现取。
5. **拖进不可处理的文件时抢默认行为**。只有确认「这批文件我能建节点」才 `preventDefault`；不能处理时别拦 —— 用户可能就是想把文件拖到浏览器的下载栏/书签栏。真实插件在 drop 回调里先查 `files` 与类型注册情况，全部命中才阻止默认行为。
