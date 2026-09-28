/**
 * mockTaskPlugin —— mock 后台插件：把假后台包成两条图片动作（同步 + 异步）。
 *
 * 用途（用户要求「先 mock 一个后台，实现这样的一个效果」）：
 * - 选中图片节点 → 底栏出现两条 mock 动作 → 选参数 → 执行 →
 *   卡片上出现覆盖层与进度 → 完成后覆盖层消失。
 * - mock 动作经 image 写入器写 data.imageUrl：点了它当前图会被换成 mock 产物（预期行为）。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type { ToolPollFn, ToolPollState } from '@mini-canvas/kernel'
import { registerBarAction, registerBarApplier, type BarRunContext } from '@mini-canvas/plugin-bottom-bar'
import { MockBackend } from './mockBackend'

export const name = 'mock-task-backend'
export const inject = ['doc'] as string[]

export function apply(ctx: Context) {
  // §0.3：nodeBar 是插件服务，取得到才注册；没装 bottom-bar 的宿主里本插件静默无用。
  const register = (): boolean => {
    if (!ctx.tryGet('nodeBar')) return false

    const backend = new MockBackend({ steps: 10, intervalMs: 120 })

    // 同步动作：1.2s 后直接返回结果（验证同步路径：底栏状态 + 覆盖层出现后一次性消失）
    registerBarAction(ctx, {
      id: 'mock-task:sync',
      types: ['image'],
      title: 'Mock 同步任务',
      description: '假后台：1.2 秒后返回一张 mock 产物（验证同步路径）',
      group: 'Mock',
      needsPrompt: true,
      fields: [
        {
          key: 'size',
          label: '尺寸',
          type: 'select',
          default: '320',
          options: [
            { label: '小 320', value: '320' },
            { label: '中 480', value: '480' },
          ],
        },
      ],
      async run(_input, runCtx: BarRunContext) {
        await new Promise((r) => setTimeout(r, 1200))
        void runCtx
        return { ok: true, urls: [backend.queryTask(backend.createTask().taskId).result!.urls![0]] }
      },
    })

    // 异步动作：返回轮询函数，0→100 分 10 帧（验证异步路径 + 覆盖层进度 + 刷新续查）
    registerBarAction(ctx, {
      id: 'mock-task:async',
      types: ['image'],
      title: 'Mock 异步任务',
      description: '假后台：创建任务 + 轮询进度（验证覆盖层与刷新续查）',
      group: 'Mock',
      needsPrompt: true,
      fields: [
        {
          key: 'mode',
          label: '模式',
          type: 'select',
          default: 'progress',
          options: [
            { label: '带进度', value: 'progress' },
            { label: '只报阶段', value: 'stage' },
          ],
        },
      ],
      run() {
        const { taskId } = backend.createTask()
        const poll: ToolPollFn = () => {
          const view = backend.queryTask(taskId)
          if (view.status === 'done') {
            return { status: 'done', result: { ok: true, urls: view.result?.urls ?? [], taskId } }
          }
          const state: ToolPollState = {
            status: 'running',
            message: view.message,
            taskId,
          }
          // 选「只报阶段」时不带 progress → 覆盖层走不确定态（验证无百分比分支）
          if (view.progress !== undefined) state.progress = view.progress
          return state
        }
        return poll
      },
      // 刷新续查：mock 后台进程内状态还在（页面没关时）；页面重开后查不到 → 标中断
      resume(taskId: string) {
        return () => {
          const view = backend.queryTask(taskId)
          if (view.status === 'done') {
            return { status: 'done' as const, result: { ok: true, urls: view.result?.urls ?? [], taskId } }
          }
          return { status: 'running' as const, progress: view.progress, message: view.message, taskId }
        }
      },
    })

    // image 写入器若已有人注册（node-image 插件），这里不重复注册 —— 写回交给它。
    // 本插件只负责动作。这样 mock 产物也会走「量尺寸 + 一次 patch」的既有写回规矩。
    return true
  }

  if (!register()) {
    const off = ctx.on('ctx:plugin-installed', () => {
      if (register()) off.dispose()
    })
  }
  // 静态引用防 tree-shake 误删（registerBarApplier 在其它宿主组合下可能用到）
  void registerBarApplier
}

export const mockTaskPlugin: PluginModule = { name, inject, apply }

