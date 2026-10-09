async function main() {
  const base = 'http://127.0.0.1:8865'
  for (const u of [
    '/api/style-library/file/nope.png',
    '/api/style-library/file/abc',
    '/api/style-library/meta',
    '/api/style-library/file/196839fdfe0c4922bd6b8412407022cb_08a35db09431614a9b50e1784d6b20e078ae9467306d9b6bf2285027b3e2d9ba.png',
  ]) {
    const r = await fetch(base + u)
    const ct = r.headers.get('content-type')
    console.log(r.status, ct, u.slice(0, 70))
  }
}
main()

