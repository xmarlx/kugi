#!/usr/bin/env node
// 新商品の下書きを追加する。
// 使い方: node scripts/new-product.mjs <slug> <type> "<商品名>" <価格>
//   例:   node scripts/new-product.mjs bat-cap tee "ローバット Tee 2" 4400
// data/products.json に status:"draft" で追加し、designs/<slug>.svg のひな形を作る。
// 仕上げたら status を "active" にして npm run build。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GARMENT_TYPES } from "../lib/catalog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [slug, type, name, price] = process.argv.slice(2);
if (!slug || !GARMENT_TYPES.includes(type) || !name || !Number(price)) {
  console.error(`使い方: node scripts/new-product.mjs <slug> <${GARMENT_TYPES.join("|")}> "<商品名>" <価格>`);
  process.exit(1);
}
const file = join(ROOT, "data/products.json");
const catalog = JSON.parse(readFileSync(file, "utf8"));
if (catalog.products.some((p) => p.slug === slug)) {
  console.error(`slug "${slug}" は既にあります`);
  process.exit(1);
}
catalog.products.push({
  slug,
  name,
  type,
  prints: [{ side: "front", design: slug, area: "full" }],
  hero: "front",
  price: Number(price),
  cost: null,
  status: "draft",
  description: "",
  material: "",
  colors: [{ name: "ホワイト", hex: "#f4f3ef", ink: "#1d1d1b" }],
  sizes: ["S", "M", "L", "XL"],
  fulfillment: { provider: "printful", variantIds: {} },
});
writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
const design = join(ROOT, "designs", `${slug}.svg`);
if (!existsSync(design))
  writeFileSync(
    design,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">
  <!-- {{INK}} = プリント色 / {{BG}} = 生地色 -->
  <text x="600" y="640" text-anchor="middle" font-family="DotGothic16, monospace" font-size="160" fill="{{INK}}">${name.replace(/[<&]/g, "")}</text>
</svg>
`,
  );
console.log(`追加しました: data/products.json（draft） / designs/${slug}.svg`);
