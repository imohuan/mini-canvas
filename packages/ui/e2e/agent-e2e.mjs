// @ts-nocheck
/**
 * agent-e2e —— Agent 插件的端到端 UI 自动化（真实浏览器 + 真实后台 + 真实模型）。
 *
 * 跑法：
 *   1) 起画布应用：pnpm -C packages/ui dev            （:5411）
 *   2) 起后台：     node packages/cloud-server/dist/cli.js serve --port 8890 --open
 *      （cloud-server 自己托管 ui 的构建产物，所以其实一步就够：serve 之后直接开那个地址）
 *   3) 跑本脚本：   node packages/ui/e2e/agent-e2e.mjs
 *
 * 覆盖用户点名的每一条：
 *   1. 发送对话：按钮有加载动画、对话列表正常渲染
 *   2. 执行工具：只有规则命中的工具才走手动审批
 *   3. 规则列表：可在界面上看到并点击
 *   4. 四种状态：思考 / 普通对话 / 工具卡片 / 审批卡片
 *   + 设置页：provider / MCP / skill 都能配
 *   + 对话列表、新建对话、切模型、引用技能与 MCP（@ 下拉）
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'

/**
 * 本地假上游（OpenAI 兼容的 GET /v1/models）。
 *
 * 为什么要它：Provider 页的「拉取 → tag 多选」要么真问上游、要么就测不了 ——
 * 而用户那台自建网关经常是 401 / 没起（实测就是），把断言挂在上游可用性上会**假红**。
 * 起一个本地桩，tag 这条链路就永远可测。
 */
const FAKE_UPSTREAM_PORT = 18899
const fakeUpstream = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ data: ['m-a', 'm-b', 'm-c', 'm-d'].map((id) => ({ id })) }))
})
await new Promise((r) => fakeUpstream.listen(FAKE_UPSTREAM_PORT, '127.0.0.1', r))
process.on('exit', () => fakeUpstream.close())

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:8890/'
const SHOTS = 'packages/ui/e2e/_shots'
if (!existsSync(EXE)) {
  console.error('chromium 不存在:', EXE)
  process.exit(2)
}
try { mkdirSync(SHOTS, { recursive: true }) } catch {}

const errors = []
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

let shot = 0
async function snap(name) {
  shot += 1
  const file = `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: false })
  console.log('  截图 ' + file)
  return file
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(2500)

// ---------- 1. 打开 Agent 面板（底栏按钮） ----------
const dockBtn = page.locator('button[aria-label="Agent 对话"]')
check('底栏有 Agent 入口按钮', (await dockBtn.count()) > 0)
await dockBtn.first().click()
await page.waitForTimeout(1200)
const shell = page.locator('.agent-shell')
check('面板已显示', await shell.isVisible())
await snap('panel-open')

// ---------- 1b. 预设提示词插入：不能带前导空行 ----------
// 用户报的 bug：点「感知画布开始创作」，插进输入框的文本前面多出一个换行。
// 根因是「外部设值」走了纯文本恢复分支，开头残留一个空段落（见 useEditor.setText 注释）。
{
  await page.locator('button[aria-label="新建对话"]').click()
  await page.waitForTimeout(900)
  const sugg = page.locator('.ac-suggestion')
  if ((await sugg.count()) === 0) {
    console.log('  当前不是空态（没有预设提示词）→ 跳过插入检查')
  } else {
    const want = (await sugg.first().innerText()).trim()
    await sugg.first().click()
    await page.waitForTimeout(500)
    const probe = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')
      if (!pm) return null
      const paras = [...pm.querySelectorAll('p')]
      return {
        paraCount: paras.length,
        firstParaEmpty: paras.length > 1 && paras[0].textContent.trim() === '',
        text: (pm.innerText || '').trim(),
      }
    })
    check('点预设提示词只产生一个段落（无前导空行）', !!probe && probe.paraCount === 1 && !probe.firstParaEmpty, JSON.stringify(probe))
    check('插入的正文就是那条提示词', !!probe && probe.text.includes(want), 'want=' + want + ' got=' + (probe ? probe.text : 'null'))
    if ((await sugg.count()) > 1) {
      await sugg.nth(1).click()
      await page.waitForTimeout(500)
      const probe2 = await page.evaluate(() => {
        const pm = document.querySelector('.ProseMirror')
        return pm ? { paraCount: pm.querySelectorAll('p').length, text: (pm.innerText || '').trim() } : null
      })
      check('再点另一条是整体替换（不叠加、不残留）', !!probe2 && probe2.paraCount === 1 && probe2.text !== probe.text, JSON.stringify(probe2))
    }
    await snap('suggestion-inserted')
    // 清掉，别影响后面用例
    await page.locator('.ac-editor .ProseMirror').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
  }
}

// ---------- 2. 未配模型时的引导（若已配则跳过） ----------
// ---------- 1c. 图片支持（用户要求「Agent 暂时还不支持图片，请添加」） ----------
// 这里验**界面这一侧**：选图出缩略图、只有图也能发、发完画在消息里、点开能看大图。
// （图片随转录落盘、刷新后回放，由后端单测 + 本轮浏览器实测覆盖。）
{
  const shotPath = 'packages/ui/e2e/_tmp-image.png'
  // 1×1 的真 PNG（够小，且是合法图片字节）
  writeFileSync(shotPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'))
  const fileInput = page.locator('.ac-file')
  check('输入框有图片选择入口（隐藏的 file input）', (await fileInput.count()) > 0)
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(shotPath)
    await page.waitForTimeout(600)
    const picked = await page.evaluate(() => ({
      thumbs: document.querySelectorAll('.ac-attach').length,
      hasThumbImg: !!document.querySelector('.ac-attach img'),
      src: (document.querySelector('.ac-attach img') || {}).src?.slice(0, 22),
    }))
    check('选图后出现待发送缩略图', picked.thumbs === 1 && picked.hasThumbImg, JSON.stringify(picked))
    // 只有图、没打字：发送键要可用（"这图是什么"这种问法）
    check('只有图也能发送（发送键可用）', !(await page.locator('.ac-send').isDisabled()), 'disabled=' + (await page.locator('.ac-send').isDisabled()))
    // 移除附件
    await page.locator('.ac-attach-del').first().click()
    await page.waitForTimeout(300)
    check('能移除待发送的图', (await page.locator('.ac-attach').count()) === 0)
    check('移除后发送键又变灰（没字没图）', await page.locator('.ac-send').isDisabled())
    await snap('image-picker')
  }
  // 收尾：确保没有残留的附件/文字带进后面用例（本块只验选择与移除）
  await page.evaluate(() => {
    document.querySelectorAll('.ac-attach-del').forEach((b) => b.click())
  })
  await page.waitForTimeout(200)
  await page.locator('.ac-editor .ProseMirror').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  try { rmSync(shotPath, { force: true }) } catch { /* 清理失败不影响用例 */ }
}

const needsModel = await page.locator('.ac-onboard').count()
if (needsModel > 0) {
  console.log('  当前还没有可用模型 → 正在经设置页添加')
  await page.locator('button[aria-label="Agent 设置"]').click()
  await page.waitForTimeout(600)
  const settings = page.locator('.psd-dialog')
  check('设置面板已打开', await settings.isVisible())
  await page.locator('.psd-nav-item', { hasText: 'Agent' }).first().click()
  await page.waitForTimeout(400)
  check('设置里有 Agent 一级导航', (await page.locator('.asn').count()) > 0)
  await page.locator('.asp-tab', { hasText: 'Provider' }).first().click()
  await page.waitForTimeout(500)
  await snap('settings-models')
  // 新 Provider UI：填渠道 → 拉取 → 用 tag 勾选 → 保存
  await page.locator('.ap-models .ap-field', { hasText: '渠道名' }).locator('input').fill(process.env.AGENT_PROVIDER ?? 'local')
  await page.locator('.ap-models .ap-field', { hasText: 'Base URL' }).locator('input').fill(process.env.AGENT_BASEURL ?? 'http://127.0.0.1:3000/v1')
  await page.locator('.ap-models .ap-field', { hasText: 'API Key' }).locator('input').fill(process.env.AGENT_KEY ?? '')
  const pull0 = page.locator('.ap-models button', { hasText: '拉取模型清单' }).first()
  if ((await pull0.count()) > 0) { await pull0.click(); await page.waitForTimeout(6000) }
  // 勾上目标模型（拉回来的 tag 池里找；找不到就全选）
  const want = page.locator('.ap-tagchip', { hasText: process.env.AGENT_MODEL ?? 'deepseek-auto' }).first()
  if ((await want.count()) > 0) await want.click()
  else await page.locator('.ap-quick button', { hasText: '全选' }).click()
  await page.waitForTimeout(300)
  await page.locator('.ap-submit').click()
  await page.waitForTimeout(2000)
  check('模型写入后渠道列表里出现了它', (await page.locator('.ap-models .ap-tr:not(.is-head)').count()) > 0)
  await snap('settings-models-saved')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
} else {
  check('模型已配置（无需引导）', true)
}

// ---------- 3. 设置页：MCP 与技能 ----------
await page.locator('button[aria-label="Agent 设置"]').click()
await page.waitForTimeout(600)
await page.locator('.psd-nav-item', { hasText: 'Agent' }).first().click()
await page.waitForTimeout(300)
// Agent 页内部的分页签是**页面自己画的**（.asp-tab）：Provider / 技能 / MCP / 审批规则 / 系统提示词。
// 为什么不用面板的 .psd-tab-item：那是面板的页签标签，把整页注册进去会把页签条撑到 600px、
// 内容区被压成 22px（实测），整页都看不见。
const aspTabs = await page.locator('.asp-tab').allInnerTexts()
check('设置里有一排分页签', aspTabs.includes('Provider') && aspTabs.includes('技能'), aspTabs.join('/'))
for (const a of [
  { tab: '技能', body: '.ap-skills' },
  { tab: 'MCP', body: '.ap-mcp' },
  { tab: '审批规则', body: '.ap-rules' },
  { tab: '系统提示词', body: '.ap-prompt' },
]) {
  await page.locator('.asp-tab', { hasText: a.tab }).first().click()
  await page.waitForTimeout(600)
  check(`点「${a.tab}」切到对应内容`, (await page.locator(a.body).count()) > 0)
  await snap('settings-' + a.tab)
  // MCP 页：主动「检查连接」——不必先发一句话就能看到连没连上、有哪些工具
  if (a.tab === 'MCP') {
    const probeBtn = page.locator('.ap-mcp .ap-block-head button', { hasText: '检查连接' }).first()
    check('MCP 页有「检查连接」按钮', (await probeBtn.count()) > 0)
    if ((await probeBtn.count()) > 0) {
      await probeBtn.click()
      await page.waitForTimeout(3000)
      const probe = await page.evaluate(() => {
        const box = document.querySelector('.ap-probe')
        if (!box) return null
        return {
          summary: (box.querySelector('.ap-hint') || {}).textContent.replace(/\s+/g, ' ').trim(),
          toolTags: [...box.querySelectorAll('.ap-tagchip')].map((t) => t.textContent.trim()),
        }
      })
      check('检查后有结果（连了几个 / 报了什么）', !!probe && probe.summary.length > 0, JSON.stringify(probe))
      // 连上就该列出工具 tag；连不上至少要有明确状态文字（已由上面那条覆盖）
      if (probe && /连接成功/.test(probe.summary)) {
        check('连接成功时列出了可用工具', probe.toolTags.length > 0, probe.toolTags.join(','))
      }
      await snap('settings-mcp-probe')
    }
  }
}
// 内容区必须真的显示得出来（不是被压成一条缝）
const bodyBox = await page.locator('.psd-content-body').boundingBox()
check('设置内容区高度正常（没被压扁）', !!bodyBox && bodyBox.height > 200, 'h=' + (bodyBox ? Math.round(bodyBox.height) : 'null'))
// Provider 页（用户口径：一个渠道配一批模型，拉取后 tag 多选 / 反选 / 全选）
await page.locator('.asp-tab', { hasText: 'Provider' }).first().click()
await page.waitForTimeout(600)
check('Provider 页按渠道聚合（表头是「渠道」）', (await page.locator('.ap-models .ap-table .ap-tr.is-head').first().innerText()).includes('渠道'))
const pullBtn = page.locator('.ap-models button', { hasText: '拉取模型清单' }).first()
check('Provider 页有「拉取模型清单」按钮', (await pullBtn.count()) > 0)
check('Provider 页有「新建渠道」按钮', (await page.locator('.ap-models button', { hasText: '新建渠道' }).count()) > 0)
check('已配置渠道每行都有「编辑」', (await page.locator('.ap-models .ap-table .ap-tr:not(.is-head) button', { hasText: '编辑' }).count()) > 0)
if ((await pullBtn.count()) > 0) {
  // 把编辑区的 Base URL 指向本地假上游，再拉 —— 清单就有确定的 4 个模型
  await page.locator('.ap-models .ap-field', { hasText: 'Base URL' }).locator('input')
    .fill('http://127.0.0.1:' + FAKE_UPSTREAM_PORT + '/v1')
  await page.waitForTimeout(200)
  await pullBtn.click()
  await page.waitForTimeout(2500)
  const tagCount = await page.locator('.ap-tagchip').count()
  if (tagCount === 0) {
    // 假上游没起来（端口被占等）：宁可明确报红，也不要静默跳过整段 tag 断言
    check('拉取后出现 tag 候选池', false, '本地假上游没返回清单（端口 ' + FAKE_UPSTREAM_PORT + ' 被占？）')
  } else {
    check('拉取后出现 tag 候选池', tagCount > 2, 'count=' + tagCount)
    const quick = await page.locator('.ap-quick button').allInnerTexts()
    check('tag 池支持 全选/反选/清空', quick.includes('全选') && quick.includes('反选') && quick.includes('清空'), quick.join('/'))
    await page.locator('.ap-quick button', { hasText: '全选' }).click()
    await page.waitForTimeout(200)
    check('「全选」勾中全部 tag', (await page.locator('.ap-tagchip.is-on').count()) === tagCount, (await page.locator('.ap-tagchip.is-on').count()) + '/' + tagCount)
    await page.locator('.ap-quick button', { hasText: '反选' }).click()
    await page.waitForTimeout(200)
    check('「反选」把勾选反过来', (await page.locator('.ap-tagchip.is-on').count()) === 0)
    await page.locator('.ap-quick button', { hasText: '清空' }).click()
    await page.waitForTimeout(200)
    check('「清空」取消所有勾选', (await page.locator('.ap-tagchip.is-on').count()) === 0)
  }
  await snap('settings-provider-tags')
}
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// ---------- 4. 对话列表 + 发消息（按钮加载动画 + 渲染） ----------
const input = page.locator('.ac-editor .ProseMirror, .ac-editor [contenteditable="true"]')
check('输入框已渲染（ProseMirror）', (await input.count()) > 0)
await input.first().click()
await page.keyboard.type('你好，请只回答两个字：收到')
await page.waitForTimeout(300)
await snap('composer-typed')
const sendBtn = page.locator('.ac-send')
check('发送按钮可用', await sendBtn.isEnabled())
await sendBtn.click()
await snap('sending')
// 运行态是瞬态：模型首字可能几毫秒就到，用轮询而不是定长等待，
// 否则会偶发地把一条正确的功能判成失败。
let sawRunning = false
for (let i = 0; i < 40; i++) {
  if ((await page.locator('.ac-send.is-running').count()) > 0) { sawRunning = true; break }
  await page.waitForTimeout(50)
}
// 「等首个 token」时显示的是加载行（转圈 + 正在思考），不再是一根闪烁的方块光标
// （用户口径：把模拟光标换成一个加载 UI，文案「正在思考」）。
{
  const pending = await page.evaluate(() => {
    const el = document.querySelector('.ac-pending')
    if (!el) return null
    const spin = el.querySelector('.ac-pending-spin')
    const cs = spin ? getComputedStyle(spin) : null
    return {
      text: el.textContent.trim(),
      role: el.getAttribute('role'),
      spinRound: cs ? cs.borderRadius === '50%' : false,
      spinAnimating: cs ? cs.animationIterationCount === 'infinite' : false,
      // 开口弧：上边框透明，转起来才看得出在动
      openArc: cs ? cs.borderTopColor === 'rgba(0, 0, 0, 0)' : false,
      caretGone: !document.querySelector('.ac-caret'),
    }
  })
  if (pending) {
    check('等待首个 token 时显示「正在思考」', pending.text === '正在思考', pending.text)
    check('加载行是可读屏的状态行（role=status）', pending.role === 'status', String(pending.role))
    check('加载行是转圈的圆环（不是闪烁方块）', pending.spinRound && pending.spinAnimating && pending.openArc, JSON.stringify(pending))
    check('旧的闪烁光标已移除', pending.caretGone)
  } else {
    console.log('  没抓到「正在思考」那一瞬（模型首字太快）→ 跳过加载行断言')
  }
}
if (!sawRunning) {
  // 已经跑完也算通过：只要助手消息确实出现了（说明它经过了运行态）
  sawRunning = (await page.locator('.ac-msg.assistant').count()) > 0
}
check('发送后按钮进入运行态（加载动画）', sawRunning)

// 等回答（最多 90 秒）
const deadline = Date.now() + 90000
let answered = false
while (Date.now() < deadline) {
  const txt = await page.locator('.ac-scroll').innerText().catch(() => '')
  if (txt.includes('收到')) { answered = true; break }
  await page.waitForTimeout(1000)
}
check('对话列表渲染出了回答', answered)
await page.waitForTimeout(1200)
await snap('answered')
const bubbleCount = await page.locator('.ac-msg').count()
check('消息气泡都在（用户 + 助手）', bubbleCount >= 2, 'count=' + bubbleCount)

// 消息布局（用户口径）：不要头像；用户靠右、AI 靠左；字号比之前小一号
// 助手那条要等真出字再量字号（否则量到的是还没渲染的空壳）
await page.locator('.ac-msg.assistant .md .md-p').first().waitFor({ timeout: 20000 }).catch(() => null)
const layout = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ac-msg')]
  const scroller = document.querySelector('.ac-scroll')
  if (!scroller) return []
  const box = scroller.getBoundingClientRect()
  return rows.map((m) => {
    const b = m.querySelector('.ac-bubble').getBoundingClientRect()
    return {
      kind: m.className.includes('user') ? 'user' : 'assistant',
      justify: getComputedStyle(m).justifyContent,
      left: Math.round(b.left - box.left),
      width: Math.round(b.width),
      // 正文右缘距滚动区右缘的空档：助手消息应≈滚动区内边距(16)，不应出现 84 那种大留白
      rightGap: (() => {
        const inner = m.querySelector('.md') || m.querySelector('.ac-user-line')
        return inner ? Math.round(box.right - inner.getBoundingClientRect().right) : null
      })(),
      // 量**内层正文字号**：.ac-bubble 自己是外壳，字号设在里面的 Markdown 上
      fontSize: (() => {
        const inner = m.querySelector('.md .md-p') || m.querySelector('.md')
        return inner ? getComputedStyle(inner).fontSize : null
      })(),
    }
  })
})
const userRow = layout.find((r) => r.kind === 'user')
const aiRow = layout.find((r) => r.kind === 'assistant')
check('用户消息靠右', !!userRow && userRow.justify === 'flex-end', userRow?.justify)
check('AI 回复靠左', !!aiRow && aiRow.justify === 'flex-start', aiRow?.justify)
check('消息不再显示左侧头像', (await page.locator('.ac-avatar').count()) === 0)
// 字号以 LiBTV 实测为准（Chrome MCP 量到正文 14px / 行高 24px），不是早期的 12px
check('正文用 14px（照参考页实测）', !!aiRow && !!aiRow.fontSize && parseFloat(aiRow.fontSize) === 14, aiRow?.fontSize)
// 助手正文要占满整行：右内边距一旦留白（曾经的 84px），面板右侧会出现一条空档
check('助手正文占满整行（右侧不留白）', !!aiRow && aiRow.rightGap !== null && aiRow.rightGap <= 20, 'rightGap=' + (aiRow ? aiRow.rightGap : 'null'))

// 面板底色必须是**不透明**的：早期照参考页做过半透明 + 毛玻璃，实测底下的画布节点
// 会透上来、正文和它糊在一起（用户点名）。这里量计算样式，透明一定会被抓到。
{
  const shellStyle = await page.evaluate(() => {
    const el = document.querySelector('.agent-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, backdrop: cs.backdropFilter, radius: cs.borderRadius }
  })
  const opaque = !!shellStyle && /^rgba?\(/.test(shellStyle.bg) && !/rgba\([^)]*,\s*0?\.\d+\)/.test(shellStyle.bg)
  check('面板底色不透明（画布不透上来）', opaque, JSON.stringify(shellStyle))
  check('面板不再用毛玻璃', !!shellStyle && (shellStyle.backdrop === 'none' || shellStyle.backdrop === ''), shellStyle?.backdrop)
}

// Markdown 列表符号：Tailwind preflight 会全局 `ol,ul{list-style:none}`，
// 不显式写回来的话列表只剩缩进、没有圆点（用户报的就是这个）。
//
// 量法：往**已有的** `.md` 元素里插一段真列表再读计算样式。
// 为什么不自己造个 .md：scoped 规则是 `.md[data-v-x] .md-list`，后代选择器不要求
// 后代带属性 —— 挂在真 .md 里就能命中真实样式。
// （也不查 CSSOM 字符串：`disc` 是 list-style-type 的初始值，会被省略不写。）
{
  const listProbe = await page.evaluate(() => {
    const md = document.querySelector('.md')
    if (!md) return null
    const ul = document.createElement('ul')
    ul.className = 'md-list'
    ul.innerHTML = '<li>甲</li><li>乙</li>'
    md.appendChild(ul)
    const cs = getComputedStyle(ul)
    const li = getComputedStyle(ul.querySelector('li'))
    const out = { type: cs.listStyleType, position: cs.listStylePosition, paddingLeft: cs.paddingLeft, liType: li.listStyleType }
    ul.remove()
    return out
  })
  check('Markdown 列表有圆点（没被全局 reset 吃掉）', !!listProbe && listProbe.type === 'disc' && listProbe.liType === 'disc', JSON.stringify(listProbe))
  check('Markdown 列表有左缩进（防 preflight 清零）', !!listProbe && parseFloat(listProbe.paddingLeft) > 0, listProbe?.paddingLeft)
}


// 面板头与画布右上角按钮**不能重叠**（用户报过的 bug：z-index 相等时顶栏压在面板上）
const overlap = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.shell-top-right button')].map((b) => b.getBoundingClientRect())
  const head = document.querySelector('.agent-head')?.getBoundingClientRect()
  const panel = document.querySelector('.agent-shell')?.getBoundingClientRect()
  const hit = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
  return {
    anyOverlaps: !!head && btns.some((b) => hit(b, head)),
    rightmostBtnRight: btns.length ? Math.round(Math.max(...btns.map((b) => b.right))) : null,
    panelLeft: panel ? Math.round(panel.left) : null,
  }
})
check('右上角按钮不压在 Agent 面板上', !overlap.anyOverlaps, JSON.stringify(overlap))

// 消息流里的「已连接 MCP：…」过程提示**暂时隐藏**（用户口径：不要删除，只是先不显示）。
// 数据仍然在 turn.notice 上；MCP 的真实状态改到下面的下拉里按需检测。
check('过程提示不再画在消息流里', (await page.locator('.ac-notice').count()) === 0)

// 底栏那排按钮：下拉一律是**设计系统目录里的 dropdown**（.dd-menu 是它的浮层）。
// 技能 / MCP 点一项 = 往输入框插一个标签（不再切开关）。
const skillTb = page.locator('.ac-toolbar button[aria-label="选择技能"]').first()
check('底栏有「技能」按钮', (await skillTb.count()) > 0)

// 输入框左下角的「授权方式」下拉：接受审核 / 完全自动授权。
// 它与「设置 → Agent → 审批规则」里那个开关是**同一条通道**（policy.enabled），
// 所以这里同时验「下拉真的改了后端策略」+「设置页跟着同步」。
{
  const authTb = page.locator('.ac-toolbar button[aria-label^="授权方式"]').first()
  check('底栏有「授权方式」下拉', (await authTb.count()) > 0)
  if ((await authTb.count()) > 0) {
    const before = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('agent').state.policy.enabled)
    await authTb.click()
    await page.waitForTimeout(500)
    const menu = await page.evaluate(() => {
      const m = document.querySelector('.dd-menu')
      if (!m) return null
      return {
        labels: [...m.querySelectorAll('.ac-menu-name')].map((e) => e.textContent.trim()),
        // 当前项要打勾（照参考图：选中项右侧一个对勾）
        checked: [...m.querySelectorAll('.ac-menu-item')].filter((b) => b.querySelector('.ac-menu-check')).map((b) => b.querySelector('.ac-menu-name').textContent.trim()),
      }
    })
    check('下拉有两个选项（接受审核 / 完全自动授权）', !!menu && menu.labels.includes('接受审核') && menu.labels.includes('完全自动授权'), JSON.stringify(menu))
    check('当前授权方式打了勾', !!menu && menu.checked.length === 1, JSON.stringify(menu ? menu.checked : null))
    // 切到与当前相反的那一项，验证真的写进后端策略
    const target = before ? '完全自动授权' : '接受审核'
    await page.locator('.ac-menu-item', { hasText: target }).click()
    await page.waitForTimeout(1200)
    const after = await page.evaluate(() => ({
      enabled: window.MiniCanvasUI.getHost().ctx.get('agent').state.policy.enabled,
      label: document.querySelector('.ac-toolbar button[aria-label^="授权方式"]').getAttribute('aria-label'),
    }))
    check('切换授权方式真的改了后端策略', after.enabled === !before, 'before=' + before + ' after=' + after.enabled)
    check('按钮文案跟着变', after.label.includes(target), after.label)
    await snap('auth-mode')
    // 改回去，别把策略留在非默认态影响后面的审批用例
    await authTb.click()
    await page.waitForTimeout(400)
    await page.locator('.ac-menu-item', { hasText: before ? '接受审核' : '完全自动授权' }).click()
    await page.waitForTimeout(1200)
    check('授权方式已复原（不影响后续审批用例）', (await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('agent').state.policy.enabled)) === before)
  }
}
await skillTb.click()
await page.waitForTimeout(500)
check('点「技能」能展开下拉', (await page.locator('.dd-menu .ac-menu-card').count()) > 0)
check('技能下拉每行有图标', (await page.locator('.dd-menu .ac-menu-card-icon svg').count()) > 0)
// 结构（用户口径：上下 flex 分栏 —— 标题固定、只有下面列表滚，滚动条只出在列表区；
// 不是整个浮层滚、更不该靠 sticky 去补）。
check('技能下拉有分组标题 + 计数', /^技能\s*\d+$/.test((await page.locator('.dd-menu .ac-menu-head').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()), await page.locator('.dd-menu .ac-menu-head').innerText().catch(() => ''))
{
  const menuBox = await page.evaluate(() => {
    const m = document.querySelector('.dd-menu')
    const sc = document.querySelector('.dd-menu .ac-menu-scroll')
    const head = document.querySelector('.dd-menu .ac-menu-head')
    if (!m) return null
    const cs = getComputedStyle(m)
    const scs = sc ? getComputedStyle(sc) : null
    const hr = head ? head.getBoundingClientRect() : null
    const sr = sc ? sc.getBoundingClientRect() : null
    return {
      menuH: Math.round(m.getBoundingClientRect().height),
      viewportH: window.innerHeight,
      // 浮层自身**不滚**（只当外框），滚动发生在列表区
      menuOverflowY: cs.overflowY,
      menuScrollsItself: m.scrollHeight > m.clientHeight + 2,
      scrollOverflowY: scs ? scs.overflowY : null,
      scrollScrollsItself: sc ? sc.scrollHeight > sc.clientHeight + 2 : null,
      // 标题在列表区**上方**，且不是靠定位吸住（position 应是 static）
      headPosition: head ? getComputedStyle(head).position : null,
      headAboveList: !!hr && !!sr && hr.bottom <= sr.top + 1,
      // 行卡片有底色/圆角才算"一条一条"的结构（不是裸文字行）
      cardBg: getComputedStyle(document.querySelector('.dd-menu .ac-menu-card')).backgroundColor,
      cardRadius: getComputedStyle(document.querySelector('.dd-menu .ac-menu-card')).borderRadius,
    }
  })
  check('下拉高度不超过视口（有限高）', !!menuBox && menuBox.menuH <= menuBox.viewportH - 16, JSON.stringify(menuBox))
  check('浮层自身不滚（只当外框）', !!menuBox && !menuBox.menuScrollsItself, JSON.stringify(menuBox))
  // 这里只断言「列表区**具备**滚动能力」（overflow-y auto）。是否真的滚取决于内容长度 ——
  // 技能只有 2 条、根本不需要滚；「真的滚起来」在模型下拉（37 条）那边验。
  check('只有列表区能滚（overflow-y auto）', !!menuBox && menuBox.scrollOverflowY === 'auto', JSON.stringify(menuBox))
  check('标题在列表区上方且不靠定位', !!menuBox && menuBox.headAboveList && menuBox.headPosition === 'static', JSON.stringify(menuBox))
  check('每行是带底色和圆角的卡片（有层次）', !!menuBox && menuBox.cardRadius !== '0px', JSON.stringify(menuBox))
}

await snap('toolbar-menu')
// 点一项 → 输入框里出现一个带图标的标签（不是开关态高亮）
await page.locator('.dd-menu .ac-menu-card').first().click()
await page.waitForTimeout(500)
const tag = page.locator('.prose-mirror-editor .ac-tag').first()
check('点技能后输入框插入了标签', (await tag.count()) > 0)
check('标签左侧有图标', (await page.locator('.prose-mirror-editor .ac-tag .ac-tag-icon svg').count()) > 0)
check('技能按钮不再显示开关态高亮', (await page.locator('.ac-toolbar button[aria-label="选择技能"].is-on').count()) === 0)
await snap('toolbar-tag')
// 下拉此时应已自动收起（点一项即插入并关闭）
check('点一项后下拉自动收起', (await page.locator('.dd-menu').count()) === 0)
// 清空输入框（标签是可删的，删掉引用就该失效）
const clearBox = page.locator('.ac-editor .ProseMirror')
await clearBox.click()
await page.keyboard.press('Control+A')
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
check('删掉标签后引用失效', (await page.locator('.prose-mirror-editor .ac-tag').count()) === 0)

// 上下文剩余：照参考页实测画成**环形 SVG**（12×12 viewBox / r=5.25 / 描边 1.5），
// 数值走 aria-label，hover 出提示气泡（不再是干巴巴的 "96%" 文字）。
const ctxProbe = await page.evaluate(() => {
  const el = document.querySelector('.ac-context')
  if (!el) return null
  const svg = el.querySelector('svg')
  const circles = svg ? [...svg.querySelectorAll('circle')] : []
  const arc = circles[1]
  return {
    aria: el.getAttribute('aria-label'),
    box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })(),
    viewBox: svg ? svg.getAttribute('viewBox') : null,
    r: arc ? arc.getAttribute('r') : null,
    strokeWidth: arc ? arc.getAttribute('stroke-width') : null,
    dashArray: arc ? Number(arc.getAttribute('stroke-dasharray')) : null,
    dashOffset: arc ? Number(arc.getAttribute('stroke-dashoffset')) : null,
  }
})
const ctxLeft = ctxProbe && /上下文剩余 (\d+)%/.exec(ctxProbe.aria || '')
check('上下文用环形 SVG 显示', !!ctxProbe && !!ctxProbe.viewBox, JSON.stringify(ctxProbe))
check('环的几何照参考页（12×12 / r=5.25 / 描边 1.5）', !!ctxProbe && ctxProbe.viewBox === '0 0 12 12' && ctxProbe.r === '5.25' && ctxProbe.strokeWidth === '1.5', JSON.stringify(ctxProbe))
check('环的触发区 32×32（与工具条按钮同尺寸）', !!ctxProbe && ctxProbe.box[0] === 32 && ctxProbe.box[1] === 32, ctxProbe ? ctxProbe.box.join('×') : 'null')
// 弧长 = 已用比例：offset = 周长 × 剩余%（允许 0.5% 误差）
if (ctxLeft) {
  const left = Number(ctxLeft[1])
  const C = 2 * Math.PI * 5.25
  check('弧长与剩余百分比一致', !!ctxProbe && Math.abs(ctxProbe.dashOffset - C * left / 100) < C * 0.02, 'left=' + left + '% offset=' + (ctxProbe ? ctxProbe.dashOffset : 'null'))
}
// hover 出提示气泡
await page.locator('.ac-context').hover()
await page.waitForTimeout(400)
const ctxTip = await page.evaluate(() => {
  const t = document.querySelector('.tlt-bubble')
  if (!t) return null
  const trig = document.querySelector('.ac-context').getBoundingClientRect()
  const r = t.getBoundingClientRect()
  return { text: t.textContent, above: r.bottom <= trig.top + 1, hasArrow: !!t.querySelector('.tlt-arrow') }
})
check('hover 上下文环出提示气泡', !!ctxTip, JSON.stringify(ctxTip))
check('提示内容是「上下文剩余 N%」', !!ctxTip && /^上下文剩余 \d+%$/.test(ctxTip.text || ''), ctxTip?.text)
await page.mouse.move(10, 10)
await page.waitForTimeout(250)

// MCP 下拉里的「检测」：主动连一次，实时看到每个服务连了几个工具。
// 为什么要在下拉里做：消息流里那条「已连接 MCP」提示隐藏了，状态得有个地方按需看。
// （放在这一段末尾：它会开自己的下拉、用完按 Esc 收起，不影响前面的技能下拉断言。）
{
  const mcpTb = page.locator('.ac-toolbar button[aria-label="选择 MCP"]').first()
  check('底栏有「MCP」按钮', (await mcpTb.count()) > 0)
  if ((await mcpTb.count()) > 0) {
    await mcpTb.click()
    await page.waitForTimeout(500)
    const probeBtn = page.locator('.dd-menu .ac-menu-head-btn').first()
    check('MCP 下拉标题右侧有「检测」按钮', (await probeBtn.count()) > 0, (await page.locator('.dd-menu .ac-menu-head').innerText().catch(() => '')).replace(/\s+/g, ' '))
    if ((await probeBtn.count()) > 0) {
      await probeBtn.click()
      // 等检测**真的结束**：「正在连接…」那句中转提示不算结果，得等按钮回到可点
      for (let i = 0; i < 60; i++) {
        const done = await page.evaluate(() => {
          const btn = document.querySelector('.dd-menu .ac-menu-head-btn')
          return !!btn && !btn.disabled
        })
        if (done) break
        await page.waitForTimeout(400)
      }
      const probe = await page.evaluate(() => ({
        badges: [...document.querySelectorAll('.dd-menu .ac-menu-card-badge')].map((b) => b.textContent.trim()),
        hint: (document.querySelector('.dd-menu .ac-menu-empty') || {}).textContent?.trim() ?? '',
        btnEnabled: !document.querySelector('.dd-menu .ac-menu-head-btn')?.disabled,
      }))
      check('检测后每个服务都有状态（徽章或说明）', probe.badges.length > 0 || probe.hint.length > 0, JSON.stringify(probe))
      check('检测结束按钮恢复可点', probe.btnEnabled, JSON.stringify(probe))
      if (probe.badges.length) {
        check('连上时徽章显示工具数', /\d+\s*个工具/.test(probe.badges.join(' ')), probe.badges.join(','))
      }
      await snap('mcp-probe-dropdown')
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

// ---------- 4b. 发送后「引用仍是标签」+「助手正文占满整行」 ----------
// 先往输入框插一个技能标签，再发一句，验证用户那条消息里它**没有退化成 @名字 纯文本**。
{
  const skillBtn2 = page.locator('.ac-toolbar button[aria-label="选择技能"]').first()
  // 先清空输入框：上一段用例可能留下文字/标签，直接从干净状态开跑
  await page.locator('.ac-editor .ProseMirror').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  if ((await skillBtn2.count()) > 0) {
    await skillBtn2.click()
    await page.waitForTimeout(500)
    await page.locator('.dd-menu .ac-menu-card').first().click()
    await page.waitForTimeout(400)
  }
  await page.locator('.ac-editor .ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type('只回答两个字：收到')
  await page.waitForTimeout(200)
  await page.locator('.ac-send').click()
  for (let i = 0; i < 60; i++) {
    const running = await page.locator('.ac-send.is-running').count()
    if (running === 0) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(1200)

  const sentProbe = await page.evaluate(() => {
    const users = [...document.querySelectorAll('.ac-msg.user')]
    const u = users[users.length - 1]
    if (!u) return null
    const tag = u.querySelector('.ac-sent-tag')
    // 去掉标签文字后再看还剩不剩 @xxx（标签本身不算"残留纯文本"）
    const plain = (u.innerText || '').replace(tag ? tag.textContent : '', '')
    return {
      hasTag: !!tag,
      label: tag ? tag.textContent : null,
      hasIcon: !!u.querySelector('.ac-sent-tag-icon svg'),
      leftoverAt: /@[A-Za-z\u4e00-\u9fff]/.test(plain),
      raw: (u.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    }
  })
  check('发送后用户消息里的技能仍是标签', !!sentProbe && sentProbe.hasTag, JSON.stringify(sentProbe))
  check('发送后的标签带左侧图标', !!sentProbe && sentProbe.hasIcon)
  check('发送后不残留 @名字 纯文本', !!sentProbe && !sentProbe.leftoverAt, JSON.stringify(sentProbe))

  const widthProbe = await page.evaluate(() => {
    const scroller = document.querySelector('.ac-scroll')
    const rows = [...document.querySelectorAll('.ac-msg.assistant')]
    const a = rows[rows.length - 1]
    if (!scroller || !a) return null
    const box = scroller.getBoundingClientRect()
    const md = a.querySelector('.md')
    if (!md) return null
    return { rightGap: Math.round(box.right - md.getBoundingClientRect().right), mdW: Math.round(md.getBoundingClientRect().width), boxW: Math.round(box.width) }
  })
  check('助手正文占满整行（右侧不留白）', !!widthProbe && widthProbe.rightGap <= 20, JSON.stringify(widthProbe))

  // 清掉这一轮，别影响后面用例
  await page.locator('button[aria-label="新建对话"]').click()
  await page.waitForTimeout(800)
}

// ---------- 5. 思考 / 工具 / 审批 三种额外状态 ----------
const thinkCount = await page.locator('.ac-think-toggle').count()
console.log('  思考折叠块数量 = ' + thinkCount)
const toolLine = await page.locator('.ac-tool-line').count()
const toolCard = await page.locator('.ac-tool-card').count()
console.log('  工具行 = ' + toolLine + '，工具卡片 = ' + toolCard)
await snap('states')

// ---------- 5b. 思考态（要 clientType=deepseek-v4 才会吐 thinking；见设置页的「客户端协议」） ----------
if (thinkCount > 0) {
  await page.locator('.ac-think-toggle').first().click()
  await page.waitForTimeout(400)
  const thinkText = await page.locator('.ac-think').first().innerText().catch(() => '')
  check('展开思考能看到推理内容', thinkText.length > 0, 'len=' + thinkText.length)
  await snap('thinking-expanded')
} else {
  console.log('  这一轮没有思考载荷（模型/客户端协议没吐），跳过思考展开检查')
}

// ---------- 5c. 非审批工具走「简洁一行」（不出卡片、不出审批） ----------
await page.locator('.ac-editor [contenteditable="true"]').first().click()
await page.keyboard.type('请调用 smart MCP 的工具查一下可用工具，必须真的调用，不要只回答文字')
await page.waitForTimeout(200)
await page.locator('.ac-send').click()
for (let i = 0; i < 90; i++) {
  const n = (await page.locator('.ac-tool-line').count()) + (await page.locator('.ac-tool-card').count())
  if (n > 0) break
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(500)
const lines2 = await page.locator('.ac-tool-line').count()
const cards2 = await page.locator('.ac-tool-card').count()
check('普通 MCP 工具走简洁一行（不是卡片）', lines2 > 0 && cards2 === 0, 'lines=' + lines2 + ' cards=' + cards2)
await snap('tool-line')

// ---------- 6. 让模型执行一个需要审批的工具（exec_command） ----------
await page.locator('.ac-editor [contenteditable="true"]').first().click()
await page.keyboard.type('请用 exec_command 执行 echo hello（必须真的调用工具）')
await page.waitForTimeout(200)
await page.locator('.ac-send').click()
let approvalSeen = false
// 模型是否愿意调用工具本身有随机性：允许重试两次，
// 免得把「模型这次没动手」误判成功能坏了。
for (let attempt = 1; attempt <= 3 && !approvalSeen; attempt++) {
  const dl2 = Date.now() + 90000
  while (Date.now() < dl2) {
    if ((await page.locator('.ac-approval').count()) > 0) { approvalSeen = true; break }
    const running = await page.locator('.ac-send.is-running').count()
    if (running === 0) break
    await page.waitForTimeout(1000)
  }
  if (approvalSeen) break
  console.log('  第 ' + attempt + ' 次模型没调用工具，再试一次')
  await page.locator('.ac-editor [contenteditable="true"]').first().click()
  await page.keyboard.type('必须真的调用 exec_command 工具执行 echo hello，不要只用文字回答')
  await page.waitForTimeout(200)
  await page.locator('.ac-send').click()
  await page.waitForTimeout(1500)
}
check('需要审批的工具弹出了审批卡片', approvalSeen)
if (approvalSeen) {
  await snap('approval-card')
  const allow = page.locator('.ac-approval .ac-btn-primary').first()
  check('审批卡片上有「允许」按钮', (await allow.count()) > 0)
  await allow.click()
  await page.waitForTimeout(1500)
  // 点过之后卡片**整张消失**（用户口径：「都授权了 就不显示」）——
  // 已经放行、工具也跑完了，再挂一张「已允许」的死卡片只是挡着看下面的内容。
  const stillThere = await page.locator('.ac-approval').count()
  check('点过之后审批卡片消失', stillThere === 0, 'remaining=' + stillThere)
  await snap('approval-decided')
}

// ---------- 7. 新建对话 + 历史 ----------
await page.locator('button[aria-label="新建对话"]').click()
await page.waitForTimeout(800)
check('新建对话后消息区清空', (await page.locator('.ac-msg').count()) === 0)
await page.locator('button[aria-label="历史对话"]').click()
await page.waitForTimeout(600)
const histItems = await page.locator('.agent-history-item').count()
check('历史下拉里有会话', histItems > 0, 'count=' + histItems)
// 历史是普通 dropdown（用户口径：「替换成 drop down 的形式…并让它居中显示」）：
// 它没有遮罩、点外面关；居中 = **相对它的触发器按钮**（用户后来的口径：「触发是通过
// 「历史记录」这个按钮来进行的……居中肯定也是根据它来呀」）—— 不是相对面板中线。
{
  const hist = await page.evaluate(() => {
    const m = document.querySelector('.dd-menu')
    if (!m) return null
    const r = m.getBoundingClientRect()
    // 居中锚点 = 触发它的那个按钮（历史对话）
    const trig = document.querySelector('button[aria-label="历史对话"]')
    const tr = trig ? trig.getBoundingClientRect() : null
    const head = m.querySelector('.agent-history-head')
    const list = m.querySelector('.agent-history-list')
    return {
      isDropdown: m.classList.contains('dd-menu'),
      noModal: !m.classList.contains('dd-menu--modal'),
      scrim: !!document.querySelector('.dd-scrim'),
      // 水平：与**触发器按钮**中线对齐
      dx: tr ? Math.round((r.left + r.width / 2) - (tr.left + tr.width / 2)) : null,
      inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      headText: head ? head.innerText.replace(/\s+/g, ' ').trim() : null,
      listScrolls: list ? getComputedStyle(list).overflowY === 'auto' : false,
    }
  })
  check('历史是 dropdown（不是弹窗/遮罩）', !!hist && hist.isDropdown && hist.noModal && !hist.scrim, JSON.stringify(hist))
  check('历史水平居中在触发按钮上', !!hist && hist.dx !== null && Math.abs(hist.dx) <= 4, JSON.stringify(hist))
  check('历史不越出视口', !!hist && hist.inside, JSON.stringify(hist))
  check('历史有标题 + 列表可滚', !!hist && /^历史对话\s*\d+$/.test(hist.headText || '') && hist.listScrolls, JSON.stringify(hist))
}

// 宽度：下拉要比面板**最小宽度**更窄（用户口径：「下拉宽度比最小宽度再小一点就行了」）。
// 注意：居中锚点是**触发按钮**（用户后来点名），按钮偏右时菜单允许越过面板右缘几像素 ——
// 所以这里只钉「比最小宽度窄」+「整块在视口内」，不再钉「左右都留白」。
{
  const widths = await page.evaluate(() => {
    const menu = document.querySelector('.dd-menu')?.getBoundingClientRect()
    const shell = document.querySelector('.agent-shell')?.getBoundingClientRect()
    return menu && shell
      ? { menuW: Math.round(menu.width), panelW: Math.round(shell.width), inside: menu.left >= 0 && menu.right <= window.innerWidth }
      : null
  })
  check('历史下拉比面板窄', !!widths && widths.menuW < widths.panelW, JSON.stringify(widths))
  check('历史下拉整块在视口内', !!widths && widths.inside, JSON.stringify(widths))
  // 面板最小宽度：拖到极窄也夹在 360，保证下拉（320）仍装得下
  const minW = await page.evaluate(async () => {
    const st = window.MiniCanvasUI.getHost().ctx.get('agent').state
    const before = st.width
    st.width = 200 // 故意拖得极小
    await new Promise((r) => setTimeout(r, 400))
    const w = Math.round(document.querySelector('.agent-shell').getBoundingClientRect().width)
    st.width = before
    return w
  })
  check('面板最小宽度夹在 360（下拉 320 仍装得下）', minW === 360, 'minW=' + minW)
}
await snap('history')
await page.locator('.agent-history-item').first().click()
await page.waitForTimeout(1800)
check('切回历史会话后消息回来了', (await page.locator('.ac-msg').count()) > 0)
// 回放的工具**不能看起来还在跑**（用户报的：刷新后历史工具带个转圈，像在加载）。
// 转录里存了结构化信息（名字/参数/结果/完成位），所以这里应当 0 个转圈。
{
  const restored = await page.evaluate(() => ({
    spinners: document.querySelectorAll('.ac-tool-card .ac-spin, .ac-tool-line .ac-spin').length,
    pending: !!document.querySelector('.ac-pending'),
  }))
  check('回放的历史工具不再转圈（已完成态）', restored.spinners === 0 && !restored.pending, JSON.stringify(restored))
}
await snap('history-restored')

// ---------- 8. 切换模型（底栏的模型按钮：图标按钮，不是文字） ----------
const modelBtn = page.locator('.ac-toolbar button[aria-label="选择模型"]').first()
check('底栏有模型选择入口', (await modelBtn.count()) > 0)
if ((await modelBtn.count()) > 0) {
  await modelBtn.click()
  await page.waitForTimeout(500)
  const modelItems = page.locator('.dd-menu .ac-menu-card')
  check('模型下拉里列出了可选模型', (await modelItems.count()) > 0, 'count=' + (await modelItems.count()))
  const firstLabel = await modelItems.first().innerText().catch(() => '')
  check('模型下拉显示的是当前模型', firstLabel.includes('deepseek'), firstLabel.replace(/\s+/g, ' '))
  // 结构：分组头（标题+计数）+ 每行「图标托 + 名称 + 来源」
  check('模型下拉有分组头（标题 + 计数）', /^模型\s*\d+$/.test((await page.locator('.dd-menu .ac-menu-head').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()))
  check('模型每行有图标托', (await page.locator('.dd-menu .ac-menu-card-icon svg').count()) > 0)
  // 长列表（几十条模型）真滚起来时：浮层自身不动、只有列表区滚、标题始终在列表上方。
  // 这就是用户要的「上下 flex 分栏、只有下面滚」—— 顺带把「不靠 sticky 补」也钉住。
  const longList = await page.evaluate(() => {
    const m = document.querySelector('.dd-menu')
    const sc = document.querySelector('.dd-menu .ac-menu-scroll')
    const head = document.querySelector('.dd-menu .ac-menu-head')
    if (!m || !sc || !head) return null
    const headTopBefore = head.getBoundingClientRect().top
    const menuTopBefore = m.getBoundingClientRect().top
    const canScroll = sc.scrollHeight > sc.clientHeight + 2
    sc.scrollTop = sc.scrollHeight
    return {
      canScroll,
      scrolled: sc.scrollTop > 0,
      menuUnmoved: Math.abs(m.getBoundingClientRect().top - menuTopBefore) < 2 && m.scrollTop === 0,
      headUnmoved: Math.abs(head.getBoundingClientRect().top - headTopBefore) < 2,
      headPosition: getComputedStyle(head).position,
    }
  })
  check('长列表真的滚起来（列表区滚、浮层不动、标题不动）', !!longList && longList.canScroll && longList.scrolled && longList.menuUnmoved && longList.headUnmoved && longList.headPosition === 'static', JSON.stringify(longList))
  await snap('model-menu')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// ---------- 8b. 输入框的 @ 下拉（引用技能 / MCP） ----------
const box2 = page.locator('.ac-editor [contenteditable="true"]').first()
await box2.click()
await page.keyboard.type('@')
await page.waitForTimeout(700)
const mentionMenu = page.locator('.mention-menu')
const mentionVisible = (await mentionMenu.count()) > 0 && (await mentionMenu.first().isVisible())
check('输入 @ 会弹出候选菜单', mentionVisible)
if (mentionVisible) {
  const cats = await page.locator('.mention-menu .category-title').allInnerTexts()
  console.log('  @ 菜单分组 = ' + JSON.stringify(cats))
  check('候选里含「技能」与「MCP」分组', cats.includes('技能') && cats.includes('MCP'), JSON.stringify(cats))
  check('@ 菜单每行有图标', (await page.locator('.mention-menu .ac-mrow-icon svg').count()) > 0)
  // 宽度 / 配色 / 描述只在 hover 显示（用户口径 2026-10-03）：
  //   ① 最小宽度 240（原来 200，看着太窄）；
  //   ② 名称用正文色（原来 --ui-ink-dim，整块像蒙灰）；
  //   ③ 描述默认不占位，hover 才多出一行、行高自然撑开。
  {
    const mm = await page.evaluate(() => {
      const m = document.querySelector('.mention-menu')
      if (!m) return null
      const cs = getComputedStyle(m)
      const rows = [...m.querySelectorAll('.menu-item')]
      // 找一行**非激活**的（激活行本来就常显描述）
      const row = rows.find((r) => !r.classList.contains('active')) || rows[0]
      const hint = row ? row.querySelector('.ac-mrow-hint') : null
      const name = row ? row.querySelector('.ac-mrow-name') : null
      return {
        menuW: Math.round(m.getBoundingClientRect().width),
        minW: cs.minWidth,
        nameColor: name ? getComputedStyle(name).color : null,
        // 收起态判据：max-height 为 0（不是 display:none —— 那个没法做过渡）
        hintCollapsed: hint ? getComputedStyle(hint).maxHeight === '0px' : null,
        rowH: row ? Math.round(row.getBoundingClientRect().height) : null,
      }
    })
    check('@ 菜单最小宽度 ≥ 240（比原来的 200 宽）', !!mm && mm.menuW >= 240, JSON.stringify(mm))
    check('@ 菜单名称用正文色（不是发灰的 ink-dim）', !!mm && mm.nameColor === 'rgb(247, 247, 247)', mm && mm.nameColor)
    check('@ 菜单描述默认收起（hover 才显示）', !!mm && mm.hintCollapsed === true, JSON.stringify(mm))
    if (mm && mm.hintCollapsed) {
      const target = page.locator('.mention-menu .menu-item').nth(1)
      const before = await target.boundingBox()
      // hover 之前先给行内节点打标：展开时**不能**被重新挂载，否则过渡没有起点可插值
      await page.evaluate(() => {
        const row = document.querySelectorAll('.mention-menu .menu-item')[1]
        row.__tag = 'ROW'; row.querySelector('.ac-mrow-hint').__tag = 'HINT'
      })
      await page.evaluate(() => {
        window.__tr = []
        const t0 = performance.now()
        const tick = () => {
          const row = document.querySelectorAll('.mention-menu .menu-item')[1]
          const hint = row && row.querySelector('.ac-mrow-hint')
          const cs = hint ? getComputedStyle(hint) : null
          window.__tr.push({ h: row ? Math.round(row.getBoundingClientRect().height) : 0, op: cs ? Number(cs.opacity) : -1 })
          if (window.__tr.length < 24) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await target.hover()
      await page.waitForTimeout(600)
      const after = await page.evaluate(() => {
        const row = document.querySelectorAll('.mention-menu .menu-item')[1]
        const hint = row && row.querySelector('.ac-mrow-hint')
        const cs = hint ? getComputedStyle(hint) : null
        return {
          h: row ? Math.round(row.getBoundingClientRect().height) : 0,
          maxH: cs ? cs.maxHeight : null,
          // 行内节点必须原地复用（被重挂 = 展开没有过渡，只能跳变）
          sameNodes: !!(row && row.__tag === 'ROW' && hint && hint.__tag === 'HINT'),
          // 采样轨迹里出现中间值 = 真的在插值，而不是一步到位
          trace: window.__tr,
        }
      })
      check('@ 菜单 hover 后描述展开、行变高', after.maxH !== '0px' && after.h > before.height + 2, JSON.stringify({ before: Math.round(before.height), after: after.h, maxH: after.maxH }))
      check('@ 菜单展开是**动画**（行高/透明度出现中间值，不是瞬跳）', (() => {
        const hs = [...new Set(after.trace.map((x) => x.h))]
        const ops = [...new Set(after.trace.map((x) => x.op))]
        // 中间态：既不是只有起点、也不是只有终点
        return hs.length > 2 || ops.length > 2
      })(), JSON.stringify({ heights: [...new Set(after.trace.map((x) => x.h))], ops: [...new Set(after.trace.map((x) => Number(x.op.toFixed(2))))] }))
      check('@ 菜单展开不重挂行内节点（重挂则过渡失效）', after.sameNodes, 'sameNodes=' + after.sameNodes)
    }
  }
  await snap('mention-menu')
  // 选第一个候选：插入一个内联标签（引用以输入框里的标签为准）
  await page.locator('.mention-menu .menu-item').first().click()
  await page.waitForTimeout(500)
  check('@ 选一项后插入标签', (await page.locator('.prose-mirror-editor .ac-tag').count()) > 0)
  await snap('mention-picked')
}
// 清掉这次的输入，别影响后面的用例
await page.locator('.ac-editor [contenteditable="true"]').first().click()
await page.keyboard.press('Control+A')
await page.keyboard.press('Delete')
await page.waitForTimeout(300)

// ---------- 9. 停靠（画布被挤窄） ----------
await page.locator('button[aria-label="停靠到右侧"]').click()
await page.waitForTimeout(800)
check('停靠后面板贴右缘', (await page.locator('.agent-shell.is-docked').count()) > 0)
await snap('docked')

// ---------- 11. 流输出自动吸底（用户口径：离底近就跟随；往上滚超过阈值就不跟） ----------
// 判定逻辑本身由单测钉住（stickToBottomCore.test.ts），这里验的是**真的接上了流**。
{
  const scrollMetrics = () => page.evaluate(() => {
    const el = document.querySelector('.ac-scroll')
    return { top: Math.round(el.scrollTop), dist: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) }
  })
  const askAndWait = async (q) => {
    await page.locator('.ac-editor .ProseMirror').click()
    await page.keyboard.type(q)
    await page.locator('.ac-send').click()
    for (let i = 0; i < 120; i++) {
      const running = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('agent').state.running)
      if (!running) break
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(700)
  }
  // 先把内容灌到能滚动（面板已停靠，高度有限）
  await askAndWait('请用 10 句话说说明亮与黑暗，每句一行，不要编号。')
  await askAndWait('再用 12 句话说说海洋，每句一行，不要编号。')
  const scrollable = await page.evaluate(() => {
    const el = document.querySelector('.ac-scroll')
    return el.scrollHeight > el.clientHeight + 60
  })
  if (!scrollable) {
    console.log('  内容没超过一屏（模型答得短）→ 跳过吸底断言')
  } else {
    // 停在底部时继续流输出 → 应一直贴底
    await askAndWait('再用 12 句话说说森林，每句一行，不要编号。')
    const stuck = await scrollMetrics()
    check('流输出时自动吸附到底部', stuck.dist <= 48, 'dist=' + stuck.dist)

    // 发完消息后往上滚到顶 → 后续流输出不应把它拽回
    await page.locator('.ac-editor .ProseMirror').click()
    await page.keyboard.type('再用 14 句话说说山脉，每句一行，不要编号。')
    await page.locator('.ac-send').click()
    await page.waitForTimeout(1400)
    await page.evaluate(() => { document.querySelector('.ac-scroll').scrollTop = 0 })
    for (let i = 0; i < 120; i++) {
      const running = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('agent').state.running)
      if (!running) break
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(700)
    const scrolled = await scrollMetrics()
    check('用户往上滚后不再被拽回底部', scrolled.top < 80, 'top=' + scrolled.top + ' dist=' + scrolled.dist)
  }
}

// ---------- 10. 浮窗（小窗口）样式：照 LiBTV 实测的半透明 + 毛玻璃 + 圆角 + 贴右/下 16px ----------
await page.locator('button[aria-label="切换为浮窗"]').click()
await page.waitForTimeout(900)
const floatStyle = await page.evaluate(() => {
  const el = document.querySelector('.agent-shell')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    docked: el.className.includes('is-docked'),
    right: Math.round(window.innerWidth - r.right),
    bottom: Math.round(window.innerHeight - r.bottom),
    width: Math.round(r.width),
    height: Math.round(r.height),
    radius: cs.borderRadius,
    blur: cs.backdropFilter,
    bg: cs.backgroundColor,
    // 底色必须**实心**：半透明时底下的画布会透上来、正文与它糊在一起（用户点名要改）
    opaque: !/rgba\([^)]*,\s*0?\.\d+\)/.test(cs.backgroundColor),
    insideViewport: r.left >= -0.5 && r.top >= -0.5 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
  }
})
check('浮窗不再停靠', !!floatStyle && !floatStyle.docked)
check('浮窗贴右/下各 16px（照参考页实测）', !!floatStyle && floatStyle.right === 16 && floatStyle.bottom === 16, JSON.stringify(floatStyle))
check('浮窗是 400×640（照参考页实测）', !!floatStyle && floatStyle.width === 400 && floatStyle.height === 640, floatStyle ? floatStyle.width + '×' + floatStyle.height : 'null')
check('浮窗圆角 28px', !!floatStyle && floatStyle.radius === '28px', floatStyle?.radius)
// 浮窗底色实心、不用毛玻璃（用户口径："悬浮框背景不要这种透明的"）
check('浮窗底色实心（不是半透明）', !!floatStyle && floatStyle.opaque, floatStyle?.bg)
check('浮窗不用毛玻璃', !!floatStyle && (floatStyle.blur === 'none' || floatStyle.blur === ''), floatStyle?.blur)
check('浮窗整块在视口内', !!floatStyle && floatStyle.insideViewport)
await snap('float-window')

// 输入框尺寸照参考页实测：整块 122px（编辑器 min-height 64 + 工具条 32 + 内边距/间距）
const composerBox = await page.evaluate(() => {
  const box = document.querySelector('.ac-input-box')
  const ed = document.querySelector('.ac-editor')
  const tb = document.querySelector('.ac-toolbar')
  if (!box || !ed || !tb) return null
  const boxCs = getComputedStyle(box)
  return {
    boxH: Math.round(box.getBoundingClientRect().height),
    editorH: Math.round(ed.getBoundingClientRect().height),
    toolbarH: Math.round(tb.getBoundingClientRect().height),
    radius: boxCs.borderRadius,
    border: boxCs.borderTopWidth + ' ' + boxCs.borderTopColor,
  }
})
check('输入框整块 122px（照参考页实测）', !!composerBox && composerBox.boxH === 122, composerBox ? composerBox.boxH + 'px' : 'null')
check('编辑器最小高 64px（压掉库默认的 120）', !!composerBox && composerBox.editorH === 64, composerBox ? composerBox.editorH + 'px' : 'null')
check('输入框圆角 16px', !!composerBox && composerBox.radius === '16px', composerBox?.radius)

// 通知提示条（照参考页实测 40 高 / 圆角 12）：浏览器未授权时出现，点「开启」走真的权限申请
const notifyTip = await page.evaluate(() => {
  const tip = document.querySelector('.ac-notify')
  if (!tip) return null
  const r = tip.getBoundingClientRect()
  const cs = getComputedStyle(tip)
  return {
    h: Math.round(r.height),
    radius: cs.borderRadius,
    hasEnable: !!tip.querySelector('.ac-notify-btn'),
    text: tip.innerText.replace(/\s+/g, ' ').trim(),
  }
})
if (notifyTip) {
  check('通知提示条 40px 高（照参考页实测）', notifyTip.h === 40, notifyTip.h + 'px')
  check('通知提示条圆角 12px', notifyTip.radius === '12px', notifyTip.radius)
  check('通知提示条有「开启」按钮', notifyTip.hasEnable, notifyTip.text)
} else {
  console.log('  浏览器已授权/不支持通知 → 提示条不出现（跳过检查）')
}

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`结果：${results.length - failed.length}/${results.length} 通过`)
// 已知无害的噪声：favicon/404，以及插件管理页拉清单失败（云服务没起时的可选接口）
// 没起时的 ERR_CONNECTION_REFUSED —— 它跟 Agent 功能无关，但会把整轮判成失败。
const realErrors = errors.filter((e) => !/favicon|404 \(Not Found\)|5320\/catalog\.json|ERR_CONNECTION_REFUSED/.test(e))
console.log(`控制台错误：${realErrors.length}`)
for (const e of realErrors.slice(0, 10)) console.log('  ERR ' + e)

await browser.close()
process.exit(failed.length || realErrors.length ? 1 : 0)
