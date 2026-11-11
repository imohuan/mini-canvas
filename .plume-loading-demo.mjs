const now = Date.now()
const body = {
  nodes: [
    {
      id: 'demo-run',
      type: 'text',
      position: { x: 0, y: 0 },
      data: {
        label: '加载中（有进度）',
        text: '示例文本',
        runState: { status: 'running', progress: 42, message: '渲染第 3 帧…', startedAt: now - 31400 },
      },
    },
    {
      id: 'demo-indet',
      type: 'text',
      position: { x: 380, y: 0 },
      data: {
        label: '加载中（不确定）',
        text: '示例文本',
        runState: { status: 'running', label: '排队中', message: '前面还有 2 个任务', startedAt: now - 8200 },
      },
    },
    {
      id: 'demo-error',
      type: 'text',
      position: { x: 760, y: 0 },
      data: {
        label: '执行失败',
        text: '示例文本',
        runState: { status: 'error', label: '转码失败', reason: 'ffmpeg 退出码 1', hint: '换一个 mp4 再试' },
      },
    },
    {
      id: 'demo-video',
      type: 'video',
      position: { x: 0, y: 330 },
      size: { w: 440, h: 260 },
      data: {
        label: '视频后台处理中',
        videoUrl: '/api/canvases/loading-ui-demo/resources/0d2059a04190df15.mp4',
        resourceId: '0d2059a04190df15',
        videoWidth: 1280,
        videoHeight: 720,
        cardWidth: 440,
        cardHeight: 260,
        videoDuration: 10,
        runState: { status: 'running', progress: 55, message: '后台裁剪中…', startedAt: now - 5400 },
      },
    },
    {
      id: 'demo-video2',
      type: 'video',
      position: { x: 560, y: 330 },
      size: { w: 440, h: 260 },
      data: {
        label: '选中这支视频看顶栏「裁剪中」胶囊',
        videoUrl: '/api/canvases/loading-ui-demo/resources/0d2059a04190df15.mp4',
        resourceId: '0d2059a04190df15',
        videoWidth: 1280,
        videoHeight: 720,
        cardWidth: 440,
        cardHeight: 260,
        videoDuration: 10,
      },
    },
    {
      id: 'demo-resizable',
      type: 'text',
      position: { x: 0, y: 760 },
      size: { w: 420, h: 260 },
      data: {
        label: '可 resize（加载中，无把手）',
        text: '加载中的文本节点',
        resizable: true,
        runState: { status: 'running', progress: 30, message: '正在处理…', startedAt: now - 9000 },
      },
    },
    {
      id: 'demo-resizable-ready',
      type: 'text',
      position: { x: 560, y: 760 },
      size: { w: 420, h: 260 },
      data: { label: '可 resize（加载成功，有把手）', text: '可拖拽改尺寸', resizable: true },
    },
  ],
  edges: [],
}

const base = process.env.PLUME_BASE || 'http://localhost:5288'
const target = process.argv[2] || 'loading-ui-demo'
const res = await fetch(base + '/api/canvases/' + target, {
  method: 'PUT',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})
console.log(res.status, await res.text())
