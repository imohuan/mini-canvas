// 测试探针：读一份 Trace 文件并按 penguin-core 的 resumeTrace 规则回放。
// 之所以单独一个文件：让测试只依赖 SDK 公共 API（readTraceTolerant/resumeTrace），
// 而不用在测试里 import SDK（外部依赖，单测环境不可用）。这里动态 import 是可控点。

export async function resumeTrace(file: string): Promise<Array<{ payload: { role?: string; type?: string; text?: string; [k: string]: unknown } }>> {
  const sdk = await import('@prismshadow/penguin-core')
  const msgs = await sdk.readTraceTolerant(file)
  const resumed = sdk.resumeTrace(msgs)
  return [...resumed.history, ...resumed.carryOver] as unknown as Array<{ payload: { role?: string; type?: string; text?: string; [k: string]: unknown } }>
}
