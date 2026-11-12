/** 把错误归一成可展示的 message（Error 取 message，其余 String 兜底） */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * best-effort 字段名清单：一个场条目的值"有哪些顶层字段可读"（surface() 的条目轴用）。
 *
 * 只读 descriptor 名，**不取字段值**（值里可能有组件句柄/函数，摊出去既读不完也会泄漏）。
 *
 * 两处刻意收窄（否则这条轴只会输出噪声）：
 * - 只认**朴素对象**（类实例 / 数组 / Map / 函数都不是"有字段可读的声明"）；
 * - **组件句柄不算**：SFC 编译产物也是朴素对象，但它的"字段"是 `__name`/`setup`/`render`/`__file`
 *   这类编译内部物，对作者零诊断价值（`theme`/`ui` 两条轴里大量是这种），故识别到组件形状就跳过。
 * - 下划线开头的键一律不算（编译/内部约定）。
 */
export function entryFields(value: unknown): string[] | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return undefined
  const all = Object.getOwnPropertyNames(value)
  // 组件形状识别：这些键出现即视为 opaque 组件句柄，不是"数据声明"
  if (all.some((k) => k === 'setup' || k === 'render' || k === '__name' || k === '__file')) return undefined
  const names = all.filter((k) => k !== 'constructor' && !k.startsWith('_'))
  return names.length > 0 ? names : undefined
}

/**
 * best-effort 方法名清单：一个服务实例上"能调哪些函数"（surface() 的服务轴用）。
 *
 * 只用 descriptor 反射 —— **绝不用 `obj[k]` 取值**，否则会真的执行 getter
 * （如 selection.ids 这类访问器会被跑一次，产生副作用）。
 * 走自有属性 + 原型链；拿不到（null/原始值）返回 undefined。
 * 名字压缩/混淆后可能失真，故 surface 把它标成可选诊断字段、不写进稳定契约。
 */
export function describeMethods(target: unknown): string[] | undefined {
  if (target === null || target === undefined) return undefined;
  if (typeof target !== 'object' && typeof target !== 'function') return undefined;
  const names = new Set<string>();
  let obj: object | null = target as object;
  while (obj && obj !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (key === 'constructor' || names.has(key)) continue;
      try {
        const d = Object.getOwnPropertyDescriptor(obj, key);
        if (d && typeof d.value === 'function') names.add(key);
      } catch {
        /* 某些宿主对象的 descriptor 不可读：跳过该键，不中断枚举 */
      }
    }
    obj = Object.getPrototypeOf(obj) as object | null;
  }
  return names.size > 0 ? [...names].sort() : undefined;
}
