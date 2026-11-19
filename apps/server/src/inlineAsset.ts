/**
 * 回读上传资源时的安全响应头。
 *
 * ## 为什么需要（2026-10-19 实测）
 *
 * 上传接口允许 `.svg`（`store/mime.ts` 的白名单里有它），回读时按扩展名给
 * `image/svg+xml`，且**没有任何 CSP**。于是攻击者匿名上传一段带 `<script>` 的 SVG，
 * 用户一打开，脚本就在**后台自己的源**上执行 —— 能读 `localStorage` 里的管理令牌、
 * 能以同源身份调所有接口。真实服务上复现过（上传 → 打开 → 标题被改、令牌被读出）。
 *
 * ## 为什么是 CSP `sandbox`
 *
 * 实测对比过几种写法（Chrome 153）：`sandbox`、`default-src 'none'`、`script-src 'none'`
 * 都能挡住内联脚本，且**都不影响 `<img src="x.svg">` 的正常显示**。
 * 选 `sandbox` 是因为它作用面最完整：不只是脚本，连表单、弹窗、顶层导航一并禁掉，
 * 而这些对一个用来显示的图片资源本来就没有意义。
 *
 * `nosniff` 仍要加，但它不是这里的主力：对已经声明成 `image/svg+xml` 的响应，
 * 它的作用是阻止浏览器「按别的方式猜类型」，不能替代 CSP。
 */

const INLINE_ASSET_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:"

/**
 * 给「按字节回读上传资源」的响应加安全头。
 *
 * 用在：画布资源（`/api/canvases/:id/resources/:name`）、资产文件（`/api/assets/files/:name`）、
 * 风格库文件（`/api/style-library/file`、`/api/effect-library/file`）。
 * 这三处都是「用户上传的内容按扩展名当文档回读」，受同一类风险影响。
 */
export function inlineAssetHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'content-security-policy': INLINE_ASSET_CSP,
    'x-content-type-options': 'nosniff',
    /*
     * 不能写 `same-site`：可视化节点里的生成页面跑在**不透明源**（`Origin: null`）的
     * iframe 里，按 CORP 规则它和后台既不同源、也不被算作同一个 site —— 于是
     * `<audio src>` / `<video src>` 直接报「无法播放媒体」（用户 2026-11-17 实测：
     * 静音裁剪节点出来的音频播不出来，同一地址在普通标签页里能播）。
     * 这里用 `cross-origin`：它本来就只是给别的网页读、不涉及凭据，真正挡住脚本执行
     * 的是上面的 CSP sandbox + nosniff。
     */
    'cross-origin-resource-policy': 'cross-origin',
  }
}
