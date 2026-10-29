/**
 * Agent 选择面板 · 独立 UI 稿
 *
 * 只渲染 Dropdown 内部：审核 / 技能 / MCP / 模型。
 * 页面没有输入框，也没有下拉触发器；接入时把对应 section 的内容放进现有 Dropdown。
 *
 * 平台标志来自 lobehub/lobe-icons（MIT），内联保存，离线也能显示。
 * 普通工具图标统一使用 24 格线性 SVG，和品牌标志分开。
 */

// ---------------------------------------------------------------- 数据

var MODELS = [
  { id: 'deepseek-auto', provider: 'local · 默认', platform: 'deepseek', note: '自动路由', tag: '默认' },
  { id: 'gpt-6-astra', provider: 'local', platform: 'openai', note: '128K', tag: '' },
  { id: 'gpt-6-sol', provider: 'local', platform: 'openai', note: '视觉', tag: '' },
  { id: 'doubao-seed-2-0-lite-260215', provider: 'local', platform: 'doubao', note: '256K', tag: '' },
  { id: 'glm-5.3-flash', provider: 'local', platform: 'zhipu', note: '高速', tag: '' },
  { id: 'claude-opus-4-8', provider: 'anthropic', platform: 'claude', note: '200K', tag: '' },
  { id: 'gemini-3.2-pro', provider: 'google', platform: 'gemini', note: '1M', tag: '' },
  { id: 'qwen3.7-max', provider: 'dashscope', platform: 'qwen', note: '262K', tag: '' },
  { id: 'kimi-k3', provider: 'moonshot', platform: 'kimi', note: '长文', tag: '' },
  { id: 'grok-5', provider: 'xai', platform: 'grok', note: '视觉', tag: '' },
  { id: 'minimax-m3', provider: 'minimax', platform: 'minimax', note: '200K', tag: '' },
  { id: 'hunyuan-t2', provider: 'tencent', platform: 'hunyuan', note: '视觉', tag: '' },
  { id: 'ernie-5.2', provider: 'baidu', platform: 'wenxin', note: '中文', tag: '' },
  { id: 'step-4', provider: 'stepfun', platform: 'stepfun', note: '多模', tag: '' },
  { id: 'yi-large-3', provider: 'lingyi', platform: 'yi', note: '200K', tag: '' },
  { id: 'mistral-large-3', provider: 'mistral', platform: 'mistral', note: '128K', tag: '' },
  { id: 'self-hosted-v4', provider: 'openai-chat', platform: 'custom', note: '自建网关', tag: '' }
]

var SKILLS = [
  { id: 'lit-anim', name: '英语课文与绘本动画', desc: '把英语课文或绘本转成教学动画。', cat: '教育培训', files: 6, size: '12 KB', hue: 208, icon: 'book' },
  { id: 'geo', name: '英文地理可视化教学', desc: '把地理知识转成全英文可视化教学。', cat: '教育培训', files: 9, size: '24 KB', hue: 172, icon: 'globe', featured: true },
  { id: 'bio', name: '生物机制可视化教学', desc: '把生物机制转成动画讲解。', cat: '教育培训', files: 4, size: '8 KB', hue: 148, icon: 'leaf' },
  { id: 'word', name: '英语单词动画教学', desc: '输入英语单词，自动生成动画讲解。', cat: '教育培训', files: 5, size: '10 KB', hue: 34, icon: 'type' },
  { id: 'oral', name: '口播视频规划', desc: '输入逐字稿或知识视频脚本，可拆分镜。', cat: '短视频', files: 3, size: '6 KB', hue: 262, icon: 'mic' },
  { id: 'ad', name: '商品广告分镜', desc: '从卖点生成 15 秒商品广告分镜。', cat: '商业广告', files: 7, size: '15 KB', hue: 12, icon: 'bag' },
  { id: 'film', name: '专业影视调色描述', desc: '给镜头写可执行的调色与布光说明。', cat: '专业影视', files: 5, size: '11 KB', hue: 220, icon: 'film' },
  { id: 'anime', name: '动漫角色设定', desc: '整理角色外观、性格与动作习惯。', cat: '动漫游戏', files: 8, size: '18 KB', hue: 320, icon: 'sparkle' },
  { id: 'mv', name: '音乐 MV 分镜', desc: '按节拍把歌曲拆成镜头列表。', cat: '音乐 MV', files: 4, size: '9 KB', hue: 284, icon: 'music' },
  { id: 'short', name: '短剧爆点改写', desc: '检查前三秒钩子与每一集的结尾悬念。', cat: '短剧漫剧', files: 6, size: '13 KB', hue: 198, icon: 'clapper' }
]

var MCP = [
  {
    name: 'smart', desc: '内置画布工具：查节点、改属性、连线', transport: '内置', builtin: true, ok: true,
    tools: [
      { name: 'canvas_list_nodes', desc: '列出当前画布上的节点' },
      { name: 'canvas_update_node', desc: '修改节点文字、尺寸或样式' },
      { name: 'canvas_connect_nodes', desc: '按端口连接两个节点' },
      { name: 'canvas_export_image', desc: '把选中区域导出成图片' }
    ]
  },
  {
    name: 'filesystem', desc: '读取本机项目文件', transport: 'stdio', ok: true,
    tools: [
      { name: 'read_file', desc: '读取一个文件的全文' },
      { name: 'list_dir', desc: '列出目录里的文件' },
      { name: 'search_files', desc: '按名字或内容搜索文件' }
    ]
  },
  {
    name: 'chrome-devtools', desc: '检查页面结构与控制台', transport: 'SSE', ok: true,
    tools: [
      { name: 'take_snapshot', desc: '读取当前页面的可访问结构' },
      { name: 'list_console_messages', desc: '读取控制台日志' },
      { name: 'click', desc: '按页面元素点击' }
    ]
  },
  {
    name: 'figma', desc: '读取设计稿与变量', transport: 'SSE', ok: false,
    tools: []
  }
]

// ---------------------------------------------------------------- 品牌图标
// 路径来自 lobehub/lobe-icons（MIT）。viewBox 统一 24，品牌色尽量保留。

var BRANDS = {
  deepseek: { name: 'DeepSeek', svg: '<path fill="#4D6BFE" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"/>' },
  openai: { name: 'OpenAI', svg: '<path fill="currentColor" fill-rule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z"/>' },
  claude: { name: 'Claude', svg: '<path fill="#D97757" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>' },
  gemini: { name: 'Gemini', svg: '<defs><linearGradient id="lab-gm0" gradientUnits="userSpaceOnUse" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient><linearGradient id="lab-gm1" gradientUnits="userSpaceOnUse" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient><linearGradient id="lab-gm2" gradientUnits="userSpaceOnUse" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient></defs><path fill="#3186FF" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/><path fill="url(#lab-gm0)" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/><path fill="url(#lab-gm1)" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/><path fill="url(#lab-gm2)" d="M20.616 10.835a14.147 14.147 0 0 1-4.45-3.001 14.111 14.111 0 0 1-3.678-6.452.503.503 0 0 0-.975 0 14.134 14.134 0 0 1-3.679 6.452 14.155 14.155 0 0 1-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 0 0 0 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 0 1 4.45 3.001 14.112 14.112 0 0 1 3.679 6.453.502.502 0 0 0 .975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 0 1 3.001-4.45 14.113 14.113 0 0 1 6.453-3.678.503.503 0 0 0 0-.975 13.245 13.245 0 0 1-2.003-.678z"/>' },
  doubao: { name: '豆包', svg: '<path fill="#1E37FC" d="M5.31 15.756c.172-3.75 1.883-5.999 2.549-6.739-3.26 2.058-5.425 5.658-6.358 8.308v1.12C1.501 21.513 4.226 24 7.59 24a6.59 6.59 0 0 0 2.2-.375c.353-.12.7-.248 1.039-.378.913-.899 1.65-1.91 2.243-2.992-4.877 2.431-7.974.072-7.763-4.5l.002.001z"/><path fill="#37E1BE" d="M22.57 10.283c-1.212-.901-4.109-2.404-7.397-2.8.295 3.792.093 8.766-2.1 12.773a12.782 12.782 0 0 1-2.244 2.992c3.764-1.448 6.746-3.457 8.596-5.219 2.82-2.683 3.353-5.178 3.361-6.66a2.737 2.737 0 0 0-.216-1.084v-.002z"/><path fill="#A569FF" d="M14.303 1.867C12.955.7 11.248 0 9.39 0 7.532 0 5.883.677 4.545 1.807 2.791 3.29 1.627 5.557 1.5 8.125v9.201c.932-2.65 3.097-6.25 6.357-8.307.5-.318 1.025-.595 1.569-.829 1.883-.801 3.878-.932 5.746-.706-.222-2.83-.718-5.002-.87-5.617h.001z"/><path fill="#1E37FC" d="M17.305 4.961a199.47 199.47 0 0 1-1.08-1.094c-.202-.213-.398-.419-.586-.622l-1.333-1.378c.151.615.648 2.786.869 5.617 3.288.395 6.185 1.898 7.396 2.8-1.306-1.275-3.475-3.487-5.266-5.323z"/>' },
  qwen: { name: '通义千问', svg: '<path fill="#082dff" d="M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z"/>' },
  zhipu: { name: '智谱', svg: '<path fill="#3859FF" fill-rule="evenodd" d="M12.105 2 9.927 4.953H.653L2.83 2h9.276zM23.254 19.048 21.078 22h-9.242l2.174-2.952h9.244zM24 2 9.264 22H0L14.736 2H24z"/>' },
  kimi: { name: 'Kimi', svg: '<path fill="#1783FF" d="M21.846 0a1.923 1.923 0 1 1 0 3.846H20.15a.226.226 0 0 1-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"/><path fill="currentColor" d="m11.065 11.199 7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 0 0-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 0 1 .205-.023l6.484 4.772a7.677 7.677 0 0 0 3.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 0 1-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"/>' },
  grok: { name: 'Grok', svg: '<path fill="currentColor" fill-rule="evenodd" d="m9.27 15.29 7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 0 0-1.829-1A8.975 8.975 0 0 0 5.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/>' },
  minimax: { name: 'MiniMax', svg: '<defs><linearGradient id="lab-mm" x1="0%" x2="100.182%" y1="50.057%" y2="50.057%"><stop stop-color="#E2167E"/><stop offset="100%" stop-color="#FE603C"/></linearGradient></defs><path fill="url(#lab-mm)" fill-rule="nonzero" d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 0 0 .744.709.74.74 0 0 0 .743-.709V9.099a2.06 2.06 0 0 1 2.071-2.049A2.06 2.06 0 0 1 24 9.1v6.561a.649.649 0 0 1-.652.645.649.649 0 0 1-.653-.645V9.1a.762.762 0 0 0-.766-.758.762.762 0 0 0-.766.758v7.472a2.037 2.037 0 0 1-2.048 2.026 2.037 2.037 0 0 1-2.048-2.026v-12.5a.785.785 0 0 0-.788-.753.785.785 0 0 0-.789.752l-.001 15.904A2.037 2.037 0 0 1 13.441 22a2.037 2.037 0 0 1-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 0 0 .372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 0 1-.652.645.648.648 0 0 1-.652-.645V4.07a.785.785 0 0 0-.789-.78.785.785 0 0 0-.789.78v14.013a2.06 2.06 0 0 1-2.07 2.048 2.06 2.06 0 0 1-2.071-2.048V9.1a.762.762 0 0 0-.766-.758.762.762 0 0 0-.766.758v3.8a2.06 2.06 0 0 1-2.071 2.049A2.06 2.06 0 0 1 0 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 0 1 2.07-2.048 2.06 2.06 0 0 1 2.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z"/>' },
  hunyuan: { name: '腾讯混元', svg: '<circle cx="12" cy="12" fill="#0055E9" r="12"/><path fill="#A8DFF5" d="M12 0c.518 0 1.028.033 1.528.096A6.188 6.188 0 0 1 12.12 12.28l-.12.001c-2.99 0-5.242 2.179-5.554 5.11-.223 2.086.353 4.412 2.242 6.146C3.672 22.1 0 17.479 0 12 0 5.373 5.373 0 12 0z"/><path fill="#00BCFF" d="M12.98.04c.272.021.543.053.81.093.583.106 1.117.254 1.538.44 6.638 2.927 8.07 10.052 1.748 15.642a4.125 4.125 0 0 1-5.822-.358c-1.51-1.706-1.3-4.184.357-5.822.858-.848 3.108-1.223 4.045-2.441 1.257-1.634 2.122-6.009-2.523-7.506L12.98.039z"/><path fill="#ECECEE" d="M13.528.096A6.187 6.187 0 0 1 12 12.281a5.75 5.75 0 0 0-1.71.255c.147-.905.595-1.784 1.321-2.501.858-.848 3.108-1.223 4.045-2.441 1.27-1.651 2.14-6.104-2.676-7.554.184.014.367.033.548.056z"/>' },
  wenxin: { name: '文心一言', svg: '<defs><linearGradient id="lab-wx" x1="9.155%" x2="90.531%" y1="75.177%" y2="25.028%"><stop offset="0%" stop-color="#0A51C3"/><stop offset="100%" stop-color="#23A4FB"/></linearGradient></defs><path fill="url(#lab-wx)" d="M11.32 1.176a1.4 1.4 0 0 1 1.36 0l8.64 4.843c.421.234.68.67.68 1.141v9.68c0 .472-.259.908-.68 1.143l-8.64 4.84a1.4 1.4 0 0 1-1.36 0l-8.64-4.84A1.31 1.31 0 0 1 2 16.84V7.159c0-.471.259-.907.68-1.142l8.64-4.84zm7.42 13.839V8.227L12.002 12 12 19.551l6.059-3.394a1.31 1.31 0 0 0 .68-1.142zM12.68 4.833a1.393 1.393 0 0 0-1.36 0L5.944 7.846c-.421.235-.68.67-.68 1.142v6.027c0 .47.259.905.68 1.142l2.795 1.566V11.09a1.546 1.546 0 0 0 .221.79 1.527 1.527 0 0 1-.216-.834l.004-.094.02-.15.018-.084.017-.062.039-.117.062-.142.035-.065.081-.13.094-.122.084-.091.08-.075.125-.1.071-.048.134-.076 5.87-3.29-2.796-1.566z"/><path fill="#012F8D" d="M12 11.088c0-.875-.73-1.584-1.631-1.584a1.66 1.66 0 0 0-.855.237c-.027.016-.055.033-.08.05a2.361 2.361 0 0 0-.123.093c-.022.02-.045.038-.066.059l-.048.045-.063.067c-.014.016-.028.031-.04.048a2.303 2.303 0 0 0-.094.125l-.042.069a1.7 1.7 0 0 0-.07.13l-.036.081a.764.764 0 0 0-.022.06c-.01.03-.02.058-.028.087l-.017.062a.883.883 0 0 0-.03.16c-.002.025-.007.05-.008.074a1.527 1.527 0 0 0 .213.929c.302.508.85.792 1.414.792.277 0 .558-.068.814-.212l.815-.457v-.914L12 11.088z"/>' },
  stepfun: { name: '阶跃星辰', svg: '<defs><linearGradient id="lab-sf" gradientUnits="userSpaceOnUse" x1="1.646" x2="18.342" y1="1.916" y2="22.091"><stop stop-color="#01A9FF"/><stop offset="1" stop-color="#0160FF"/></linearGradient></defs><path fill="url(#lab-sf)" fill-rule="evenodd" d="M22.012 0h1.032v.927H24v.968h-.956V3.78h-1.032V1.896h-1.878v-.97h1.878V0zM2.6 12.371V1.87h.969v10.502h-.97zm10.423.66h10.95v.918h-6.208v9.579h-4.742V13.03zM5.629 3.333v12.356H0v4.51h10.386V8L20.859 8l-.003-4.668-15.227.001z"/>' },
  yi: { name: '零一万物', svg: '<g fill="currentColor" fill-rule="evenodd"><path d="M18.62 13.927c.611 0 1.107.505 1.107 1.128v5.817c0 .623-.496 1.128-1.108 1.128a1.118 1.118 0 0 1-1.108-1.128v-5.817c0-.623.496-1.128 1.108-1.128zM16.59 3.052a1.094 1.094 0 0 1 1.562-.129c.466.404.522 1.116.126 1.59l-5.938 7.111v9.147c0 .624-.496 1.129-1.108 1.129a1.118 1.118 0 0 1-1.108-1.129v-9.477l.003-.088.01-.087c.015-.232.102-.462.261-.654l6.192-7.413zM2.906 2.256a1.094 1.094 0 0 1 1.559.157l4.387 5.45a1.142 1.142 0 0 1-.155 1.587 1.094 1.094 0 0 1-1.559-.157l-4.387-5.45a1.144 1.144 0 0 1 .06-1.498l.095-.09z"/></g><ellipse cx="20.146" cy="10.692" fill="#00E01F" rx="1.354" ry="1.379"/>' },
  mistral: { name: 'Mistral', svg: '<path fill="#FFD800" d="M3.428 3.4h3.429v3.428H3.428zM17.142 3.4h3.43v3.428h-3.43z"/><path fill="#FFAF00" d="M3.428 6.828h6.857v3.429H3.429zm10.286 0h6.857v3.429h-6.857z"/><path fill="#FF8205" d="M3.428 10.258h17.144v3.428H3.428z"/><path fill="#FA500F" d="M3.428 13.686h3.429v3.428H3.428zm6.858 0h3.429v3.428h-3.429zm6.856 0h3.43v3.428h-3.43z"/><path fill="#E10500" d="M0 17.114h10.286v3.429H0zm13.714 0H24v3.429H13.714z"/>' },
  custom: { name: '自建网关', svg: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 8h16v9H4zm0 0 8 5 8-5M9 3v3M15 3v3"/>' },
}

function detectPlatform(modelId, provider) {
  var s = String(modelId || '').toLowerCase()
  var p = String(provider || '').toLowerCase()
  var rules = [
    [/^(deepseek|ds-)/, 'deepseek'],
    [/^(gpt|o[134](-|$)|chatgpt)/, 'openai'],
    [/^claude/, 'claude'],
    [/^gemini/, 'gemini'],
    [/^(doubao|seed-|ep-)/, 'doubao'],
    [/^(qwen|qwq|qvq|tongyi)/, 'qwen'],
    [/^(glm|chatglm|zhipu)/, 'zhipu'],
    [/^(kimi|moonshot)/, 'kimi'],
    [/^(grok)/, 'grok'],
    [/^(minimax|abab)/, 'minimax'],
    [/^(hunyuan)/, 'hunyuan'],
    [/^(ernie|wenxin)/, 'wenxin'],
    [/^(step-|stepfun)/, 'stepfun'],
    [/^(yi-)/, 'yi'],
    [/^(mistral|codestral|mixtral)/, 'mistral']
  ]
  for (var i = 0; i < rules.length; i++) {
    if (rules[i][0].test(s)) return rules[i][1]
  }
  if (/deepseek/.test(s + p)) return 'deepseek'
  if (/openai|azure/.test(p)) return 'openai'
  if (/anthropic/.test(p)) return 'claude'
  if (/google|vertex/.test(p)) return 'gemini'
  if (/doubao|volc/.test(p)) return 'doubao'
  if (/dashscope|alibaba|qwen/.test(p)) return 'qwen'
  if (/zhipu|bigmodel/.test(p)) return 'zhipu'
  if (/moonshot|kimi/.test(p)) return 'kimi'
  if (/xai/.test(p)) return 'grok'
  if (/minimax/.test(p)) return 'minimax'
  if (/tencent|hunyuan/.test(p)) return 'hunyuan'
  if (/baidu|wenxin/.test(p)) return 'wenxin'
  if (/stepfun/.test(p)) return 'stepfun'
  if (/lingyi|01.ai/.test(p)) return 'yi'
  if (/mistral/.test(p)) return 'mistral'
  return 'custom'
}

function brandIcon(key, extraClass) {
  var b = BRANDS[key] || BRANDS.custom
  var mono = key === 'openai' || key === 'grok' || key === 'kimi' || key === 'yi' || key === 'custom'
  return '<span class="brand' + (mono ? ' mono' : '') + (extraClass ? ' ' + extraClass : '') + '" title="' + esc(b.name) + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' + b.svg + '</svg></span>'
}

// ---------------------------------------------------------------- 线性图标

var LINE = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  hand: '<path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 11V4a2 2 0 0 1 4 0v7"/><path d="M17 11V6a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-2.5a6 6 0 0 1-5.2-3L4 12.5A2 2 0 0 1 7 10l2 2"/>',
  shield: '<path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-3Z"/><path d="M12 8v4M12 16h.01"/>',
  sparkle: '<path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/><path d="m5 14 .8 1.7L7.5 16.5l-1.7.8L5 19l-.8-1.7L2.5 16.5l1.7-.8L5 14Z"/><path d="m15 15 .8 1.7 1.7.8-1.7.8L15 20l-.8-1.7-1.7-.8 1.7-.8L15 15Z"/>',
  plug: '<path d="M12 2v5M8 2v5M6 7h12v4a6 6 0 0 1-12 0ZM12 17v5M9 22h6"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.7-8.7Z"/><path d="m14.7 6.3 3-3 3 3-3 3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  leaf: '<path d="M20 4C10 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-6 11-16Z"/><path d="M4 20c3-7 7-10 12-12"/>',
  type: '<path d="M4 6h16M12 6v14M8 20h8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  clapper: '<path d="M4 9h16v11H4zM4 9l2-5h16l-2 5"/><path d="m9 4-1 5M14 4l-1 5M19 4l-1 5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  star: '<path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.2l5.9-.8L12 3Z"/>'
}

function icon(name) {
  return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (LINE[name] || LINE.info || LINE.search) + '</svg>'
}

var SKILL_ICONS = {
  book: 'book', globe: 'globe', leaf: 'leaf', type: 'type', mic: 'mic',
  bag: 'bag', film: 'film', sparkle: 'sparkle', music: 'music', clapper: 'clapper'
}

// ---------------------------------------------------------------- 状态

var state = {
  view: { skill: 'card', mcp: 'card', model: 'card' },
  query: { skill: '', mcp: '', model: '' },
  searchOpen: { skill: false, mcp: false, model: false },
  selectedSkills: new Set(),
  selectedModels: new Set(),
  selectedServers: new Set(),
  selectedTools: new Set(),
  expandedMcp: new Set(['smart']),
  activeCategory: '全部',
  activePlatform: 'all',
  activeMcp: 'smart',
  auth: 'ask',
  detecting: false
}

// ---------------------------------------------------------------- 工具

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  })
}

function checkMark() {
  return '<span class="check-mark" aria-hidden="true">' + icon('check') + '</span>'
}

function emptyState(title, desc) {
  return '<div class="empty-state">' +
    '<span class="empty-icon">' + icon('search') + '</span>' +
    '<span class="empty-title">' + esc(title) + '</span>' +
    '<span class="empty-desc">' + esc(desc) + '</span>' +
    '</div>'
}

function skillCover(skill, tile) {
  var hue2 = (skill.hue + 42) % 360
  var cls = tile ? 'skill-cover' : 'skill-thumb'
  var image = skill.cover ? '<img src="' + esc(skill.cover) + '" alt="">' : ''
  return '<span class="' + cls + '" style="--hue:' + skill.hue + ';--hue2:' + hue2 + '">' +
    image + icon(SKILL_ICONS[skill.icon] || 'book') +
    '</span>'
}

function toggleIn(set, value) {
  if (set.has(value)) set.delete(value)
  else set.add(value)
}

// ---------------------------------------------------------------- 过滤

function skillCategories() {
  var order = ['全部']
  SKILLS.forEach(function (skill) {
    if (order.indexOf(skill.cat) === -1) order.push(skill.cat)
  })
  if (SKILLS.some(function (skill) { return skill.featured })) order.push('精选')
  return order.map(function (name) {
    var count = name === '全部'
      ? SKILLS.length
      : name === '精选'
        ? SKILLS.filter(function (skill) { return skill.featured }).length
        : SKILLS.filter(function (skill) { return skill.cat === name }).length
    return { name: name, count: count }
  })
}

function filteredSkills() {
  var query = state.query.skill.trim().toLowerCase()
  return SKILLS.filter(function (skill) {
    if (state.activeCategory !== '全部') {
      if (state.activeCategory === '精选') {
        if (!skill.featured) return false
      } else if (skill.cat !== state.activeCategory) {
        return false
      }
    }
    if (!query) return true
    return (skill.name + ' ' + skill.desc + ' ' + skill.cat).toLowerCase().indexOf(query) !== -1
  })
}

function modelPlatforms() {
  var order = []
  MODELS.forEach(function (model) {
    if (order.indexOf(model.platform) === -1) order.push(model.platform)
  })
  return order
}

function filteredModels() {
  var query = state.query.model.trim().toLowerCase()
  return MODELS.filter(function (model) {
    if (state.activePlatform !== 'all' && model.platform !== state.activePlatform) return false
    if (!query) return true
    var brand = BRANDS[model.platform] ? BRANDS[model.platform].name : ''
    return (model.id + ' ' + model.provider + ' ' + model.note + ' ' + brand).toLowerCase().indexOf(query) !== -1
  })
}

function visibleMcp() {
  var query = state.query.mcp.trim().toLowerCase()
  return MCP.map(function (server) {
    var serverHit = (server.name + ' ' + server.desc + ' ' + server.transport).toLowerCase().indexOf(query) !== -1
    var shownTools = query && !serverHit
      ? server.tools.filter(function (tool) {
          return (tool.name + ' ' + tool.desc).toLowerCase().indexOf(query) !== -1
        })
      : server.tools
    if (query && !serverHit && !shownTools.length) return null
    return {
      name: server.name,
      desc: server.desc,
      transport: server.transport,
      builtin: server.builtin,
      ok: server.ok,
      tools: server.tools,
      shownTools: shownTools,
      serverHit: serverHit
    }
  }).filter(Boolean)
}

function mcpToolKey(serverName, toolName) {
  return serverName + '/' + toolName
}

function selectedToolsFor(serverName) {
  var count = 0
  state.selectedTools.forEach(function (key) {
    if (key.indexOf(serverName + '/') === 0) count++
  })
  return count
}

// ---------------------------------------------------------------- 搜索与切换控件

function searchPlaceholder(kind) {
  if (kind === 'skill') return '搜索技能'
  if (kind === 'mcp') return '搜索服务或工具'
  return '搜索模型或平台'
}

function clearSearchButton(kind) {
  return '<button type="button" class="search-clear" data-action="clear-search" data-kind="' + kind + '" aria-label="清空搜索" title="清空搜索">' + icon('close') + '</button>'
}

function collapseSearchButton(kind) {
  return '<button type="button" class="search-clear" data-action="toggle-search" data-kind="' + kind + '" aria-label="收起搜索" title="收起搜索">' + icon('close') + '</button>'
}

function searchInline(kind) {
  var query = state.query[kind]
  var placeholder = searchPlaceholder(kind)
  return '<div class="search-inline">' +
    icon('search') +
    '<input type="search" id="search-' + kind + (state.searchOpen[kind] ? '-inline' : '') + '" name="search-' + kind + '" data-search-input="' + kind + '" value="' + esc(query) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" autocomplete="off" spellcheck="false">' +
    (query ? clearSearchButton(kind) : state.searchOpen[kind] ? collapseSearchButton(kind) : '') +
    '</div>'
}

function searchControl(kind) {
  return '<button type="button" class="icon-btn search-toggle" data-action="toggle-search" data-kind="' + kind + '" aria-expanded="' + (state.searchOpen[kind] ? 'true' : 'false') + '" aria-label="' + (state.searchOpen[kind] ? '收起搜索' : '搜索') + '" title="' + (state.searchOpen[kind] ? '收起搜索' : '搜索') + '">' +
    icon('search') +
    '</button>'
}

function segment(kind) {
  var current = state.view[kind]
  return '<div class="segment" role="group" aria-label="面板布局">' +
    '<button type="button" data-action="view" data-kind="' + kind + '" data-view="card" aria-pressed="' + (current === 'card' ? 'true' : 'false') + '" aria-label="轻卡片" title="轻卡片">' +
    icon('grid') + '<span class="segment-label">卡片</span></button>' +
    '<button type="button" data-action="view" data-kind="' + kind + '" data-view="split" aria-pressed="' + (current === 'split' ? 'true' : 'false') + '" aria-label="分栏" title="分栏">' +
    icon('columns') + '<span class="segment-label">分栏</span></button>' +
    '</div>'
}

function panelHead(kind, title, count, extra) {
  return '<div class="panel-head">' +
    '<div class="panel-head-top">' +
    '<div class="panel-heading"><h2 class="panel-title">' + esc(title) + '</h2><span class="count-pill">' + count + '</span></div>' +
    '<div class="panel-search">' + searchInline(kind) + '</div>' +
    '<div class="panel-tools">' + searchControl(kind) + (extra || '') + segment(kind) + '</div>' +
    '</div>' +
    '</div>'
}

// ---------------------------------------------------------------- 底栏

function footer(kind) {
  var count = 0
  var summary = ''
  if (kind === 'skill') {
    count = state.selectedSkills.size
    summary = count
      ? '已选 <b class="selected-number">' + count + '</b> 个技能'
      : '未选择技能'
  } else if (kind === 'model') {
    count = state.selectedModels.size
    summary = count
      ? '已选 <b class="selected-number">1</b> 个模型'
      : '未选择模型'
  } else {
    var servers = state.selectedServers.size
    var tools = state.selectedTools.size
    count = servers + tools
    summary = count
      ? '已选 <b class="selected-number">' + servers + '</b> 个服务 · <b class="selected-number">' + tools + '</b> 个工具'
      : '未选择服务或工具'
  }

  return '<div class="panel-foot">' +
    '<div class="selection-summary">' + summary + '</div>' +
    '<button type="button" class="confirm-btn" data-action="confirm" data-kind="' + kind + '"' + (count ? '' : ' disabled') + '>' +
    icon('check') + '确认引用</button>' +
    '</div>'
}

// ---------------------------------------------------------------- 审核

var REVIEW_OPTIONS = [
  { id: 'ask', title: '接受审核', desc: '需要确认时先停下来问你。', icon: 'hand', auto: false, badge: '推荐' },
  { id: 'auto', title: '完全自动授权', desc: '所有工具直接执行，不再逐次确认。', icon: 'shield', auto: true, badge: '谨慎' }
]

function renderReview(live) {
  var options = REVIEW_OPTIONS.map(function (option) {
    var selected = state.auth === option.id
    return '<button type="button" class="review-option' + (option.auto ? ' auto' : '') + '" data-action="auth" data-auth="' + option.id + '" role="radio" aria-checked="' + (selected ? 'true' : 'false') + '">' +
      '<span class="option-icon">' + icon(option.icon) + '</span>' +
      '<span class="option-copy">' +
      '<span class="option-title">' + option.title +
      '<span class="badge' + (option.auto ? ' warn' : ' accent') + '">' + option.badge + '</span>' +
      '</span>' +
      '<span class="option-desc">' + option.desc + '</span>' +
      '</span>' +
      '<span class="radio" aria-hidden="true">' + icon('check') + '</span>' +
      '</button>'
  }).join('')

  return '<section class="panel review-panel' + (live ? ' is-live' : '') + '" id="panel-review">' +
    '<div class="panel-head"><div class="panel-head-top">' +
    '<div class="panel-heading"><h2 class="panel-title">授权方式</h2><span class="count-pill">2</span></div>' +
    '</div></div>' +
    '<div class="review-body"><div class="review-list" role="radiogroup" aria-label="授权方式">' +
    options +
    '</div></div>' +
    '</section>'
}

// ---------------------------------------------------------------- 技能

function skillCard(skill) {
  var picked = state.selectedSkills.has(skill.id)
  return '<button type="button" class="skill-card" data-action="select-skill" data-id="' + skill.id + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' +
    skillCover(skill, false) +
    '<span class="skill-copy">' +
    '<span class="skill-name-row"><span class="skill-name">' + esc(skill.name) + '</span>' +
    (skill.featured ? '<span class="badge accent">精选</span>' : '') +
    checkMark() + '</span>' +
    '<span class="skill-desc">' + esc(skill.desc) + '</span>' +
    '<span class="skill-meta"><span>' + esc(skill.cat) + '</span><span class="dot-sep"></span><span>' + skill.files + ' 文件</span></span>' +
    '</span>' +
    '</button>'
}

function skillTile(skill) {
  var picked = state.selectedSkills.has(skill.id)
  return '<button type="button" class="skill-tile" data-action="select-skill" data-id="' + skill.id + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' +
    skillCover(skill, true) +
    '<span class="skill-tile-body">' +
    '<span class="tile-top"><span class="skill-name">' + esc(skill.name) + '</span>' + checkMark() + '</span>' +
    '<span class="skill-desc">' + esc(skill.desc) + '</span>' +
    '<span class="skill-meta"><span>' + esc(skill.cat) + '</span><span class="dot-sep"></span><span>' + skill.files + ' 文件</span><span class="dot-sep"></span><span>' + esc(skill.size) + '</span></span>' +
    '</span>' +
    '</button>'
}

function skillCards(list) {
  return '<div class="panel-scroll" data-scroll="skill-list">' +
    (list.length
      ? '<div class="skill-grid">' + list.map(skillCard).join('') + '</div>'
      : emptyState('没有找到技能', '换个关键词，或清空搜索再试。')) +
    '</div>'
}

function skillSplit(list) {
  var categories = skillCategories()
  var rail = categories.map(function (category) {
    var active = state.activeCategory === category.name
    var iconName = category.name === '全部' ? 'layers' : category.name === '精选' ? 'star' : 'folder'
    return '<button type="button" class="rail-item" data-action="category" data-cat="' + esc(category.name) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
      icon(iconName) +
      '<span class="rail-name">' + esc(category.name) + '</span>' +
      '<span class="rail-count">' + category.count + '</span>' +
      '</button>'
  }).join('')

  return '<div class="split">' +
    '<aside class="split-rail" aria-label="技能分类">' +
    '<div class="rail-label">分类</div>' +
    '<div class="rail-scroll" data-scroll="skill-rail">' + rail + '</div>' +
    '</aside>' +
    '<div class="split-main">' +
    '<div class="split-scroll" data-scroll="skill-main">' +
    (list.length
      ? '<div class="skill-grid">' + list.map(skillTile).join('') + '</div>'
      : emptyState('没有找到技能', '换个关键词，或清空搜索再试。')) +
    '</div>' +
    '</div>' +
    '</div>'
}

function renderSkill(live) {
  var list = filteredSkills()
  var body = state.view.skill === 'split' ? skillSplit(list) : skillCards(list)
  var tall = state.view.skill === 'split' ? ' panel-tall' : ''
  return '<section class="panel' + tall + ' skill-panel' + (live ? ' is-live' : '') + (state.searchOpen.skill ? ' is-search-open' : '') + '" id="panel-skill">' +
    panelHead('skill', '技能', SKILLS.length) +
    '<div class="panel-body">' + body + '</div>' +
    footer('skill') +
    '</section>'
}

// ---------------------------------------------------------------- 模型

function modelTag(model) {
  if (!model.tag) return ''
  return '<span class="badge accent">' + esc(model.tag) + '</span>'
}

function modelMeta(model) {
  var brand = BRANDS[model.platform] ? BRANDS[model.platform].name : '自定义'
  return '<span class="model-meta"><span>' + esc(brand) + '</span><span class="dot-sep"></span><span>' + esc(model.note) + '</span></span>'
}

function modelCard(model) {
  var picked = state.selectedModels.has(model.id)
  return '<button type="button" class="model-card" data-action="select-model" data-id="' + esc(model.id) + '" role="radio" aria-checked="' + (picked ? 'true' : 'false') + '">' +
    brandIcon(model.platform) +
    '<span class="model-copy">' +
    '<span class="model-card-top"><span class="model-id">' + esc(model.id) + '</span>' + modelTag(model) + checkMark() + '</span>' +
    modelMeta(model) +
    '</span>' +
    '</button>'
}

function modelRow(model) {
  var picked = state.selectedModels.has(model.id)
  return '<button type="button" class="model-row" data-action="select-model" data-id="' + esc(model.id) + '" role="radio" aria-checked="' + (picked ? 'true' : 'false') + '">' +
    brandIcon(model.platform) +
    '<span class="model-copy"><span class="model-id">' + esc(model.id) + '</span>' + modelMeta(model) + '</span>' +
    '<span class="model-badges">' + modelTag(model) + '</span>' +
    checkMark() +
    '</button>'
}

function modelCards(list) {
  return '<div class="panel-scroll" data-scroll="model-list">' +
    (list.length
      ? '<div class="model-grid" role="radiogroup" aria-label="模型">' + list.map(modelCard).join('') + '</div>'
      : emptyState('没有找到模型', '换个模型名或平台名试试。')) +
    '</div>'
}

function modelSplit(list) {
  var platforms = modelPlatforms()
  var rail = '<button type="button" class="rail-item" data-action="platform" data-platform="all" aria-pressed="' + (state.activePlatform === 'all' ? 'true' : 'false') + '">' +
    icon('layers') +
    '<span class="rail-name">全部平台</span>' +
    '<span class="rail-count">' + MODELS.length + '</span>' +
    '</button>'

  platforms.forEach(function (platform) {
    var count = MODELS.filter(function (model) { return model.platform === platform }).length
    var active = state.activePlatform === platform
    rail += '<button type="button" class="rail-item" data-action="platform" data-platform="' + esc(platform) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
      brandIcon(platform) +
      '<span class="rail-name">' + esc(BRANDS[platform] ? BRANDS[platform].name : platform) + '</span>' +
      '<span class="rail-count">' + count + '</span>' +
      '</button>'
  })

  return '<div class="split">' +
    '<aside class="split-rail" aria-label="模型平台">' +
    '<div class="rail-label">平台</div>' +
    '<div class="rail-scroll" data-scroll="model-rail">' + rail + '</div>' +
    '</aside>' +
    '<div class="split-main">' +
    '<div class="split-scroll" data-scroll="model-main">' +
    (list.length
      ? '<div class="model-row-list" role="radiogroup" aria-label="模型">' + list.map(modelRow).join('') + '</div>'
      : emptyState('没有找到模型', '换个模型名或平台名试试。')) +
    '</div>' +
    '</div>' +
    '</div>'
}

function renderModel(live) {
  var list = filteredModels()
  var body = state.view.model === 'split' ? modelSplit(list) : modelCards(list)
  var tall = state.view.model === 'split' ? ' panel-tall' : ''
  return '<section class="panel' + tall + ' model-panel' + (live ? ' is-live' : '') + (state.searchOpen.model ? ' is-search-open' : '') + '" id="panel-model">' +
    panelHead('model', '模型', MODELS.length) +
    '<div class="panel-body">' + body + '</div>' +
    footer('model') +
    '</section>'
}

// ---------------------------------------------------------------- MCP

function detectButton() {
  return '<button type="button" class="detect-btn' + (state.detecting ? ' is-busy' : '') + '" data-action="detect" title="检测全部 MCP 服务" aria-label="检测全部 MCP 服务"' + (state.detecting ? ' disabled' : '') + '>' +
    icon('refresh') +
    '<span class="detect-label">' + (state.detecting ? '检测中' : '重新检测') + '</span>' +
    '</button>'
}

function statusPill(server) {
  if (!server.ok) return '<span class="status bad">未连接</span>'
  return '<span class="status ok">' + server.tools.length + ' 工具</span>'
}

function toolRow(server, tool) {
  var key = mcpToolKey(server.name, tool.name)
  var picked = state.selectedTools.has(key)
  return '<button type="button" class="tool-row' + (picked ? ' is-picked' : '') + '" data-action="tool-pick" data-key="' + esc(key) + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' +
    '<span class="pick-box" aria-hidden="true">' + icon('check') + '</span>' +
    '<span class="tool-copy"><span class="tool-name">' + esc(tool.name) + '</span><span class="tool-desc">' + esc(tool.desc) + '</span></span>' +
    '</button>'
}

function mcpToolsHtml(server, scrollKey) {
  var tools = server.shownTools
  if (!tools.length) {
    return '<div class="mcp-empty-tools">这个服务还没有可用工具。</div>'
  }
  return '<div class="mcp-tools" data-scroll="' + esc(scrollKey) + '">' +
    tools.map(function (tool) { return toolRow(server, tool) }).join('') +
    '</div>'
}

function mcpCard(server) {
  var picked = state.selectedServers.has(server.name)
  var query = state.query.mcp.trim()
  var autoOpen = query && !server.serverHit && server.shownTools.length
  var expanded = state.expandedMcp.has(server.name) || autoOpen
  var canExpand = server.tools.length > 0
  return '<div class="mcp-card' + (picked ? ' is-picked' : '') + '">' +
    '<div class="mcp-card-head">' +
    '<button type="button" class="pick-box" data-action="server-pick" data-name="' + esc(server.name) + '" aria-pressed="' + (picked ? 'true' : 'false') + '" aria-label="引用整个 ' + esc(server.name) + ' 服务" title="引用整个服务">' + icon('check') + '</button>' +
    '<button type="button" class="mcp-server-main" data-action="expand-mcp" data-name="' + esc(server.name) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
    '<span class="server-icon">' + icon('plug') + '</span>' +
    '<span class="server-copy"><span class="server-name">' + esc(server.name) + '</span><span class="server-desc">' + esc(server.desc) + '</span></span>' +
    '</button>' +
    '<div class="server-side">' + statusPill(server) +
    (canExpand ? '<button type="button" class="expand-btn" data-action="expand-mcp" data-name="' + esc(server.name) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '" aria-label="展开工具" title="展开工具">' + icon('chevron') + '</button>' : '') +
    '</div>' +
    '</div>' +
    (expanded && canExpand ? mcpToolsHtml(server, 'mcp-tools-' + server.name) : '') +
    '</div>'
}

function mcpCards(list) {
  return '<div class="panel-scroll" data-scroll="mcp-list">' +
    (list.length
      ? '<div class="mcp-list">' + list.map(mcpCard).join('') + '</div>'
      : emptyState('没有找到服务或工具', '换个关键词，或清空搜索再试。')) +
    '</div>'
}

function mcpRail(list, active) {
  return list.map(function (server) {
    var picked = state.selectedServers.has(server.name)
    var isActive = active && active.name === server.name
    return '<div class="mcp-rail-row' + (isActive ? ' is-active' : '') + '">' +
      '<button type="button" class="mcp-rail-main" data-action="select-mcp" data-name="' + esc(server.name) + '" title="' + esc(server.name) + '">' +
      '<span class="server-icon">' + icon('plug') + '</span>' +
      '<span class="rail-name">' + esc(server.name) + '</span>' +
      '</button>' +
      '<button type="button" class="mcp-rail-check" data-action="server-pick" data-name="' + esc(server.name) + '" aria-pressed="' + (picked ? 'true' : 'false') + '" aria-label="引用整个 ' + esc(server.name) + ' 服务" title="引用整个服务">' + icon('check') + '</button>' +
      '</div>'
  }).join('')
}

function mcpSplit(list) {
  var active = list.find(function (server) { return server.name === state.activeMcp }) || list[0] || null
  if (active && state.activeMcp !== active.name) state.activeMcp = active.name

  var detail = ''
  if (active) {
    var picked = state.selectedServers.has(active.name)
    var pickedTools = selectedToolsFor(active.name)
    detail = '<div class="server-detail' + (picked ? ' is-picked' : '') + '">' +
      '<div class="server-detail-head">' +
      '<span class="server-icon">' + icon('plug') + '</span>' +
      '<div class="server-detail-copy"><div class="server-detail-name">' + esc(active.name) + '</div><div class="server-detail-desc">' + esc(active.desc) + ' · ' + esc(active.transport) + '</div></div>' +
      statusPill(active) +
      '</div>' +
      '<div class="server-detail-actions">' +
      '<button type="button" class="ghost-btn' + (picked ? ' is-on' : '') + '" data-action="server-pick" data-name="' + esc(active.name) + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' +
      icon('check') + (picked ? '已选整个服务' : '选择整个服务') +
      '</button>' +
      '<span class="badge">' + (active.builtin ? '内置' : '外部') + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="detail-tools-title"><span>具体工具</span><small>已选 ' + pickedTools + ' 个</small></div>' +
      '<div class="detail-tools">' +
      (active.shownTools.length
        ? active.shownTools.map(function (tool) { return toolRow(active, tool) }).join('')
        : '<div class="mcp-empty-tools">这个服务还没有可用工具，点「重新检测」再看看。</div>') +
      '</div>'
  } else {
    detail = emptyState('没有找到服务或工具', '换个关键词，或清空搜索再试。')
  }

  return '<div class="split">' +
    '<aside class="split-rail" aria-label="MCP 服务">' +
    '<div class="rail-label">服务</div>' +
    '<div class="rail-scroll" data-scroll="mcp-rail">' + mcpRail(list, active) + '</div>' +
    '</aside>' +
    '<div class="split-main">' +
    '<div class="split-scroll" data-scroll="mcp-main">' + detail + '</div>' +
    '</div>' +
    '</div>'
}

function renderMcp(live) {
  var list = visibleMcp()
  var body = state.view.mcp === 'split' ? mcpSplit(list) : mcpCards(list)
  var tall = state.view.mcp === 'split' ? ' panel-tall' : ''
  return '<section class="panel' + tall + ' mcp-panel' + (live ? ' is-live' : '') + (state.searchOpen.mcp ? ' is-search-open' : '') + '" id="panel-mcp">' +
    panelHead('mcp', 'MCP', MCP.length, detectButton()) +
    '<div class="panel-body">' + body + '</div>' +
    footer('mcp') +
    '</section>'
}

// ---------------------------------------------------------------- 渲染与刷新

var RENDERERS = {
  review: renderReview,
  skill: renderSkill,
  mcp: renderMcp,
  model: renderModel
}

var panelHost = document.getElementById('panels')

function renderApp() {
  panelHost.innerHTML = renderReview(false) + renderSkill(false) + renderMcp(false) + renderModel(false)
}

function captureScrolls(root) {
  var values = {}
  root.querySelectorAll('[data-scroll]').forEach(function (element) {
    values[element.dataset.scroll] = element.scrollTop
  })
  return values
}

function restoreScrolls(root, values) {
  root.querySelectorAll('[data-scroll]').forEach(function (element) {
    var value = values[element.dataset.scroll]
    if (typeof value === 'number') element.scrollTop = value
  })
}

function visibleSearchInput(kind) {
  var inputs = Array.prototype.slice.call(document.querySelectorAll('[data-search-input="' + kind + '"]'))
  return inputs.find(function (input) {
    return input.offsetParent !== null
  }) || null
}

function focusSearch(kind, caret) {
  var input = visibleSearchInput(kind)
  if (!input) return
  input.focus()
  var end = typeof caret === 'number' ? caret : input.value.length
  if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end)
}

function refreshPanel(kind, options) {
  options = options || {}
  var old = document.getElementById('panel-' + kind)
  if (!old) return

  var scrolls = captureScrolls(old)
  var active = document.activeElement
  var activeSearch = active && active.matches && active.matches('[data-search-input]')
    ? active.dataset.searchInput
    : null
  var caret = activeSearch ? active.selectionStart : null

  old.outerHTML = RENDERERS[kind](true)
  var next = document.getElementById('panel-' + kind)
  if (!next) return
  restoreScrolls(next, scrolls)

  if (options.focusSearch) {
    focusSearch(kind, options.caret)
  } else if (activeSearch === kind) {
    focusSearch(kind, caret)
  }
}

// ---------------------------------------------------------------- 提示

var toastTimer = 0

function showToast(message) {
  var toast = document.getElementById('toast')
  var text = document.getElementById('toast-text')
  var iconBox = document.getElementById('toast-icon')
  if (!toast || !text || !iconBox) return
  text.textContent = message
  iconBox.innerHTML = icon('check')
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(function () {
    toast.hidden = true
  }, 2800)
}

// ---------------------------------------------------------------- 动作

function confirmSelection(kind) {
  if (kind === 'skill') {
    var skillCount = state.selectedSkills.size
    if (!skillCount) return
    state.selectedSkills.clear()
    refreshPanel('skill')
    showToast('已确认引用 ' + skillCount + ' 个技能')
    return
  }

  if (kind === 'model') {
    var modelCount = state.selectedModels.size
    if (!modelCount) return
    state.selectedModels.clear()
    refreshPanel('model')
    showToast('已确认引用 1 个模型')
    return
  }

  var servers = state.selectedServers.size
  var tools = state.selectedTools.size
  if (!servers && !tools) return
  state.selectedServers.clear()
  state.selectedTools.clear()
  refreshPanel('mcp')

  var parts = []
  if (servers) parts.push(servers + ' 个服务')
  if (tools) parts.push(tools + ' 个工具')
  showToast('已确认引用 ' + parts.join('、'))
}

var detectTimer = 0

function detectAllMcp() {
  if (state.detecting) return
  state.detecting = true
  refreshPanel('mcp')

  clearTimeout(detectTimer)
  detectTimer = setTimeout(function () {
    state.detecting = false
    refreshPanel('mcp')
    var available = MCP.filter(function (server) { return server.ok }).length
    var missing = MCP.length - available
    showToast(missing
      ? '已检测全部 ' + MCP.length + ' 个 MCP 服务：' + available + ' 个可用，' + missing + ' 个未连接'
      : '已检测全部 ' + MCP.length + ' 个 MCP 服务：全部可用')
  }, 1100)
}

panelHost.addEventListener('click', function (event) {
  var target = event.target.closest('[data-action]')
  if (!target || !panelHost.contains(target)) return
  var action = target.dataset.action
  var kind = target.dataset.kind

  if (action === 'auth') {
    state.auth = target.dataset.auth
    refreshPanel('review')
    return
  }

  if (action === 'view') {
    state.view[kind] = target.dataset.view
    refreshPanel(kind)
    return
  }

  if (action === 'toggle-search') {
    state.searchOpen[kind] = !state.searchOpen[kind]
    refreshPanel(kind, { focusSearch: state.searchOpen[kind] })
    return
  }

  if (action === 'clear-search') {
    state.query[kind] = ''
    refreshPanel(kind, { focusSearch: true })
    return
  }

  if (action === 'select-skill') {
    toggleIn(state.selectedSkills, target.dataset.id)
    refreshPanel('skill')
    return
  }

  if (action === 'category') {
    state.activeCategory = target.dataset.cat
    refreshPanel('skill')
    return
  }

  if (action === 'select-model') {
    state.selectedModels.clear()
    state.selectedModels.add(target.dataset.id)
    refreshPanel('model')
    return
  }

  if (action === 'platform') {
    state.activePlatform = target.dataset.platform
    refreshPanel('model')
    return
  }

  if (action === 'select-mcp') {
    state.activeMcp = target.dataset.name
    refreshPanel('mcp')
    return
  }

  if (action === 'server-pick') {
    toggleIn(state.selectedServers, target.dataset.name)
    refreshPanel('mcp')
    return
  }

  if (action === 'expand-mcp') {
    var name = target.dataset.name
    if (state.expandedMcp.has(name)) state.expandedMcp.delete(name)
    else state.expandedMcp.add(name)
    refreshPanel('mcp')
    return
  }

  if (action === 'tool-pick') {
    toggleIn(state.selectedTools, target.dataset.key)
    refreshPanel('mcp')
    return
  }

  if (action === 'confirm') {
    confirmSelection(kind)
    return
  }

  if (action === 'detect') {
    detectAllMcp()
  }
})

var composing = false

panelHost.addEventListener('compositionstart', function (event) {
  if (event.target.matches && event.target.matches('[data-search-input]')) composing = true
})

panelHost.addEventListener('compositionend', function (event) {
  if (!event.target.matches || !event.target.matches('[data-search-input]')) return
  composing = false
  handleSearchInput(event.target)
})

function handleSearchInput(input) {
  var kind = input.dataset.searchInput
  if (!kind) return
  state.query[kind] = input.value
  if (kind === 'skill') state.activeCategory = '全部'
  if (kind === 'model') state.activePlatform = 'all'
  refreshPanel(kind, { focusSearch: true, caret: input.selectionStart })
}

panelHost.addEventListener('input', function (event) {
  var input = event.target.closest('[data-search-input]')
  if (!input) return
  var kind = input.dataset.searchInput
  state.query[kind] = input.value
  if (composing || event.isComposing) return
  handleSearchInput(input)
})

// 窄屏展开搜索后，点击 Esc 收起搜索，不额外显示快捷键提示。
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return
  var changed = false
  Object.keys(state.searchOpen).forEach(function (kind) {
    if (state.searchOpen[kind]) {
      state.searchOpen[kind] = false
      changed = true
      refreshPanel(kind)
    }
  })
  if (changed) event.stopPropagation()
})

renderApp()

