import assert from 'node:assert/strict'
import {
  clampClipRange,
  formatTime,
  makeImageNodeFromFrame,
  makeVideoResultNode,
  fitVideoCardSize,
} from './videoNodeUtils.ts'

assert.equal(formatTime(0), '0:00')
assert.equal(formatTime(7.4), '0:07')
assert.equal(formatTime(68.9), '1:08')

assert.deepEqual(fitVideoCardSize(1280, 720), { cardWidth: 560, cardHeight: 315 })
assert.deepEqual(fitVideoCardSize(720, 1280), { cardWidth: 203, cardHeight: 360 })
assert.deepEqual(fitVideoCardSize(0, 0), { cardWidth: 480, cardHeight: 320 })
assert.deepEqual(clampClipRange({ start: -2, end: 99, duration: 38 }), { start: 0, end: 38 })
assert.deepEqual(clampClipRange({ start: 20, end: 10, duration: 38 }), { start: 10, end: 20 })
assert.deepEqual(clampClipRange({ start: 12, end: 12, duration: 38 }), { start: 12, end: 12.1 })

const sourceNode = {
  id: 'video-1',
  position: { x: 100, y: 200 },
  data: {
    label: 'demo.mp4',
    nodeType: 'video',
    videoUrl: 'blob:demo',
    videoName: 'demo.mp4',
    videoType: 'video/mp4',
    videoWidth: 1920,
    videoHeight: 1080,
    videoDuration: 38,
    cardWidth: 480,
    cardHeight: 340,
  },
}

const imageNode = makeImageNodeFromFrame(sourceNode, {
  url: 'blob:frame',
  width: 1920,
  height: 1080,
  assetId: 'asset-frame',
  at: 3.2,
})
assert.equal(imageNode.type, 'custom')
assert.equal(imageNode.data.nodeType, 'image')
assert.equal(imageNode.data.imageUrl, 'blob:frame')
assert.equal(imageNode.data.assetId, 'asset-frame')
assert.equal(imageNode.position.x, 620)

const clipNode = makeVideoResultNode(sourceNode, {
  suffix: '_clip',
  clipStart: 5,
  clipEnd: 10,
})
assert.equal(clipNode.data.nodeType, 'video')
assert.equal(clipNode.data.videoUrl, 'blob:demo')
assert.equal(clipNode.data.clipStart, 5)
assert.equal(clipNode.data.clipEnd, 10)
assert.equal(clipNode.data.videoDuration, 5)
assert.equal(clipNode.position.x, 620)

const cropNode = makeVideoResultNode(sourceNode, {
  suffix: '_crop',
  cropRect: { x: 10, y: 20, width: 640, height: 360 },
})
assert.equal(cropNode.data.videoWidth, 640)
assert.equal(cropNode.data.videoHeight, 360)
assert.equal(cropNode.data.cropSourceWidth, 1920)
assert.equal(cropNode.data.cropSourceHeight, 1080)
assert.deepEqual(cropNode.data.cropRect, { x: 10, y: 20, width: 640, height: 360 })

console.log('videoNodeUtils tests passed')
