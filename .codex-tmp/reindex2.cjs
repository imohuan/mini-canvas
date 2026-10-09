const fs = require("fs");
const path = require("path");
const dir = "I:/Assets/liblib-assets";
const full = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, "Downloads/liblib_style_library.json"), "utf8"));

// 太笼统、不适合当分类的标签
const GENERIC = new Set(["通用","主体","风格","创作手段","创作形式","垂类","行业","功能","精选","独家","设计/渲染通用","主体强化","全部","是"]);
// 含 emoji / 非常规符号的标签一律不当分类（活动位标签）
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
const GROUP_PRIORITY = ["newModelTag","modelContent","modelContent2"]; // 越靠前越像"分类"

function pickCategory(tagsV2) {
  const byGroup = new Map();
  for (const g of (tagsV2 || [])) {
    if (!byGroup.has(g.k)) byGroup.set(g.k, []);
    for (const l of (g.labels || [])) if (!byGroup.get(g.k).includes(l)) byGroup.get(g.k).push(l);
  }
  const good = (l) => !GENERIC.has(l) && !EMOJI_RE.test(l) && l.length <= 12;
  for (const gk of GROUP_PRIORITY) {
    const hit = (byGroup.get(gk) || []).find(good);
    if (hit) return hit;
  }
  // 退：任意组里第一个合格标签
  for (const [, labels] of byGroup) { const hit = labels.find(good); if (hit) return hit; }
  return ""; // 都没有 → 让服务端归入"未分类"
}

function safeName(u) {
  const m = u.match(/([a-f0-9]{32}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-f0-9]{8}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/);
  return m ? m[1].replace("/", "_") : ("img_" + [...u].reduce((a,c)=>((a*31+c.charCodeAt(0))|0),0).toString(36) + ".bin");
}
const have = new Set(fs.readdirSync(dir));
const items = [];
let dropped = 0;
for (const x of full) {
  let extra = {}; try { extra = JSON.parse(x.extraInfo || "{}"); } catch(e) {}
  const urls = (extra.images && extra.images.length ? extra.images : (x.imageUrl ? [x.imageUrl] : []));
  const files = [];
  for (const u of urls) { const n = safeName(u); if (have.has(n)) files.push(n); else dropped++; }
  if (!files.length) continue;
  const tags = [];
  for (const g of (x.tagsV2 || [])) for (const l of (g.labels || [])) if (!tags.includes(l)) tags.push(l);
  items.push({
    id: x.id,
    name: x.name || "",
    author: x.nickname || "",
    category: pickCategory(x.tagsV2),
    modelType: x.modelType,
    modelTypeName: x.modelTypeName || "",
    baseType: x.baseType || [],
    tags,
    commercial: Array.isArray(x.privilege) && x.privilege.includes("1"),
    exclusive: tags.includes("独家"),
    runCount: typeof x.runCount === "number" ? x.runCount : 0,
    likeCount: typeof x.likeCount === "number" ? x.likeCount : 0,
    imageCount: typeof x.imageCount === "number" ? x.imageCount : files.length,
    images: files,
  });
}
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(items), "utf8");
const cat = {};
items.forEach(i => { const c = i.category || "未分类"; cat[c] = (cat[c]||0)+1; });
const top = Object.entries(cat).sort((a,b)=>b[1]-a[1]).slice(0,20);
console.log("items=" + items.length, "images=" + items.reduce((a,b)=>a+b.images.length,0), "dropped=" + dropped);
console.log("categories:", JSON.stringify(top));

