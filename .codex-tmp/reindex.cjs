
const fs = require("fs");
const path = require("path");
const dir = "I:/Assets/liblib-assets";
const full = JSON.parse(fs.readFileSync(process.env.USERPROFILE + "/Downloads/liblib_style_library.json", "utf8"));

function safeName(u) {
  const m = u.match(/([a-f0-9]{32}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-f0-9]{8}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/);
  return m ? m[1].replace("/", "_") : ("img_" + [...u].reduce((a,c)=>((a*31+c.charCodeAt(0))|0),0).toString(36) + ".bin");
}
const have = new Set(fs.readdirSync(dir));
const items = [];
let droppedImgs = 0;
for (const x of full) {
  let extra = {}; try { extra = JSON.parse(x.extraInfo || "{}"); } catch(e) {}
  const urls = (extra.images && extra.images.length ? extra.images : (x.imageUrl ? [x.imageUrl] : []));
  const files = [];
  for (const u of urls) { const n = safeName(u); if (have.has(n)) files.push(n); else droppedImgs++; }
  if (!files.length) continue;
  const tags = [];
  for (const g of (x.tagsV2 || [])) for (const l of (g.labels || [])) if (!tags.includes(l)) tags.push(l);
  items.push({
    id: x.id,
    name: x.name || "",
    author: x.nickname || "",
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
// 备份旧索引
if (fs.existsSync(path.join(dir, "index.json"))) fs.copyFileSync(path.join(dir, "index.json"), path.join(dir, "index.raw.json"));
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(items), "utf8");
const totalImgs = items.reduce((a, b) => a + b.images.length, 0);
console.log("items=" + items.length + " images=" + totalImgs + " droppedImgs(404)=" + droppedImgs);
console.log("sample=" + JSON.stringify(items[0]).slice(0, 400));

