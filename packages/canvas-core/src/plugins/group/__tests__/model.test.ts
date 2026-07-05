import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GROUP_COLOR_SWATCHES,
  resolveGroupBackgroundColor,
  selectDownloadableGroupChildren,
  normalizeGroupTitle,
} from '../model.ts'

test('group color swatches render a 4x2 grid with custom color as the last item', () => {
  assert.equal(GROUP_COLOR_SWATCHES.length, 8)
  assert.equal(GROUP_COLOR_SWATCHES.at(-1)?.kind, 'custom')
})

test('resolveGroupBackgroundColor uses the stored color and falls back to the default swatch', () => {
  assert.equal(resolveGroupBackgroundColor('#123456'), '#123456')
  assert.equal(resolveGroupBackgroundColor(undefined), GROUP_COLOR_SWATCHES[0].color)
})

test('normalizeGroupTitle trims text but keeps empty title as empty', () => {
  assert.equal(normalizeGroupTitle('  分镜组  '), '分镜组')
  assert.equal(normalizeGroupTitle('   '), '')
})

test('selectDownloadableGroupChildren keeps only group children with registered download commands', () => {
  const nodes = [
    { id: 'group-1', type: 'group' },
    { id: 'image-1', type: 'image', parentNode: 'group-1' },
    { id: 'pano-1', type: 'panorama', parentNode: 'group-1' },
    { id: 'video-1', type: 'video', parentNode: 'group-1' },
    { id: 'image-2', type: 'image' },
    { id: 'text-1', type: 'text', parentNode: 'group-1' },
  ]

  const registeredDownloads = new Set(['image.download', 'panorama.download'])

  assert.deepEqual(
    selectDownloadableGroupChildren(nodes, 'group-1', (commandId) => registeredDownloads.has(commandId)),
    [
      { node: nodes[1], commandId: 'image.download' },
      { node: nodes[2], commandId: 'panorama.download' },
    ],
  )
})