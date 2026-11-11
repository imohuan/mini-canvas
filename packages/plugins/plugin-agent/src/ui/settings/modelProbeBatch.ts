/**
 * 一次测多个模型：**并发**发出去，谁先回来谁先回调。
 *
 * 为什么单独抽出来：旧写法是 `for (const id of ids) await probe(id)`，
 * 一个慢模型会把后面的全拖成串行（用户 2026-11-11：选了多个模型，等很久才一个个出结果）。
 * 这里用 allSettled：某个请求抛错不会影响其它模型，结果也不会丢。
 */
export async function probeModelsConcurrently<T>(
  ids: readonly string[],
  probe: (id: string) => Promise<T>,
  onResult: (id: string, result: T) => void,
  onSettled?: () => void,
): Promise<void> {
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        const result = await probe(id)
        onResult(id, result)
      } finally {
        onSettled?.()
      }
    }),
  )
}
