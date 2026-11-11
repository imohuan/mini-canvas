import { nextTick } from 'vue'
import { SAMPLE_IMAGE_URL } from '../../assembly'
import { importPack, isNodePackFile, resolvePackBase, VERSION_SEP } from '../nodePack'
import { uniqueLabel } from '../nodeLabel'
import { assetKindOf } from '../assetModel'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { AssetScope } from './useAssetScope'
import type { ViewportLike, ViewportScope } from './useViewportControls'
import type { FullHost, HostApi } from './types'

/**
 * 建节点与资产落画布：建节点、拖资产、拖文件、节点包导入、文件夹批量添加。
 *
 * 选中/聚焦的差异（拖拽只选中、菜单添加才取景）逐行保留，避免回退「拖拽后画布乱跳」。
 */
export function createCreateNodeScope(
  state: UiState,
  host: UiHostScope,
  assets: AssetScope,
  viewport: ViewportScope,
) {
  const { hostCtx, canvasHost, canvasCtx, showToast, hostEl } = host
  const { assetItems } = assets
  const { viewportSvc } = viewport

  function createNode(type: 'text' | 'image' | 'video'): void {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    if (!host?.command) {
      // 兜底：从 window key 拿（与 e2e 同源）
      const w = window as unknown as { MiniCanvasUI?: { getHost(): FullHost } }
      const fallback = w.MiniCanvasUI?.getHost()
      if (fallback) { fallback.command.execute('command:create-node', buildPayload(type, fallback)); return }
      return
    }
    host.command.execute('command:create-node', buildPayload(type, host))
  }
  function buildPayload(type: 'text' | 'image' | 'video', host: HostApi): { type: string; position: { x: number; y: number }; imageUrl?: string } {
    const count = host.nodeStore?.getNodes().length ?? 0
    const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = {
      type,
      position: { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 },
    }
    if (type === 'image') payload.imageUrl = SAMPLE_IMAGE_URL
    return payload
  }
  /** 一份资产在画布上对应的节点类型：image / video / audio；不支持的类型 → null */
  function nodeTypeOfAsset(asset: { kind?: string; assetKind?: string }): 'image' | 'video' | 'audio' | null {
    const kind = assetKindOf(asset)
    return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
  }

  /** 建节点时的落点：优先用调用方给的 flow 坐标（拖拽落点），否则按已有节点数级联错开 */
  function spawnPosition(atFlow?: { x: number; y: number }): { x: number; y: number } {
    if (atFlow && Number.isFinite(atFlow.x) && Number.isFinite(atFlow.y)) {
      // 拖拽落点 = 指针位置：把节点左上角回退半个身位，视觉上"落在指针处"而不是"指针在左上角"
      return { x: Math.round(atFlow.x - 24), y: Math.round(atFlow.y - 24) }
    }
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    const count = host?.nodeStore?.getNodes().length ?? 0
    return { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 }
  }

  /** 只选中（不动视口）：拖拽落点已在用户眼前，再挪视口等于画布自己乱动 */
  function selectNewNode(newId: unknown): void {
    if (typeof newId !== 'string' || !newId) return
    hostCtx()?.get<{ set(ids: Iterable<string>): void }>('selection')?.set([newId])
  }

  /** 建完选中 + 聚焦（等价按 F）；宿主没就绪或没返回 id 时静默跳过 */
  function focusNewNode(newId: unknown): void {
    if (typeof newId !== 'string' || !newId) return
    const ctx = hostCtx()
    const selection = ctx?.get<{ set(ids: Iterable<string>): void }>('selection')
    selection?.set([newId])
    // 聚焦放在 nextTick：节点刚建出来，等一帧让渲染层拿到它的位置/尺寸再算 bounds。
    void nextTick(() => ctx?.get<{ runCommand(id: string): unknown }>('canvas')?.runCommand('auto-layout:focus-selected'))
  }

  /**
   * 画布上**现在已有的全部显示名**（判重用的那口锅）。
   *
   * 为什么读 nodeStore 而不是别处：它是"画布上现在有什么"的唯一真源，
   * 而重名要防的正是"与画布上已有的撞"。
   * 宿主没就绪 / 拿不到 → 空数组（此时谈不上撞名，照原样建）。
   */
  function existingLabels(): string[] {
    const nodes = canvasHost()?.nodeStore?.getNodes() ?? []
    const out: string[] = []
    for (const raw of nodes) {
      const label = (raw as { data?: { label?: unknown } } | null)?.data?.label
      if (typeof label === 'string' && label.trim()) out.push(label.trim())
    }
    return out
  }

  /**
   * 给**建进来的节点**定一个不撞的名字（用户 2026-10-14 报的「拖出来的节点名称没有自动追加」）。
   *
   * 为什么需要它：画布上「新建节点」的名字走数据层按类型计数（图片 1 / 图片 2…），不会撞；
   * 而**从资产库拖节点包进来**、以及**来自包里那份 label**，是"收藏时那一刻的名字"原样再建一次 ——
   * 拖两次同一个包就得到两个同名节点（左侧树 / 画面里分不清谁是谁）。
   *
   * want 为空 = 包本身就没名字 → 交回数据层按类型模板补（那里才是"图片 1"的出处，不在这重复一份）。
   */
  function dedupeNodeLabel(want: unknown): string | undefined {
    if (typeof want !== 'string' || !want.trim()) return undefined
    return uniqueLabel(want, existingLabels())
  }

  /**
   * 指定类型与地址建节点（资产「添加到画布」/ 拖拽落画布共用）。
   *
   * 为什么分类型走**插件自己的服务**而不是一条命令：image 有 command:create-node 的 extra 通道，
   * video / audio 的初始地址通道在各自插件的服务上（addVideoNode / addAudioNode）——
   * 那是各类型唯一的写入口，从这里进才不会绕过撤销栈/落盘/默认尺寸（与按钮同一条路）。
   * atFlow 给了就用它当落点（拖拽），没给就级联错开（菜单"添加到画布"）。
   */
  async function createAssetNode(
    asset: { name?: string; url: string; kind?: string; assetKind?: string },
    atFlow?: { x: number; y: number },
  ): Promise<string | null> {
    // ★ 节点包（.mcnode）走导入那条路，不是"建一个媒体节点"。
    //   为什么要在这里认：从**资源库**拖一个包到画布，与从**文件系统**拖一个包，
    //   对用户来说是同一个动作（用户 2026-10-13 口径："拖拽之后和直接从文件夹中拖拽进来的效果是一样的"），
    //   所以两条路必须落到同一件事：写脚本 + 还原节点。
    if (assetKindOf(asset) === 'node-package') {
      // ★ 落点必须一路传下去（与图片/视频那条路一致）。
      //   漏了它的后果有两个，都是用户实测报的：
      //     ① 位置不对 —— atFlow 为空 → spawnPosition 走「按已有节点数级联错开」，
      //        包不会落在指针处；
      //     ② 出现「聚焦效果」—— importPackFromUrl 里 atFlow 为空会走 focusNewNode
      //        （= 按 F 聚焦选中，会缩放平移视口），而拖拽那条本该只 selectNewNode。
      void importPackFromUrl(asset.url, asset.name, atFlow)
      return null
    }
    const type = nodeTypeOfAsset(asset)
    if (!type) {
      showToast('暂不支持把「' + assetKindOf(asset) + '」类型的资产添加到画布')
      return null
    }
    const target = canvasHost()
    const ctx = hostCtx()
    const position = spawnPosition(atFlow)
    let newId: unknown
    if (type === 'image') {
      if (!target?.command) return null
      newId = target.command.execute('command:create-node', {
        type: 'image',
        position,
        imageUrl: asset.url,
        ...(asset.name ? { name: asset.name } : {}),
      })
    } else {
      // video / audio：走插件服务（服务名与节点类型同名；插件没装 → undefined → 明确反馈）
      const svc = ctx?.get<{
        addVideoNode?: (p: { x: number; y: number }, url?: string) => string
        addVideoNodeWithMeta?: (p: { x: number; y: number }, url: string, name?: string) => Promise<string>
        addAudioNode?: (p: { x: number; y: number }, url?: string) => string
      }>(type)
      if (type === 'video' && svc?.addVideoNodeWithMeta) newId = await svc.addVideoNodeWithMeta(position, asset.url, asset.name)
      else if (type === 'video' && svc?.addVideoNode) newId = svc.addVideoNode(position, asset.url)
      else if (type === 'audio' && svc?.addAudioNode) newId = svc.addAudioNode(position, asset.url)
      else {
        showToast('「' + type + '」节点插件未启用，无法添加')
        return null
      }
    }
    /**
     * 选中新节点**总是要做**（用户一眼看到"加进来了"），但**取景只在不拖拽时做**：
     *   用户口径（2026-10-07）：「从左侧面板拖拽到画布添加节点时，希望不要对画布进行任何缩放和平移操作，
     *   直接添加上去就行」—— 拖拽的落点就是用户当前正看着的地方，再把视口挪走属于"画布自己乱动"。
     *   菜单「添加到画布」那条路（atFlow 为空）节点可能落在视口外，所以照旧取景。
     */
    if (atFlow) selectNewNode(newId)
    else focusNewNode(newId)
    return typeof newId === 'string' ? newId : null
  }

  /**
   * 指定图片地址建图片节点（资产「添加到画布」用；复用 command:create-node 的 payload 形状）。
   *
   * 建完**选中它并聚焦**（等价于按 F）—— 用户口径：「节点添加到画布之后，自动聚焦就是快捷键 F」。
   * 不这么做的话，新节点可能落在当前视口外，用户看不到"加进去了"（以为没生效）。
   */
  function createImageNodeWithUrl(imageUrl: string, name?: string): void {
    void createAssetNode({ url: imageUrl, ...(name ? { name } : {}) }, undefined)
  }

  /**
   * 屏幕坐标 → flow 坐标（拖拽落画布时把指针位置换算成节点位置）。
   * viewport 服务缺失（宿主未就绪）→ null，调用方退级联默认落点。
   */
  function screenToFlow(clientX: number, clientY: number): { x: number; y: number } | null {
    const vp = hostCtx()?.get<{ screenToFlow?(x: number, y: number): { x: number; y: number } }>('view')
    if (!vp?.screenToFlow) return null
    try {
      return vp.screenToFlow(clientX, clientY)
    } catch {
      return null
    }
  }

  /**
   * 视口中心（flow 坐标）—— 「没有指针落点」那一类入口的默认落点。
   *
   * 为什么不用鼠标位置：点菜单/点上传这类入口触发时，用户多半在盯底栏，
   * 用鼠标位置会把节点甩到上次路过的角落；中心一定看得见。
   * 与 addMediaFilesToCanvas 里那段同一条口径（媒体文件拖进来也走它）。
   */
  function viewportCenterFlow(): { x: number; y: number } | null {
    const vp = hostCtx()?.get<
      { getPaneEl?(): HTMLElement | null; screenToFlow?(x: number, y: number): { x: number; y: number } }
    >('view')
    const pane = vp?.getPaneEl?.()
    if (!pane || !vp?.screenToFlow) return null
    const r = pane.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) return null
    try {
      return vp.screenToFlow(r.left + r.width / 2, r.top + r.height / 2)
    } catch {
      return null
    }
  }

  // ===== 资产「服务动作」：把资产接到画布 / Agent =====
  // 为什么收进 ui 层当**服务**（用户口径：「我觉得你应该把这个功能做成一个服务」）：
  // 左侧抽屉、资产管理弹窗、将来的右键菜单/搜索面板都要干同一件事，散在各组件里必然走样。
  // 这里只做「取到目标（ctx 服务 / 画布命令）→ 调一次」，UI 组件退化成调用点。

  /**
   * 数据集：把一份资产建到画布上。
   *
   * 类型一律经 assetKindOf 取 —— 列表行给的是 assetKind、AssetItem 给的是 kind，
   * 之前直接读 asset.kind：列表行传进来时是 undefined，于是**静默走了「不支持」分支、什么也没建**
   * （用户报的「添加到画布没有效果」）。
   */
  function addAssetToCanvas(asset: { name: string; url: string; kind?: string; assetKind?: string }): void {
    void createAssetNode(asset, undefined)
  }

  /**
   * 把一份资产**拖到画布**上：在落点（屏幕坐标）建对应类型的节点。
   * 拖拽的落点即指针位置 —— 用户口径：「资源里的图片、音频和视频等，可以直接拖拽到画布上，
   * 拖拽上去就是直接添加一个新的节点」。
   */
  function dropAssetToCanvas(
    asset: { name?: string; url: string; kind?: string; assetKind?: string },
    client: { x: number; y: number },
  ): Promise<string | null> {
    const flow = screenToFlow(client.x, client.y) ?? undefined
    return createAssetNode(asset, flow)
  }

  /** file-drop 服务的最小用面（契约见 plugin-file-drop 的 FileDropService） */
  type FileDropLike = {
    addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
    canHandle(file: { name: string; type: string }): boolean
  }
  /**
   * 本地上传的文件**直接落画布**（底栏「+ → 上传」用）。
   *
   * 用户口径（2026-10-11）：「点击『上传』时，它是直接把你选中的东西放置在画布中」——
   * 就是「把文件拖进画布」那件事，所以不自己另写一套建节点，而是把文件交给
   * file-drop 插件的 addFiles（同一份识别 / 尺寸 / 资源落盘 / 选中逻辑）。
   *   · 图片 → image 节点（带真实比例）、视频 → video 节点、文本 → text 节点；
   *   · 多文件在锚点处依次排开，一次历史提交，建完选中。
   *
   * 落点：**视口中心**（而不是"最近一次鼠标位置"）—— 这条入口是点菜单触发的，
   * 用户这时多半在盯着底栏，用鼠标位置会把节点甩到上次路过的角落；中心一定看得见。
   * 视口服务拿不到（宿主没就绪）就传 null，交给 addFiles 用它的默认锚点。
   *
   * 插件没装（拿不到 file-drop 服务）→ 明确提示，不静默什么都不做。
   */
  async function addFilesToCanvas(files: File[]): Promise<number> {
    const list = files.filter((f) => f.size > 0)
    if (!list.length) return 0

    // ★ 节点包（.mcnode）单独走一条：它不是媒体文件，而是"一个节点 + 它的脚本"。
    //   为什么要在这里分流：拖进来的动作是同一个（拖到画布），但落点完全不同 ——
    //   媒体文件是"建一个媒体节点"，包是"写脚本 + 还原节点"。
    //   先挑出来落地，剩下的交给 file-drop（用户可能一次拖了包 + 图片）。
    const packs = list.filter((f) => isNodePackFile(f.name))
    const restFiles = list.filter((f) => !isNodePackFile(f.name))
    // 节点包与媒体文件落到同一处：没有指针落点时用**视口中心**（与 addMediaFilesToCanvas 一致）
    const packAnchor = viewportCenterFlow() ?? undefined
    for (const p of packs) await importPackFile(p, packAnchor)
    if (restFiles.length === 0) return packs.length
    return (await addMediaFilesToCanvas(restFiles)) + packs.length
  }

  /**
   * 把一个 .mcnode 交给后台落地（写脚本 + 还原节点），然后**在前端建出那个节点**。
   *
   * 为什么建节点这一步在前端：只有前端知道往哪张画布、落在哪个位置、建完选中谁。
   * 后台只负责"把脚本写下去、把节点数据算好"（它算不了视口）。
   */
  async function importPackFile(file: File, atFlow?: { x: number; y: number }): Promise<boolean> {
    const target = canvasHost()
    const ctx = hostCtx()
    if (!target?.command || !ctx) return false
    try {
      const base = await resolvePackBase()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await importPack({ base, bytes })
      // 与「媒体文件拖进画布」同一条口径（见 addMediaFilesToCanvas）：
      //   落点 = 指针位置（没给就用视口中心）；建完**只选中**、不取景。
      //   原先这里是 spawnPosition(undefined) + focusNewNode —— 于是同一个「往画布拖东西」
      //   的动作，图片/视频只是多一个节点，节点包却会让画布自己缩放平移（用户报的「聚焦效果」）。
      const anchor = atFlow ?? viewportCenterFlow() ?? undefined
      // 名字要跟着画布上的现状去重（否则拖两次同一个包 = 两个同名节点，左侧树里分不清）
      const uniqueName = dedupeNodeLabel((result.node.data as { label?: unknown }).label)
      const id = target.command.execute('command:create-node', {
        type: result.node.type,
        position: spawnPosition(anchor),
        ...result.node.data,
        ...(uniqueName !== undefined ? { label: uniqueName } : {}),
      })
      if (typeof id === 'string') selectNewNode(id)
      // 升版本了要说一声：用户得知道"这是 v2、原来那个没动"
      showToast(
        result.action === 'bump'
          ? '已导入（本机有同名脚本，整套升到 ' + VERSION_SEP + result.version + '）'
          : '已导入：' + result.title,
      )
      return true
    } catch (err) {
      showToast('导入失败：' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  /**
   * 从**资产库里的地址**导入一个包（拖抽屉里那一项到画布）。
   *
   * 与 importPackFile 的区别只有"字节从哪来"：那边是本地文件，这边要先取回来。
   * 其余（交给后台落地 → 前端建节点 → 提示升版本）完全一样 —— 用户口径：
   * 「拖拽之后，和直接从文件夹中拖拽进来的效果是一样的」。
   */
  async function importPackFromUrl(
    url: string,
    name?: string,
    atFlow?: { x: number; y: number },
  ): Promise<boolean> {
    const target = canvasHost()
    if (!target?.command) return false
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('取包失败（HTTP ' + res.status + '）')
      const bytes = new Uint8Array(await res.arrayBuffer())
      const base = await resolvePackBase()
      const result = await importPack({ base, bytes })
      // 与 importPackFile 同一条口径：名字跟着画布上已有的去重（拖两次同一个包会重名）
      const uniqueName = dedupeNodeLabel((result.node.data as { label?: unknown }).label)
      const id = target.command.execute('command:create-node', {
        type: result.node.type,
        // 右键菜单那条路会给落点（用户在哪儿右键就放哪儿）；资产库拖拽那条没有，走默认位置
        position: spawnPosition(atFlow),
        ...result.node.data,
        ...(uniqueName !== undefined ? { label: uniqueName } : {}),
      })
      if (typeof id === 'string') {
        if (atFlow) selectNewNode(id)
        else focusNewNode(id)
      }
      showToast(
        result.action === 'bump'
          ? '已从资源库导入（本机有同名脚本，整套升到 ' + VERSION_SEP + result.version + '）'
          : '已从资源库导入：' + (name || result.title),
      )
      return true
    } catch (err) {
      showToast('导入失败：' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  /** 媒体文件那条老路（原 addFilesToCanvas 的实现，原样搬过来） */
  async function addMediaFilesToCanvas(list: File[]): Promise<number> {
    const svc = hostCtx()?.get<FileDropLike>('file-drop')
    if (!svc?.addFiles) {
      showToast('文件拖放插件未启用，无法把文件加到画布')
      return 0
    }
    // 视口中心（client 坐标）→ flow：pane 矩形的一半即屏幕中心；两者都拿不到就 null
    const vp = hostCtx()?.get<ViewportLike & { getPaneEl?(): HTMLElement | null; screenToFlow?(x: number, y: number): { x: number; y: number } }>('view')
    let atFlow: { x: number; y: number } | null = null
    const pane = vp?.getPaneEl?.()
    if (pane && vp?.screenToFlow) {
      const r = pane.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) atFlow = vp.screenToFlow(r.left + r.width / 2, r.top + r.height / 2)
    }
    // canHandle 不认的文件（比如占了多个的其它类型）：先挑出来明确说一句，剩下的照建
    const handled = list.filter((f) => svc.canHandle(f))
    const skipped = list.length - handled.length
    const made = handled.length ? await svc.addFiles(handled, atFlow) : 0
    if (skipped > 0 && made === 0) showToast('这些文件类型暂不支持放到画布')
    return made
  }

  /**
   * 文件夹「添加到 Agent」：把**文件夹路径**作为一条引用发给 Agent（不是把里面的资产一张张贴）。
   *
   * 用户口径（2026-10-07）：「将文件夹添加到 Agent：直接把文件夹的地址发过去就行」。
   * 文件夹在后端只是登记表里的一条记录（没有本机目录），它的"地址"= 里面资产的公共目录
   * （取第一条有 path 的资产所在目录）。标签显示文件夹名，载荷是这条路径 —— Agent 侧自己 ls。
   */
  function addFolderToAgent(folder: { id: string; name: string }): void {
    const agent = canvasCtx()?.get<{ referenceAsset?: (a: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }) => void }>('agent')
    if (!agent?.referenceAsset) return
    const first = assetItems.value.find((a) => a.folderId === folder.id && a.path)
    const dir = first?.path ? first.path.replace(/[\\/][^\\/]+$/, '') : undefined
    // folderId 一定要带（用户口径 2026-10-08）：Agent 里点这颗文件夹标签时要能打开
    // 资产管理并展开到那一层 —— 只有 dir 没地方定位。
    // isFolder：显式标出「这是目录」（目录名带点号时不会被误判成文件）。
    agent.referenceAsset({ id: folder.id, name: folder.name, url: '', ...(dir ? { path: dir } : {}), folderId: folder.id, isFolder: true })
  }

  /**
   * 文件夹「添加到画布」：把文件夹里的**全部内容**按类型建到画布上（图片/视频/音频各走各的节点服务）。
   *
   * 用户口径（2026-10-07）：「将文件夹添加到画布：把文件夹中的所有内容全部添加到画布中。
   * 如果数量超过 10 个，需要弹出一个对话框让我点击确认，不然一下添加太多会卡死」。
   *
   * 数量 > 上限时**先弹确认**（确认回调由宿主给 —— 弹窗长什么样是 UI 的事，这里只问"允不允许"）；
   * 用户不点确认就一个都不建。返回实际建出的数量；空文件夹返回 0。
   */
  async function addFolderAssetsToCanvas(
    folderId: string,
    opts: { confirm?: (count: number) => Promise<boolean> } = {},
  ): Promise<number> {
    const items = assetItems.value.filter((a) => a.folderId === folderId)
    if (!items.length) return 0
    if (items.length > 10 && opts.confirm) {
      const ok = await opts.confirm(items.length)
      if (!ok) return 0
    }
    let created = 0
    const newIds: string[] = []
    for (const a of items) {
      const kind = assetKindOf(a)
      if (kind === 'image') {
        // 图片：createAssetNode 内部会"选中/聚焦"单个节点 —— 这里传 atFlow 会走"只选中"分支，
        // 但它选中会**覆盖**之前批量的选区。所以批量场景绕过它，直接走命令拿 id，收尾一次性多选。
        const target = canvasHost()
        if (!target?.command) continue
        const pos = { x: 80 + (created % 5) * 48, y: 80 + Math.floor(created / 5) * 60 }
        const newId = target.command.execute('command:create-node', {
          type: 'image',
          position: pos,
          imageUrl: a.url,
          ...(a.name ? { name: a.name } : {}),
        })
        if (typeof newId === 'string' && newId) { newIds.push(newId); created++ }
      } else if (kind === 'video' || kind === 'audio') {
        const svc = hostCtx()?.get<{ addVideoNode?: (p: { x: number; y: number }, url?: string) => string; addAudioNode?: (p: { x: number; y: number }, url?: string) => string }>(kind)
        const pos = { x: 80 + (created % 5) * 48, y: 80 + Math.floor(created / 5) * 60 }
        const newId = kind === 'video' ? svc?.addVideoNode?.(pos, a.url) : svc?.addAudioNode?.(pos, a.url)
        if (newId) { newIds.push(newId); created++ }
      }
      // other 类型跳过（没有对应节点实现），不算失败也不打断
    }
    // **一次性多选**全部新建的节点（用户口径：菜单添加的节点，添加之后自动选中）——
    // 若建一个选一个，最后选区只剩最后一个；这里批量建完统一 set，用户能直接拖动/删除这一批。
    if (newIds.length) hostCtx()?.get<{ set(ids: Iterable<string>): void }>('selection')?.set(newIds)
    return created
  }
  /**
   * 资产「添加到 Agent」。
   *
   * kind 必须一起传（用户 2026-11-11）：资产名可能是 UUID、没有扩展名，
   * 只靠扩展名认不出音频 —— 标签会退回图片图标。类型以资产列表里的那份为准。
   */
  function addAssetToAgent(asset: { name: string; url: string; path?: string; folderId?: string; kind?: string }): void {
    const agent = canvasCtx()?.get<{ referenceAsset?: (a: { name: string; url: string; path?: string; folderId?: string; kind?: string }) => void }>('agent')
    if (!agent?.referenceAsset) {
      showToast('Agent 插件未启用')
      return
    }
    agent.referenceAsset(asset)
  }
  return {
    createNode, nodeTypeOfAsset, spawnPosition, selectNewNode, focusNewNode, existingLabels, dedupeNodeLabel,
    createAssetNode, createImageNodeWithUrl, screenToFlow, viewportCenterFlow,
    addAssetToCanvas, dropAssetToCanvas, addFilesToCanvas, importPackFile, importPackFromUrl,
    addMediaFilesToCanvas, addFolderToAgent, addFolderAssetsToCanvas, addAssetToAgent,
  }
}

export type CreateNodeScope = ReturnType<typeof createCreateNodeScope>

