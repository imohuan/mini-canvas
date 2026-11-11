/**
 * bundle-dts —— 把 tsc 产出的几十个 .d.ts 合并成**一个** dist/index.d.ts。
 *
 * 为什么需要：发布包里 types 只该有一个入口文件。逐个发 .d.ts 有三个问题：
 *   1. 包里多出几十个没人直接引用的文件；
 *   2. 它们会 import `@plume-canvas/kernel` 这类 private 包 —— 用户机上装不到，类型直接坏；
 *   3. 后续改内部文件结构，声明路径会跟着变，等于对外接口天天漂移。
 *
 * 做法：用 api-extractor 的 rolled-up 模式，以 src/index.ts 为唯一入口，
 * 把私有包的类型一并内联进产物，最后只留 dist/index.d.ts。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const TMP_DIR = path.join(PACKAGE_ROOT, '.dts-tmp')
const OUT_FILE = path.join(PACKAGE_ROOT, 'dist', 'index.d.ts')

/**
 * 中间目录：api-extractor 需要 .d.ts 本体与 .api.json 报告。
 * 放进 .dts-tmp 并在结束时删掉，dist 里最后只剩合并后的 index.d.ts。
 */
await fs.mkdir(TMP_DIR, { recursive: true })

/**
 * 先把 @plume-canvas/kernel 的声明单独编译出来。
 *
 * 它的 package.json `types` 指向 .ts 源码，api-extractor 直接把源码当声明读会崩
 *（Unable to determine semantic information）。编译出一份真正的 .d.ts 再让它解析。
 */
const KERNEL_DTS = path.join(TMP_DIR, 'kernel')
const run = promisify(execFile)
const require = createRequire(import.meta.url)
const TSC_BIN = path.join(path.dirname(require.resolve('typescript')), '..', 'bin', 'tsc')
await run(process.execPath, [
  TSC_BIN,
  '--declaration', '--emitDeclarationOnly',
  '--outDir', KERNEL_DTS,
  '--rootDir', path.join(REPO_ROOT, 'packages/kernel/src'),
  '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2023',
  '--skipLibCheck', '--strict', '--verbatimModuleSyntax',
  path.join(REPO_ROOT, 'packages/kernel/src/index.ts'),
], { cwd: REPO_ROOT })

/**
 * 临时 tsconfig：让 `@plume-canvas/kernel` 解析到刚编译出来的 .d.ts，
 * 而不是它 package.json 里指向的 .ts 源码。
 */
const TMP_TSCONFIG = path.join(TMP_DIR, 'tsconfig.json')
await fs.writeFile(
  TMP_TSCONFIG,
  JSON.stringify(
    {
      extends: path.join(PACKAGE_ROOT, 'tsconfig.build.json'),
      compilerOptions: {
        baseUrl: PACKAGE_ROOT,
        paths: { '@plume-canvas/kernel': [path.join(KERNEL_DTS, 'index.d.ts')] },
      },
    },
    null,
    2,
  ),
  'utf8',
)

const config = ExtractorConfig.prepare({
  configObject: {
    $schema: 'https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json',
    projectFolder: PACKAGE_ROOT,
    mainEntryPointFilePath: path.join(PACKAGE_ROOT, 'dist', 'index.d.ts'),
    // 内联 kernel 的类型：用户机上没有这个 private 包，留着类型就坏了。
    // 解析走下面临时目录里的 .d.ts（不是 package.json 指向的 .ts 源码）。
    bundledPackages: ['@plume-canvas/kernel'],
    compiler: { tsconfigFilePath: TMP_TSCONFIG },
    apiReport: {
      enabled: false,
      reportFolder: TMP_DIR,
    },
    docModel: { enabled: false },
    dtsRollup: {
      enabled: true,
      publicTrimmedFilePath: path.join(TMP_DIR, 'index.d.ts'),
    },
    tsdocMetadata: { enabled: false },
    messages: {
      compilerMessageReporting: { default: { logLevel: 'warning' } },
      extractorMessageReporting: {
        // 内部实现里大量「已导出/未导出」的提示与本次目的无关，静音；真正的错误照样抛
        'ae-internal-missing-underscore': { logLevel: 'none' },
        'ae-forgotten-export': { logLevel: 'none' },
        default: { logLevel: 'warning' },
      },
      tsdocMessageReporting: { default: { logLevel: 'none' } },
    },
  },
  configObjectFullPath: path.join(TMP_DIR, 'api-extractor.json'),
  packageJsonFullPath: path.join(PACKAGE_ROOT, 'package.json'),
})

const result = Extractor.invoke(config, {
  localBuild: true,
  showVerboseMessages: false,
})
if (!result.succeeded) {
  console.error('[bundle-dts] 声明合并失败')
  process.exit(1)
}

await fs.copyFile(path.join(TMP_DIR, 'index.d.ts'), OUT_FILE)
await fs.rm(TMP_DIR, { recursive: true, force: true })

/** 只留入口声明：tsc 的中间产物与目录里其它 .d.ts 全部删掉 */
async function dropOtherDeclarations(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await dropOtherDeclarations(full)
      const left = await fs.readdir(full)
      if (left.length === 0) await fs.rm(full, { recursive: true, force: true })
    } else if (entry.name.endsWith('.d.ts') && full !== OUT_FILE) {
      await fs.rm(full, { force: true })
    }
  }
}
await dropOtherDeclarations(path.join(PACKAGE_ROOT, 'dist'))

const text = await fs.readFile(OUT_FILE, 'utf8')
console.log('[bundle-dts] dist/index.d.ts ' + (Math.round(Buffer.byteLength(text) / 1024)) + ' KB（唯一声明文件）')
