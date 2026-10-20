【可视化节点（type = "ui"）—— 画界面用】

它是一块**空画布**：节点里会渲染你写的一段 HTML。它自己没有界面、没有设置项 ——
内容完全由你决定。用户把它放到画布上、连好素材，然后让你画。

⚠️ **两条边界，先记住**：

1. **别去翻项目源码**。你在对话框里，看的应该是本手册 + 运行时接口。
   开发期源码可能就摆在用户项目里（`packages/cloud-server/src/…`、
   `packages/plugins/plugin-node-ui/src/…`），看着很诱人，但那是**实现**、随时会变；
   本手册给的是**稳定契约**。依赖实现，改一次就失效。
   要问"有哪些脚本 / 有哪些动作"，用运行时接口（`{type:"list"}`、`generation_actions`），
   或者直接看本手册最后那两节（都会现读）。
2. **这是可视化节点的说明书**。用户一提"可视化节点 / ui 节点 / 面板 / 预览器 /
   给这个节点画个界面"，第一个动作就是读本手册 —— 不要先去猜、更不要和"生成图片"
   （`generation_*`）混起来：那是**调模型出媒体**，这是**画界面**，两条不同的轨道。

## 〇、动手之前：先跟用户把需求问清楚（**这一步别省**）

这个能力看着简单，但"要不要后台"决定了后面所有工作。所以先问，再动手：

  1. **这个界面只是"看"，还是要"干活"？**
     · 只是看（展示上游的图/视频/文本）→ **纯前端就够**，不用写脚本。
     · 要干活（转码 / 抽帧 / 批量处理 / 读文件 / 算数据）→ 需要**后台脚本**，
       而那件事**只有用户能加**（脚本是服务器上的文件，你写不了）。

  2. **要干活的话，这台机器上已经有能干这个活的脚本吗？**
     看本手册最后一节（实时脚本清单）。有 → 直接用；没有 → 告诉用户
     "需要往 task-scripts/ 放一个 xxx.mjs"，并把你想让它干什么说清楚。

  3. **要不要收进资源库**（之后能拖到别的画布复用）？要的话最后调 canvas_ui_package。

确认完再动手。**别埋头就写** —— 写完才发现"其实需要后台能力、而脚本还没有"，
那一整轮界面都得推倒重来。

## 〇之二、整个流程长什么样（照这个顺序做）

一件"可视化节点"是这样长出来的。**顺序很重要：要后台就先做后台，后台通了再写界面** ——
反过来做的话，界面写完了才发现后台对不上，两边都得返工。

  ┌── ① 先判要不要后台（见第〇节）──────────────────────────────┐
  │   只是"把拿到的东西显示出来" → 跳到 ④，纯前端就完事。            │
  │   要**真正干活**（转码 / 批处理 / 算数据 / 读写文件）→ 走 ②③。   │
  └──────────────────────────────────────────────────────┘

  ② **写后台脚本**（一个 .mjs 文件 = 一件事，文件名 = 脚本名）。

     ★ 文件名必须先用下划线打头（`_名字.mjs`）—— 这是"还没验证"的状态标识，见 0.3。
       带下划线的脚本**不会出现在 canvas_fn_list 里**，别的 Agent 也就不会误用它。

  ③ **用 MCP 把后台调通**（这三步是"后台可用"的判据，全过了才准往下走）：

       canvas_fn_list()                 看这台机器上有哪些**已通过**的函数
       canvas_fn_info(script, fn)       查它的参数 / 返回 / 示例
       canvas_fn_call(script, fn, argsJson)  真调一次，拿结果

     调通了（执行成功、结果符合预期）→ 把文件名前面的下划线**去掉**，这个脚本才算"可用"。
     调不通就改脚本重来，别急着写界面。

  ④ **写前端界面**：canvas_ui_read 看现状（可为空）→ canvas_ui_write 写上去。
     界面里调后台那套（CanvasUI.task / POST /api/task/call）见第五·补节。
     界面里要放按钮/输入，照第六节那个最小例子抄骨架。

  ⑤ **声明依赖**：在节点上写 data.uiScripts = { "脚本名": {} }。
     不声明，界面调后台会被 403 挡（见 1.2）。canvas_ui_write 会顺手帮你补，但自己写更稳。

  ⑥ **收尾（务必做，别省）—— 把前后端一起打包落到下载目录**：

       canvas_ui_export(canvasId, nodeId, name?)

     它把「这个节点的界面 + 它用到的脚本」打成一个 .mcnode 包，**自动保存到本机下载目录**，
     返回值里给**绝对路径**。为什么要这一步（用户原话）：
     「你的这个节点一删，后台就完全没有意义了，还要重新写 HTML 代码」——
     落了盘，节点删了也能从包里原样恢复（或换个画布用）。
     想同时收进资产库（之后能从左侧资源库拖出来复用）再调一次 canvas_ui_package。

一条判断准则：**后台管"干什么活"，界面管"长什么样"，节点上的声明把两者绑在一起。**
**先让后台通过 MCP 调通，再写界面，最后一定打包落盘。**

### 0.3 ★ 脚本的"下划线 = 未验证"约定（生产环境踩过，务必遵守）

线上环境是这么出问题的：Agent 每次要写脚本，先去 canvas_fn_list 看**之前留下**的函数，
但那些里面**有半成品、还有老 API 版本的脚本** —— 拿起来一调就失败，白费一轮。

所以加一条状态标识，规则就三条：

  1. **初始创建**：第一次写脚本，文件名前面**必须**加一个下划线 —— `_scale.mjs`。
  2. **测试通过**：只有它**跑通了**（执行成功且结果有效），才把下划线去掉 —— `scale.mjs`。
  3. **工具过滤**：canvas_fn_list **只列不带下划线的**（= 已验证的）。
     带下划线的那些是不给别人用的在建品。

配套：
  · 在建脚本**照样能调**（canvas_fn_call 认得带下划线的名字）—— 否则你没法测它。
    但调用时会明确提示"这是未验证的在建脚本"。
  · canvas_fn_info 对带下划线的脚本**照样能查**（你要看自己写的参数）——
    它只影响"对外可发现的清单"，不影响你调试。
  · 判断准则：**清单里没有 ≠ 不存在**。清单是"给别人用的"；你要调自己在建的那个，
    名字前面带下划线直接调即可。

## 一、怎么画 / 怎么改

**第一次画**（或整段重画）：

  canvas_ui_write({ canvasId, nodeId, html })
    · html 给一整段自包含的 HTML（不用包 <!DOCTYPE>，也不用包 markdown 代码块）
    · 写完立刻在节点里渲染出来（用户当场就能看到）
    · 它只写这一个节点，不碰别的

**改一小块**（写完发现要调一个 class / 一段文字）：**不要整段重写**，用局部替换：

  canvas_ui_update({ canvasId, nodeId, old, new })
    · old = 现在的代码片段（要原样、能在当前 HTML 里找到）
    · new = 改后的片段
    · 例：old: "class=\"card\"" → new: "class=\"card card--big\""
    · old 找不到时会报错，并把当前内容回一段给你，照着改 old 再试
    · old 出现多次 = 全换掉（会回报次数）；只想换一处就把 old 写得更长更精确

改之前想先看现状：canvas_ui_read({ canvasId, nodeId }) → { html }

## 二、你的 HTML 跑在哪（**必须遵守，否则白屏**）

它住在一个**沙箱 iframe** 里（不透明源）。文档加载前，宿主已经把下面这些东西注入好了，直接用：

  window.__CANVAS_INPUTS__   → { 键: 值 }
      节点声明的输入参数（用户/你的旧调用声明的键 → 值；没声明就是 {}）

  window.__CANVAS_UPSTREAM__ → [ { refName, kind, url?, value?, nodeId? } ]
      画布上**连进这个节点**的上游素材，一条一个：
        · kind     : image / video / audio / text（按素材实际类型）
        · refName  : 引用名（图片1 / 视频2 …），用来在界面上标注
        · url      : 媒体地址（kind 是 image/video/audio 时给；可直接放进 img/video 的 src）
        · value    : 文本内容（kind 是 text 时给）
        · nodeId   : 那条上游节点的 id（要改它就用画布接口）
      没连任何素材就是 []。

  window.__CANVAS_UI__       → { theme, baseUrl, canvasId, nodeId, palette }
        · theme     : "light" | "dark"，当前画布是亮还是暗
        · baseUrl   : 后台根地址（发请求要用绝对地址，见下）
        · canvasId  : 当前画布 id
        · nodeId    : 本节点 id
        · palette   : { light: {...}, dark: {...} } 画布的**主题色板**（见下）

### 色板 palette（提供给你，用不用随你）

palette.light / palette.dark 各是一组语义色，键一样、值不同：

  accent        强调色（画布的品牌色，主按钮/选中态用它最搭）
  accentHover   强调色悬停态
  danger        危险色（删除这类破坏性操作）
  warn          警示色
  edgeRail      连线颜色
  edgeFlow      连线流光色
  background    背景色
  surface       卡片/面板底色
  text          正文色
  textMuted     次要文字
  textFaint     最弱文字（placeholder 一级）
  border        分隔线 / 边框色

**这只是「提供」，不是「必须用」**：想跟画布整体一个调，就取 palette[theme] 里的值；
想自己配色也完全可以 —— 只要求你看清当前是亮是暗（见下面第 4 条）。

### 3.3 往外输出（画布 → 下游节点）

页面用注入的助手 window.CanvasUI 跟外面打交道。**就五件事**：

  CanvasUI.setInputs(params)       ← 交**参数**（笔迹 / 选项 / 配置，都是参数）
  CanvasUI.onChange(fn)            ← **这个节点的参数变了** → 照着重画
  CanvasUI.save(data, "名字.ext")   ← 交**产物**（图 / 视频 / 音频 / 文本）
  CanvasUI.task(脚本, 函数, 参数, opts)  ← 叫后台干活（自动带节点信息）
  CanvasUI.cancel(runId)           ← 取消一次后台调用

**只有两样东西：上游、参数。没有第三个概念。**
  · **上游** = 连线连进来的素材（window.__CANVAS_UPSTREAM__，你只能读）
  · **参数** = 这个节点的 data 里给界面的值（window.__CANVAS_INPUTS__）
  · 你 setInputs 交上去的笔迹 / 选项，**也是参数**（只是你自己写的）。
    刷新后宿主把它并回 __CANVAS_INPUTS__，你重新读就能恢复画面 —— 不用另学一套。

**交参数：CanvasUI.setInputs({ strokes: strokes })**
  · 参数随便什么能 JSON 化的东西（数组 / 对象都行）。**保持小**（几 KB 级）。
  · 它**进撤销栈** —— 交一次，用户按一次撤销就退回那之前。
  · 建议时机：**一笔松手 / 一次配置改完**调一次（不要每帧调）。

**收变化：CanvasUI.onChange(function (d) { … })**
  · 参数或上游**变了**就回调，给你最新的：
      d.inputs     ← 参数（含你自己交上去的那些）
      d.upstream   ← 上游素材
  · 收到就**照着重画**。一件事，一个监听，不用记那是哪种变化。
  · 页面**不会因为参数变化而重启**（以前会重开，用户正在输的东西会丢）。

硬性约束：
  1. 不许外链任何 js / css / 字体 / 图片 CDN —— 沙箱里只有后台一个源可达，外链一律连不上。
  2. 样式写 <style>、脚本写 <script>，图标用内联 SVG 或字符。
  3. 铺满整块（html, body 宽高 100%，body margin 0），字号 12–14px。
  4. 深浅色都要能看清：读 __CANVAS_UI__.theme，或用 html[data-theme="dark"] 写分支。
  5. 发请求必须写**绝对地址**（页面基地址是 about:srcdoc，相对路径解析不出来）。
     baseUrl 与 canvasId 都从 __CANVAS_UI__ 取。

## 三、读画布：看规模 / 读一个节点 / 读整张

  canvas_get({ canvasId, nodeId })   ← **只读那一个节点**（还附带它的连线与邻居节点）
  canvas_get({ canvasId })           ← 读整张全量（节点多的时候别这么用）
  canvas_overview({ canvasId })      ← 只读规模与类型分布
  canvas_list_canvases()             ← 这台服务器上有哪些画布

要引用别的节点、或想看看某个节点连了什么，就用第一条（省一次全量搬运）。

## 四、要改画布上的东西，用内置的 canvas_batch_nodes

**改字段是「替换」语义**：你给的那个键覆盖原值，该节点 data 里别的键保留。
所以只写要改的键，不要整份 data 抄一遍。

  canvas_batch_nodes({ canvasId, update: [{ id, data: { 只写要改的键 } }] })   ← 改
  canvas_batch_nodes({ canvasId, delete: ["3"] })                              ← 删（连带它的连线）
  canvas_batch_nodes({ canvasId, add: [{ type, position, data? }] })            ← 新建

这三条都是增量的：只动你点名的节点，不会碰别的、也不搬整张画布。
读整张画布用 canvas_get；只看规模用 canvas_overview。

## 五、沙箱里（你自己写的 HTML 里）能调什么

注意：上面三条是**你**（Agent）通过 MCP 调的工具。而**你写出来的那个界面**在浏览器里跑，
它走的是 HTTP，不是 MCP。

> ⚠️ **2026-10-20 起，界面里不要直接 `fetch` 后台**。界面住在 `sandbox="allow-scripts"`
> 的 iframe 里（不透明源，`Origin: null`），后台的请求边界会拒绝它；而令牌也不能交给它。
> 一律改用 **`CanvasUI.api(path, init)`**：它把请求交给宿主（同源、带管理令牌）代发，
> 回包形状接近 `fetch`（`{ ok, status, headers.get(), text(), json(), arrayBuffer() }`）。

  读整张画布   CanvasUI.api('/api/canvases/' + __CANVAS_UI__.canvasId)      → { ok, nodes, edges, view }
  增量改节点   CanvasUI.api('/api/canvas/nodes', { method:'POST', headers:{'content-type':'application/json'},
                                              body: JSON.stringify({ add?, delete?, update? }) })
               ⚠️ **改一个节点就用这条**（只动点名那个，不搬整张画布）
  增量改连线   CanvasUI.api('/api/canvas/edges', { method:'POST', ... })      body { add?, delete?, update? }
  整体写回     CanvasUI.api('/api/canvases/' + __CANVAS_UI__.canvasId, { method:'PUT', ... })
               ⚠️ 整体替换：少一个节点它就没了。只有真要换掉整张画布时才用。
  画布清单     CanvasUI.api('/api/canvases')                                 → { canvases: [{id,name}] }
  下单生成     CanvasUI.api('/api/jobs', { method:'POST', headers:{'content-type':'application/json'},
                                         body: JSON.stringify({ canvasId, nodeId, actionId, prompt?, values? }) })
               （先 CanvasUI.api('/api/actions') 看有哪些 actionId 与参数）

`path` 必须以 `/api/` 开头（宿主只转发这一类，防止被当成任意地址的代理）。
不想自己拼 JSON 也行：`CanvasUI.api` 透传 `body`，字符串 / Blob 都收。

## 五·补、让界面能叫后台干活（任务脚本）

界面上要是需要一个"后台去跑点东西"的按钮（转码、批处理、算点数据…），不要写死逻辑，
用**任务脚本**：后台有个目录 `task-scripts/`，里面一个 `.mjs` 文件就是一件事，
文件名 = 脚本名，文件里 export 的函数就是能调的动作。

  列脚本      POST {base}/api/task/call   body { type: "list" }
              → { ok, scripts: [{ name, methods: [...] }] }
  问一个脚本 GET  {base}/api/task/info?name=scale  → { ok, methods: [...] }
  跑           POST {base}/api/task/call   body {
                 type: "call", name: "scale", methods: "run",
                 args: [640],          // 位置参数数组，最后一个参数由后台补 ctx
                 nodeId: "3",          // 建议带上：脚本用 ctx.nodeId 知道是谁在问
                 wait: true }          // 可选：true = 直接把结果给你（几百毫秒的活就这么用）
              → { ok, runId, state, result? }   或 { ok, runId, state: "running" }
  实时输出     GET  {base}/api/task/events?runId=r…    （SSE：log / progress / done / error）
              → data: {"type":"log","line":"…"}、data: {"type":"progress","value":0.4}
  查状态       GET  {base}/api/task/status?runId=r…    （刷新后回来就靠它）
  取消         POST {base}/api/task/cancel  body { runId }

规矩：
  1. runId 是**唯一凭证**：拿到它才能订阅/取消。跑起来之后建议把 runId 写进节点字段
     （页面刷新后状态还在，能接着订阅）。
  0.8 ★ **要给节点加一个"后台能力"，就三步**：
     (a) **脚本**：看本手册最后那份实时清单，已经有就用；没有就让用户往 task-scripts/ 放一个
         .mjs（你写不了它 —— 它在服务器磁盘上）。脚本形如：
             export async function run(width, ctx) { … }
         ctx 里有什么、能不能开子进程（能开 ffmpeg），见本节的「4. 脚本能查到的东西」。
     (b) **声明**：在节点上写 data.uiScripts = { "脚本名": {} }（见下面 1.2，不写会被 403 挡）。
     (c) **界面里调它**：POST {base}/api/task/call，body 形如
             { type: "call", name: "脚本名", methods: "run", args: [...],
               nodeId: __CANVAS_UI__.nodeId, canvasId: __CANVAS_UI__.canvasId }
         快活（几百毫秒）加 wait: true 直接拿结果；长活（转码）用 events 订阅日志、
         并且**把 runId 写进节点字段**（刷新后才找得回来）。
     —— 这三步做完，节点就从"只能看"变成"真能干活"。
  1.2 ★ **调用后台脚本前，必须在节点上声明依赖**（这是硬规定，不是建议）：
     节点 data.uiScripts 写成 { "脚本名": {} }，把界面要调的脚本都列上。
     后台 /api/task/call 会**按声明核对**：没声明的脚本直接 403（连进程都不起）。
     为什么要有这一关：nodeId 是调用方自己填的，不核对就等于谁都能调机器上任何脚本。
     · 你调 canvas_ui_write / canvas_ui_update 时后台会**顺手帮你补**（返回值里
       declaredScripts 就是补上的那些）；但别指望它 —— 自己写上更稳。
     · 声明只写脚本名即可（"scale": {}）；哈希是打包时才用得到的东西，后台会补。
  1.5 **这台机器上现在有什么脚本，看本手册最后那一节**（后台每次现读目录，是实时清单）——
     不要去猜脚本名；清单里没有的，就在界面里先调 { type: "list" } 拿到再决定调哪个。
  2. 脚本是**别人写好的文件**，你改不了它。要新功能就跟用户说"往 task-scripts 放一个 xxx.mjs"，
     或者先 POST { type: "list" } 看这台机器上已经有什么。
  3. 长任务（转码那种）用 events 订阅着看日志；短任务用 wait: true 一步拿到结果。
  4. 脚本能查到的东西写在它的 ctx 里：workspace（临时目录）、dir（脚本自己所在目录）、
     baseUrl（**后台自己的地址**）、canvasId / nodeId / name、log()、signal（取消信号）、progress()。

  5. ★ **脚本算出来的文件怎么交回节点**（这条最常问）：
     脚本产出的是**字节**，塞不进 SSE 日志。所以走节点的**槽位**：
         await fetch(ctx.baseUrl + "/api/canvases/" + ctx.canvasId + "/resources?slot=" +
                     encodeURIComponent(ctx.nodeId) + "&name=out.png",
                     { method: "POST", headers: { "content-type": "image/png" }, body: bytes })
     落完这个节点自己那格就是那张图；界面里再把返回的地址写进节点字段（或直接 <img> 显示），
     下游节点也会跟着更新。

  ★ **但更好的做法是用 ctx.save**（同一个助手，见上面第 4 条）：
         return await ctx.save(pngBytes, "out.png")
     它替你拼好 slot 地址、取扩展名、写 content-type —— 以前这三件事每个脚本各写一遍、必漏一个。
     （ctx.baseUrl 还在，真出问题时可以自己拼上面那条。）

  6. ★ **展示端的一条规矩：产物地址带 ?v= 时间戳**。
     同一个槽位地址是固定的，后台为了让下游重新取，会在后面加 ?v=<毫秒>。
     界面里**去重要用干净 URL**（去掉 ? 与 # 之后再比），否则同一个文件会被算成好几份
     （用户实测过：预览重复出现）。判类型也**按地址扩展名**，别按字段名 ——
     叫 imageUrl 的字段里可能装着 .mp3。

  7. ★ **产物落哪个字段：后台按扩展名自动判，你不用管**。
     ctx.save(…, "a.png") → imageUrl ｜ "a.mp4" → videoUrl ｜ "a.mp3" → audioUrl ｜
     "a.txt" → **text（写正文，不是地址）**。
     下游（底栏的素材区、图片对比、图片生成）就是**按这四个字段名认类型**的，
     所以别自己去写 imageUrl —— 音频写进 imageUrl，下游就当图读（裂图）。
     ⚠️ 只有**落在本节点自己的槽位**（不传 opts.slot）才会写这些字段；
        显式存到别人的槽位不算本节点的产物，后台不动那个节点。

## 六、一个能跑的最小例子

  下面这段是一个**完整可跑**的界面：读注入的上游素材（__CANVAS_UPSTREAM__），
  把有几份、每份是什么显示出来。抄这个骨架改内容，比从零写快也不容易漏约定：
  样式写 <style>（这里从简没写）、脚本写 <script>、铺满整块、不用任何外链。
  （审查发现的断链：这段例子原先孤悬在 7.4 工具清单后面，没有引言 —— 已挪回本节名下。）

## 六·补、完整的接口清单（前后端各有哪些，照这张表写就行）

### 7.1 界面（沙箱里的 HTML）能调的 HTTP 口

  // 叫后台干活
  //   （更省事的写法：CanvasUI.task(...) / CanvasUI.cancel(runId) —— 见 3.3 节）
  POST {base}/api/task/call   { type:"call", name, methods, args, canvasId, nodeId, wait? }
  POST {base}/api/task/call   { type:"list" }        // 列脚本名与它们的函数
  GET  {base}/api/task/info?name=xxx                 // 某个脚本有哪些函数
  GET  {base}/api/task/events?runId=xxx              // SSE：log / progress / done / error
  GET  {base}/api/task/status?runId=xxx              // 查状态（刷新回来靠它）
  POST {base}/api/task/cancel { runId }              // 取消（杀整棵进程树）

  // 读画布 / 改画布
  GET  {base}/api/canvases                              → { canvases: [{id,name}] }
  GET  {base}/api/canvases/{canvasId}                    → { ok, nodes, edges, view }
  POST {base}/api/canvas/nodes   { add?, delete?, update? }        ← 改【默认画布】
  POST {base}/api/canvases/{canvasId}/nodes  { add?, delete?, update? }  ← 改【指定画布】
       ⚠️ 非默认画布必须用带画布 id 的那条；老路径只认默认画布（写错会静默无效）
  POST {base}/api/canvas/edges   { add?, delete?, update? }
  PUT  {base}/api/canvases/{canvasId}  { nodes, edges }   // 整体替换（慎用）

  // 资源
  POST {base}/api/canvases/{canvasId}/resources?slot={节点id}&name=out.png   // 交产物到槽位
  POST {base}/api/canvases/{canvasId}/resources  (body=字节)                 // 只新增、不覆盖
  GET  {base}/api/assets                              // 资产库清单
  POST {base}/api/assets?name=&folderId=  (body=字节) // 上传到资产库

  // 调模型出媒体（与「画界面」是两条轨道，别混）
  GET  {base}/api/actions                              // 有哪些动作、要什么参数
  POST {base}/api/jobs  { canvasId, nodeId, actionId, prompt?, values? }

### 7.2 脚本（task-scripts/*.mjs）能用的 ctx

  ⚠️ **文件名状态**：新脚本先用 `_名字.mjs`（未验证），跑通了再去掉下划线。见 0.3。

  export async function run(你的参数..., ctx) { ... }
    · 参数由界面里的 args 依次传入；ctx 永远在【最后一个】
    · 信息：workspace / dir / baseUrl / dataRoot / canvasId / nodeId / name
    · 方法：ctx.log(msg) / ctx.progress(0..1) / ctx.signal.aborted
    · 助手：await ctx.save(字节或字符串, "名字.ext"[, { slot, mime }])
            ctx.file(地址或文件名) → 本地路径（认不出就原样返回）
            ctx.temp("名字") → 工作目录里的路径
    · 干活用 Node 自带（spawn / fs / fetch），没有任何封装命令 —— 这就是自定义脚本
    · 返回值原样作为 result 回到调用方（要能 JSON 化）

### 7.3 节点包（导出 / 导入）

  POST {base}/api/node-packages/build    { canvasId, nodeId }        → .mcnode 字节
  POST {base}/api/node-packages/save     { canvasId, nodeId, name?, folderId? }  // 打包并存库
  POST {base}/api/node-packages/export   { canvasId, nodeId, name? }   // 打包 + **写到本机下载目录**
  POST {base}/api/node-packages/inspect  (body=包字节)              // 先体检：会不会升版本
  POST {base}/api/node-packages/import   (body=包字节)              // 真落地
  GET  {base}/api/node-packages/read?assetUrl=…                   // 从库里取包


### 7.5 让界面能问 AI（单轮对话，不建会话）

界面上要是有「让 AI 总结 / 分类 / 改写」这类需求，用这条 —— 它**问一句答一句**，
**不建会话、不进对话列表、不留任何文件**（凭据用画布已配好的 provider，传个模型名即可）。

  CanvasUI.api('/api/agent/chat/completion', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ model?, messages: [{ role: "system" | "user" | "assistant", content }], stream?, max_tokens? }) })

  非流式（不给 stream）→ OpenAI 那个形状：
    { id, object: "chat.completion", model,
      choices: [{ message: { role: "assistant", content: "…" }, finish_reason: "stop" }],
      usage: { prompt_tokens, completion_tokens, total_tokens } }

  流式（stream: true）→ SSE：每帧 data: {object:"chat.completion.chunk", choices:[{delta}]}，末帧 data: [DONE]

  // 例：把上游的文本素材丢给 AI 总结
  var U = window.__CANVAS_UI__
  var up = window.__CANVAS_UPSTREAM__ || []
  var text = up.filter(function (x) { return x.kind === "text" })    .map(function (x) { return x.value }).join("\n")
  var r = await CanvasUI.api("/api/agent/chat/completion", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [
      { role: "system", content: "你是编辑，只输出一句摘要。" },
      { role: "user", content: text } ] }) })
  var j = await r.json()
  var answer = j.choices[0].message.content

  规矩：
   1. **要接着上文，就自己把上文拼进 messages** —— 服务端不存东西。
   2. **不支持的参数会明确回 400**（tools / n / stop / logprobs / temperature…）；
      尤其 temperature：SDK 那层没有这个开关，传了会被拒（不是静默忽略）。
   3. 模型名不传 = 用画布默认；**传了但没配过会 400**（不会偷偷换一个）。
   4. 想边写边看就加 stream: true 走 SSE；只要完整答案就别管它。
   5. 这条是**单轮**。要带工具、能自己干活的对话，那是 Agent 多轮那套
      （/api/agent/canvases/<画布>/sessions/…），不在本手册范围。

### 7.4 你（Agent）自己的 MCP 工具

  canvas_ui_guide   (canvasId)                      读本手册（含实时脚本 / 节点清单）
  canvas_ui_write   (canvasId, nodeId, html)        整段写界面（顺手补依赖声明）
  canvas_ui_update  (canvasId, nodeId, old, new)    局部替换（不必重写整段）
  canvas_ui_read    (canvasId, nodeId)              看现状
  canvas_ui_package (canvasId, nodeId, name?, folderId?)  打包进资产库
  canvas_ui_describe(canvasId, nodeId, what, effect?)     给节点写功能说明书（收藏前先写）
  canvas_ui_favorites(keyword?)                          列资产库里收藏的可视化节点（带说明书）
  canvas_ui_add_favorite(url?|name?, canvasId?)          把收藏的节点建成到画布上

  后台功能函数（task-scripts 里的那些）：
  canvas_fn_list   (keyword?)               列全部功能函数（做什么 / 参数 / 返回 / 示例）
  canvas_fn_info   (script, fn?)            查某个函数的参数与返回值
  canvas_fn_call   (script, fn, argsJson?)  直接调它并拿回结果（**不必传 Canvas ID / Node ID**）
  其余画布操作（建 / 删 / 改节点与连线、读整张、上传资源、调模型）用【内置的】
  canvas_batch_nodes / canvas_batch_edges / canvas_get / canvas_overview /
  resource_upload / generation_* —— 本插件不再造重复工具。

## 七、最小例子（照抄能跑）


  <div style="padding:12px;font:13px system-ui">
    <h3 id="t" style="margin:0 0 8px"></h3>
    <div id="list"></div>
  </div>
  <script>
    var U = window.__CANVAS_UPSTREAM__ || [];
    document.getElementById("t").textContent = "素材 " + U.length + " 份";
    document.getElementById("list").innerHTML = U.map(function (x) {
      return x.kind === "image"
        ? "<img src="" + x.url + "" style="width:120px">"
        : "<p>" + String(x.value || "") + "</p>";
    }).join("");
  </script>
## 七·补、写完怎么调（沙箱里没法调试，这是唯一的办法）

**先说清楚为什么**：你写的界面住在 `sandbox="allow-scripts"` 的 iframe 里，
故意不给同源权限（不然它就能读宿主页面的 localStorage —— 那是整张画布）。
所以父页面**伸不进去**：读不到它的 DOM、看不到它的变量、DevTools 也点不进那一帧。
**这不是 bug，是安全设计**，改不了。

**解法是「另开一份副本」**：节点遮罩层左下角有个「调试」按钮（鼠标停到节点上才露出），
点它会把这份界面**原样复制**到一个独立窗口里。那份副本是同源的普通页面，于是：

- 浏览器 DevTools 能点进那个窗口：控制台 / 断点 / 单步 / 看网络请求，全都有；
- 能直接读它的变量 —— 包括 `<script>` 顶层写的 `var` / `let` / `const`（不只是 window 属性）；
- 副本里照样能调后台（手册第 3 条要求写绝对地址，副本照旧连得上）。

**你要记住的三条**：

1. **副本是副本，不是画布上那个**。在副本里点的效果不会自动出现在画布上。
   想让画布上那个节点真的出图，就在副本里调 `CanvasUI.save(...)` —— 宿主会把它落进节点
   （走的是与沙箱同一条链，只落一次）。`CanvasUI.setInputs(...)` 同理。
2. **别在副本里改完就以为完事了**。副本是临时的，关掉就没了。改好了要用
   `canvas_ui_update` 把改动写回节点里的 HTML，那才是持久的那份。
3. **副本不带 CSP**（沙箱那份带）。副本是给你调试的，不是发布物 —— 所以别把
   「只在副本里能跑」的写法当成能上线（比如它可能依赖了外链）。

**一条实际的闭环**：`canvas_ui_read` 看现状 → 改 → `canvas_ui_write` / `canvas_ui_update` 写回
→ 点「调试」开副本 → 在副本里看变量 / 打断点 / 看控制台报错 → 定位问题 → 再改 → 再写回。


