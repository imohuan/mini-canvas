/**
 * test 模型 —— 本地伪造的「模型端点」+ 自动登记（用户口径 2026-10-09）。
 *
 * 用户原话：
 *   「在模型列表中额外添加一个模型，命名为 test模型。当我请求这个 test模型 时，
 *    不需要真正请求后台，而是随便伪造一些数据返回过来。」
 *   「你这个测试模型，它的响应速度太快了，我一点反应都没有……我希望你的后台能够解析我发送的文本，
 *    比如说我会发送让你这个模型持续跑多久？你给我定一个规则，然后进行解析。
 *    我发送这条消息之后，你就会解析出这次的流需要多久才能完整返回。
 *    而且，我还可以自定义返回结果。」
 *
 * ## 节奏规则（写在消息里，后台解析）
 *
 *   ::test 时长=8s 间隔=120ms 内容=自定义回复::
 *
 * 键名（中英都认，大小写不敏感）：
 *   - 时长 / duration / dur / time —— 整条流跑多久。无单位=秒；支持 ms / s / 秒 / 分 / m / min。
 *   - 间隔 / gap / interval —— 每片之间等多久（默认 120ms）。给了时长就按时长反推间隔，间隔让位。
 *   - 内容 / text / content / reply —— 自定义返回正文（放最后，可含空格）。
 * 其它写法：`::test 8s::`（只给时长）、`::test::`（全默认）。指令会从回显正文里剥掉。
 *
 * ## 为什么做成「假端点」
 * SDK（@prismshadow/penguin-core）不开放注入自定义 LLM，它只按配置里的
 * provider / model_id / base_url / client_type 去请求一个 OpenAI 兼容端点。
 * 所以在**本进程内**挂一个假端点、再登记一个指向它的模型，是唯一无需改 SDK 的接法；
 * 好处是 SDK 的副作用全都照常发生 —— 转录、目标 hook 的 stop.mjs、队列调度、token 记账
 * 走的都是真实链路，只有那一次网络请求被伪造。
 *
 * 路径：POST /api/test-model/v1/chat/completions（标准 OpenAI Chat Completions SSE）。
 */
import { Hono } from "hono"

/** 这个假模型登记的渠道名 */
export const TEST_PROVIDER = "test"
/** 模型 id —— 就是界面上显示的「名字」（前端列表直接显示 modelId） */
export const TEST_MODEL_ID = "test模型"
/** 占位密钥：非空即可（SDK / openai 包要求有 apiKey；这个端点不校验它） */
export const TEST_API_KEY = "test-model-local"
/** 默认每片间隔（毫秒）—— 可被指令覆盖；默认值要够慢，让肉眼能看清「一段段吐出来」 */
export const DEFAULT_GAP_MS = 120
/** 一片最多多少字符（决定分片数） */
export const CHUNK_SIZE = 6
/** 单次流的上限（毫秒）—— 防手滑写出 `时长=99999` 把服务占死 */
export const MAX_DURATION_MS = 120_000

/** base_url（不含 chat/completions；openai 包会自己拼上）。origin 形如 http://127.0.0.1:8865 */
export function testModelBaseUrl(origin: string): string {
  return origin.replace(/\/+$/, "") + "/api/test-model/v1"
}

// ============================================================ 指令解析

export interface TestDirective {
  /** 整条流跑多久（毫秒）；null = 没指定 */
  durationMs: number | null
  /** 每片之间等多久（毫秒）；null = 没指定 */
  gapMs: number | null
  /** 自定义返回正文；null = 用默认的「回显」 */
  text: string | null
}

export interface TestRequestPlan {
  directive: TestDirective
  /** 剥掉指令后的正文（默认回显时用它） */
  cleanText: string
}

/** 时间词 → 毫秒。无单位按秒；ms/s/秒/分/m/min 都认。解析不了返回 null（不瞎猜）。 */
export function parseTimeToken(raw: string): number | null {
  const s = String(raw ?? "").trim().toLowerCase()
  if (!s) return null
  const m = /^(\d+(?:\.\d+)?)\s*(ms|毫秒|s|sec|秒|m|min|分钟|分)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  const unit = m[2] ?? "s"
  if (unit === "ms" || unit === "毫秒") return Math.round(n)
  if (unit === "m" || unit === "min" || unit === "分钟" || unit === "分") return Math.round(n * 60_000)
  return Math.round(n * 1000)
}

/** 从 OpenAI 请求体里拿所有 user 消息文本（新→旧） */
function userTexts(body: unknown): string[] {
  const messages = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages)) return []
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null
    if (m?.role !== "user") continue
    if (typeof m.content === "string") out.push(m.content)
    else if (Array.isArray(m.content)) {
      out.push(
        m.content
          .map((part) => {
            const p = part as { type?: unknown; text?: unknown } | null
            return p?.type === "text" && typeof p.text === "string" ? p.text : ""
          })
          .join(" "),
      )
    }
  }
  return out
}

/** 把一段 `::test …::` 里的键值对拆出来 */
function parseDirectiveBody(raw: string): TestDirective {
  const directive: TestDirective = { durationMs: null, gapMs: null, text: null }
  const body = raw.trim()
  // 单值简写：::test 8s::（没有 = 号、也不含「内容」这类键）
  if (body && !body.includes("=")) {
    const t = parseTimeToken(body)
    if (t !== null) directive.durationMs = t
    return directive
  }
  // 「内容=…」会吞掉后面所有字符（含空格），所以先单独切出来
  const textMatch = /(?:内容|text|content|reply)\s*=\s*([\s\S]*)$/.exec(body)
  if (textMatch) directive.text = textMatch[1].trim() || null
  const head = textMatch ? body.slice(0, textMatch.index) : body
  for (const seg of head.split(/[\s,;]+/)) {
    const eq = seg.indexOf("=")
    if (eq < 0) {
      // 裸时间词（前面没写键）：当作时长
      const t = parseTimeToken(seg)
      if (t !== null) directive.durationMs = t
      continue
    }
    const key = seg.slice(0, eq).trim().toLowerCase()
    const val = seg.slice(eq + 1).trim()
    if (key === "时长" || key === "duration" || key === "dur" || key === "time") {
      directive.durationMs = parseTimeToken(val)
    } else if (key === "间隔" || key === "gap" || key === "interval") {
      directive.gapMs = parseTimeToken(val)
    }
  }
  return directive
}

/** 找消息里的 `::test …::` 指令（从新到旧扫 user 消息，取第一条带指令的） */
function extractDirective(body: unknown): { directive: TestDirective; found: boolean } {
  for (const text of userTexts(body)) {
    const m = /::test\b([\s\S]*?)::/i.exec(text)
    if (m) return { directive: parseDirectiveBody(m[1] ?? ""), found: true }
  }
  return { directive: { durationMs: null, gapMs: null, text: null }, found: false }
}

/**
 * 解析一次请求：拿到指令 + 「剥掉指令后的正文」。
 * 回显用 cleanText（否则默认回复里会夹着 `::test …::` 本身）。
 */
export function analyzeTestRequest(body: unknown): TestRequestPlan {
  const texts = userTexts(body)
  const { directive } = extractDirective(body)
  const newest = texts[0] ?? ""
  // 只从**最新那条**里剥；指令可能在更早的一条里（那就不动最新这条的正文）
  const cleanText = newest.replace(/::test\b[\s\S]*?::/i, "").trim()
  return { directive, cleanText }
}

// ============================================================ 回复与节奏

/** 默认回复：回显这一轮的正文（取第一行，避免目标协议全文把回复撑爆） */
function echoReply(cleanText: string): string {
  const firstLine = cleanText.split(/\r?\n/)[0] ?? ""
  const echo = firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine
  return [
    "【test模型 · 本地伪造回复】",
    echo ? "收到：" + echo : "收到：（这一轮没有用户文本）",
    "",
    "以上由本地 test 模型伪造，没有请求任何真实后台。",
  ].join("\n")
}

/** 回复正文：有自定义内容就用它，否则回显 */
export function buildReply(directive: TestDirective, cleanText: string): string {
  if (directive.text) return directive.text
  return echoReply(cleanText)
}

/** 把回复切成小片（模仿真实流式） */
export function sliceReply(text: string, size = CHUNK_SIZE): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : [""]
}

export interface StreamPlan {
  /** 各分片之间的等待（毫秒）；长度 = chunkCount */
  waits: number[]
  /** 每片之后的间隔（归一后的值，纯展示/测试用） */
  gapMs: number
  chunkCount: number
  /** 整条流的时长（毫秒） */
  totalMs: number
}

/**
 * 按指令算出「每片等多久」。
 * - 给了时长：总等待 = 时长，平均分到每片（这样整条流正好跑那么久）；
 * - 只给间隔：每片都等间隔；
 * - 都没给：用默认间隔。
 * 时长上限 MAX_DURATION_MS。
 */
export function planStream(model: string, reply: string, directive: TestDirective): StreamPlan {
  void model
  const chunks = sliceReply(reply)
  const n = chunks.length
  const duration = directive.durationMs !== null ? Math.min(Math.max(0, directive.durationMs), MAX_DURATION_MS) : null
  if (duration !== null) {
    const per = n > 0 ? duration / n : 0
    return { waits: chunks.map(() => per), gapMs: per, chunkCount: n, totalMs: per * n }
  }
  const gap = directive.gapMs !== null ? Math.max(0, directive.gapMs) : DEFAULT_GAP_MS
  return { waits: chunks.map(() => gap), gapMs: gap, chunkCount: n, totalMs: gap * n }
}

// ============================================================ SSE 输出

/** 把一次回复编成一整段 OpenAI 兼容的 SSE 文本（不含等待；等待由路由逐片吐出） */
export function sseFrames(model: string, reply: string): string[] {
  const id = "chatcmpl-test-" + Date.now()
  const created = Math.floor(Date.now() / 1000)
  const frame = (o: unknown): string => "data: " + JSON.stringify(o) + "\n\n"
  const chunk = (delta: unknown, finish: string | null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  const frames: string[] = []
  frames.push(frame(chunk({ role: "assistant", content: "" }, null)))
  for (const piece of sliceReply(reply)) frames.push(frame(chunk({ content: piece }, null)))
  frames.push(frame(chunk({}, "stop")))
  const promptTokens = Math.max(1, Math.round(reply.length / 2))
  const completionTokens = Math.max(1, Math.round(reply.length / 2))
  frames.push(
    frame({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
  )
  frames.push("data: [DONE]\n\n")
  return frames
}

/** 一次性输出（测试 / 不需要拖时间时用） */
export function sseBodyFor(model: string, reply: string): string {
  return sseFrames(model, reply).join("")
}

/** 假的回复（兼容旧签名：不做指令解析，直接回显） */
export function fakeReplyFor(body: unknown): string {
  const { directive, cleanText } = analyzeTestRequest(body)
  return buildReply(directive, cleanText)
}

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

/**
 * 挂载假端点（返回 Hono，由 server.ts 注册；必须在 ui 静态兜底之前）。
 *
 * 按指令**逐片 + 逐片等待**输出，这样界面上能看到「流慢慢出来」——
 * 用户口径要的就是「有反应、能看清单条」。给了时长就整条流正好跑那么久。
 */
export function testModelRoutes(): Hono {
  const app = new Hono()
  app.post("/api/test-model/v1/chat/completions", async (c) => {
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      /* 空 body 也照回，别把测试卡在解析上 */
    }
    const { directive, cleanText } = analyzeTestRequest(body)
    const reply = buildReply(directive, cleanText)
    const model = String((body as { model?: unknown } | null)?.model ?? TEST_MODEL_ID)
    const plan = planStream(model, reply, directive)
    const frames = sseFrames(model, reply)
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let i = 0
        // 第一帧（role）立刻发，让前端马上知道「流开始了」
        controller.enqueue(encoder.encode(frames[i++] ?? ""))
        // 内容帧：一片一帧，每帧之后等 plan 指定的时间
        for (let k = 0; k < plan.chunkCount && i < frames.length - 2; k++) {
          await sleep(plan.waits[k] ?? 0)
          controller.enqueue(encoder.encode(frames[i++] ?? ""))
        }
        // 收尾帧（stop / usage / [DONE]）一起补上
        while (i < frames.length) controller.enqueue(encoder.encode(frames[i++] ?? ""))
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
    })
  })
  return app
}
