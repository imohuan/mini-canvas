import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { uiComponent, uiNames } from '../uiCatalog'

/**
 * ui 目录场（设计文档 §4.5 / 案例 4 / 决策 4）：
 * 主题把设计系统件登记进 registryOf('ui')，业务插件按名取 —— 换主题零改动。
 */
describe('ui 组件目录（按名取设计系统件）', () => {
  it('主题登记后，消费方按名取到组件（uiComponent）', async () => {
    const ctx = new Context()
    const ThemeButton = { name: 'ThemeButton' };
    ctx.registryOf<unknown>('ui').add('button', ThemeButton, { id: 'default' });
    await ctx.start();
    expect(uiComponent(ctx, 'button')).toBe(ThemeButton);
    expect(uiNames(ctx)).toContain('button');
    ctx.stop();
  })

  it('换主题 = 叠一层（order 小者赢），且原值仍可查（永不覆盖）', async () => {
    const ctx = new Context();
    const BaseBtn = { name: 'Base' };
    const NeonBtn = { name: 'Neon' };
    ctx.registryOf<unknown>('ui').add('button', BaseBtn, { id: 'default', order: 0 });
    ctx.registryOf<unknown>('ui').add('button', NeonBtn, { id: 'neon', order: -1 });
    await ctx.start();
    expect(uiComponent(ctx, 'button')).toBe(NeonBtn); // order 最小者在最外
    const all = ctx.registryOf<unknown>('ui').list('button');
    expect(all.map((e) => e.value)).toEqual([NeonBtn, BaseBtn]); // 原值没丢
    ctx.stop();
  })

  it('目录里没有的名字返回 undefined（调用方自行降级，不炸）', async () => {
    const ctx = new Context();
    await ctx.start();
    expect(uiComponent(ctx, 'nope')).toBeUndefined();
    ctx.stop();
  })

  it('无 ctx 时返回 undefined / 空数组（组件树外调用安全）', () => {
    expect(uiComponent(undefined, 'button')).toBeUndefined();
    expect(uiNames(undefined)).toEqual([]);
  })
})
