/**
 * 「看图」槽位规则的测试（node --test，零依赖）。
 *
 * 跑法：node --test docs/demo/slotRules.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSlots, judgeDrop, mediaTypeOfFile, kindMatches } from './slotRules.mjs'

test('标签解析：@图片/@音频/@音视频 + 数字', () => {
  assert.deepEqual(
    parseSlots('将 @图片1 中的女子，参照 @音频2 和 @音视频3'),
    [
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'audio:2', kind: 'audio', index: 2 },
      { key: 'av:3', kind: 'av', index: 3 },
    ],
  )
})

test('标签解析：英文写法、去重、任意位数', () => {
  assert.deepEqual(
    parseSlots('@image12 @image12 @video7').map((s) => s.key),
    ['image:12', 'video:7'],
  )
})

test('标签解析：关掉 @音视频 后不再产出 av 槽位', () => {
  assert.deepEqual(parseSlots('@音视频1 @音频1', { allowAv: false }).map((s) => s.key), ['audio:1'])
})

test('标签解析：0 或没有数字不算槽位', () => {
  assert.deepEqual(parseSlots('@图片0 @图片 @图片abc'), [])
})

test('文件类型：MIME 优先，扩展名兜底', () => {
  assert.equal(mediaTypeOfFile({ name: 'a.bin', type: 'image/png' }), 'image')
  assert.equal(mediaTypeOfFile({ name: 'a.MP4', type: '' }), 'video')
  assert.equal(mediaTypeOfFile({ name: 'voice.mp3' }), 'audio')
  assert.equal(mediaTypeOfFile({ name: 'readme.txt', type: 'text/plain' }), null)
})

test('槽位种类：「音视频」收视频与音频，图片槽位只收图片', () => {
  assert.equal(kindMatches('av', 'video'), true)
  assert.equal(kindMatches('av', 'audio'), true)
  assert.equal(kindMatches('av', 'image'), false)
  assert.equal(kindMatches('image', 'image'), true)
  assert.equal(kindMatches('image', 'video'), false)
})

test('落点：本地文件只要类型对就能进（不需要 Ctrl）', () => {
  assert.deepEqual(judgeDrop('image', { fileMediaType: 'image' }), { ok: true, mediaType: 'image' })
  assert.deepEqual(judgeDrop('image', { fileMediaType: 'audio' }), {
    ok: false,
    reason: 'kind-mismatch',
    mediaType: 'audio',
  })
})

test('落点：拖节点必须按 Ctrl，并且类型要匹配', () => {
  const node = { name: '图片1', mime: 'image/svg+xml' }
  assert.deepEqual(judgeDrop('image', { node, modifier: false }), { ok: false, reason: 'no-modifier' })
  assert.deepEqual(judgeDrop('image', { node, modifier: true }), { ok: true, mediaType: 'image' })
  assert.deepEqual(judgeDrop('audio', { node, modifier: true }), {
    ok: false,
    reason: 'kind-mismatch',
    mediaType: 'image',
  })
})

test('落点：拖节点，视频节点可以进「音频」以外的音视频槽位', () => {
  const video = { name: '视频1', mime: 'video/mp4' }
  assert.deepEqual(judgeDrop('av', { node: video, modifier: true }), { ok: true, mediaType: 'video' })
  assert.deepEqual(judgeDrop('video', { node: video, modifier: true }), { ok: true, mediaType: 'video' })
})

test('落点：不支持的类型被拒绝', () => {
  assert.deepEqual(judgeDrop('image', { fileMediaType: null }), { ok: false, reason: 'unsupported' })
  assert.deepEqual(judgeDrop('image', { node: { name: 'x.txt', mime: 'text/plain' }, modifier: true }), {
    ok: false,
    reason: 'unsupported',
  })
})
