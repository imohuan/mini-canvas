import { describe, it, expect } from 'vitest'
import { CommandRegistry } from '../command'

/**
 * Command v2 —— 元数据扩展（第三批）：
 *  - CommandDef 增加可选 UI 元数据(icon/tooltip/areas/order/group)，纯声明、不改 run 语义
 *  - get(id) 查命令定义（含元数据，供 UI 插件渲染菜单/工具栏）
 *  - list() 枚举全部命令
 */
describe('CommandRegistry v2 元数据', () => {
  it('注册带元数据命令，get 可取回完整定义', () => {
    const c = new CommandRegistry()
    c.register({
      id: 'x.download',
      title: '下载',
      icon: 'svg:download',
      areas: ['node', 'edge'],
      order: 10,
      group: 'action',
      run: () => 1,
    })
    const def = c.get('x.download')
    expect(def?.title).toBe('下载')
    expect(def?.icon).toBe('svg:download')
    expect(def?.areas).toEqual(['node', 'edge'])
    expect(def?.order).toBe(10)
    expect(def?.group).toBe('action')
    expect(c.get('nope')).toBeUndefined()
  })

  it('list 枚举全部命令含元数据；注销后消失', () => {
    const c = new CommandRegistry()
    c.register({ id: 'a', title: 'A', areas: ['pane'], run: () => 1 })
    c.register({ id: 'b', title: 'B', run: () => 2 })
    expect(c.list().map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(c.list().find((x) => x.id === 'a')?.areas).toEqual(['pane'])
    const disp = c.get('a')
    expect(disp).toBeDefined()
    // 无 get 的注销句柄时按 id 注销方法
    expect(c.unregister('a')).toBe(true)
    expect(c.list().map((x) => x.id)).toEqual(['b'])
    expect(c.unregister('a')).toBe(false)
  })

  it('既有无元数据命令照常执行（向后兼容）', () => {
    const c = new CommandRegistry()
    let ran = 0
    c.register({ id: 'plain', run: () => (ran += 1) })
    c.execute('plain')
    expect(ran).toBe(1)
    expect(c.get('plain')).toBeDefined()
  })
})

