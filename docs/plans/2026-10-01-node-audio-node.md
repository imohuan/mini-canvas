# 音频节点插件（波形 + 可拖拽进度）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把 web2api-tools 里顺带注册的 `audio` 节点抽成独立插件包 `plugin-node-audio`，并把卡片换成「主题色波形进度条」：波形可点击/拖拽改播放进度，播放时波形有动画。

**Architecture：** 照 `plugin-node-video` 的分层：纯函数（波形计算 / 进度换算）→ 浏览器端口（解码音频 / 选文件 / 下载）→ ops（载入音频：解码 + 一次写回）→ 插件 apply（注册节点类型 + 服务 + 命令）→ `.vue` 内容组件（只画波形与控件）。波形数据在**第一次载入音频时算一次**，以 100 个整数（1..100 的高度百分比）存进节点 `data.audioWaveform`，之后只读缓存、不再重复解码。

**Tech Stack：** TypeScript + Vue 3 SFC + Web Audio API（`decodeAudioData`）+ SVG（单 `path` 画 100 根竖条 + `clipPath` 分层上色）。

**Spec：** 无独立 spec —— 设计在会话里当面对过（bounded 任务，用户已确认）。

## Global Constraints

- 依赖方向恒为 插件 → 内核：本包**不得** import `@mini-canvas/plugin-theme-default`（T08 守卫会红）；设计系统件走 `useUiComponent('button')` 按名取。
- 不写死颜色：一律 `var(--token, 兜底)`（`themeColorHygiene` 守卫会红）；已播色用 `--ui-accent`（用户改品牌色要跟着变），未播用灰阶 token。
- 新增配置文件项一律带本包前缀 + 带 `group`（settings 是全局平面命名，先声明者独占；无 group 的项在设置面板里会消失）。
- 节点类型名 **必须**保持 `audio`（web2api 的动作 `types: ['audio']` 与写入器 `kind: 'audio'` 靠它）。
- 播放进度、播放中状态 = **会话态**（内存），不写库、不进撤销栈。
- 波纹数据 = 派生数据：写库走 `doc.updateNodeRuntime`（落盘、不进撤销栈）。
- 中文文案；中文正文不小于 12px；动效 150–240ms 且带 `prefers-reduced-motion` 降级。
- 视觉数值照 `docs/design/ui-style-guide.md`（圆角 6/8/10、灰阶四档、图标 24-viewBox 线性 SVG）。

---

## 文件结构

**新建 `packages/plugins/plugin-node-audio/`**

| 文件 | 职责 |
|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` | 包骨架（抄 plugin-node-video） |
| `src/env.d.ts` | `*.vue` / `*.css` shim |
| `src/index.ts` | 导出 `nodeAudioPlugin` |
| `src/waveform.ts` | **纯函数**：桶化峰值、归一化、校验、按地址确定性回落波形 |
| `src/audioPlayback.ts` | **纯函数**：进度换算、时间格式化、拖拽比例夹取 |
| `src/audioTransform.ts` | 浏览器端口：解码音频取峰值、读时长、选文件、下载（node 下安全返回 null/false） |
| `src/audioOps.ts` | 载入/上传/下载一条路：解码 → 一次写回（audioUrl + 时长 + 波形） |
| `src/AudioContent.vue` | 卡片内容：波形（SVG）+ 拖拽 seek + 播放/暂停 + 时间 |
| `src/nodeAudioPlugin.ts` | `name/inject/Config/apply`：注册类型 + `AudioService` + 命令 |

**修改**

| 文件 | 改动 |
|---|---|
| `packages/plugins/plugin-web2api-tools/src/web2apiPlugin.ts` | 删掉 `AudioContent` / `AudioService` / `AUDIO_NODE_TYPE` / `ctx.nodes.register`；**保留** audio 写入器 |
| `packages/plugins/plugin-web2api-tools/src/AudioContent.vue` | 删除（搬去新包并重写） |
| `packages/ui/src/assembly.ts` | 清单加 `nodeAudioPlugin` |
| `packages/ui/package.json` | 加 `@mini-canvas/plugin-node-audio` 依赖 |
| `packages/ui/src/__tests__/entrypoint.test.ts` | 插件数 23 → 24 |
| `packages/ui/src/__tests__/web2apiAssembly.test.ts` | 装载加 `nodeAudioPlugin`；audio 类型/服务断言改由新插件提供 |
| `packages/ui/src/__tests__/nodePluginsAssembly.test.ts` | EXPECTED 加 `audio`（in 段）+ 服务断言加 `audio` |
| `docs/STATUS.md` | 追加一条本轮记录 |

**数据契约（跨任务共享，勿改名）**

```ts
// 节点 data 上与本节点有关的字段
interface AudioNodeData {
  audioUrl?: string          // 音频地址（web2api 写入器 / 上传都会写它）
  audioName?: string         // 文件名（web2api 写入器已经会写）
  audioDuration?: number     // 秒（读元数据成功时写）
  audioWaveform?: number[]   // 100 个整数，1..100（高度百分比）；算过一次就不再算
}
export const WAVEFORM_BUCKETS = 100   // 桶数（用户口径："最多 100 个数字"）
export const WAVEFORM_MAX = 100       // 值域上限（整数百分比）
```

---

### Task 1: 纯函数 · 波形计算（waveform.ts）

**Files:** Create `packages/plugins/plugin-node-audio/src/waveform.ts`，Test `src/__tests__/waveform.test.ts`

**Interfaces:**
- Produces：`WAVEFORM_BUCKETS: 100`、`WAVEFORM_MAX: 100`、`bucketPeaks(samples: Float32Array, buckets?: number, channels?: number): number[]`、`normalizeToPercent(peaks: number[]): number[]`、`isValidWaveform(v: unknown): v is number[]`、`fallbackWaveform(seed: string, buckets?: number): number[]`

- [ ] 步骤 1：写失败测试（覆盖：桶数恒定 100；静音不丢帧（最低保留 1）；峰值归一化到 1..100 整数；多声道取绝对最大值；非法输入返回 null；同 seed 同形状、不同 seed 不同形状；`isValidWaveform` 对长度/值域/非数组的拒绝）

```ts
import { describe, it, expect } from 'vitest'
import { WAVEFORM_BUCKETS, WAVEFORM_MAX, bucketPeaks, normalizeToPercent, isValidWaveform, fallbackWaveform } from '../waveform'

describe('waveform 桶化', () => {
  it('恒定输出 WAVEFORM_BUCKETS 个桶（采样数多于/少于桶数都成立）', () => {
    expect(bucketPeaks(new Float32Array(48000))).toHaveLength(WAVEFORM_BUCKETS)
    expect(bucketPeaks(new Float32Array(50))).toHaveLength(WAVEFORM_BUCKETS)
  })
  it('取样峰值 = 桶内绝对最大值（-1 也要算进去）', () => {
    const s = new Float32Array(200)
    s[10] = -0.8
    s[150] = 0.4
    const peaks = bucketPeaks(s, 2)          // 每桶 100 个采样
    expect(peaks[0]).toBeCloseTo(0.8, 5)
    expect(peaks[1]).toBeCloseTo(0.4, 5)
  })
  it('多声道交错采样按帧取最大（左右不同相也不会被平均掉）', () => {
    const s = new Float32Array([1, -1, 0.2, 0.2])  // 2 帧 × 2 声道
    expect(bucketPeaks(s, 1, 2)[0]).toBeCloseTo(1, 5)
  })
  it('归一化到 1..WAVEFORM_MAX 的整数，静音桶保底 1（不出现 0 高度的空档）', () => {
    const out = normalizeToPercent([0, 0.5, 1])
    expect(out.every((v) => Number.isInteger(v) && v >= 1 && v <= WAVEFORM_MAX)).toBe(true)
    expect(out[0]).toBe(1)
    expect(out[2]).toBe(WAVEFORM_MAX)
  })
})

describe('waveform 校验与回落', () => {
  it('isValidWaveform 只认长度正确的整数数组', () => {
    expect(isValidWaveform(fallbackWaveform('a'))).toBe(true)
    expect(isValidWaveform('x')).toBe(false)
    expect(isValidWaveform([])).toBe(false)
    expect(isValidWaveform(new Array(WAVEFORM_BUCKETS).fill(0))).toBe(false)   // 0 不在 1..100
    expect(isValidWaveform(new Array(WAVEFORM_BUCKETS).fill(101))).toBe(false)
  })
  it('回落波形只由 seed 决定：同 seed 完全一致、不同 seed 一般不同', () => {
    expect(fallbackWaveform('https://x/a.mp3')).toEqual(fallbackWaveform('https://x/a.mp3'))
    expect(fallbackWaveform('a')).not.toEqual(fallbackWaveform('b'))
    expect(fallbackWaveform('a')).toHaveLength(WAVEFORM_BUCKETS)
  })
})
```

- [ ] 步骤 2：跑测试确认失败 —— `pnpm -C packages/plugins/plugin-node-audio test`（此时包还没建：先建骨架，或先在 plugin-node-video 的安全位置跑；实际执行顺序是先建 Task 0 骨架）
- [ ] 步骤 3：实现 —— 桶化用「每桶取绝对最大值」，归一化用「除以全局峰值 → 乘 (MAX-1) → 取整 → 保底 1」，回落用 FNV-1a 哈希 + 线性同余伪随机（不用 `Math.random`：同地址必须同形状）
- [ ] 步骤 4：跑测试确认通过
- [ ] 步骤 5：提交

```bash
git add packages/plugins/plugin-node-audio
git commit -m "feat(node-audio): 波形纯函数（桶化/归一化/校验/确定性回落）"
```

---

### Task 2: 纯函数 · 播放进度换算（audioPlayback.ts）

**Files:** Create `src/audioPlayback.ts`，Test `src/__tests__/audioPlayback.test.ts`

**Interfaces:**
- Produces：`clamp01(v: number): number`、`progressRatio(current: number, duration: number): number`、`seekTime(ratio: number, duration: number): number`、`formatClock(seconds: number): string`、`ratioFromPointer(clientX: number, left: number, width: number): number`

- [ ] 步骤 1：写失败测试

```ts
import { describe, it, expect } from 'vitest'
import { clamp01, progressRatio, seekTime, formatClock, ratioFromPointer } from '../audioPlayback'

describe('播放进度换算', () => {
  it('progressRatio 收敛在 0..1，时长未知时为 0', () => {
    expect(progressRatio(5, 10)).toBeCloseTo(0.5)
    expect(progressRatio(-1, 10)).toBe(0)
    expect(progressRatio(99, 10)).toBe(1)
    expect(progressRatio(3, 0)).toBe(0)
    expect(progressRatio(Number.NaN, 10)).toBe(0)
  })
  it('seekTime 是 progressRatio 的逆运算，并夹在 0..duration', () => {
    expect(seekTime(0.25, 8)).toBeCloseTo(2)
    expect(seekTime(-3, 8)).toBe(0)
    expect(seekTime(2, 8)).toBe(8)
    expect(seekTime(0.5, 0)).toBe(0)
  })
  it('formatClock 输出 m:ss（>=1 小时给 h:mm:ss），非法值给 0:00', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9.4)).toBe('0:09')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
  it('ratioFromPointer 把指针位置换成比例，宽度为 0 时给 0', () => {
    expect(ratioFromPointer(150, 100, 100)).toBeCloseTo(0.5)
    expect(ratioFromPointer(0, 100, 100)).toBe(0)
    expect(ratioFromPointer(500, 100, 100)).toBe(1)
    expect(ratioFromPointer(120, 100, 0)).toBe(0)
  })
})
```

- [ ] 步骤 2：跑测试确认失败
- [ ] 步骤 3：实现
- [ ] 步骤 4：跑测试确认通过
- [ ] 步骤 5：提交 `feat(node-audio): 播放进度换算纯函数`

---

### Task 3: 新包骨架 + 类型注册 + 服务 + 命令（nodeAudioPlugin.ts）

**Files:** Create `package.json` / `tsconfig.json` / `vitest.config.ts` / `src/env.d.ts` / `src/index.ts` / `src/nodeAudioPlugin.ts` / `src/AudioContent.vue`（占位版，Task 5 重写），Test `src/__tests__/nodeAudioSmoke.test.ts`

**Interfaces:**
- Produces：`nodeAudioPlugin: PluginModule`（`name = 'audio'`）、`AudioService`（服务名 `audio`，方法 `addAudioNode(position, audioUrl?): string`）、`AUDIO_NODE_TYPE = 'audio'`、命令 `audio.upload` / `audio.download` / `audio.reanalyze`
- Consumes：`doc.transaction / createNode / updateNode / updateNodeRuntime`、`nodeRegistry`、`command`

- [ ] 步骤 1：写失败测试（真内核装配：类型注册、`in` 段存在、服务可取、能建出节点、命令已注册、卸载后回收）

```ts
// 照 nodePluginsAssembly 的 boot 写法建内核 → ctx.plugin(nodeAudioPlugin) → await ctx.start()
expect([...nodeStore.types.keys()]).toContain('audio')
expect(nodeRegistry.get('audio')?.segments?.in).toBeTruthy()
expect(ctx.get('audio')).toBeTruthy()
expect(commands.list().map((c) => c.id)).toContain('audio.upload')
const id = factory.create('audio', { x: 1, y: 2 })
expect(ctx.get('doc').getNode(id)?.type).toBe('audio')
// 卸载后类型与段一起回收
```

- [ ] 步骤 2：跑测试确认失败
- [ ] 步骤 3：建骨架（package.json 依赖只写 `canvas-base` / `canvas-data` / `canvas-render` / `kernel` + peer vue；**不写** plugin-theme-default），实现 `apply`：
  - `ctx.nodes.register({ type: 'audio', label: '音频', description: '在画布中添加一个音频节点（语音合成 / 音频生成）', icon: AUDIO_ICON, size: { w: 320, h: 120 }, inputs: [{ port: 'target', acceptsTypes: ['text', 'audio'] }], outputs: [{ port: 'source', contentType: 'audio' }], resizable: true, in: AudioContent, create(position) { return audio.addAudioNode(position) } })`
  - `AudioService extends Service`，`super(ctx, 'audio')`
  - `declare module '@mini-canvas/canvas-data' { interface Context { audio: AudioNodeService } }`
  - 命令三条（upload / download / reanalyze）走 `audioOps`
- [ ] 步骤 4：`pnpm -C packages/ui ... pnpm install` 认到新包，跑测试确认通过
- [ ] 步骤 5：提交

---

### Task 4: 浏览器端口 + ops（解码一次、写回一次）

**Files:** Create `src/audioTransform.ts` / `src/audioOps.ts`，Test `src/__tests__/audioOps.test.ts`

**Interfaces:**
- `AudioTransform`：`analyze(url, buckets): Promise<number[] | null>`、`readDuration(url): Promise<number | null>`、`pickFile(): Promise<File | null>`、`download(url, fileName): boolean`
- `loadAudio(ops, nodeId, url, meta?, transform?): Promise<boolean>` —— 一次写回 `{ audioUrl, audioName?, audioDuration?, audioWaveform }`；分析失败用 `fallbackWaveform(url)` 兜底（**仍然写库**，下次不再分析）
- `uploadAudio(ops, nodeId, file, transform?, registerResource?): Promise<boolean>`、`downloadAudioNode(ops, nodeId, transform?): boolean`
- `reanalyzeAudio(ops, nodeId, transform?): Promise<boolean>`

- [ ] 步骤 1：写失败测试（注入假 transform，断言：写回字段齐全；分析失败落回落波形且只写一次；换地址重算；空地址 / 节点不存在返回 false）
- [ ] 步骤 2：跑测试确认失败
- [ ] 步骤 3：实现
  - `audioTransform.analyze`：`fetch(url) → arrayBuffer → new AudioContext().decodeAudioData → getChannelData`，多声道逐帧取最大；`finally` 里 `close()`；任何异常 → `null`；非浏览器 → `null`
  - 写波形用 `doc.updateNodeRuntime`（不进撤销栈），`audioUrl/duration/name` 用 `doc.updateNode`（进历史）
  - **两次写入合并成一次 updateNode**（url/duration/name）+ 一次 updateNodeRuntime（波形）
- [ ] 步骤 4：跑测试确认通过
- [ ] 步骤 5：提交

---

### Task 5: 内容组件（波形 + 拖拽 seek + 播放动画）

**Files:** Create/Rewrite `src/AudioContent.vue`，Test `src/__tests__/audioContentRender.test.ts`

**Interfaces（模板与 DOM 契约，SSR 断言用）**
- 根 `.audio-node`；无音频时 `.audio-empty`（文案「（无音频）」）或失效态 `.audio-broken`
- 波形容器 `.aw-wave`（带 `nodrag nopan nowheel`）；内 `.aw-svg` + 两条同形 `path`：`.aw-base`（灰）、`.aw-played`（主题色，被 `<clipPath>` 的 `.aw-clip` 限制）+ `.aw-head`（播放头竖线）
- 播放按钮 `.aw-btn`（`title`/`aria-label` 随状态变「播放」/「暂停」）；时间 `.aw-time` 文案 `m:ss / m:ss`
- 播放时根元素加 `.is-playing`（动画类挂在这里）

- [ ] 步骤 1：写失败测试（`@vue/server-renderer` SSR 真 HTML）：无音频渲染空态；有音频渲染 `polyline/path` 与 100 个点的 `d`；`clipPath` 的 `width` 比例符合初值 0；时间文案存在
- [ ] 步骤 2：跑测试确认失败
- [ ] 步骤 3：实现
  - 挂载时若无 `data.audioWaveform`：调 `reanalyze`（一次）→ 写库；已有则直接画
  - 波形 → SVG：`viewBox="0 0 1000 100"`、`preserveAspectRatio="none"`；每桶一根竖线（单条 `path` 的 `M x,y0 V y1` 段），`stroke-width` = 桶宽，配合 `shape-rendering="crispEdges"`
  - 拖拽：`pointerdown` → `setPointerCapture` → `ratioFromPointer` → `audio.currentTime = seekTime(...)`；`pointermove`（按住时）同路；`pointerup` 释放
  - 播放：`rAF` 循环读 `audio.currentTime` 更新 `clipPath` 宽度与播放头（**只在播放中跑**；暂停即停）
  - 动画：`.is-playing .aw-played { animation: aw-pulse 1.6s ease-in-out infinite } `（透明度呼吸），`@media (prefers-reduced-motion: reduce)` 关掉
  - 颜色：`.aw-base { fill: var(--canvas-node-text-muted, #9ca3af) }`、`.aw-played { fill: var(--ui-accent, #0891b2) }`
- [ ] 步骤 4：跑测试确认通过
- [ ] 步骤 5：提交

---

### Task 6: web2api-tools 交还节点所有权 + 装配清单

**Files:** Modify `plugin-web2api-tools/src/web2apiPlugin.ts`、删 `AudioContent.vue`、`packages/ui/src/assembly.ts`、`packages/ui/package.json`、`packages/ui/src/__tests__/{entrypoint,web2apiAssembly,nodePluginsAssembly}.test.ts`

- [ ] 步骤 1：先改测试（把「audio 类型由 web2api 注册」的断言改成「由 nodeAudioPlugin 注册」；`APP_PLUGINS` 数量 23 → 24）→ 跑，确认红
- [ ] 步骤 2：改实现：web2api 删掉节点注册与 `AudioService`（**保留** audio 写入器与两条音频动作）；assembly 加插件；package.json 加依赖
- [ ] 步骤 3：`pnpm install` 后跑三个 ui 测试文件 + web2api 自己的测试，确认全绿
- [ ] 步骤 4：`pnpm -C packages/ui typecheck`、`pnpm -C packages/plugins/plugin-web2api-tools typecheck`、新包 typecheck 全过
- [ ] 步骤 5：提交

---

### Task 7: 全量验证 + 记录

- [ ] 跑：新包 test、web2api-tools test、`packages/ui test`、`packages/plugins/plugin-node-video test`（对照）、新包与 ui 的 typecheck、`themeColorHygiene` / `stylesCompile`（在 ui 包里）
- [ ] 起 `pnpm -C packages/ui dev` 目验：建一个音频节点 → 波形是灰色 → 点播放 → 左侧变主题色并有呼吸动画 → 在波形上按住左右拖 → 播放头与时间跟着走 → 刷新后波形还在（不再重新分析）
- [ ] 更新 `docs/STATUS.md`（本轮记录：做了什么、验证数字）
- [ ] 提交

---

## Self-Review

- **Spec 覆盖**：抽离成独立插件（Task 3/6）、波形存节点且只算一次（Task 1/4）、不显示字幕（全程无字幕字段）、波纹可拖拽当进度条（Task 2/5）、左侧主题色右侧灰（Task 5）、播放时有动画（Task 5）、多节点性能（Task 1 桶数固定 + Task 5 单 path / 单 rAF）—— 逐条有任务对应。
- **占位符扫描**：仅 `audioTransform` 的浏览器 API 细节以"实现要点"表述，其接口签名、失败回落、非浏览器行为均已写明。
- **类型一致**：`WAVEFORM_BUCKETS` / `WAVEFORM_MAX` / `AudioNodeData` 字段名在 Task 1、4、5 中一致；`AudioTransform` 四个方法在 Task 4/5/7 中同名同参。

