import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const sourcePath = join(repoRoot, 'src/canvas/core/components/performance/performanceMetrics.ts')
const tempDir = mkdtempSync(join(tmpdir(), 'canvas-performance-metrics-'))
const tempSource = join(tempDir, 'performanceMetrics.ts')
const tempOutput = join(tempDir, 'performanceMetrics.js')
const tscBin = join(repoRoot, 'node_modules/typescript/bin/tsc')
writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }))

try {
  writeFileSync(tempSource, readFileSync(sourcePath, 'utf8'))
  execFileSync(process.execPath, [
    tscBin,
    '--ignoreConfig',
    tempSource,
    '--target',
    'ES2022',
    '--module',
    'ES2022',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
    '--outDir',
    tempDir,
  ], { cwd: repoRoot, stdio: 'pipe' })
} catch (error) {
  rmSync(tempDir, { recursive: true, force: true })
  throw error
}

const metrics = await import(pathToFileURL(tempOutput).href)

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

test('classifies smooth, unstable, slow, and jank states', () => {
  const thresholds = metrics.DEFAULT_PERFORMANCE_THRESHOLDS

  assert.equal(metrics.getPerformanceStatus({ fps: 58, frameMs: 17, thresholds }).level, 'smooth')
  assert.equal(metrics.getPerformanceStatus({ fps: 50, frameMs: 22, thresholds }).level, 'unstable')
  assert.equal(metrics.getPerformanceStatus({ fps: 38, frameMs: 35, thresholds }).level, 'slow')
  assert.equal(metrics.getPerformanceStatus({ fps: 24, frameMs: 45, thresholds }).level, 'jank')
  assert.equal(metrics.getPerformanceStatus({ fps: 58, frameMs: 126, thresholds }).level, 'jank')
})

test('summarizes samples with average fps, lowest fps, max frame time, and jank count', () => {
  const summary = metrics.summarizeSamples([
    { timestamp: 1, fps: 60, frameMs: 16 },
    { timestamp: 2, fps: 42, frameMs: 24 },
    { timestamp: 3, fps: 20, frameMs: 125 },
  ], metrics.DEFAULT_PERFORMANCE_THRESHOLDS)

  assert.equal(summary.averageFps, 41)
  assert.equal(summary.lowestFps, 20)
  assert.equal(summary.maxFrameMs, 125)
  assert.equal(summary.jankCount, 1)
})

test('keeps only the newest samples within the requested limit', () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    timestamp: index,
    fps: 60 - index,
    frameMs: 16 + index,
  }))

  assert.deepEqual(metrics.limitSamples(samples, 3).map((sample) => sample.timestamp), [3, 4, 5])
})

test('counts nodes visible inside the viewport with a small preload margin', () => {
  const nodes = [
    { id: 'inside', position: { x: 50, y: 50 }, dimensions: { width: 80, height: 60 } },
    { id: 'edge', position: { x: 780, y: 560 }, dimensions: { width: 80, height: 60 } },
    { id: 'outside', position: { x: 2000, y: 2000 }, dimensions: { width: 80, height: 60 } },
  ]

  const result = metrics.getVisibleNodeStats({
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 800, height: 600 },
    margin: 80,
  })

  assert.equal(result.totalNodes, 3)
  assert.equal(result.visibleNodes, 2)
})

test('converts screen viewport into flow-space bounds', () => {
  assert.deepEqual(metrics.getViewportBounds({
    viewport: { x: -200, y: -100, zoom: 2 },
    containerSize: { width: 800, height: 600 },
    margin: 0,
  }), {
    left: 100,
    top: 50,
    right: 500,
    bottom: 350,
  })
})




