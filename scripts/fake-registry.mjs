/**
 * fake-registry —— 本地假 npm registry（自验证链路的「伪造 npm」）。
 * GET /<pkg> packument；PUT /<pkg> 收包；GET /<pkg>/-/<v>.tgz 下载；/-/v1/search 搜索；/health 探活。
 * 用法：node scripts/fake-registry.mjs [端口=9201]。内存存储，重启即空。
 */
import http from 'node:http'

const PORT = Number(process.argv[2] ?? process.env.FAKE_REGISTRY_PORT ?? 9201)
const store = new Map()

function packumentOf(name) {
  const entry = store.get(name)
  if (!entry || entry.versions.size === 0) return null
  const versions = {}
  const time = {}
  for (const [v, info] of entry.versions) {
    versions[v] = { name, version: v, dist: { tarball: `http://127.0.0.1:${PORT}/${encodeURIComponent(name)}/-/${v}.tgz`, shasum: info.shasum }, plume: info.plume }
    time[v] = info.publishedAt
  }
  const latest = [...entry.versions.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
  return { name, "dist-tags": { latest }, versions, time }
}

const server = http.createServer((req, res) => {
  const url = req.url ?? ""
  if (url === "/health") { res.end(JSON.stringify({ ok: true, packages: store.size })); return }
  // DELETE /<pkg> = 清掉一个包（自验证用：重发同版本前先清，npm 客户端见远端已有版本会拒绝）
  if (req.method === "DELETE") {
    const name = decodeURIComponent(url.slice(1).split("?")[0])
    store.delete(name)
    console.log(`[fake-registry] DELETE ${name}`)
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (url.startsWith("/-/v1/search")) {
    const q = decodeURIComponent((url.split("text=")[1] ?? "").split("&")[0]).toLowerCase()
    const objects = []
    for (const [name] of store) {
      if (!q || name.toLowerCase().includes(q)) {
        const pk = packumentOf(name)
        if (pk) objects.push({ package: { name, description: "fake", version: pk["dist-tags"].latest, date: new Date().toISOString(), links: {} } })
      }
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ objects, total: objects.length }))
    return
  }
  if (req.method === "PUT" && !url.includes("/-/")) {
    const name = decodeURIComponent(url.slice(1))
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        const entry = store.get(name) ?? { versions: new Map() }
        for (const [v, meta] of Object.entries(body.versions ?? {})) {
          const attName = Object.keys(body._attachments ?? {})[0]
          const tarballB64 = attName ? body._attachments[attName].data : null
          entry.versions.set(v, { tarball: tarballB64 ? Buffer.from(tarballB64, "base64") : Buffer.alloc(0), shasum: meta.dist?.shasum ?? "", plume: meta.plume ?? {}, publishedAt: new Date().toISOString() })
        }
        store.set(name, entry)
        console.log(`[fake-registry] PUT ${name} -> ${[...entry.versions.keys()].join(", ")}`)
        res.statusCode = 201
        res.end(JSON.stringify({ ok: true, id: name }))
      } catch (err) {
        console.error("[fake-registry] PUT parse fail:", err.message)
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  const tgzMatch = url.match(/^\/([^/]+)\/-\/([^/]+)\.tgz$/)
  if (tgzMatch && req.method === "GET") {
    const info = store.get(decodeURIComponent(tgzMatch[1]))?.versions.get(tgzMatch[2])
    if (!info) { res.statusCode = 404; res.end("{}"); return }
    res.setHeader("content-type", "application/octet-stream")
    res.end(info.tarball)
    return
  }
  if (req.method === "GET") {
    const pk = packumentOf(decodeURIComponent(url.slice(1).split("?")[0]))
    if (!pk) { res.statusCode = 404; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "not found" })); return }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(pk))
    return
  }
  res.statusCode = 404
  res.end("{}")
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-registry] http://127.0.0.1:${PORT}`)
})
