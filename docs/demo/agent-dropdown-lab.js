/**
 * Agent 输入框下拉 · 方案实验室
 *
 * 只演示「菜单内部」。浮层定位、翻边、点击外部关闭在真实接入时仍交给项目的 Dropdown。
 * 所有平台图标来自 lobehub/lobe-icons（MIT），内联保存，页面离线也能显示。
 *
 * 结构：数据 → 图标 → 渲染器（3 套 × 4 菜单）→ 交互。
 */

// ---------------------------------------------------------------- 数据

const MODELS = [
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
  { id: 'self-hosted-v4', provider: 'openai-chat', platform: 'custom', note: '自建网关', tag: '' },
]

const SKILLS = [
  { id: 'lit-anim', name: '英语课文与绘本动画', desc: '把英语课文或绘本转成教学动画。', cat: '教育培训', files: 6, size: '12 KB', hue: 208, icon: 'book' },
  { id: 'geo', name: '英文地理可视化教学', desc: '把地理知识转成全英文可视化教学。', cat: '教育培训', files: 9, size: '24 KB', hue: 172, icon: 'globe', featured: true },
  { id: 'bio', name: '生物机制可视化教学', desc: '把生物机制转成动画讲解。', cat: '教育培训', files: 4, size: '8 KB', hue: 148, icon: 'leaf' },
  { id: 'word', name: '英语单词动画教学', desc: '输入英语单词，自动生成动画讲解。', cat: '教育培训', files: 5, size: '10 KB', hue: 34, icon: 'type' },
  { id: 'oral', name: '口播视频规划', desc: '输入逐字稿或知识视频脚本，可拆分镜。', cat: '短视频', files: 3, size: '6 KB', hue: 262, icon: 'mic' },
  { id: 'ad', name: '商品广告分镜', desc: '从卖点生成 15 秒商品广告分镜。', cat: '商业广告', files: 7, size: '15 KB', hue: 12, icon: 'bag' },
  { id: 'film', name: '专业影视调色描述', desc: '给镜头写可执行的调色与布光说明。', cat: '专业影视', files: 5, size: '11 KB', hue: 220, icon: 'film' },
  { id: 'anime', name: '动漫角色设定', desc: '整理角色外观、性格与动作习惯。', cat: '动漫游戏', files: 8, size: '18 KB', hue: 320, icon: 'sparkle' },
  { id: 'mv', name: '音乐 MV 分镜', desc: '按节拍把歌曲拆成镜头列表。', cat: '音乐 MV', files: 4, size: '9 KB', hue: 284, icon: 'music' },
  { id: 'short', name: '短剧爆点改写', desc: '检查前三秒钩子与每一集的结尾悬念。', cat: '短剧漫剧', files: 6, size: '13 KB', hue: 198, icon: 'clapper' },
]

const MCP = [
  {
    name: 'smart', desc: '内置画布工具：查节点、改属性、连线', transport: '内置', builtin: true, ok: true,
    tools: [
      { name: 'canvas_list_nodes', desc: '列出当前画布上的节点' },
      { name: 'canvas_update_node', desc: '修改节点文字、尺寸或样式' },
      { name: 'canvas_connect_nodes', desc: '按端口连接两个节点' },
      { name: 'canvas_export_image', desc: '把选中区域导出成图片' },
    ],
  },
  {
    name: 'filesystem', desc: '读取本机项目文件', transport: 'stdio', ok: true,
    tools: [
      { name: 'read_file', desc: '读取一个文件的全文' },
      { name: 'list_dir', desc: '列出目录里的文件' },
      { name: 'search_files', desc: '按名字或内容搜索文件' },
    ],
  },
  {
    name: 'chrome-devtools', desc: '检查页面结构与控制台', transport: 'SSE', ok: true,
    tools: [
      { name: 'take_snapshot', desc: '读取当前页面的可访问结构' },
      { name: 'list_console_messages', desc: '读取控制台日志' },
      { name: 'click', desc: '按页面元素点击' },
    ],
  },
  {
    name: 'figma', desc: '读取设计稿与变量', transport: 'SSE', ok: false,
    tools: [],
  },
]

// ---------------------------------------------------------------- 图标
// 路径数据来自 lobehub/lobe-icons（MIT）。viewBox 统一 24；带品牌色的保留原色。

const BRANDS = {
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

/** 模型名 → 平台。先看前缀/关键词，再按名字里出现的平台词兜底。 */
function detectPlatform(modelId, provider = '') {
  const s = String(modelId || '').toLowerCase()
  const p = String(provider || '').toLowerCase()
  const rules = [
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
    [/^(mistral|codestral|mixtral)/, 'mistral'],
  ]
  for (const [re, key] of rules) if (re.test(s)) return key
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

function brandIcon(key) {
  const b = BRANDS[key] || BRANDS.custom
  const mono = key === 'openai' || key === 'grok' || key === 'kimi' || key === 'yi' || key === 'custom'
  return '<span class="brand' + (mono ? ' mono' : '') + '" title="' + esc(b.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + b.svg + '</svg></span>'
}

/** 24 格线性图标（与项目规范一致，只有 12/14/16 的实际使用尺寸） */
const LINE = {
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
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  star: '<path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.2l5.9-.8L12 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
}

function icon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (LINE[name] || LINE.info) + '</svg>'
}

const SKILL_ICONS = { book: 'book', globe: 'globe', leaf: 'leaf', type: 'type', mic: 'mic', bag: 'bag', film: 'film', sparkle: 'sparkle', music: 'music', clapper: 'clapper' }

// ---------------------------------------------------------------- 工具

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}

function skillThumb(skill, withImage = true) {
  const hue = skill.hue
  if (withImage) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(' + hue + ' 72% 56%)"/><stop offset="1" stop-color="hsl(' + ((hue + 42) % 360) + ' 66% 38%)"/></linearGradient></defs>' +
      '<rect width="96" height="64" fill="url(#g)"/>' +
      '<circle cx="76" cy="14" r="15" fill="rgba(255,255,255,.18)"/>' +
      '<circle cx="18" cy="54" r="11" fill="rgba(255,255,255,.12)"/>' +
      '<path d="M0 50 Q24 30 48 46 T96 38 V64 H0Z" fill="rgba(255,255,255,.16)"/>' +
      '</svg>'
    return '<span class="skill-thumb"><img alt="" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '"></span>'
  }
  return '<span class="skill-thumb"><span class="thumb-fallback" style="background:hsl(' + hue + ' 40% 92%);color:hsl(' + hue + ' 45% 42%)">' + icon(skill.icon) + '</span></span>'
}

function modelBrand(model) {
  const key = model.platform || detectPlatform(model.id, model.provider)
  return brandIcon(key)
}

// ---------------------------------------------------------------- 状态

const state = {
  scheme: 'soft',
  menu: 'model',
  covers: true,
  auth: 'ask',
  skillFilter: '',
  skillCat: '全部',
  skillSelected: [],
  modelFilter: '',
  modelPlatform: 'all',
  modelSelected: [],
  mcpFilter: '',
  mcpOpen: 'smart',
  mcpServerPicked: [],
  mcpPicked: [],
  mcpDetecting: false,
  reviewStyle: 'compact',
  refs: [],
}

const SCHEMES = [
  { id: 'soft', name: '轻卡片', sub: '紧凑 · 一行一项' },
  { id: 'split', name: '分栏', sub: '左分类 · 右详情' },
  { id: 'index', name: '索引', sub: '索引条 · 分组大卡' },
]

// ---------------------------------------------------------------- 渲染

function filteredSkills() {
  const q = state.skillFilter.trim().toLowerCase()
  return SKILLS.filter((s) => {
    if (state.skillCat !== '全部' && s.cat !== state.skillCat) return false
    if (!q) return true
    return (s.name + ' ' + s.desc + ' ' + s.cat).toLowerCase().includes(q)
  })
}

function head(title, count, sub) {
  return '<div class="m-head"><div class="m-head-row"><span class="m-title">' + esc(title) + '</span>' +
    (count != null ? '<span class="m-count">' + count + '</span>' : '') + '<span class="m-grow"></span>' +
    (sub || '') + '</div></div>'
}

function searchBox(kind, placeholder, value = '') {
  return '<div class="m-search">' + icon('search') + '<input type="search" data-menu-search="' + esc(kind) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" value="' + esc(value) + '"></div>'
}

function filteredModels() {
  const q = state.modelFilter.trim().toLowerCase()
  return MODELS.filter((m) => {
    if (state.modelPlatform !== 'all' && m.platform !== state.modelPlatform) return false
    if (!q) return true
    const brand = BRANDS[m.platform] ? BRANDS[m.platform].name : ''
    return (m.id + ' ' + m.provider + ' ' + m.note + ' ' + brand).toLowerCase().includes(q)
  })
}

/** 搜索同时覆盖服务名、说明与工具名；命中工具时只保留命中的工具。 */
function filteredMcp() {
  const q = state.mcpFilter.trim().toLowerCase()
  return MCP.map((s) => {
    const serverHit = (s.name + ' ' + s.desc + ' ' + s.transport).toLowerCase().includes(q)
    const tools = q && !serverHit ? s.tools.filter((t) => (t.name + ' ' + t.desc).toLowerCase().includes(q)) : s.tools
    return !q || serverHit || tools.length ? { ...s, tools } : null
  }).filter(Boolean)
}

function quoteCount(kind) {
  if (kind === 'skill') return state.skillSelected.length
  if (kind === 'model') return state.modelSelected.length
  if (kind === 'mcp') return state.mcpServerPicked.length + state.mcpPicked.length
  return 0
}

function quoteBar(kind) {
  const n = quoteCount(kind)
  const detail = kind === 'mcp'
    ? '<b>' + state.mcpServerPicked.length + '</b> 个服务 · <b>' + state.mcpPicked.length + '</b> 个工具'
    : '<b>' + n + '</b> 项'
  return '<div class="m-actions"><span class="m-actions-count">已选 ' + detail + '</span>' +
    '<button type="button" class="m-confirm" data-confirm-quote="' + kind + '"' + (n ? '' : ' disabled') + '>' + icon('check') + '确认引用' + (n ? ' ' + n : '') + '</button></div>'
}

function mcpDetectButton() {
  return '<button type="button" class="m-btn" data-mcp-redetect' + (state.mcpDetecting ? ' disabled' : '') + ' title="重新检测全部 MCP 服务">' +
    (state.mcpDetecting ? '<span class="m-spin"></span>检测中…' : icon('refresh') + '重新检测') + '</button>'
}

function reviewBody() {
  const opts = [
    { id: 'ask', title: '接受审核', desc: '命中规则的工具先停下来问你。', icon: 'hand', auto: false, badge: '推荐' },
    { id: 'auto', title: '完全自动授权', desc: '所有工具直接执行，不再逐次确认。', icon: 'shield', auto: true, badge: '谨慎' },
  ]
  const rules = '<span class="rule-chip">filesystem/*</span><span class="rule-chip">chrome-devtools/click</span>'

  if (state.reviewStyle === 'card') {
    return head('授权方式', null, '<span class="m-sub">当前会话</span>') +
      '<div class="rv-cards">' + opts.map((o) =>
        '<button type="button" class="rv-card' + (o.auto ? ' auto' : '') + '" data-auth="' + o.id + '" aria-selected="' + (state.auth === o.id) + '">' +
        '<span class="rv-card-top"><span class="rv-card-icon">' + icon(o.icon) + '</span>' +
        '<span class="rv-card-title">' + o.title + '</span>' +
        '<span class="rv-radio">' + (state.auth === o.id ? icon('check') : '') + '</span></span>' +
        '<span class="rv-card-desc">' + o.desc + '</span>' +
        (o.auto ? '<span class="rv-card-warn">' + icon('shield') + '会跳过所有确认</span>' : '') + '</button>').join('') + '</div>' +
      '<div class="rv-footnote">命中 ' + rules + ' 时先停一下。</div>'
  }

  if (state.reviewStyle === 'compare') {
    return head('授权方式', null, '<span class="m-sub">二选一</span>') +
      '<div class="rv-compare">' + opts.map((o) =>
        '<button type="button" class="rv-col' + (o.auto ? ' auto' : '') + '" data-auth="' + o.id + '" aria-selected="' + (state.auth === o.id) + '">' +
        '<span class="rv-col-icon">' + icon(o.icon) + '</span>' +
        '<span class="rv-col-title">' + o.title + '</span>' +
        '<span class="rv-col-desc">' + o.desc + '</span>' +
        '<span class="rv-col-tag">' + (state.auth === o.id ? '当前使用' : o.badge) + '</span></button>').join('') + '</div>' +
      '<div class="rv-footnote">审批规则在设置 → Agent → 审批规则里管理。</div>'
  }

  return head('授权方式', null, '<span class="m-sub">随会话</span>') +
    '<div class="rv-compact">' + opts.map((o) =>
      '<button type="button" class="rv-row' + (o.auto ? ' auto' : '') + '" data-auth="' + o.id + '" aria-selected="' + (state.auth === o.id) + '">' +
      '<span class="rv-icon">' + icon(o.icon) + '</span>' +
      '<span class="rv-text"><span class="rv-name">' + o.title + '</span><span class="rv-desc">' + o.desc + '</span></span>' +
      '<span class="rv-radio">' + (state.auth === o.id ? icon('check') : '') + '</span></button>').join('') + '</div>' +
    '<div class="rv-footnote">命中 ' + rules + ' 时先停一下。</div>'
}

function skillRow(skill, variant) {
  const picked = state.skillSelected.includes(skill.id)
  if (variant === 'v2card') {
    return '<button type="button" class="v2-card" data-skill="' + skill.id + '" aria-selected="' + picked + '">' + skillThumb(skill, state.covers) +
      '<span class="v2-card-body"><span class="v2-card-name"><span>' + esc(skill.name) + '</span>' + (picked ? '<span class="check" style="width:14px;height:14px">' + icon('check') + '</span>' : '') + '</span>' +
      '<span class="v2-card-desc">' + esc(skill.desc) + '</span></span></button>'
  }
  if (variant === 'v3card') {
    return '<button type="button" class="v3-skill" data-skill="' + skill.id + '" aria-selected="' + picked + '">' + skillThumb(skill, state.covers) +
      '<span class="row-main"><span class="row-name"><span class="nm">' + esc(skill.name) + '</span></span>' +
      '<span class="row-desc">' + esc(skill.desc) + '</span>' +
      '<span class="v3-skill-foot"><span class="badge">' + esc(skill.cat) + '</span><span>' + (skill.featured ? '精选 · ' : '') + skill.files + ' 个文件</span></span></span></button>'
  }
  return '<button type="button" class="row skill-card" data-skill="' + skill.id + '" aria-selected="' + picked + '">' + skillThumb(skill, state.covers) +
    '<span class="row-main"><span class="row-name"><span class="nm">' + esc(skill.name) + '</span>' + (skill.featured ? '<span class="badge accent">精选</span>' : '') + '</span>' +
    '<span class="row-desc">' + esc(skill.desc) + '</span>' +
    '<span class="skill-meta"><span>' + esc(skill.cat) + '</span><span class="sep"></span><span>' + skill.files + ' 文件</span><span class="sep"></span><span>' + esc(skill.size) + '</span></span></span>' +
    '<span class="row-side">' + (picked ? '<span class="check">' + icon('check') + '</span>' : '') + '</span></button>'
}

function skillBody() {
  const list = filteredSkills()
  const cats = ['全部', '教育培训', '商业广告', '专业影视', '动漫游戏', '短视频', '音乐 MV', '短剧漫剧']
  if (state.scheme === 'split') {
    return head('技能', SKILLS.length, '<span class="m-sub">可多选</span>') +
      '<div class="m-head" style="padding-top:0">' + searchBox('skill', '搜索技能', state.skillFilter) + '</div>' +
      '<div class="v2-body"><div class="v2-rail"><div class="m-scroll">' + cats.map((c) => {
        const n = c === '全部' ? SKILLS.length : SKILLS.filter((s) => s.cat === c).length
        if (!n) return ''
        return '<button type="button" class="v2-rail-item' + (state.skillCat === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + icon(c === '全部' ? 'layers' : 'folder') + '<span>' + esc(c) + '</span><b>' + n + '</b></button>'
      }).join('') + '</div></div>' +
      '<div class="v2-main"><div class="m-scroll">' + (list.length ? '<div class="v2-cards">' + list.map((s) => skillRow(s, 'v2card')).join('') + '</div>' : '<div class="m-empty">没有找到匹配的技能</div>') + '</div></div></div>' + quoteBar('skill')
  }
  if (state.scheme === 'index') {
    return head('技能', SKILLS.length, '<span class="m-sub">可多选</span>') +
      '<div class="m-head" style="padding-top:0">' + searchBox('skill', '搜索技能', state.skillFilter) + '</div>' +
      '<div class="v3-strip-wrap"><div class="v3-strip">' + cats.map((c) => {
        const n = c === '全部' ? SKILLS.length : SKILLS.filter((s) => s.cat === c).length
        if (!n) return ''
        return '<button type="button" aria-pressed="' + (state.skillCat === c) + '" data-cat="' + esc(c) + '">' + esc(c) + '<b>' + n + '</b></button>'
      }).join('') + '</div></div>' +
      '<div class="m-scroll"><div class="v3-group-title"><span>' + esc(state.skillCat === '全部' ? '全部技能' : state.skillCat) + '</span><small>' + list.length + ' 个</small></div>' +
      (list.length ? list.map((s) => skillRow(s, 'v3card')).join('') : '<div class="m-empty">没有找到匹配的技能</div>') +
      (list.length < 3 ? '<div class="v3-empty-fill"><b>搜索小提示</b><br>没写说明的技能也会按名字被搜到；清空搜索即可回来。</div>' : '') + '</div>' + quoteBar('skill')
  }
  return head('技能', SKILLS.length, '<span class="m-sub">可多选</span>') +
    '<div class="m-head" style="padding-top:0">' + searchBox('skill', '搜索技能', state.skillFilter) + '</div>' +
    '<div class="m-scroll">' + (list.length ? list.map((s) => skillRow(s, 'v1')).join('') : '<div class="m-empty">没有找到匹配的技能</div>') + '</div>' + quoteBar('skill')
}

function mcpToolRow(server, tool, variant) {
  const key = server.name + '/' + tool.name
  const on = state.mcpPicked.includes(key)
  if (variant === 'v2') {
    return '<button type="button" class="v2-tool" data-tool="' + esc(key) + '" aria-pressed="' + on + '"><span class="pick">' + icon('check') + '</span><span class="v2-tool-text"><span class="v2-tool-name">' + esc(tool.name) + '</span><span class="v2-tool-desc">' + esc(tool.desc) + '</span></span></button>'
  }
  return '<button type="button" class="mcp-tool" data-tool="' + esc(key) + '" aria-pressed="' + on + '"><span class="pick">' + icon('check') + '</span><span class="v2-tool-text"><span class="mcp-tool-name">' + esc(tool.name) + '</span><span class="mcp-tool-desc">' + esc(tool.desc) + '</span></span></button>'
}

function mcpServerRow(server, expanded, variant) {
  const status = server.ok ? '<span class="v3-mcp-status"><i></i>' + (server.tools.length || '已连接') + '</span>' : '<span class="v3-mcp-status bad"><i></i>未连接</span>'
  const quoted = state.mcpServerPicked.includes(server.name)
  if (variant === 'v2') {
    return '<button type="button" class="v2-rail-item has-icon mcp-rail' + (expanded ? ' active' : '') + '" data-mcpserver="' + esc(server.name) + '"><span class="rail-icon">' + icon('plug') + '</span><span>' + esc(server.name) + '</span>' +
      (quoted ? '<span class="rail-quoted" title="已选整个服务">' + icon('check') + '</span>' : '<b>' + (server.ok ? server.tools.length : '—') + '</b>') + '</button>'
  }
  if (variant === 'v3') {
    return '<div class="v3-mcp' + (expanded ? ' expanded' : '') + (quoted ? ' quoted' : '') + '"><div class="v3-mcp-head"><span class="row-icon">' + icon('plug') + '</span>' +
      '<span class="v3-mcp-name"><strong>' + esc(server.name) + '</strong><span>' + esc(server.desc) + ' · ' + esc(server.transport) + '</span></span>' + status +
      '<button type="button" class="m-btn quote' + (quoted ? ' on' : '') + '" data-mcpserver-pick="' + esc(server.name) + '" aria-pressed="' + quoted + '" aria-label="引用整个 ' + esc(server.name) + ' 服务">' + icon('check') + '服务</button>' +
      (server.tools.length ? '<button type="button" class="m-btn" data-mcp-expand="' + esc(server.name) + '" aria-expanded="' + expanded + '" aria-label="展开工具">' + icon('chevron') + '</button>' : '') + '</div>' +
      (expanded && server.tools.length ? '<div class="v3-tool-grid">' + server.tools.map((t) => mcpToolRow(server, t, 'v1')).join('') + '</div>' : '') + '</div>'
  }
  const open = expanded || (state.mcpFilter.trim() !== '' && server.tools.length > 0)
  return '<div class="mcp-svc' + (open ? ' expanded' : '') + (quoted ? ' quoted' : '') + '">' +
    '<div class="mcp-svc-head">' +
    '<button type="button" class="mcp-svc-pick" data-mcpserver-pick="' + esc(server.name) + '" aria-pressed="' + quoted + '" aria-label="引用整个 ' + esc(server.name) + ' 服务"><span class="pick">' + icon('check') + '</span></button>' +
    '<button type="button" class="row mcp-svc-main" data-mcp-expand="' + esc(server.name) + '" aria-expanded="' + expanded + '">' +
    '<span class="row-icon">' + icon('plug') + '</span><span class="row-main"><span class="row-name"><span class="nm">' + esc(server.name) + '</span></span>' +
    '<span class="row-desc" title="' + esc(server.desc) + '">' + (server.builtin ? '<span class="badge accent">内置</span> ' : '') + esc(server.desc) + '</span></span>' +
    '<span class="row-side">' + (server.ok ? '<span class="badge ok">' + server.tools.length + ' 工具</span>' : '<span class="badge warn">未连接</span>') + (server.tools.length ? '<svg class="chev" viewBox="0 0 24 24">' + LINE.chevron + '</svg>' : '') + '</span></button></div>' +
    (open && server.tools.length ? '<div class="mcp-tools">' + server.tools.map((t) => mcpToolRow(server, t, 'v1')).join('') + '</div>' : '') +
    '</div>'
}

function mcpBody() {
  const list = filteredMcp()
  if (state.scheme === 'split') {
    const active = list.find((s) => s.name === state.mcpOpen) || list[0]
    const quoted = active ? state.mcpServerPicked.includes(active.name) : false
    return head('MCP', MCP.length, mcpDetectButton()) +
      '<div class="m-head" style="padding-top:0">' + searchBox('mcp', '搜索服务或工具', state.mcpFilter) + '</div>' +
      '<div class="v2-body"><div class="v2-rail"><div class="m-scroll">' + list.map((s) => mcpServerRow(s, active && s.name === active.name, 'v2')).join('') + '</div></div>' +
      '<div class="v2-main"><div class="m-scroll"><div class="v2-mcp-form">' +
      (active
        ? '<div class="v2-detail' + (quoted ? ' quoted' : '') + '"><div class="v2-detail-head"><span class="v2-detail-icon">' + icon('plug') + '</span><span style="flex:1;min-width:0"><span class="v2-detail-title">' + esc(active.name) + '</span><div class="v2-detail-desc">' + esc(active.desc) + ' · ' + esc(active.transport) + '</div></span>' +
          (active.ok ? '<span class="v3-mcp-status"><i></i>已连接</span>' : '<span class="v3-mcp-status bad"><i></i>未连接</span>') + '</div>' +
          '<div class="v2-detail-actions"><button type="button" class="m-btn quote' + (quoted ? ' on' : '') + '" data-mcpserver-pick="' + esc(active.name) + '" aria-pressed="' + quoted + '">' + icon('check') + (quoted ? '已选整个服务' : '选择整个服务') + '</button></div></div>' +
          (active.tools.length ? '<div class="v3-group-title"><span>具体工具</span><small>可多选 · 已选 ' + state.mcpPicked.length + '</small></div><div class="v2-tools">' + active.tools.map((t) => mcpToolRow(active, t, 'v2')).join('') + '</div>' : '<div class="m-empty">这个服务还没连上，点「重新检测」再看看。</div>')
        : '<div class="m-empty">没有找到匹配的服务或工具</div>') +
      '</div></div></div></div>' + quoteBar('mcp')
  }
  if (state.scheme === 'index') {
    return head('MCP 工具', MCP.length, mcpDetectButton() + '<span class="m-sub">服务与工具可分开选</span>') +
      '<div class="m-head" style="padding-top:0">' + searchBox('mcp', '搜索服务或工具', state.mcpFilter) + '</div>' +
      '<div class="m-scroll">' + (list.length ? list.map((s) => mcpServerRow(s, state.mcpOpen === s.name, 'v3')).join('') : '<div class="m-empty">没有找到匹配的服务或工具</div>') + '</div>' + quoteBar('mcp')
  }
  return head('MCP', MCP.length, mcpDetectButton()) +
    '<div class="m-head" style="padding-top:0">' + searchBox('mcp', '搜索服务或工具', state.mcpFilter) + '</div>' +
    '<div class="m-scroll">' + (list.length ? list.map((s) => mcpServerRow(s, state.mcpOpen === s.name, 'v1')).join('') : '<div class="m-empty">没有找到匹配的服务或工具</div>') + '</div>' + quoteBar('mcp')
}

function modelRow(m, variant) {
  const sel = state.modelSelected.includes(m.id)
  if (variant === 'v2') {
    return '<button type="button" class="row v2-model" data-model="' + esc(m.id) + '" aria-selected="' + sel + '"><span class="row-icon has-brand">' + modelBrand(m) + '</span><span class="row-main"><span class="row-name"><span class="nm">' + esc(m.id) + '</span></span><span class="row-desc">' + esc(m.provider) + ' · ' + esc(m.note) + '</span></span>' + (sel ? '<span class="row-side"><span class="check">' + icon('check') + '</span></span>' : '') + '</button>'
  }
  if (variant === 'v3') {
    return '<button type="button" class="v3-mcard" data-model="' + esc(m.id) + '" aria-selected="' + sel + '"><span class="v3-mcard-top"><span class="v3-mcard-logo">' + modelBrand(m) + '</span><span class="v3-mcard-name">' + esc(m.id) + '</span>' + (sel ? '<span class="check" style="width:15px;height:15px">' + icon('check') + '</span>' : '') + '</span><span class="v3-mcard-meta"><span>' + esc(BRANDS[m.platform] ? BRANDS[m.platform].name : '自定义') + '</span><span class="sep"></span><span>' + esc(m.note) + '</span></span></button>'
  }
  return '<button type="button" class="row model-row' + (m.platform === 'deepseek' ? ' selected-strong' : '') + '" data-model="' + esc(m.id) + '" aria-selected="' + sel + '"><span class="row-icon has-brand">' + modelBrand(m) + '</span><span class="row-main"><span class="row-name"><span class="nm">' + esc(m.id) + '</span></span><span class="row-desc">' + esc(m.provider) + '</span></span><span class="row-side"><span class="model-badges">' + (m.tag ? '<span class="badge accent">' + m.tag + '</span>' : '') + (m.note && m.note !== '视觉' ? '<span class="badge">' + esc(m.note) + '</span>' : '') + (m.note === '视觉' ? '<span class="badge">视觉</span>' : '') + '</span>' + (sel ? '<span class="check">' + icon('check') + '</span>' : '') + '</span></button>'
}

function modelBody() {
  const list = filteredModels()
  if (state.scheme === 'split') {
    const platforms = [...new Set(MODELS.map((m) => m.platform))]
    return head('模型', MODELS.length, '<span class="m-sub">可多选</span>') +
      '<div class="m-head" style="padding-top:0">' + searchBox('model', '搜索模型或平台', state.modelFilter) + '</div>' +
      '<div class="v2-body"><div class="v2-rail"><div class="m-scroll"><button type="button" class="v2-rail-item has-icon' + (state.modelPlatform === 'all' ? ' active' : '') + '" data-model-platform="all"><span class="rail-icon">' + icon('layers') + '</span><span>全部平台</span><b>' + MODELS.length + '</b></button>' + platforms.map((p) => {
        const n = MODELS.filter((m) => m.platform === p).length
        return '<button type="button" class="v2-rail-item has-icon' + (state.modelPlatform === p ? ' active' : '') + '" data-model-platform="' + esc(p) + '"><span class="rail-icon">' + brandIcon(p) + '</span><span>' + esc(BRANDS[p].name) + '</span><b>' + n + '</b></button>'
      }).join('') + '</div></div><div class="v2-main">' +
      '<div class="m-scroll">' + (list.length ? '<div class="v2-model-grid">' + list.map((m) => modelRow(m, 'v2')).join('') + '</div>' : '<div class="m-empty">没有找到匹配的模型</div>') + '</div></div></div>' + quoteBar('model')
  }
  if (state.scheme === 'index') {
    return head('模型', MODELS.length, '<span class="m-sub">可多选</span>') +
      '<div class="m-head" style="padding-top:0">' + searchBox('model', '搜索模型或平台', state.modelFilter) + '</div>' +
      '<div class="v3-strip-wrap"><div class="v3-strip">' +
      '<button type="button" aria-pressed="' + (state.modelPlatform === 'all') + '" data-model-platform="all">全部</button>' +
      [...new Set(MODELS.map((m) => m.platform))].map((p) => '<button type="button" aria-pressed="' + (state.modelPlatform === p) + '" data-model-platform="' + esc(p) + '">' + esc(BRANDS[p].name) + '</button>').join('') + '</div></div>' +
      '<div class="m-scroll">' + (list.length ? '<div class="v3-model-grid">' + list.map((m) => modelRow(m, 'v3')).join('') + '</div>' : '<div class="m-empty">没有找到匹配的模型</div>') + '</div>' + quoteBar('model')
  }
  return head('模型', MODELS.length, '<span class="m-sub">可多选</span>') +
    '<div class="m-head" style="padding-top:0">' + searchBox('model', '搜索模型或平台', state.modelFilter) + '</div>' +
    '<div class="m-scroll">' + (list.length ? list.map((m) => modelRow(m, 'v1')).join('') : '<div class="m-empty">没有找到匹配的模型</div>') + '</div>' + quoteBar('model')
}

function renderMenu() {
  const layer = document.getElementById('menu-layer')
  const sheet = document.getElementById('menu-sheet')
  layer.hidden = false
  // 审核不套技能的三套版式；它始终保持同一张卡，只换内部排版。
  const sheetScheme = state.menu === 'review' ? 'v1' : state.scheme === 'soft' ? 'v1' : state.scheme === 'split' ? 'v2' : 'v3'
  sheet.className = 'menu-sheet sheet-' + sheetScheme
  sheet.dataset.menu = state.menu
  sheet.dataset.reviewStyle = state.reviewStyle
  const body = state.menu === 'review' ? reviewBody() : state.menu === 'skill' ? skillBody() : state.menu === 'mcp' ? mcpBody() : modelBody()
  sheet.innerHTML = body
  sheet.dataset.scheme = state.scheme
  syncTrigger()
  document.getElementById('review-switch').hidden = state.menu !== 'review'
  document.querySelectorAll('#review-switch [data-review-style]').forEach((x) => x.classList.toggle('on', x.dataset.reviewStyle === state.reviewStyle))
}

function syncTrigger() {
  document.querySelectorAll('.dd').forEach((dd) => {
    const on = dd.dataset.dd === state.menu
    dd.querySelector('[data-trigger]')?.setAttribute('aria-expanded', String(on))
  })
  document.querySelectorAll('#menu-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.open === state.menu)))
  document.querySelectorAll('#menu-switch button').forEach((b) => b.classList.toggle('on', b.dataset.open === state.menu))
}

function renderTabs() {
  const tabs = document.getElementById('tabs')
  tabs.innerHTML = SCHEMES.map((s, i) =>
    '<button type="button" class="lab-tab" role="tab" data-scheme="' + s.id + '" aria-selected="' + (state.scheme === s.id) + '"><span>' + (i + 1) + '. ' + s.name + '</span><small>' + s.sub + '</small></button>').join('')
  const note = SCHEMES.find((s) => s.id === state.scheme)
  document.getElementById('scheme-note').textContent = '当前：' + note.name + ' —— ' + note.sub
}

function renderRefs() {
  const wrap = document.getElementById('composer-chips')
  wrap.innerHTML = state.refs.map((r, i) =>
    '<span class="composer-chip"><span class="ci">' + (r.kind === 'model' ? brandIcon(r.platform) : r.kind === 'tool' ? icon('tool') : r.kind === 'mcp' ? icon('plug') : icon('sparkle')) + '</span><span class="cn">' + esc(r.name) + '</span>' +
    '<button type="button" class="cx" data-removeref="' + i + '" aria-label="移除 ' + esc(r.name) + '">' + icon('close') + '</button></span>').join('')
  document.querySelector('.composer-placeholder').hidden = state.refs.length > 0
}

let toastTimer = 0
function toast(text) {
  const t = document.getElementById('demo-toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 1600)
}

// ---------------------------------------------------------------- 交互

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scheme]')
  if (!b) return
  state.scheme = b.dataset.scheme
  renderTabs()
  renderMenu()
})

document.getElementById('menu-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]')
  if (!b) return
  state.menu = b.dataset.open
  renderMenu()
})

document.getElementById('review-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-review-style]')
  if (!b) return
  state.reviewStyle = b.dataset.reviewStyle
  renderMenu()
})

// 审核独立成一套：这里只留「紧凑 / 卡片 / 对照」三档，换风格时不跑技能的三套版式。
// （菜单内容仍共用同一个 #menu-sheet，所以定位/翻边逻辑不变。）

document.querySelectorAll('.dd [data-trigger]').forEach((b) => {
  b.addEventListener('click', () => {
    const id = b.closest('.dd').dataset.dd
    if (state.menu === id && !document.getElementById('menu-layer').hidden) {
      document.getElementById('menu-layer').hidden = true
      document.querySelectorAll('.dd [data-trigger]').forEach((x) => x.setAttribute('aria-expanded', 'false'))
      return
    }
    state.menu = id
    renderMenu()
  })
})

document.getElementById('covers-toggle').addEventListener('change', (e) => {
  state.covers = e.target.checked
  if (state.menu === 'skill') renderMenu()
})

document.getElementById('menu-sheet').addEventListener('click', (e) => {
  const t = e.target
  const confirm = t.closest('[data-confirm-quote]')
  if (confirm) {
    confirmQuote(confirm.dataset.confirmQuote)
    return
  }
  const auth = t.closest('[data-auth]')
  if (auth) {
    state.auth = auth.dataset.auth
    renderMenu()
    toast(state.auth === 'ask' ? '已选择：接受审核' : '已选择：完全自动授权')
    return
  }
  const skill = t.closest('[data-skill]')
  if (skill) {
    toggleIn(state.skillSelected, skill.dataset.skill)
    renderMenu()
    return
  }
  const platform = t.closest('[data-model-platform]')
  if (platform) {
    state.modelPlatform = platform.dataset.modelPlatform
    renderMenu()
    return
  }
  const pickModel = t.closest('[data-model]')
  if (pickModel) {
    toggleIn(state.modelSelected, pickModel.dataset.model)
    renderMenu()
    return
  }
  const server = t.closest('[data-mcpserver]')
  if (server) {
    state.mcpOpen = server.dataset.mcpserver
    renderMenu()
    return
  }
  // 索引方案里服务头有两个按钮：展开旁边那条工具，与「引用」分开
  // 索引方案的服务卡里，展开工具与「引用」是两个独立按钮；按键所在位置区分。
  const expandV3 = t.closest('.v3-mcp-head [data-mcp-expand]')
  if (expandV3) {
    state.mcpOpen = state.mcpOpen === expandV3.dataset.mcpExpand ? '' : expandV3.dataset.mcpExpand
    renderMenu()
    return
  }
  const serverPick = t.closest('[data-mcpserver-pick]')
  if (serverPick) {
    toggleIn(state.mcpServerPicked, serverPick.dataset.mcpserverPick)
    renderMenu()
    return
  }
  const tool = t.closest('[data-tool]')
  if (tool) {
    toggleIn(state.mcpPicked, tool.dataset.tool)
    renderMenu()
    return
  }
  const expand = t.closest('.row[data-mcp-expand]')
  if (expand) {
    state.mcpOpen = state.mcpOpen === expand.dataset.mcpExpand ? '' : expand.dataset.mcpExpand
    renderMenu()
    return
  }
  const probe = t.closest('[data-mcp-redetect]')
  if (probe) {
    redetectAllMcp()
    return
  }
  const cat = t.closest('[data-cat]')
  if (cat) {
    state.skillCat = cat.dataset.cat
    renderMenu()
  }
})

document.getElementById('menu-sheet').addEventListener('input', (e) => {
  const input = e.target.closest('[data-menu-search]')
  if (!input) return
  const kind = input.dataset.menuSearch
  if (kind === 'skill') state.skillFilter = input.value
  else if (kind === 'model') state.modelFilter = input.value
  else if (kind === 'mcp') state.mcpFilter = input.value
  const pos = e.target.selectionStart
  renderMenu()
  const next = document.querySelector('[data-menu-search="' + kind + '"]')
  if (next) {
    next.focus()
    try { next.setSelectionRange(pos, pos) } catch { /* search 输入在某些 WebView 不支持选区 */ }
  }
})

document.getElementById('composer-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-removeref]')
  if (!b) return
  state.refs.splice(Number(b.dataset.removeref), 1)
  renderRefs()
})

function toggleIn(list, value) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

/**
 * 勾选只是「待引用」，这里才真正写进输入框。
 * 服务引用与工具引用是两种独立载荷（与真实 Agent 的 ref.kind 对齐）。
 */
function confirmQuote(kind) {
  const refs = []
  if (kind === 'skill') {
    for (const id of state.skillSelected) {
      const s = SKILLS.find((x) => x.id === id)
      if (s) refs.push({ kind: 'skill', name: s.name })
    }
    state.skillSelected = []
  } else if (kind === 'model') {
    for (const id of state.modelSelected) {
      const m = MODELS.find((x) => x.id === id)
      if (m) refs.push({ kind: 'model', name: m.id, platform: m.platform })
    }
    state.modelSelected = []
  } else if (kind === 'mcp') {
    for (const name of state.mcpServerPicked) refs.push({ kind: 'mcp', name })
    for (const key of state.mcpPicked) {
      const [server, tool] = key.split('/')
      refs.push({ kind: 'tool', name: server + ' › ' + tool })
    }
    state.mcpServerPicked = []
    state.mcpPicked = []
  }
  if (!refs.length) return
  addRefs(refs)
  document.getElementById('menu-layer').hidden = true
  toast('已引用 ' + refs.length + ' 项')
}

function addRefs(refs) {
  for (const ref of refs) {
    state.refs = state.refs.filter((r) => !(r.kind === ref.kind && r.name === ref.name))
    state.refs.push(ref)
  }
  renderRefs()
}

/** 重新检测：一次检查所有服务，不提供单服务检测。 */
function redetectAllMcp() {
  if (state.mcpDetecting) return
  state.mcpDetecting = true
  renderMenu()
  setTimeout(() => {
    state.mcpDetecting = false
    renderMenu()
    const ok = MCP.filter((s) => s.ok).length
    toast('重新检测完成：' + ok + '/' + MCP.length + ' 个服务已连接')
  }, 900)
}

function addRef(ref, message) {
  state.refs = state.refs.filter((r) => !(r.kind === ref.kind && (ref.kind !== 'tool' || r.name === ref.name)))
  state.refs.push(ref)
  renderRefs()
  toast(message)
}

// 键盘：Esc 收起菜单（真实 Dropdown 自带，这里保持演示一致）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('menu-layer').hidden = true
})

// 点击舞台空白处收起
document.querySelector('.stage-wrap').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.composer')) return
  document.getElementById('menu-layer').hidden = true
})

renderTabs()
renderMenu()
renderRefs()
addRefs([{ kind: 'model', name: 'deepseek-auto', platform: 'deepseek' }])
document.getElementById('demo-toast').hidden = true
