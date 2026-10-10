// 文件：packages/docs/public/examples/tools/plugin-tool-demo/src/demoTools.ts
// 格式：TypeScript 模块（纯逻辑，零 Vue / 零 DOM，Node 可单测）
// 位置：插件包内部的"工具定义"文件，只构造 ToolDef，不知道 ctx 是谁
//
// 为什么单独放一个文件：这段代码不碰 ctx、不碰 Vue，
// 可以直接用普通对象断言 —— 把"参数算得对不对"与"注册成没成"分开看。

import type { ToolDef } from '@mini-canvas/kernel'

/** 工具分组名（UI 据此归类） */
export const DEMO_GROUP = '演示'

/**
 * 工具一：把提示词倒过来写。同步返回，不联网。
 * 用来演示最小形态：只要 name + run 就能工作。
 */
export function reverseTool(): ToolDef {
  return {
    name: 'demo.text.reverse',
    title: '倒写演示',
    description: '把输入的提示词倒过来返回，不联网，纯演示',
    group: DEMO_GROUP,
    produces: 'text',                 // ① 它产出文本 → 文本节点能找到它
    params: [],
    run: (input) => {
      const text = input.prompt ?? ''
      return { ok: true, text: text.split('').reverse().join('') }   // ② 同步形态：直接给结果
    },
  }
}

/**
 * 工具二：数一数提示词有多少字。异步轮询形态，不联网。
 * 用来演示"提交任务 → 轮询进度 → 完成"这条第三方 API 最常见的路。
 */
export function countTool(): ToolDef {
  return {
    name: 'demo.text.count',
    title: '字数演示',
    description: '统计提示词字数；故意分三次报进度，演示轮询形态',
    group: DEMO_GROUP,
    produces: 'text',
    params: [
      {
        key: 'withSpaces',            // ③ 声明式参数：UI 自动长一个开关，不用写控件
        label: '统计空格',
        type: 'boolean',
        default: false,
      },
    ],
    run: (input) => {
      const text = input.prompt ?? ''
      const withSpaces = input.params?.withSpaces === true
      const total = withSpaces ? text.length : text.replace(/\s/g, '').length   // ④ 读参数值
      let step = 0
      // ⑤ 异步形态：返回一个轮询函数；内核按 interval 反复调它，直到 status 为 'done'
      return () => {
        step += 1
        if (step < 3) {
          return { status: 'running', progress: Math.round((step / 3) * 100), message: '正在数…' }
        }
        return { status: 'done', result: { ok: true, text: '共 ' + total + ' 个字' } }
      }
    },
  }
}

