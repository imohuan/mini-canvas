/**
 * 停用 / 删除 provider 后，底栏下拉必须**当场少掉那些模型**。
 *
 * 真 bug（用户 2026-11-10 两次反馈「开关对应平台，下拉菜单并没有更新」）：
 * 重载时用 `f.list('node/bar')` 取旧条目、用 `f.remove('node/bar', id)` 删 ——
 * 但注册用的 key 是 `actions/${id}`、id 也是动作 id。key 写错，`list` 永远空、
 * `remove` 永远 false，于是旧动作一条都删不掉，只有新动作能注册进去。
 *
 * 这里用一个与 kernel registry 同语义的最小桩（按 key 分桶、桶内按 id 分槽），
 * 把「注册 / 摘除各自该用什么 key」钉死。
 */
import { describe, it, expect } from 'vitest'

/** 与 kernel 的 Registry 同语义：byKey → byId → entry */
class Field {
  private byKey = new Map<string, Map<string, { id: string; value: unknown }>>()

  add(key: string, value: unknown, opts: { id?: string } = {}): void {
    const id = opts.id ?? key
    let slots = this.byKey.get(key)
    if (!slots) this.byKey.set(key, (slots = new Map()))
    slots.set(id, { id, value })
  }

  keys(): string[] {
    return [...this.byKey.keys()]
  }

  list(key: string): Array<{ id: string; value: unknown }> {
    return [...(this.byKey.get(key)?.values() ?? [])]
  }

  remove(key: string, id: string): boolean {
    const slots = this.byKey.get(key)
    if (!slots?.delete(id)) return false
    if (slots.size === 0) this.byKey.delete(key)
    return true
  }
}

const BAR_FIELD = 'node/bar'

/** 与 bar-contract 的 registerBarAction 一致 */
function register(field: Field, id: string): void {
  field.add(`actions/${id}`, { id, title: id }, { id })
}

/** 复刻 reloadActions 里「摘掉已消失的」那段 */
function pruneStale(field: Field, keepIds: readonly string[]): void {
  const keep = new Set(keepIds)
  const existing: string[] = []
  for (const key of field.keys()) {
    if (!key.startsWith('actions/')) continue
    for (const entry of field.list(key)) existing.push(entry.id)
  }
  for (const id of existing) {
    if (keep.has(id)) continue
    field.remove(`actions/${id}`, id)
  }
}

function ids(field: Field): string[] {
  const out: string[] = []
  for (const key of field.keys()) {
    if (!key.startsWith('actions/')) continue
    for (const e of field.list(key)) out.push(e.id)
  }
  return out.sort()
}

describe('停用平台后摘掉旧动作', () => {
  /**
   * 先钉住**旧写法为什么失效**：`list('node/bar')` 返回空、`remove('node/bar', id)` 返回 false。
   * 这条是根因的证据 —— 谁改回旧 key 拼法，这里立刻红。
   */
  it('旧写法（把 BAR_FIELD 当 key）根本删不掉条目', () => {
    const field = new Field()
    register(field, 'token01:a')
    register(field, 'token01:b')

    expect(field.list(BAR_FIELD)).toEqual([])
    expect(field.remove(BAR_FIELD, 'token01:a')).toBe(false)
    expect(ids(field)).toHaveLength(2)
  })

  it('按 actions/<id> 注册的动作能被摘干净', () => {
    const field = new Field()
    for (const id of ['token01:a', 'token01:b', 'demo:a']) register(field, id)
    expect(ids(field)).toHaveLength(3)

    pruneStale(field, ['demo:a'])

    expect(ids(field)).toEqual(['demo:a'])
  })

  it('全部停用后一条都不剩', () => {
    const field = new Field()
    for (const id of ['token01:a', 'token01:b']) register(field, id)
    pruneStale(field, [])
    expect(ids(field)).toEqual([])
  })
})
