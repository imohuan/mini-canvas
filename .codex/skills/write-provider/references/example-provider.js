/**
 * 最小可跑的 provider 示例（丢进 <数据根>/providers/ 即生效）。
 *
 * 两个动作：
 *   skill:echo   —— 同步，直接把参数拼成一句话返回。
 *   skill:delay  —— 异步，submit 给 taskId，poll 数几拍后完成。
 *
 * 注意：整份文件自包含，只用 Node 内置模块；相对 import 和第三方包都会加载失败。
 */
import { randomUUID } from 'node:crypto'

/** 内存里放异步任务的进度（进程重启就丢，示例够用；真做事应换成外部任务的 id） */
const jobs = new Map()

const provider = {
  id: 'skill-example',
  actions: [
    {
      id: 'skill:echo',
      title: '示例 · 回显参数',
      description: '把可视化参数拼成一句话，用来确认 provider 接通了。',
      group: '示例',
      nodeTypes: ['image', 'video', 'audio'],
      needsPrompt: true,
      order: 900,
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
            { label: '1:1', value: '1:1' },
          ],
        },
        { key: 'count', label: '数量', type: 'number', default: 1, min: 1, max: 4, step: 1 },
      ],
      templates: [
        {
          id: 'skill:tpl-square',
          name: '方图一张',
          prompt: '画一张方形图，主体居中。',
          values: { ratio: '1:1', count: 1 },
        },
      ],
    },
    {
      id: 'skill:delay',
      title: '示例 · 异步三步',
      description: '提交后轮询三次才完成，用来确认 poll 生效。',
      group: '示例',
      needsPrompt: false,
      order: 901,
      pollIntervalMs: 800,
      pollTimeoutMs: 60000,
    },
  ],

  async submit(action, input) {
    if (action.id === 'skill:echo') {
      const v = input.values || {}
      return {
        done: true,
        text: '收到：ratio=' + (v.ratio ?? '-') + ' count=' + (v.count ?? '-') +
          ' prompt=' + (input.prompt || '（空）'),
      }
    }
    const taskId = randomUUID()
    jobs.set(taskId, 0)
    return { taskId }
  },

  async poll(taskId) {
    const step = (jobs.get(taskId) ?? 0) + 1
    if (step < 3) {
      jobs.set(taskId, step)
      return { status: 'running', progress: step / 3, message: '第 ' + step + ' 步' }
    }
    jobs.delete(taskId)
    return { status: 'done', text: '三步走完了' }
  },

  async cancel(taskId) {
    jobs.delete(taskId)
  },
}

export default provider
