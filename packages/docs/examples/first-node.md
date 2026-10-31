# 案例 1 · 一个最小节点插件（text 式）

## 这个案例能做到什么

**装上这个插件，画布上就多出一种「便签」节点**：左边菜单的「新建节点」里出现它，双击卡片能写字，卡片可以接进别的节点的输入口，把便签上的文字喂给下游。

装上后你会看到：新建节点菜单多一项「便签」；拖出来是一张 300×200 的卡片，上面写着「双击编辑」；双击后直接在卡片上打字，点卡片外面（失焦）文字就保存了，画布刷新后还在；它的输出口能连给「吃文本」的输入口。

## 完整代码

插件一共三个文件：一张「身份证」（package.json）、一个「干活的插件文件」（ts）、一个「卡片长什么样的组件」（vue）。

```
my-note-plugin/
├── package.json        # 身份证：告诉画布这是个什么插件
├── src/NoteContent.vue # 卡片里面长什么样、怎么编辑
└── src/notePlugin.ts   # 插件本体：把节点类型注册进画布
```

```json
// 文件：my-note-plugin/package.json
{
  "name": "@my/note-plugin",            // 包名，随你起，不跟别人的包重名就行
  "version": "0.0.0",
  "private": true,
  "type": "module",                     // ① 我们全程用 import/export 写代码，必须标这个
  "miniCanvas": {                       // ② miniCanvas 段：画布的插件市场靠它认你
    "title": "便签节点",
    "description": "一张能写字的小卡片，输出 text",
    "pluginName": "note",               // 插件名（插件 ts 里 name 的一致），全画布唯一
    "installable": true
  },
  "main": "./src/notePlugin.ts",        // ③ 插件入口文件，画布装插件时读它
  "types": "./src/notePlugin.ts",
  "exports": {
    ".": { "types": "./src/notePlugin.ts", "default": "./src/notePlugin.ts" },
    "./*": "./src/*"
  },
  "dependencies": {                     // ④ 我们用到的仓库自己的包（内核的薄入口 + 数据层）
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*"
  },
  "peerDependencies": {
    "vue": "^3.5.34"                    // ⑤ content 组件是 Vue 组件，Vue 由宿主提供
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.6",
    "typescript": "~6.0.2",
    "vite": "^8.0.12",
    "vitest": "^3.0.0",
    "vue": "^3.5.34"
  }
}
```

```ts
// 文件：my-note-plugin/src/NoteContent.vue
<script setup lang="ts">
// NoteContent —— 「卡片里面」的那一层。画布外壳负责卡片边框、拖动、连接口；
// 这里只管卡片中间那块白纸：显示文字、双击打字、失焦保存。
import { ref, watch } from 'vue'
// useCanvasRender 是渲染层发的「对讲机」：拿到 ctx，才能叫到插件上架的服务。
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NoteService } from './notePlugin'

// ① props 由节点外壳自动塞进来：id = 这个节点的编号，data = 这个节点存的数据。
//    data 的类型按自己节点的字段写（我们只有 text 一个业务字段）。
const props = defineProps<{ id: string; data: { text?: string } }>()

// ② 拿到 ctx。注意：拿服务一律走 ctx.get('服务名')。
const { ctx } = useCanvasRender()

function noteService(): NoteService | undefined {
  // ctx.get 缺服务返回 undefined、不抛错 —— 组件里先判一下再用。
  return ctx?.get<NoteService>('note')
}

// ③ shown = 屏幕上显示的文字。开机时从 data 里读一次。
const shown = ref(typeof props.data.text === 'string' ? props.data.text : '')
const editing = ref(false)   // 现在是不是正在编辑
const draft = ref('')        // 编辑中的草稿
const inputEl = ref<HTMLTextAreaElement | null>(null)

// ④ 别人改了节点数据（撤销/重做、别的插件写回），屏幕要跟着变。
//    正在编辑时不覆盖，不然用户打的字会被冲掉。
watch(
  () => props.data.text,
  (next) => {
    if (editing.value) return
    shown.value = typeof next === 'string' ? next : ''
  },
)

function startEdit(): void {
  if (editing.value) return
  editing.value = true
  draft.value = shown.value
}

function commit(): void {
  if (!editing.value) return
  editing.value = false
  if (draft.value === shown.value) return
  shown.value = draft.value
  // ⑤ 改数据只经服务这一个门：改完自动进历史、自动落盘。组件自己永远不直接改 data。
  noteService()?.editNote(props.id, draft.value)
}

function cancelEdit(): void {
  editing.value = false
  draft.value = shown.value
}
</script>

<template>
  <div class="note">
    <textarea
      v-if="editing"
      ref="inputEl"
      v-model="draft"
      class="editor nodrag nopan nowheel"
      placeholder="写点什么…"
      @blur="commit"
      @keydown.esc="cancelEdit"
    ></textarea>
    <div v-else class="preview" title="双击编辑" @dblclick="startEdit">{{ shown || '（空）' }}</div>
  </div>
</template>

<style scoped>
.note {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 16px;
  overflow: hidden;
}
.preview {
  width: 100%;
  height: 100%;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow: hidden;
  cursor: text;
}
.editor {
  width: 100%;
  height: 100%;
  font: inherit;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  overflow-y: auto;
}
</style>
```

```ts
// 文件：my-note-plugin/src/notePlugin.ts
// 一个插件文件 = 导出 name / inject / apply 三样东西。宿主把整个包当参数装进去即可。
import { Service, type Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import NoteContent from './NoteContent.vue'

/** NoteService —— 这个插件对外提供的「能力包」：别的插件和组件都从这里调它。 */
export interface NoteService {
  /** 在指定坐标放一张便签，返回节点编号 */
  addNote(position: { x: number; y: number }): string
  /** 改某张便签的文字（进历史，可撤销） */
  editNote(id: string, text: string): void
}

/** ① 类型增强：让全画布都能用 ctx.note 直达本服务（写代码时会有提示）。 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    note: NoteService
  }
}

/**
 * ② Service 子类：new 的时候 super(ctx, 'note') 一句话，实例就以「note」这个名字
 *    上架成服务；插件卸载时它跟着自动消失，不用手写清理代码。
 */
export class NoteService extends Service implements NoteService {
  constructor(ctx: Context) {
    super(ctx, 'note')
  }

  /** 每次用的时候现取 doc 服务（不缓存）：插件随时可能被卸掉，缓存会拿到过期引用。 */
  private doc(): DocService {
    return this.ctx.get('doc')
  }

  addNote(position: { x: number; y: number }): string {
    // ③ 建节点用「事务」包住：一次动作 = 一条撤销记录，Ctrl+Z 一次就能整张撤掉。
    return this.doc().transaction('add-note', (tx) =>
      tx.createNode('note', position, { text: '双击编辑' }),
    )
  }

  editNote(id: string, text: string): void {
    this.doc().updateNode(id, { data: { text } })
  }
}

export const name = 'note'
/** ④ 硬依赖：doc 是所有节点插件的地基。缺了它内核让插件挂着等待，而不是带病启动。 */
export const inject = ['doc'] as string[]

/** 节点图标：一段 SVG 字符串（新建节点菜单和卡片标题都用它）。 */
const NOTE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/></svg>'

export function apply(ctx: Context): void {
  // ⑤ 上架服务（构造即上架）。
  const note = new NoteService(ctx)

  // ⑥ 注册节点类型：一次调用，同时登记「数据形状」「长什么样」「怎么新建」三件事。
  ctx.nodes.register({
    type: 'note',                       // 类型名，连接约束里引用它时写这个
    label: '便签',                       // 菜单和标题里显示的名字
    nameTemplate: '便签 {{ID}}',        // 新节点默认叫「便签 1」「便签 2」…
    description: '一张能写字的小卡片',
    icon: NOTE_ICON,
    size: { w: 300, h: 200 },           // 新建时的默认尺寸
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],   // 输入口只收文本
    outputs: [{ port: 'source', contentType: 'text' }],     // 输出口产出文本
    resizable: true,                    // 允许用户拖右下角改大小
    in: NoteContent,                    // 卡片内容组件（「in」= 卡片里面那一层）
    create(position) {                  // 「新建」按钮按下去时走这里
      return note.addNote(position)
    },
  })

  // ⑦ 顺手给画布加个命令，别的插件 / 快捷键也能建便签。
  ctx.commands.register({
    id: 'note.add',
    title: '新建便签',
    run: () => Boolean(note.addNote({ x: 120, y: 120 })),
  })
}
```

装插件只要一行：`ctx.plugin(notePlugin)`，或者把 `@my/note-plugin` 的默认导出加进宿主的插件列表。下面逐段拆开讲。

### 进阶 1 · 默认尺寸接设置面板（真实插件的做法）

真实文本插件把「默认宽高」做成了设置项：用户在设置面板拖滑块，**没有被手动改过尺寸的节点**立刻跟着变。做法是模块级 `Config` schema + `bindTypeDefaultSize` 一条绑定：

```ts
// 文件：my-note-plugin/src/notePlugin.ts（追加）
import { Service, bindTypeDefaultSize, type Context, type ConfigSchema } from '@mini-canvas/canvas-base'

export const Config: ConfigSchema = {
  // ① 键名带 note 前缀：设置面板是全局一张表，先声明者独占键名。
  noteDefaultWidth: {
    type: 'number', default: 300, min: 80, max: 2000, step: 10,
    label: '默认宽', group: '布局/便签节点尺寸',
    description: '没被手动拖过尺寸的便签节点会立刻跟着变。',
  },
  noteDefaultHeight: {
    type: 'number', default: 200, min: 80, max: 2000, step: 10,
    label: '默认高', group: '布局/便签节点尺寸',
  },
}

// apply(ctx) 里追加一条绑定：
export function apply(ctx: Context): void {
  // ……前面注册服务与节点类型的代码不变……

  // ② 「类型默认尺寸」的两个数值键分别绑到两个设置项上。
  //    改设置 → 内核收到 onChange → 没被 resize 过的节点实时换新默认尺寸。
  bindTypeDefaultSize(ctx, 'note', { w: 300, h: 200 }, { widthKey: 'noteDefaultWidth', heightKey: 'noteDefaultHeight' })
}
```

真实出处：`nodeTextPlugin.ts` 的 `Config`（`textDefaultWidth/Height`）与 `bindTypeDefaultSize(ctx, 'text', …)`。

### 进阶 2 · 给便签节点加底栏按钮（预告）

真实文本节点还往底栏注册了「复制 / 删除」按钮（`registerBarAction`）。那属于**跨插件协作** —— 怎么在 bottom-bar 没装时不挂掉、怎么等它装好再注册，是下一档难度。完整链路看 [案例 7](/examples/bottom-bar)，这里不展开。

## 每一步在干什么

**① package.json 的 `miniCanvas` 段**：插件市场、设置面板靠它知道这个包「叫什么、装不装」。缺了这段，包还能被代码装，但用户在界面里找不到它。仓库里真实插件都带这段（见 [真实出处](#仓库里的真实出处)）。

**② Service 子类**：`super(ctx, 'note')` 干两件事 —— 把 `this` 以 `note` 的名字放进服务表，并且把「撤销上架」记到本插件的账本上。所以插件卸载时服务自动消失，**不要**自己在 `apply` 里写 `ctx.inject('note', …)` 然后再想办法撤销。别的插件 `ctx.get<NoteService>('note')` 就能拿到它，拿不到时得到 `undefined`，不会抛错。

**③ 建节点走事务**：`doc.transaction(原因, tx => …)` 里的所有改动合成**一条**历史记录。不包事务直接改 store，用户按一次 Ctrl+Z 可能只撤掉半截（比如节点建了、文字没建），画面就怪了。这也是仓库里所有「建节点」代码的共同写法。

**④ `inject = ['doc']`**：这是「开工前点名」—— `doc` 不到，内核就先不启动本插件。不写它、只在 `apply` 里 `ctx.get('doc')`，装早了会拿到 `undefined`，一调方法就空指针。老版本里的 `nodeStore`、`graph`、`save` 这些名字都已经并进 `doc`，不要再写。

**⑤ ctx.nodes.register 的字段**：`type` 是连接线上的「户口名」；`size` 是新节点的默认尺寸（作者侧叫 size，数据层内部叫 defaultSize，糖帮你翻译了）；`inputs`/`outputs` 是连接约束 —— `acceptsTypes: ['text']` 表示「只有产出 text 的输出口能连进来」，连不上的线画布会直接拒绝；`in:` 是卡片内容组件，**字段名必须写 `in`**，写 `content` 会被当成老版本报错。

**⑥ create 委托服务**：「新建」的实现写在服务里、`create` 只转发一下。这样「菜单新建」「命令新建」「别的插件帮忙新建」走的是同一份代码，改逻辑只改一处。

**⑦ content 组件的两个纪律**：改数据只调服务（`editNote`），组件自己从不直接改 `data` —— 直接改不进历史、不落盘，画布刷新就丢；textarea 上挂 `nodrag nopan nowheel` 三个类，告诉画布「用户在打字，别把卡片拖走、别把画布滚缩放」。

**⑧ 外部写回要能同步进组件**：组件里的展示值来自 `props.data`，但撤销/重做、别的插件改数据时，props 会更新而组件的本地状态不会自动重置 —— 所以真实组件都有一条 `watch(() => props.data.text, …)`：外部改了就跟着刷新，**正在编辑时例外**（不然用户打的字会被冲掉）。这条 watch 缺了的话，「撤销后画面仍显示旧文本」是实测出现过的 bug 类别。

## 仓库里的真实出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| Service 子类上架服务 | `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts` | `TextService extends Service`，`super(ctx, 'text')` 上架 `text` 服务，方法里惰性 `this.ctx.get('doc')` |
| 建节点包事务、create 委托服务 | 同上 `addTextNode` / `ctx.nodes.register({ create })` | `this.doc().transaction('add-text-node', tx => tx.createNode('text', …))`，create 返回它的结果 |
| 节点类型全字段（端口/图标/可拖拽改尺寸/名称模板） | 同上 `ctx.nodes.register({...})` | `type: 'text'`，`inputs: [{ port: 'target', acceptsTypes: ['text'] }]`，`outputs: [{ port: 'source', contentType: 'text' }]` |
| 类型增强 `ctx.text` | 同上 `declare module '@mini-canvas/canvas-data'` | 给 Context 补 `text: TextService`，写代码有类型提示 |
| content 组件双击编辑、失焦保存、类名防拖拽 | `packages/plugins/plugin-node-text/src/TextContent.vue` | 双击进编辑（`beginEdit`），blur 提交经 `ctx.get('text').editText`，编辑框带 `nodrag nopan nowheel` |
| content 组件的 props 形状 | `packages/canvas-render/src/contracts/contentComponentTypes.ts` | `SegmentContentProps { id: string; data: SegmentNodeData }`，BaseNode 壳统一注入 |
| package.json 的 miniCanvas 段写法 | `packages/plugins/plugin-mini-map/package.json` | `title / description / pluginName / installable` 同款结构 |

## 常见坑

1. **组件里写 `ctx.text` 拿不到东西**。根上下文没有「服务直通车」，`ctx.text` 只是类型增强；运行时必须 `ctx.get('text')`。真实插件因此专门注释过这件事（TextContent.vue 头部）。
2. **注册字段写 `content:`**。作者侧的字段是区域词 `in`（卡片里面）；`content` 是下线的老名字，运行时会直接抛错，而不是静默忽略 —— 组件再漂亮也不会出现。
3. **在 apply 里缓存 `doc`**。插件可能被卸载重装，服务实例跟着换；构造时存一份引用，之后调到的是旧世界的东西。正确姿势是像真实插件那样「用时现取」。
4. **直接改 props.data 保存文字**。改得动界面，但不进历史、不落盘 —— 刷新就没了，Ctrl+Z 也追不回来。所有写操作都必须经服务进 `doc` 的统一写口。
5. **旧服务名还魂**。老代码里的 `nodeStore / edgeStore / graph / history` 已经全部下线，统一并进 `doc`。从老文档或 AI 生成的旧片段里抄来的 `ctx.get('nodeStore')` 拿到的是 `undefined`，第一个方法调用就空指针 —— 见到这些名字一律换成 `doc` 的对应方法（建节点走 `doc.transaction`，改数据走 `doc.updateNode`）。
