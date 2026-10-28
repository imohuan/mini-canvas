/**
 * capabilities —— 挂在插件 ctx 上的"能力段"收口（画布能力层，对齐 docs/goal/plugin-system-goal.md 2.1b）。
 *
 * 归属：`src/canvas`（画布能力层）。原先住在 `src/core/capabilities.ts`，但它产出的
 * `ctx.nodes / theme / commands / tools` 全是画布概念（节点/连线/命令/外部工具），
 * 与"插件框架不认识画布"的边界冲突，故实现迁到本层；旧路径留一行转发垫片。
 *
 * 目的：把散装注册函数(registerNodeType/registerThemeSlot/ctx.get('command')/…)收口成
 * 作者一眼能用的 `ctx.nodes / ctx.theme / ctx.commands / ctx.slots`，注册一律自动回收
 * （revoke 经当前插件 scope 的 effect 登记，插件卸载/热卸即清，作者不手写 unregister）。
 *
 * 依赖方向：canvas → core（只借通用 SlotRegistry/SettingsStore 容器与 PluginScope 类型）；
 * 零 Vue。组件句柄 opaque；节点数据/展示走 nodeStore/nodeRegistry(宿主已注入服务)，
 * 通用 UI 槽(slots)走 ctx 自带的 SlotRegistry 服务('slots')，宿主按需渲染。
 */
import type { PluginScope, Registry, SlotRegistry, SettingsStore, Disposable } from '@mini-canvas/kernel'
import { registerNodeType } from './registry/registerNodeType'
import type { ThemeSlot } from './registry/themeRegistry'
import type { NodeSegment } from './registry/nodeRegistry'
import type { NodeTypeDef } from './registry/registerNodeType'
import type { NodeStoreService } from '../nodeStore'
import type { NodeFactoryService, NodeCreator } from './nodeFactory'
import type { CommandDef } from '@mini-canvas/kernel'
import type { NodeRegion, NodeRegionAttachment } from './region'

import { assertRegion, RETIRED_CONTENT_FIELD } from './region'

/**
 * ctx.nodes.register 一次给全的定义（数据 + 展示 + 可选建节点实现）。
 *
 * **字段单一来源**：数据/展示字段（type/label/segments/inputs/outputs/icon/resizable/frameless）
 * 直接继承 NodeTypeDef，本接口只补"作者侧命名(size)"与"建节点实现"。
 * 这样加字段只需改 NodeTypeDef 一处，不会出现"两份清单漂移、漏透传"的老问题。
 */
export interface NodeRegisterDef extends Omit<NodeTypeDef, 'defaultSize'> {
  /** 尺寸（数据侧叫 defaultSize；作者侧沿用 size，与既有 API 兼容） */
  size: { w: number; h: number }
  /**
   * 内容组件（opaque）—— 最常见；落 `in` 区域（卡片内部，可叠多层）。
   *
   * 字段名就是区域词：段名进键之后，作者侧不给"另一套名字的段"留活口
   * （步骤 9：老词 `content` 已是类型错误，改用它会让"哪个位置"再次分不清）。
   */
  in?: unknown
  /** 标题位组件（opaque）；区域词 `title` 与老字段同名 */
  title?: unknown
  // （其余展示字段继承自 NodeTypeDef：segments/inputs/outputs/icon/resizable/frameless）
  /** 可选：提供"建一个该 type 节点"的实现（挂 nodeFactory，自动回收） */
  create?: NodeCreator
}

/** ctx.theme.register 的可选 occupant 信息 */
export interface ThemeOccupantOpts {
  /** occupant id（默认=当前插件名 → 同插件重装替换该格） */
  id?: string
  /** order：单格换肤点里 order 最小者获胜（默认 0，后装可给更小 order 顶替） */
  order?: number
}

/** ctx.slots.register 的 occupant 请求 */
export interface SlotRegisterReq {
  id?: string
  order?: number
  /** 排在该条目 id 之前（条目 id = owner/name，例如 host/agent；不是槽名） */
  before?: string
  /** 排在该条目 id 之后（条目 id = owner/name） */
  after?: string
  component: unknown
  /** 可选 occupant 元数据（如设置面板内容槽的 mode: replace/append/prepend）；随 occupant 存入并读回 */
  meta?: unknown
}

/** ctx.settings.define 的单项 schema（与内核 SettingSchema 对齐；作者不必 import kernel 类型） */
export type SettingDefineItem = Parameters<SettingsStore['define']>['1'][string]

/** ctx.settings.define 的一次申报：group + 各项 schema */
export interface SettingGroupDefSugar {
  group: string
  items: Record<string, SettingDefineItem>
}

/** ctx.settings.define 的允许形状：分组式或 (group, items) 平铺式 */
export type SettingDefineArgs =
  | [defs: Record<string, SettingDefineItem>]
  | [group: string, items: Record<string, SettingDefineItem>]

/** ctx.nodes.attach 的请求（§8.3）：region 是十个区域词之一；needs/props 是条目自己的数据 */
export interface NodeAttachReq {
  region: NodeRegion
  id?: string
  order?: number
  component: unknown
  needs?: string[]
  props?: Record<string, unknown>
}

/**
 * ctx.selectionRegion.attach 的请求：多选框（选择集）的区域条目。
 *
 * 与 NodeAttachReq 的**唯一差别是没有 type** —— 多选框不是某一种节点，它就是"当前选中的一批"。
 * 其余字段（region/id/order/component/needs/props）逐字同形：作者在节点上怎么写，在多选框上就怎么写。
 *
 * 场键 = 区域词本身（不像节点那样是 `type/region`）：多选框没有类型那一维。
 */
export interface SelectionAttachReq {
  region: NodeRegion
  id?: string
  order?: number
  component: unknown
  needs?: string[]
  props?: Record<string, unknown>
}


/**
 * 能力段收口。给定一个插件 scope ctx（含 get/effect），返回 ctx 上挂的 nodes/theme/commands/slots。
 */
export function buildCapabilities(
  ctx: PluginScope,
  pluginName: string,
): {
  nodes: {
    register(def: NodeRegisterDef): void
    /** 改某节点标题（label）。空串/undefined/全空白 → 清掉（显示回类型名）。 */
    setLabel(id: string, label: string | undefined): void
    /** 把某节点移到绝对坐标（同父坐标系） */
    move(id: string, position: { x: number; y: number }): void
    /** 设/清某节点的父（组归属）；undefined = 解除父 */
    setParent(id: string, parentId: string | undefined): void
    /** 删某节点（连带清相连边、子节点父引用、选中）；返回是否删到 */
    remove(id: string): boolean
    /**
     * 改某节点的尺寸（宽高，px）—— 节点尺寸的一等入口，走唯一写入口（进历史 + 落盘），
     * 并自动刷新卡片镜像（作者不用管 size 与 data.cardWidth 的分工）。
     *
     * @returns 是否写入成功；宽高非正有限数 → false 且不写。
     */
    setSize(id: string, w: number, h: number): boolean
    /**
     * 往某 type 的某区域叠一个 occupant（多插件同区域叠加；内容/装饰层/徽标等）。
     * 自动回收：插件卸载时该 occupant 移除，基座与其它贡献原位保留。
     * @param segment 区域词（十个之一，见 canvas/region.ts）；老段名是类型错误，运行时也抛错
     * @returns occupant id
     */
    contribute(
      type: string,
      segment: NodeSegment,
      component: unknown,
      opts?: { id?: string; order?: number },
    ): string
    /**
     * 往某节点类型的某区域挂一个组件（§8.3 一等 API；十个区域词见 canvas/region.ts）。
     * 落 node/region 场，键 = `${type}/${region}`；type 传 '*' = 通配所有节点类型。
     * 自动回收：随所属插件 scope 卸载自动摘除。
     * @returns Disposable（dispose 手动撤销；不接返回值即"纯声明+自动回收"）
     */
    attach(type: string | '*', req: NodeAttachReq): Disposable
  }
  theme: {
    register(slot: ThemeSlot, component: unknown, opts?: ThemeOccupantOpts): void
    add(slot: ThemeSlot, component: unknown, opts?: ThemeOccupantOpts): void
    remove(slot: ThemeSlot, id: string): void
  }
  commands: {
    register(def: CommandDef): { dispose(): void }
    has(id: string): boolean
  }
  /**
   * 往"多选框（选择集）"的某区域挂组件（与 nodes.attach 同形，只是宿主换成选择集）。
   * 落 selection/region 场，键 = 区域词；自动回收。
   */
  selectionRegion: {
    attach(req: SelectionAttachReq): Disposable
  }
  slots: {
    register(slot: string, req: SlotRegisterReq): string
    remove(slot: string, id: string): boolean
    occupants(slot: string): Array<{ id: string; order: number; component: unknown; meta?: unknown }>
  }
  settings: {
    define(...args: SettingDefineArgs): void
    set(key: string, value: string | number | boolean): boolean
    get(key: string): string | number | boolean
    onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void }
    groups(): string[]
  }
} {
  const theme = () => {
    try {
      return ctx.get<{
        addOccupant(s: string, r: { id?: string; order?: number; value: unknown }): string
        removeOccupant(s: string, id: string): boolean
        occupantIds(s: string): string[]
      }>('themeRegistry')
    } catch {
      return undefined
    }
  }
  const uiSlots = () => {
    try {
      return ctx.get<SlotRegistry>('slots')
    } catch {
      return undefined
    }
  }
  const settingsStore = () => ctx.get<SettingsStore>('settings')

  // 场取用：ctx.registryOf(kind) 拿到的即"糖的落点场"（§8.2）；放一条 = 同 id 替换，
  // 订阅随本插件 scope 自动回收（bind 视图的 keep 语义）。取不到 registryOf 的宿主
  // （非 Context 的最小 PluginScope mock）退化为不落场，行为与今天"缺服务不抛"一致。
  const land = <T>(kind: string): Registry<T> | undefined => {
    const fn = (ctx as { registryOf?: (kind: string) => Registry<T> }).registryOf
    return typeof fn === 'function' ? fn.call(ctx, kind) : undefined
  }

  // 取 nodeRegistry（缺服务不抛，纯数据 ctx 不装它）：contribute 的基座判断要用
  const nodeRegistry = (): { get(t: string): { segments?: Partial<Record<NodeSegment, unknown>> } | undefined } | undefined => {
    try {
      return ctx.get<{ get(t: string): { segments?: Partial<Record<NodeSegment, unknown>> } | undefined }>('nodeRegistry')
    } catch {
      return undefined
    }
  }

  /**
   * ctx.theme.register / add 共享的落位逻辑：一次写入**两处**，两处语义逐字一致。
   *
   * 为什么必须写两处：ThemeRegistry 是渲染层取"当前赢家"的容器，registryOf('theme') 是自省/
   * 诊断与统一注册场的落点。过去 add 只写容器、remove 只删容器 → 场里读到的内容与真实生效的
   * 内容不一致（T01）。两处 entry 的 id/order 必须同源，否则"谁赢了"会随读取入口变化。
   *
   * 回收：容器那次用 ctx.effect 显式登记；场那次经 land() 拿到的插件视图，其 add 已随本插件
   * fiber 自动回收（RegistryImpl.bind 的 keep 语义），不重复登记。
   */
  const placeTheme = (
    slot: ThemeSlot,
    component: unknown,
    opts: ThemeOccupantOpts = {},
  ): void => {
    const id = opts.id ?? pluginName
    const reg = theme()
    if (reg) {
      reg.addOccupant(slot, { id, order: opts.order, value: component })
      ctx.effect(() => () => reg.removeOccupant(slot, id))
    }
    land<unknown>('theme')?.add(slot, component, { id, order: opts.order })
  }

  return {
    // ---------- ctx.nodes：注册一个节点类型（数据+展示+可选建节点），自动回收 ----------
    nodes: {
      setLabel(id: string, label: string | undefined): void {
        ctx.get<{ setNodeLabel(id: string, label: string | undefined): void }>('doc').setNodeLabel(id, label)
      },
      move(id: string, position: { x: number; y: number }): void {
        ctx.get<{ moveNode(id: string, position: { x: number; y: number }): void }>('doc').moveNode(id, position)
      },
      setParent(id: string, parentId: string | undefined): void {
        ctx.get<{ setNodeParent(id: string, parentId: string | undefined): void }>('doc').setNodeParent(id, parentId)
      },
      remove(id: string): boolean {
        return ctx.get<{ removeNodes(ids: string[]): number }>('doc').removeNodes([id]) > 0
      },
      setSize(id: string, w: number, h: number): boolean {
        // 薄糖：与 ctx.get('doc').setNodeSize 同一实现（尺寸只有一个写口，不新增第二条路）
        return ctx.get<{ setNodeSize(id: string, w: number, h: number): boolean }>('doc').setNodeSize(id, w, h)
      },
      register(def: NodeRegisterDef): void {
        // 步骤 9 运行时兜底：作者侧老字段 content 已改名为区域词 in。
        // 类型上它已被拦住；JS 调用方或漏网代码传进来时不能**静默丢掉组件**
        // （那会表现为"注册成功了却什么都不显示"），要当场报同一条错。
        if ((def as unknown as Record<string, unknown>)[RETIRED_CONTENT_FIELD] !== undefined) {
          assertRegion(RETIRED_CONTENT_FIELD)
        }
        // ⓪ 场落点（§8.2）：node/type/<type>（声明摘要）。
        // 糖保留 void 返回；既有 nodeStore/nodeRegistry 行为原样不动。
        const typeField = land<{ type: string; label: string }>('node/type')
        typeField?.add(def.type, { type: def.type, label: def.label })
        // 段名一律是区域词（步骤 9）：作者侧的 content 字段已改名为区域词 in。
        const segRecord: Partial<Record<NodeSegment, unknown>> = def.in || def.title
          ? { in: def.in, title: def.title, ...(def.segments ?? {}) }
          : (def.segments ?? {})
        // ⚠️ 此前这里还往 `node/shell/<type>` 写了一份 `{ type, segments }` 的"展示定义摘要"。
        // 那是**错的**：§4.5 把 `node/shell` 定义为"值 = 壳组件（BaseNode 等）、消费者 = 节点壳装配"，
        // 而这份摘要是普通对象、不是组件，且**全仓无任何读取端**。壳的装配端（assembleTheme）
        // 现已按 §4.5 读这张场，若继续写摘要，它会被当成组件交给 VueFlow 渲染 → 整图崩。
        // 摘要在 `nodeRegistry` 与 `node/region` 里已有等价物，故直接删除该写入。
        // ① 数据 + 展示(经 registerNodeType，内部已 ctx.effect 回收)
        const revoke = registerNodeType(ctx, {
          type: def.type,
          label: def.label,
          defaultSize: def.size,
          nameTemplate: def.nameTemplate,
          icon: def.icon,
          titleExtra: def.titleExtra,
          titleExtraSlot: def.titleExtraSlot,
          description: def.description,
          inputs: def.inputs,
          outputs: def.outputs,
          resizable: def.resizable,
          frameless: def.frameless,
          transparent: def.transparent,
          loadingDefaultSize: def.loadingDefaultSize,
          produces: def.produces,
          consumes: def.consumes,
          segments: segRecord,
        })
        // ② 可选建节点实现 → nodeFactory.register + effect 回收
        if (def.create) {
          land<NodeCreator>('node/creator')?.add(def.type, def.create)
          const factory = ctx.get<NodeFactoryService>('nodeFactory')
          factory.register(def.type, def.create)
          ctx.effect(() => () => {
            factory.unregister(def.type)
            revoke()
          })
        } else {
          ctx.effect(() => revoke)
        }
      },
      contribute(
        type: string,
        segment: NodeSegment,
        component: unknown,
        opts: { id?: string; order?: number } = {},
      ): string {
        // 步骤 9 运行时兜底：老段名不静默、不错位落场，当场抛清晰错误。
        assertRegion(segment)
        // 场落点（§8.2）：node/region/<type>/<seg>。
        //
        // order 只解析**一次**，两处用同一个值（T01）：过去场里自行计算、还把显式 opts.order
        // 整个忽略掉，NodeRegistry 又按自己那套算 → 同一次注册在两处排序不同，作者声明的顺序
        // 到不了界面。缺省语义沿用既有约定：首条排在基座之后(1)，其后 = 已有最大 + 1。
        const regionField = land<unknown>('node/region')
        let order = opts.order
        if (regionField) {
          const regionKey = `${type}/${segment}`
          if (order === undefined) {
            const existing = regionField.list(regionKey)
            if (existing.length === 0) {
              // 基座判断用 nodeRegistry 展示定义（与 NodeRegistry.registerContribution 的
              // "首条排在基座之后"语义对齐：基座 content → order 1 起）
              const baseSeg = nodeRegistry()?.get(type)?.segments?.[segment]
              order = baseSeg !== undefined ? 1 : 0
            } else {
              order = Math.max(...existing.map((e) => e.order)) + 1
            }
          }
          regionField.add(regionKey, component, { id: opts.id, order })
        }
        // 场缺席（最小 ctx）时 order 保持 opts.order（可为 undefined），由 NodeRegistry 按自己
        // 的缺省规则解析 —— 与改动前一致。
        const registry = ctx.get<{
          registerContribution(
            t: string,
            seg: NodeSegment,
            req: { id?: string; order?: number; component: unknown },
          ): string
          unregisterContribution(t: string, seg: NodeSegment, id: string): boolean
        }>('nodeRegistry')
        const id = registry.registerContribution(type, segment, {
          id: opts.id,
          order,
          component,
        })
        ctx.effect(() => () => registry.unregisterContribution(type, segment, id))
        return id
      },
      attach(type: string | '*', req: NodeAttachReq): Disposable {
        // 场落点（§8.3）：node/region/<type>/<region>，位置进键不进值；
        // needs/props 进 value（条目自己的数据）。region 只收十个区域词（步骤 9：不做归一）。
        const region = assertRegion(String(req.region))
        const regionField = land<NodeRegionAttachment>('node/region')
        const value: NodeRegionAttachment = {
          component: req.component,
          needs: req.needs,
          props: req.props,
        }
        // 缺省 id = 当前插件名（§8.3：同插件重装即替换该格），而不是场的自动 id
        const placed = regionField?.add(`${type}/${region}`, value, {
          id: req.id ?? pluginName,
          order: req.order,
        })
        if (placed) ctx.effect(() => () => placed.dispose())
        return {
          dispose: () => placed?.dispose(),
        }
      },
    },

    // ---------- ctx.selectionRegion：往"多选框（选择集）"的某区域挂组件，自动回收 ----------
    // 与 ctx.nodes.attach 同一套语义（区域词、值形状、缺省 id、自动回收），
    // 差别只有一处：**没有 type**（多选框不是某一种节点），故场键就是区域词本身。
    // 消费者是 SelectionFrame（多选插件的群组框），它按区域词读出条目渲染到框外。
    selectionRegion: {
      attach(req: SelectionAttachReq): Disposable {
        const region = assertRegion(String(req.region))
        const regionField = land<NodeRegionAttachment>('selection/region')
        const value: NodeRegionAttachment = {
          component: req.component,
          needs: req.needs,
          props: req.props,
        }
        const placed = regionField?.add(region, value, {
          id: req.id ?? pluginName,
          order: req.order,
        })
        if (placed) ctx.effect(() => () => placed.dispose())
        return {
          dispose: () => placed?.dispose(),
        }
      },
    },

    // ---------- ctx.theme：往主题槽叠/取 occupant，自动回收 ----------
    theme: {
      register(slot: ThemeSlot, component: unknown, opts: ThemeOccupantOpts = {}): void {
        // 行为语义 = main 的"register = 放 id=调用方的 occupant，同 id 顶替、不同 id 叠加"
        //（严格审查 H3：步骤 2 曾把同 id 重复 register 改成抛错，属未申报的行为变化，本笔回退）。
        placeTheme(slot, component, opts)
      },
      add(slot: ThemeSlot, component: unknown, opts: ThemeOccupantOpts = {}): void {
        // add 与 register 走同一条落位逻辑：两处的 id/order/回收完全一致（T01）。
        // 差别只在调用方语义（add 用于运行期叠加/换皮，register 用于插件装载期声明）。
        placeTheme(slot, component, opts)
      },
      remove(slot: ThemeSlot, id: string): void {
        // 两处同时移除，否则场里会留下一条"已经撤掉的主题"（T01）。
        theme()?.removeOccupant(slot, id)
        land<unknown>('theme')?.remove(slot, id)
      },
    },

    // ---------- ctx.commands：注册命令，自动回收 ----------
    commands: {
      register(def: CommandDef): { dispose(): void } {
        // 场落点（§8.2）：command/<id>。糖保留"重复 id 抛错"：同 kind 各插件共享一张场表，
        // 先放的插件留下的条目在场里可见；先查场再走 CommandRegistry 抛错路径，值 = { def }。
        // 返回句柄语义：register 今天返回 void；这里返回 handle（有 .dispose() 的 Disposable），
        // 对想手动 dispose 的调用方可用；既有调用方不接返回值，行为不变。
        const commandField = land<{ def: CommandDef }>('command')
        if (commandField?.has(def.id)) {
          throw new Error(`[command] command "${def.id}" already registered`)
        }
        try {
          const cmd = ctx.get<{ register(d: CommandDef): { dispose(): void }; has(id: string): boolean }>('command')
          const handle = cmd.register(def)
          const placed = commandField?.add(def.id, { def })
          ctx.effect(() => () => {
            handle.dispose()
            placed?.dispose()
          })
          return {
            dispose: () => {
              handle.dispose()
              placed?.dispose()
            },
          }
        } catch (err) {
          // CommandRegistry 重复 id 抛错 → 场里也不能留这条（同一次失败的注册不落半截）
          commandField?.remove(def.id, def.id)
          throw err
        }
      },
      has(id: string): boolean {
        try {
          return ctx.get<{ has(id: string): boolean }>('command').has(id)
        } catch {
          return false
        }
      },
    },

    // ---------- ctx.slots：往通用 UI 槽叠 occupant（'slots' 服务由 ctx 自带），自动回收 ----------
    slots: {
      register(slot: string, req: SlotRegisterReq): string {
        const reg = uiSlots()
        // 场落点（§8.2）：slot/<slot>。返回 id（string）的既有契约不变；
        // 缺 'slots' 服务的宿主今天返回 ''，现仍能在场里落位（id 同形生成）。
        const slotField = land<unknown>('slot')
        if (!reg && !slotField) return ''
        const id = req.id ?? `slot/${slot}#${slotField?.ids(slot).length ?? 0}`
        if (slotField) slotField.add(slot, req.component, {
          id,
          order: req.order,
          ...(req.before !== undefined ? { before: req.before } : {}),
          ...(req.after !== undefined ? { after: req.after } : {}),
        })
        if (!reg) return id
        const compatId = reg.add(slot, {
          id: req.id,
          order: req.order,
          value: req.component,
          meta: req.meta,
          ...(req.before !== undefined ? { before: req.before } : {}),
          ...(req.after !== undefined ? { after: req.after } : {}),
        })
        if (compatId !== id) {
          // 兼容容器对自动 id 的取舍与场不同 → 场内条目对齐到兼容 id（返回值单一事实）
          slotField?.remove(slot, id)
          slotField?.add(slot, req.component, {
            id: compatId,
            order: req.order,
            ...(req.before !== undefined ? { before: req.before } : {}),
            ...(req.after !== undefined ? { after: req.after } : {}),
          })
        }
        ctx.effect(() => () => reg.remove(slot, compatId))
        ctx.effect(() => () => slotField?.remove(slot, compatId))
        return id
      },
      remove(slot: string, id: string): boolean {
        return uiSlots()?.remove(slot, id) ?? false
      },
      occupants(slot: string) {
        return (uiSlots()?.ordered(slot) ?? []).map((e) => ({
          id: e.id,
          order: e.order,
          ...(e.before !== undefined ? { before: e.before } : {}),
          ...(e.after !== undefined ? { after: e.after } : {}),
          component: e.value,
          meta: e.meta,
        }))
      },
    },

    // ---------- ctx.settings：已装配 config 的读 + 订阅（声明改由插件 Config schema 自动完成，无 define 入口） ----------
    settings: {
      define(...args: SettingDefineArgs): void {
        // 声明糖（§8.2 settings 落点 = setting 场）：两组件共享的"申报"路径。
        // store 仍是值的单一数据源；场里落 { group, schema, current } 摘要，store 值变化时刷新。
        const store = settingsStore()
        if (!store) return
        const isGrouped = typeof args[0] === 'string'
        const group = isGrouped ? (args[0] as string) : (args[1] as string | undefined)
        const items = (isGrouped ? args[1] : args[0]) as Record<string, SettingDefineItem>
        const scopeGroup = group ?? pluginName
        store.define(scopeGroup, items, pluginName)
        const settingField = land<{
          group: string
          schema: SettingDefineItem
          current: string | number | boolean
        }>('setting')
        for (const [key, schema] of Object.entries(items)) {
          settingField?.add(key, { group: scopeGroup, schema, current: store.get(key) })
        }
      },
      set(key: string, value: string | number | boolean): boolean {
        const store = settingsStore()
        const changed = store.set(key, value)
        // 场里的 current 摘要跟随 store 值（该 key 若在场里）；
        // 场里没有这条摘要时按缺省 group 顺手补齐（store 值变化 = 有人在用这条配置）。
        const settingField = land<{
          group: string
          schema: SettingDefineItem
          current: string | number | boolean
        }>('setting')
        const entry = settingField?.get(key, key)?.value
        if (settingField && entry) {
          settingField.add(key, { ...entry, current: store.get(key) }, { id: key })
        }
        return changed
      },
      get(key: string): string | number | boolean {
        return settingsStore().get(key)
      },
      onChange(scope: string, cb: (key: string, value: unknown) => void): { dispose(): void } {
        return settingsStore().onChange(cb, { scope })
      },
      groups(): string[] {
        return settingsStore().groups()
      },
    },
  }
}
