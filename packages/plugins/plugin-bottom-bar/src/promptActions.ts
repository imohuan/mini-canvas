/**
 * promptActions —— 底栏右侧图标按钮里那些"改提示词"的小动作（纯函数，零 DOM，Node 可测）。
 *
 * 目前是「翻译提示词」：底栏没有"翻译服务"可依赖（工具表里有没有翻译工具不由底栏决定），
 * 所以这里用**指令追加**实现 —— 给提示词补一句"用英文输出"，生成模型自己就会译。
 * 好处：不依赖任何特定模型/工具，装了任何出图/出文模型都生效；且用户看得见、可撤销。
 */
/** 追加的那句指令（中英双语，兼容中文模型与英文模型的理解） */
export const TRANSLATE_INSTRUCTION = '（请把上面的描述翻译成地道的英文后再执行，输出英文结果）'

/** 是否已经带了翻译指令 */
export function hasTranslateInstruction(text: string): boolean {
  return (text || '').includes(TRANSLATE_INSTRUCTION)
}

/** 加上翻译指令（已有则不重复加；自动补一个空格分隔） */
export function withTranslateInstruction(text: string): string {
  const base = text || ''
  if (hasTranslateInstruction(base)) return base
  if (base.trim() === '') return TRANSLATE_INSTRUCTION
  return base + ' ' + TRANSLATE_INSTRUCTION
}

/** 摘掉翻译指令（可能留下一个尾空格，一并收干净）；没有就是原样 */
export function withoutTranslateInstruction(text: string): string {
  const base = text || ''
  if (!hasTranslateInstruction(base)) return base
  return base.replace(TRANSLATE_INSTRUCTION, '').replace(/\s+$/, '')
}

/** 点「翻译」按钮：没加过就加，加过就去掉（一个按钮两态，与「参考」同一种交互手感） */
export function toggleTranslateInstruction(text: string): string {
  return hasTranslateInstruction(text) ? withoutTranslateInstruction(text) : withTranslateInstruction(text)
}

