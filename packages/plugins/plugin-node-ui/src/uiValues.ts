/**
 * uiValues —— 算出「界面上能读到的参数」（纯函数，Node 可单测）。
 *
 * ## 参数从哪来（用户 2026-10-13 定的口径：没有"状态"，它就是参数）
 *
 * 界面用 CanvasUI.setInputs({...}) 交上来的笔迹 / 选项 / 配置，**就是参数** ——
 * 它们存在节点 data.uiInputs 上，刷新后宿主把它们并回 __CANVAS_INPUTS__。
 * 这个模块只做一件事：**把"可能不安全的值"清洗成能安全进页面文档的形状**
 * （函数 / symbol / undefined 这类会被 JSON 扔掉的丢掉）。
 *
 * 以前这里还负责"按声明的参数清单去上游素材里取值" —— 那套声明清单**从来没人写过**
 * （永远是空数组），是设计了一半就停下的东西，2026-10-13 连同空壳一起删了。
 */

/** 手工值的形状：键 → 值（数组 / 对象都行 —— 笔迹就是数组） */
export type UiManualValues = Record<string, unknown>

/** 把节点 data 里那份参数归一（函数 / symbol / undefined 丢掉，其余原样保留） */
export function normalizeManualValues(raw: unknown): UiManualValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: UiManualValues = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue
    const t = typeof v
    if (t === 'function' || t === 'symbol' || t === 'undefined') continue
    out[k] = v
  }
  return out
}
