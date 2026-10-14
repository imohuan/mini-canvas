/**
 * zip —— 最小可用的 ZIP 读写（Node 自带 zlib，不加第三方依赖）。
 *
 * ## 为什么要自己写
 *
 * 节点包必须打成**一个文件**才能"拖进来一次就是一个节点"。
 * 而 cloud-server 的依赖是精选过的（加一个 zip 库要连带它的传递依赖、还要审），
 * 这个格式本身又只有三种结构：本地头 / 中央目录 / 结束记录 —— 自己写更省。
 *
 * ## 支持的子集（够用就好，不追求兼容全部）
 *
 * 写：deflate（store 也支持），不写 zip64、不加密、不带扩展字段。
 * 读：认中央目录（**不信本地头** —— 本地头里的 size 在流式写入时可能是 0），
 * 认 deflate 与 store 两种压缩方式，遇 zip64/加密/其它压缩方式直接报错（不猜）。
 * 为什么按中央目录读：它是权威索引；按本地头顺序扫会在"有数据描述符"的包上错位。
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** 一条要写进包里 / 从包里读出的文件 */
export interface ZipEntry {
  /** 包内路径（用正斜杠；不要以斜杠开头） */
  name: string
  data: Uint8Array
}

/** CRC32（ZIP 每条记录都要它；查表法，一次算清） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 本地文件头长度 / 中央目录项长度 / 结束记录长度 */
const LOCAL_HEADER_LEN = 30
const CENTRAL_HEADER_LEN = 46
const END_RECORD_LEN = 22

/**
 * 打一个 ZIP。
 *
 * mtime 只用来填 DOS 时间戳（很多解压器会显示"修改时间"）；
 * 传固定的值可以让同样的输入产出**完全一样**的字节（便于比对/测试）。
 */
export function buildZip(entries: readonly ZipEntry[], mtime = new Date()): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const dosTime = toDosTime(mtime)

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name)
    const crc = crc32(e.data)
    const deflated = deflateRawSync(e.data)
    // 压不动就别压（小文件常见）：store 更小也更快
    const useDeflate = deflated.length < e.data.length
    const body = useDeflate ? new Uint8Array(deflated) : e.data
    const method = useDeflate ? 8 : 0

    const local = new Uint8Array(LOCAL_HEADER_LEN + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // 本地文件头签名
    lv.setUint16(4, 20, true) // 解压所需版本 2.0
    lv.setUint16(6, 0, true) // 通用标志位
    lv.setUint16(8, method, true)
    lv.setUint16(10, dosTime.time, true)
    lv.setUint16(12, dosTime.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // 扩展字段长度
    local.set(nameBytes, LOCAL_HEADER_LEN)

    chunks.push(local, body)

    const cd = new Uint8Array(CENTRAL_HEADER_LEN + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true) // 中央目录项签名
    cv.setUint16(4, 20, true) // 生成版本
    cv.setUint16(6, 20, true) // 解压所需版本
    cv.setUint16(8, 0, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, dosTime.time, true)
    cv.setUint16(14, dosTime.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // 扩展字段
    cv.setUint16(32, 0, true) // 注释
    cv.setUint16(34, 0, true) // 起始磁盘号
    cv.setUint16(36, 0, true) // 内部属性
    cv.setUint32(38, 0, true) // 外部属性
    cv.setUint32(42, offset, true) // 本地头偏移
    cd.set(nameBytes, CENTRAL_HEADER_LEN)
    central.push(cd)

    offset += local.length + body.length
  }

  const centralBytes = concat(central)
  const end = new Uint8Array(END_RECORD_LEN)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // 结束记录签名
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralBytes.length, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true) // 注释长度

  return concat([...chunks, centralBytes, end])
}

/**
 * 读一个 ZIP（按中央目录索引）。
 *
 * 遇到不支持的东西（zip64 / 加密 / 其它压缩方式）**报错而不是猜** ——
 * 猜错的话表现为"包里的脚本变成一堆乱码字节"，比直接报错难查得多。
 *
 * @param maxTotalBytes 解开之后**总字节**的上限（可选，但强烈建议给）。
 *   为什么必须有：压缩比可以很大 —— 一个几百 KB 的包能解出好几 GB（"解压炸弹"），
 *   而限制输入大小完全挡不住它。包是**用户能自己拖进来**的东西，不能只信它看起来小。
 */
export function readZip(bytes: Uint8Array, maxTotalBytes = Number.POSITIVE_INFINITY): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndRecord(view)
  if (eocd < 0) throw new Error('不是合法的 ZIP：找不到结束记录')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)

  const out: ZipEntry[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    // 先判边界再读：损坏的包（偏移指到文件外）不该让 DataView 抛出难以理解的 RangeError
    if (p + CENTRAL_HEADER_LEN > view.byteLength) throw new Error('不是合法的 ZIP：中央目录越界')
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('不是合法的 ZIP：中央目录项签名不对')
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const rawSize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localAt = view.getUint32(p + 42, true)
    if (p + CENTRAL_HEADER_LEN + nameLen > view.byteLength) throw new Error('不是合法的 ZIP：中央目录项越界')
    const name = new TextDecoder().decode(
      bytes.subarray(p + CENTRAL_HEADER_LEN, p + CENTRAL_HEADER_LEN + nameLen),
    )
    if (compSize === 0xffffffff || rawSize === 0xffffffff) throw new Error('不支持 zip64 的包')

    // 声明值只做**预检**（早退，省掉解压的力气），**不作为放行依据** ——
    // 它是包自己写的，可以被伪造成 0（审查指出：那样总量判断永不触发）。
    if (total + rawSize > maxTotalBytes) {
      throw new Error('包解开后太大了（超过 ' + Math.round(maxTotalBytes / 1024 / 1024) + 'MB），拒绝处理')
    }

    // 本地头里的 nameLen / extraLen 与中央目录是两份记录，取字节必须按**本地**那份算
    if (localAt + LOCAL_HEADER_LEN > view.byteLength) throw new Error('不是合法的 ZIP：本地文件头越界')
    if (view.getUint32(localAt, true) !== 0x04034b50) throw new Error('不是合法的 ZIP：本地文件头签名不对')
    const lNameLen = view.getUint16(localAt + 26, true)
    const lExtraLen = view.getUint16(localAt + 28, true)
    const dataAt = localAt + LOCAL_HEADER_LEN + lNameLen + lExtraLen
    if (dataAt + compSize > view.byteLength) throw new Error('不是合法的 ZIP：文件数据越界')
    const raw = bytes.subarray(dataAt, dataAt + compSize)

    let data: Uint8Array
    if (method === 0) data = raw
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw))
    else throw new Error('不支持的压缩方式：' + method)
    // ★ 真正的闸在这：按**实际解出的字节**累计并和**剩余额度**比 ——
    //   不是每条都拿满额上限碰一次（那样 N 条声明为 0 的条目能各自解到上限）。
    total += data.length
    if (total > maxTotalBytes) throw new Error('包解开后太大了，拒绝处理')
    out.push({ name, data })
    p += CENTRAL_HEADER_LEN + nameLen + extraLen + commentLen
  }
  return out
}

/** 从尾部往前找结束记录（注释最长 65535，所以最多回看这么多） */
function findEndRecord(view: DataView): number {
  const from = view.byteLength - END_RECORD_LEN
  const to = Math.max(0, view.byteLength - END_RECORD_LEN - 0xffff)
  for (let i = from; i >= to; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** JS Date → DOS 时间/日期（ZIP 的老格式，秒的精度是 2 秒） */
function toDosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

