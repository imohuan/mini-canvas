/**
 * 全功能 provider 演示（自包含单文件，丢进 <数据根>/providers/ 即生效）。
 *
 * 覆盖的东西：
 *   1. 4 种参数控件：select / number / boolean / text（含 number 有范围与无范围两种形态）
 *   2. 全部会渲染的 kind：ratio / quality / resolution / background / count / camera /
 *      duration（按钮档与滑块两种形态）/ speed / model / speaker / format
 *      —— 外加未声明 kind 的普通下拉（对照组）与 kind:'style'（底栏会过滤掉）
 *   3. 图标三种写法：SVG 字符串、Base64 图片、图标名（`seedance` / `火山引擎`）
 *   4. 预设 templates（选中后连提示词带参数一起填）
 *   5. panelHtml 两种形态：带输入框（画在参数区）、不带输入框（占输入框那一行）
 *   6. 异步任务：submit 给 taskId，poll 轮询，waiting 帧不占超时，cancel 取消
 *   7. 同步完成、直接失败两条返回路径
 *   8. 真产物：用 node:zlib 现画一张 PNG（data URL），后台会收进画布资源目录并写回节点
 *
 * 只用 Node 内置模块。相对 import 和第三方包在 data: URL 里都会加载失败。
 */
import zlib from 'node:zlib'

// ============================== PNG 生成 ==============================

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 一个 PNG 块：长度 + 类型 + 数据 + CRC */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 生成一张真 PNG。pixel(x, y) 返回 [r, g, b] */
function makePng(width, height, pixel) {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const c = pixel(x, y)
      const o = y * stride + 1 + x * 3
      raw[o] = c[0]
      raw[o + 1] = c[1]
      raw[o + 2] = c[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ============================== 参数解释 ==============================

/** '16:9' / '1:1' → 数值比；'auto' 或解析不出按 1:1 */
function ratioOf(value) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(value || ''))
  if (!m) return 1
  const a = Number(m[1])
  const b = Number(m[2])
  return a > 0 && b > 0 ? a / b : 1
}

/** 各 kind 的取值 → 一个主色（让参数变化在图上看得出来） */
function tintOf(v) {
  const quality = String(v.quality || 'hd')
  const resolution = String(v.resolution || '2k')
  const background = String(v.background || 'white')
  const palette = {
    sd: [120, 144, 176],
    hd: [64, 132, 168],
    uhd: [32, 168, 150],
  }
  const base = palette[quality] || palette.hd
  const scale = resolution === '4k' ? 1.15 : resolution === '1k' ? 0.72 : 1
  const bg = background === 'black' ? 0.18 : background === 'transparent' ? 0.9 : 1
  return base.map((c) => Math.max(0, Math.min(255, Math.round(c * scale * bg))))
}

/** 把参数拼成一句人能读的摘要（同步动作直接当 text 返回） */
function summarize(action, input) {
  const v = input.values || {}
  const parts = []
  for (const f of action.fields || []) {
    const raw = v[f.key]
    if (raw === undefined || raw === '') continue
    const opt = (f.options || []).find((o) => o.value === raw)
    parts.push((f.label || f.key) + '=' + (opt ? opt.label : String(raw)))
  }
  const prompt = (input.prompt || '').trim()
  return (parts.length ? parts.join(' · ') : '（没有参数）') + (prompt ? ' ｜ 提示词=' + prompt : '')
}

// ============================== 面板 HTML ==============================

/**
 * 带输入框的面板：画在参数区，输入框仍在下面。
 * 颜色全部走宿主注入的 --ui-* 变量，跟随主题；不要自己加滚动条。
 */
const PANEL_WITH_PROMPT = [
  '<style>',
  '  body { margin: 0; padding: 12px 14px; font: 12px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;',
  '         color: var(--ui-ink, #18202b); background: transparent; }',
  '  .sec { display: flex; flex-direction: column; gap: 8px; }',
  '  .sec + .sec { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ui-line, #e2e5ea); }',
  '  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
  '  .title { font-size: 12px; font-weight: 700; }',
  '  .hint { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }',
  '  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }',
  '  .opt { padding: 7px 4px; border-radius: 8px; border: 1px solid var(--ui-line, #e2e5ea);',
  '         background: transparent; color: inherit; cursor: pointer; font: inherit; }',
  '  .opt:hover { background: var(--ui-chip, rgba(0,0,0,.05)); }',
  '  .opt.on { border-color: var(--ui-accent, #0891b2); color: var(--ui-accent, #0891b2); font-weight: 700;',
  '            background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent); }',
  '  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }',
  '  input[type=text] { flex: 1 1 120px; min-width: 0; padding: 5px 8px; border-radius: 8px;',
  '         border: 1px solid var(--ui-line, #e2e5ea); background: transparent; color: inherit; font: inherit; }',
  '</style>',
  '<div class="sec">',
  '  <div class="head"><span class="title">比例（面板直接写回 values）</span><span class="hint" id="model">-</span></div>',
  '  <div class="grid" id="ratios"></div>',
  '</div>',
  '<div class="sec">',
  '  <div class="head"><span class="title">运镜</span></div>',
  '  <div class="row" id="cameras"></div>',
  '</div>',
  '<div class="sec">',
  '  <div class="head"><span class="title">备注（面板里的输入框）</span><span class="hint">写进 values.note</span></div>',
  '  <div class="row"><input type="text" id="note" placeholder="比如：主体偏左" /></div>',
  '</div>',
'<script>',
  '  var values = {}',
  '  var RATIOS = [["1:1","方形"],["16:9","横版"],["9:16","竖版"],["4:3","经典"],["21:9","宽银幕"]]',
  '  var CAMERAS = [["fixed","固定"],["push","推近"],["orbit","环绕"]]',
  '  var ratioBox = document.getElementById("ratios")',
  '  var cameraBox = document.getElementById("cameras")',
  '  var noteBox = document.getElementById("note")',
  '  RATIOS.forEach(function (r) {',
  '    var b = document.createElement("button")',
  '    b.className = "opt"; b.textContent = r[1]; b.setAttribute("data-ratio", r[0])',
  '    b.onclick = function () { values.ratio = r[0]; api.setValues({ ratio: r[0] }); paint() }',
  '    ratioBox.appendChild(b)',
  '  })',
  '  CAMERAS.forEach(function (c) {',
  '    var b = document.createElement("button")',
  '    b.className = "opt"; b.textContent = c[1]; b.style.flex = "1 1 0"; b.setAttribute("data-camera", c[0])',
  '    b.onclick = function () { values.camera = c[0]; api.setValues({ camera: c[0] }); paint() }',
  '    cameraBox.appendChild(b)',
  '  })',
  '  noteBox.oninput = function () {',
  '    values.note = noteBox.value',
  '    api.setValues({ note: noteBox.value })',
  '  }',
  '  function paint() {',
  '    Array.prototype.forEach.call(ratioBox.children, function (b) {',
  '      b.classList.toggle("on", values.ratio === b.getAttribute("data-ratio"))',
  '    })',
  '    Array.prototype.forEach.call(cameraBox.children, function (b) {',
  '      b.classList.toggle("on", values.camera === b.getAttribute("data-camera"))',
  '    })',
  '    if (noteBox.value !== (values.note || "")) noteBox.value = values.note || ""',
  '  }',
  '  api.onContext(function (ctx) {',
  '    values = ctx.values || {}',
  '    document.getElementById("model").textContent = ctx.model || "-"',
  '    paint()',
  '  })',
'</scr' + 'ipt>',
].join('\n')

/**
 * 不带输入框的面板：直接占底栏输入框那一行，自己当操作区。
 * 这里演示 api.run()（等价于点发送）与 api.notify()。
 */
const PANEL_INLINE = [
  '<style>',
  '  body { margin: 0; padding: 8px 10px; font: 12px/1.5 system-ui, sans-serif;',
  '         color: var(--ui-ink, #18202b); background: transparent; }',
  '  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }',
  '  .chip { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--ui-line, #e2e5ea);',
  '          background: transparent; color: inherit; cursor: pointer; font: inherit; }',
  '  .chip.on { border-color: var(--ui-accent, #0891b2); color: var(--ui-accent, #0891b2); font-weight: 700; }',
  '  .send { margin-left: auto; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--ui-line, #e2e5ea);',
  '          background: var(--ui-accent, #0891b2); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }',
  '  .send:disabled { opacity: .45; cursor: not-allowed; }',
  '  .tip { color: var(--ui-ink-dim, #6b7280); font-size: 11px; }',
  '</style>',
  '<div class="row">',
  '  <button class="chip" data-len="short">短</button>',
  '  <button class="chip" data-len="medium">中</button>',
  '  <button class="chip" data-len="long">长</button>',
  '  <span class="tip" id="tip"></span>',
  '  <button class="send" id="send">开始生成</button>',
  '</div>',
'<script>',
  '  var values = {}',
  '  var tip = document.getElementById("tip")',
  '  var send = document.getElementById("send")',
  '  Array.prototype.forEach.call(document.querySelectorAll("[data-len]"), function (b) {',
  '    b.onclick = function () {',
  '      values.lengthPreset = b.getAttribute("data-len")',
  '      api.setValues({ lengthPreset: values.lengthPreset })',
  '      api.notify("已选：" + b.textContent, "info")',
  '      paint()',
  '    }',
  '  })',
  '  send.onclick = function () { api.run() }',
  '  function paint() {',
  '    Array.prototype.forEach.call(document.querySelectorAll("[data-len]"), function (b) {',
  '      b.classList.toggle("on", values.lengthPreset === b.getAttribute("data-len"))',
  '    })',
  '    var d = values.disabled === true',
  '    send.disabled = d',
  '    tip.textContent = d ? "生成中…" : "选中后再点开始生成"',
  '  }',
  '  api.onContext(function (ctx) { values = ctx.values || {}; paint() })',
'</scr' + 'ipt>',
].join('\n')

// ============================== 图标 ==============================

/** SVG 字符串图标：必须有 viewBox（否则底栏按原始像素乱放） */
const ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>' +
  '<circle cx="8" cy="13" r="1.4"/><path d="M12 13h6M12 16.5h4"/></svg>'

/**
 * Base64 图片图标：必须是 data:image/(png|jpeg|webp|gif|svg+xml);base64,…
 * 这里是一张 1x1 的 PNG，换成真图时保持同样格式即可。
 */
const ICON_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// ============================== 异步任务表 ==============================

/** taskId → { step, total, values, prompt }。进程重启就丢，示例够用。 */
const jobs = new Map()

// ============================== provider ==============================

const provider = {
  id: 'demo-skill-full',
  actions: [
    // ---------------------------------------------------------------
    // 1. 全部参数类型 + 全部 kind
    // ---------------------------------------------------------------
    {
      id: 'full:all-params',
      title: '演示 · 全部参数与 kind',
      description:
        '一次展示 4 种控件和 12 个 kind 的渲染差异。改完点发送，产物是一张按比例生成的 PNG。',
      group: '演示 · 全功能',
      nodeTypes: ['image', 'video'],
      needsPrompt: true,
      order: 1,
      icon: ICON_SVG,
      pollIntervalMs: 800,
      pollTimeoutMs: 60000,
      templates: [
        {
          id: 'full:tpl-poster',
          name: '竖版海报',
          description: '9:16 + 超清 + 4K',
          prompt: '一张竖版海报，主体居中，顶部留标题空间。',
          values: {
            ratio: '9:16',
            quality: 'uhd',
            resolution: '4k',
            count: '2',
            camera: 'push',
          },
        },
        {
          id: 'full:tpl-avatar',
          name: '方形头像',
          description: '1:1 + 标准画质',
          prompt: '一张方形头像，背景干净。',
          values: { ratio: '1:1', quality: 'sd', resolution: '1k', count: '1' },
        },
        {
          id: 'full:tpl-cinema',
          name: '宽银幕剧照',
          description: '21:9 + 环绕运镜',
          prompt: '宽银幕电影剧照，逆光，浅景深。',
          values: { ratio: '21:9', resolution: '4k', camera: 'orbit', speed: 1.2 },
        },
      ],
      fields: [
        // kind: ratio —— 比例网格，每格画真实宽高比的小矩形
        {
          key: 'ratio',
          kind: 'ratio',
          label: '比例',
          type: 'select',
          default: '16:9',
          options: [
            { label: '1:1', value: '1:1' },
            { label: '16:9', value: '16:9' },
            { label: '9:16', value: '9:16' },
            { label: '4:3', value: '4:3' },
            { label: '21:9', value: '21:9' },
            { label: '自动', value: 'auto' },
          ],
        },
        // kind: quality —— 3 列按钮网格
        {
          key: 'quality',
          kind: 'quality',
          label: '画质',
          type: 'select',
          default: 'hd',
          options: [
            { label: '标准', value: 'sd' },
            { label: '高清', value: 'hd' },
            { label: '超清', value: 'uhd' },
          ],
        },
        // kind: resolution —— 3 列按钮网格
        {
          key: 'resolution',
          kind: 'resolution',
          label: '分辨率',
          type: 'select',
          default: '2k',
          options: [
            { label: '1K', value: '1k' },
            { label: '2K', value: '2k' },
            { label: '4K', value: '4k' },
          ],
        },
        // kind: background —— 3 列按钮网格
        {
          key: 'background',
          kind: 'background',
          label: '背景',
          type: 'select',
          default: 'white',
          options: [
            { label: '白底', value: 'white' },
            { label: '黑底', value: 'black' },
            { label: '透明', value: 'transparent' },
          ],
        },
        // kind: count —— 3 列按钮网格
        {
          key: 'count',
          kind: 'count',
          label: '数量',
          type: 'select',
          default: '1',
          options: [
            { label: '1 张', value: '1' },
            { label: '2 张', value: '2' },
            { label: '4 张', value: '4' },
          ],
        },
        // kind: camera —— 3 列按钮网格
        {
          key: 'camera',
          kind: 'camera',
          label: '运镜',
          type: 'select',
          default: 'fixed',
          options: [
            { label: '固定', value: 'fixed' },
            { label: '推近', value: 'push' },
            { label: '环绕', value: 'orbit' },
          ],
        },
        // kind: duration + 只有 2 个档 → 按钮网格（不是滑块）
        {
          key: 'durationPreset',
          kind: 'duration',
          label: '时长档位',
          type: 'select',
          default: '5',
          options: [
            { label: '5 秒', value: '5' },
            { label: '10 秒', value: '10' },
          ],
        },
        // kind: duration + 数字区间 → 滑块 + 数字框
        {
          key: 'durationSec',
          kind: 'duration',
          label: '时长（连续）',
          type: 'number',
          default: 6,
          min: 4,
          max: 15,
          step: 1,
          unit: '秒',
        },
        // kind: speed + 数字区间 → 滑块
        {
          key: 'speed',
          kind: 'speed',
          label: '语速',
          type: 'number',
          default: 1,
          min: 0.5,
          max: 2,
          step: 0.1,
          unit: '倍',
        },
        // kind: model —— 名字长、永远走下拉（>=4 个选项也不会铺成网格）
        {
          key: 'model',
          kind: 'model',
          label: '模型',
          type: 'select',
          default: 'v2',
          options: [
            { label: '标准模型 v2（推荐）', value: 'v2' },
            { label: '高精度模型 v2-pro', value: 'v2-pro' },
            { label: '快速模型 v2-turbo', value: 'v2-turbo' },
            { label: '实验模型 v3-preview', value: 'v3-preview' },
          ],
        },
        // kind: speaker —— 只有 2 个选项也**仍然**是下拉，用来对比上面的自动网格
        {
          key: 'speaker',
          kind: 'speaker',
          label: '音色',
          type: 'select',
          default: 'male',
          options: [
            { label: '男声 · 沉稳', value: 'male' },
            { label: '女声 · 明亮', value: 'female' },
          ],
        },
        // kind: format —— 3 个选项 → 按钮网格
        {
          key: 'format',
          kind: 'format',
          label: '格式',
          type: 'select',
          default: 'png',
          options: [
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpg' },
            { label: 'WEBP', value: 'webp' },
          ],
        },
        // 没写 kind 的 select → 仍是普通下拉（对比 speaker：写了 kind 也一样是下拉）
        {
          key: 'plainSelect',
          label: '未声明 kind 的下拉',
          type: 'select',
          default: 'a',
          options: [
            { label: '选项 A', value: 'a' },
            { label: '选项 B', value: 'b' },
          ],
        },
        // type: text —— 单行输入
        {
          key: 'note',
          label: '备注（text）',
          type: 'text',
          default: '',
          placeholder: '随便写点什么',
        },
        // type: number 且无范围 —— 普通数字输入框（不是滑块）
        {
          key: 'seed',
          label: '种子（无范围的 number）',
          type: 'number',
          default: 42,
        },
        // type: boolean —— 开关
        {
          key: 'upscale',
          label: '放大 2 倍',
          type: 'boolean',
          default: false,
        },
        // kind: style —— 底栏会整条过滤，写在这里只是演示「不要用这一项」
        {
          key: 'styleName',
          kind: 'style',
          label: '风格（不会显示）',
          type: 'select',
          default: 'photo',
          options: [
            { label: '摄影', value: 'photo' },
            { label: '插画', value: 'illustration' },
          ],
        },
      ],

      async submit(action, input) {
        try {
          const v = input.values || {}
          const ratio = ratioOf(v.ratio)
          const longSide = v.resolution === '4k' ? 768 : v.resolution === '1k' ? 320 : 512
          const width = ratio >= 1 ? longSide : Math.round(longSide * ratio)
          const height = ratio >= 1 ? Math.round(longSide / ratio) : longSide
          const tint = tintOf(v)
          const bg = String(v.background || 'white')
          const base = bg === 'black' ? [16, 18, 24] : [248, 248, 250]

          const png = makePng(width, height, (x, y) => {
            const nx = x / width
            const ny = y / height
            // 斜向渐变 + 一个圆，参数不同图不同，肉眼能对上
            const k = Math.min(1, Math.max(0, (nx + ny) / 2))
            const cx = 0.5
            const cy = 0.5
            const r = Math.sqrt((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy))
            const inCircle = r < 0.28
            const mix = inCircle ? 0.15 + 0.7 * k : 0.75 * k
            return [
              Math.round(base[0] * (1 - mix) + tint[0] * mix),
              Math.round(base[1] * (1 - mix) + tint[1] * mix),
              Math.round(base[2] * (1 - mix) + tint[2] * mix),
            ]
          })

          return {
            done: true,
            urls: ['data:image/png;base64,' + png.toString('base64')],
            text: '同步完成：' + summarize(action, input),
          }
        } catch (err) {
          return { error: '生成失败：' + (err instanceof Error ? err.message : String(err)) }
        }
      },
    },

    // ---------------------------------------------------------------
    // 2. Base64 图标 + 只有一个下拉参数（会直接铺在模型下拉旁边，不套面板）
    // ---------------------------------------------------------------
    {
      id: 'full:icon-base64',
      title: '演示 · Base64 图标',
      description: '图标用 data:image/png;base64,…；只有一个下拉参数，所以不套参数面板。',
      group: '演示 · 全功能',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 2,
      icon: ICON_BASE64,
      fields: [
        {
          key: 'model',
          kind: 'model',
          label: '模型',
          type: 'select',
          default: 'a',
          options: [
            { label: '模型 A', value: 'a' },
            { label: '模型 B', value: 'b' },
            { label: '模型 C', value: 'c' },
          ],
        },
      ],
      async submit(action, input) {
        return { done: true, text: '单下拉动作收到：' + summarize(action, input) }
      },
    },

    // ---------------------------------------------------------------
    // 3. HTML 面板 · 带输入框（面板画在参数区，输入框仍在下面）
    // ---------------------------------------------------------------
    {
      id: 'full:panel-with-prompt',
      title: '演示 · HTML 面板（带输入框）',
      description: 'panelHtml 顶替默认参数控件，输入框保留在下面。面板与宿主通过 postMessage 同步 values。',
      group: '演示 · 全功能',
      nodeTypes: ['image', 'video'],
      needsPrompt: true,
      order: 3,
      icon: ICON_SVG,
      panelHtml: PANEL_WITH_PROMPT,
      fields: [
        {
          key: 'ratio',
          kind: 'ratio',
          label: '比例',
          type: 'select',
          default: '16:9',
          options: [
            { label: '1:1', value: '1:1' },
            { label: '16:9', value: '16:9' },
            { label: '9:16', value: '9:16' },
            { label: '4:3', value: '4:3' },
            { label: '21:9', value: '21:9' },
          ],
        },
        {
          key: 'camera',
          kind: 'camera',
          label: '运镜',
          type: 'select',
          default: 'fixed',
          options: [
            { label: '固定', value: 'fixed' },
            { label: '推近', value: 'push' },
            { label: '环绕', value: 'orbit' },
          ],
        },
        { key: 'note', label: '备注', type: 'text', default: '' },
      ],
      templates: [
        {
          id: 'full:tpl-panel',
          name: '面板预设 · 竖版推近',
          prompt: '竖版构图，镜头缓慢推近。',
          values: { ratio: '9:16', camera: 'push', note: '面板里改的值也会被预设覆盖' },
        },
      ],
      async submit(action, input) {
        const v = input.values || {}
        const ratio = ratioOf(v.ratio)
        const width = ratio >= 1 ? 640 : Math.round(640 * ratio)
        const height = ratio >= 1 ? Math.round(640 / ratio) : 640
        const png = makePng(width, height, (x, y) => {
          const t = (x / width + y / height) / 2
          return [Math.round(230 - 120 * t), Math.round(120 + 90 * t), Math.round(180 - 40 * t)]
        })
        return {
          done: true,
          urls: ['data:image/png;base64,' + png.toString('base64')],
          text: '面板值：' + summarize(action, input),
        }
      },
    },

    // ---------------------------------------------------------------
    // 4. HTML 面板 · 不带输入框（面板直接占输入框那一行）
    // ---------------------------------------------------------------
    {
      id: 'full:panel-inline',
      title: '演示 · HTML 面板（无输入框）',
      description: 'needsPrompt: false，面板直接占底栏输入框的位置，自己带「开始生成」按钮。',
      group: '演示 · 全功能',
      nodeTypes: ['image', 'audio'],
      needsPrompt: false,
      order: 4,
      icon: ICON_SVG,
      panelHtml: PANEL_INLINE,
      fields: [
        {
          key: 'lengthPreset',
          label: '长度',
          type: 'select',
          default: 'medium',
          options: [
            { label: '短', value: 'short' },
            { label: '中', value: 'medium' },
            { label: '长', value: 'long' },
          ],
        },
      ],
      async submit(action, input) {
        const v = input.values || {}
        const ms = v.lengthPreset === 'short' ? 250 : v.lengthPreset === 'long' ? 1000 : 500
        const taskId = 'tone-' + Date.now()
        jobs.set(taskId, {
          route: 'tone',
          step: 0,
          total: 3,
          seenWaiting: false,
          lengthPreset: String(v.lengthPreset || 'medium'),
        })
        return { taskId, text: '已提交，预计 ' + ms + 'ms' }
      },
      poll(taskId) {
        const job = jobs.get(taskId)
        if (!job) return { status: 'error', error: '任务不存在（可能已被取消）' }
        job.step += 1
        if (job.step < job.total) {
          return { status: 'running', progress: job.step / job.total, message: '第 ' + job.step + ' 步' }
        }
        jobs.delete(taskId)
        // 无输入框的面板动作产出一段文本：urls 留空，text 写进节点
        return { status: 'done', text: '面板内联动作完成：长度=' + job.lengthPreset }
      },
      cancel(taskId) {
        jobs.delete(taskId)
      },
    },

    // ---------------------------------------------------------------
    // 5. 异步：轮询 + waiting 帧 + 真产物 + 取消
    // ---------------------------------------------------------------
    {
      id: 'full:async',
      title: '演示 · 异步轮询（含 waiting）',
      description:
        'submit 只给 taskId；poll 第 1 拍跑进度、第 2 拍标 waiting（不占超时）、第 3 拍出 PNG。可取消。',
      group: '演示 · 全功能',
      nodeTypes: ['image'],
      needsPrompt: true,
      order: 5,
      icon: ICON_SVG,
      pollIntervalMs: 1000,
      pollTimeoutMs: 120000,
      fields: [
        {
          key: 'ratio',
          kind: 'ratio',
          label: '比例',
          type: 'select',
          default: '16:9',
          options: [
            { label: '1:1', value: '1:1' },
            { label: '16:9', value: '16:9' },
            { label: '9:16', value: '9:16' },
          ],
        },
        {
          key: 'quality',
          kind: 'quality',
          label: '画质',
          type: 'select',
          default: 'hd',
          options: [
            { label: '标准', value: 'sd' },
            { label: '高清', value: 'hd' },
            { label: '超清', value: 'uhd' },
          ],
        },
      ],
      async submit(action, input) {
        const taskId = 'async-' + Date.now() + '-' + Math.floor(Math.random() * 1000)
        jobs.set(taskId, {
          route: 'async',
          step: 0,
          values: { ...(input.values || {}) },
          prompt: input.prompt || '',
        })
        return { taskId }
      },
      poll(taskId) {
        const job = jobs.get(taskId)
        if (!job) return { status: 'error', error: '任务不存在（可能已被取消）' }
        job.step += 1

        if (job.step === 1) {
          return { status: 'running', progress: 25, message: '排队完成，开始生成' }
        }
        if (job.step === 2) {
          // waiting: true —— 这一拍耗掉的时间不计入 pollTimeoutMs（等用户过验证码这类场景）
          return { status: 'running', progress: 30, message: '等待外部条件（这一拍不计入超时）', waiting: true }
        }
        if (job.step < 5) {
          return { status: 'running', progress: job.step * 20, message: '生成中 ' + job.step + '/5' }
        }

        const ratio = ratioOf(job.values.ratio)
        const width = ratio >= 1 ? 640 : Math.round(640 * ratio)
        const height = ratio >= 1 ? Math.round(640 / ratio) : 640
        const tint = tintOf(job.values)
        const png = makePng(width, height, (x, y) => {
          const t = (x / width + y / height) / 2
          const ring = Math.abs(((x / width) * 8) % 2 - 1) < 0.5 ? 1 : 0.82
          return [
            Math.round(tint[0] * (0.35 + 0.65 * t) * ring),
            Math.round(tint[1] * (0.35 + 0.65 * t) * ring),
            Math.round(tint[2] * (0.35 + 0.65 * t) * ring),
          ]
        })
        jobs.delete(taskId)
        return {
          status: 'done',
          taskId,
          urls: ['data:image/png;base64,' + png.toString('base64')],
          text: '异步完成：比例=' + job.values.ratio + ' 画质=' + job.values.quality +
            (job.prompt ? ' ｜ 提示词=' + job.prompt : ''),
        }
      },
      cancel(taskId) {
        jobs.delete(taskId)
      },
    },

    // ---------------------------------------------------------------
    // 6. 直接失败：演示 { error } 这条返回路径
    // ---------------------------------------------------------------
    {
      id: 'full:icon-name',
      title: '演示 · 图标名（模糊查）',
      description: 'icon 写成平台名：先按字面命中 key，再中文/关键字模糊认。列表与触发器同源。',
      group: '演示 · 全功能',
      nodeTypes: ['video'],
      needsPrompt: false,
      order: 6,
      /** 写成中文名也行：火山引擎 / 可灵 / 豆包 都认 */
      icon: 'seedance',
      fields: [
        {
          key: 'ratio',
          kind: 'ratio',
          label: '比例',
          type: 'select',
          default: '16:9',
          options: [
            { label: '16:9', value: '16:9' },
            { label: '9:16', value: '9:16' },
          ],
        },
      ],
      async submit() {
        return { done: true, text: '图标名演示动作执行完毕' }
      },
    },

    // ---------------------------------------------------------------
    // 7. 直接失败：演示 { error } 这条返回路径
    // ---------------------------------------------------------------
    {
      id: 'full:fail',
      title: '演示 · 直接失败',
      description: 'submit 返回 { error }，底栏节点上会显示失败原因。',
      group: '演示 · 全功能',
      nodeTypes: ['image'],
      needsPrompt: false,
      order: 7,
      icon: ICON_SVG,
      async submit() {
        return { error: '这是一条演示用的失败原因：上游没有图片素材' }
      },
    },
  ],

  // ---------------------------------------------------------------
  // 顶层三个方法：契约要求 submit 挂在 provider 上，不是挂在 action 上。
  // 这里按 action.id 把活分发给各 action 自己那份实现 —— 动作一多时比一个
  // 大 switch 好读，也让每个动作的自测能单独跑。
  // ---------------------------------------------------------------

  async submit(action, input) {
    if (typeof action.submit !== 'function') {
      return { error: '动作 ' + action.id + ' 没有实现 submit' }
    }
    try {
      return await action.submit(action, input)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async poll(taskId, action) {
    if (typeof action.poll !== 'function') return { status: 'running' }
    return action.poll(taskId, action)
  },

  async cancel(taskId, action) {
    if (typeof action.cancel === 'function') await action.cancel(taskId, action)
  },
}

export default provider

