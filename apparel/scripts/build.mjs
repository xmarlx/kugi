#!/usr/bin/env node
// data/products.json と designs/*.svg から ../store/ に静的ECサイトを生成する。
// 使い方: node scripts/build.mjs [--check]   --check は生成物が最新かだけ確認（CI用）
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "../lib/catalog.mjs";
import { renderMockup } from "../lib/mockup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "..", "store");
const check = process.argv.includes("--check");

const catalog = JSON.parse(readFileSync(join(ROOT, "data/products.json"), "utf8"));
const designPath = (name) => join(ROOT, "designs", `${name}.svg`);
const { errors, warnings } = validateCatalog(catalog, { designExists: (d) => existsSync(designPath(d)) });
for (const w of warnings) console.warn(`警告: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`エラー: ${e}`);
  process.exit(1);
}

const { shop } = catalog;
const visible = catalog.products.filter((p) => p.status !== "draft");
const yen = (n) => `¥${n.toLocaleString("ja-JP")}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const imgPath = (p, i) => `img/${p.slug}-${i}.svg`;
const SIDE_LABEL = { front: "表", back: "裏" };
// デザインに使う Web フォント（モックアップをページ内に直接埋め込むことで反映される）
const FONTS = "https://fonts.googleapis.com/css2?family=DotGothic16&family=Graduate&family=Zen+Old+Mincho:wght@900&display=swap";

const files = new Map(); // 相対パス -> 内容

function page({ title, body, depth = 0, description = shop.tagline }) {
  const up = "../".repeat(depth);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${up}assets/style.css">
<link rel="icon" href="${up}assets/icon.svg" type="image/svg+xml">
</head><body>
<header class="top"><a class="logo" href="${up}index.html">${esc(shop.brand)}</a>
<a class="cartlink" href="${up}cart.html">カート <span data-cart-count>0</span></a></header>
<main>${body}</main>
<footer><p>${esc(shop.brand)} — ${esc(shop.tagline)}</p>
<p><a href="${up}legal.html">特定商取引法に基づく表記</a> ・ <a href="${up}legal.html#returns">返品・交換</a> ・ <a href="${up}legal.html#privacy">個人情報の取り扱い</a></p></footer>
<script>window.SHOP=${JSON.stringify({ endpoint: shop.checkoutEndpoint, root: up })};</script>
<script src="${up}assets/cart.js" defer></script>
</body></html>
`;
}

// モックアップ（色 × 面）。ページには SVG を直接埋め込み、img/ にはカート・OGP 用に代表面を書き出す
const designs = Object.fromEntries(visible.flatMap((p) => p.prints.map((pr) => [pr.design, readFileSync(designPath(pr.design), "utf8")])));
const sidesOf = (p) => [...new Set([p.hero || "front", ...p.prints.map((pr) => pr.side)])];
const mockups = new Map(); // `${slug}/${color}/${side}` -> svg
for (const p of visible) {
  p.colors.forEach((color, i) => {
    for (const side of sidesOf(p)) {
      mockups.set(`${p.slug}/${i}/${side}`, renderMockup({ type: p.type, side, color, prints: p.prints, designs, finish: p.finish, idPrefix: `${p.slug}-${i}-${side}` }));
    }
    files.set(imgPath(p, i), mockups.get(`${p.slug}/${i}/${sidesOf(p)[0]}`));
  });
}
const inline = (svg, label) => svg.replace('<svg xmlns="http://www.w3.org/2000/svg" ', `<svg role="img" aria-label="${esc(label)}" `);
const views = (p, i) =>
  sidesOf(p)
    .map((side) => `<figure class="view">${inline(mockups.get(`${p.slug}/${i}/${side}`), `${p.name} ${p.colors[i].name} ${SIDE_LABEL[side]}`)}${p.type === "badges" ? "" : `<figcaption>${SIDE_LABEL[side]}</figcaption>`}</figure>`)
    .join("");

// トップページ
const cards = visible
  .map(
    (p) => `<a class="card" href="p/${p.slug}.html">
<div class="thumb">${inline(mockups.get(`${p.slug}/0/${sidesOf(p)[0]}`), p.name)}</div>
<div class="meta"><span class="name">${esc(p.name)}</span><span class="price">${yen(p.price)}</span></div>
<div class="dots">${p.colors.map((c) => `<i style="background:${c.hex}" title="${esc(c.name)}"></i>`).join("")}${p.status === "soldout" ? '<em class="soldout">SOLD OUT</em>' : ""}</div>
</a>`,
  )
  .join("\n");
files.set(
  "index.html",
  page({
    title: `${shop.brand} | ${shop.tagline}`,
    body: `<section class="hero"><p class="kicker">2026 AUTUMN / WINTER — DEPT. OF OFFLINE</p>
<h1>${esc(shop.brand)}</h1><p class="lead">${esc(shop.tagline)}</p>
<p class="story">残り1%で眠るコウモリ「ローバット」と、平成ケータイの記憶。通知を切って過ごす時間のための服。</p>
<p class="note">${yen(shop.freeShippingThreshold)}以上で送料無料（通常 ${yen(shop.shippingFee)}）・受注生産</p></section>
<section class="grid">${cards}</section>`,
  }),
);

// 商品ページ
for (const p of visible) {
  const sold = p.status === "soldout";
  const body = `<article class="product" data-slug="${p.slug}">
<div class="gallery" data-gallery>${views(p, 0)}</div>
${p.colors.map((_, i) => `<template data-views="${i}">${views(p, i)}</template>`).join("")}
<div class="info">
<h1>${esc(p.name)}</h1>
<p class="price">${yen(p.price)} <small>税込</small></p>
<p>${esc(p.description)}</p>
<fieldset><legend>カラー: <b data-color-name>${esc(p.colors[0].name)}</b></legend>
<div class="swatches">${p.colors
    .map(
      (c, i) =>
        `<button type="button" class="swatch${i === 0 ? " on" : ""}" data-color="${i}" data-name="${esc(c.name)}" style="background:${c.hex}" aria-label="${esc(c.name)}"></button>`,
    )
    .join("")}</div></fieldset>
<fieldset><legend>サイズ</legend><div class="sizes">${p.sizes
    .map((s, i) => `<button type="button" class="size${i === 1 || p.sizes.length === 1 ? " on" : ""}" data-size="${esc(s)}">${esc(s)}</button>`)
    .join("")}</div></fieldset>
<button class="add" data-add ${sold ? "disabled" : ""}>${sold ? "SOLD OUT" : "カートに入れる"}</button>
<p class="added" data-added hidden>カートに追加しました。<a href="../cart.html">カートを見る</a></p>
<dl class="spec"><dt>素材</dt><dd>${esc(p.material)}</dd><dt>プリント</dt><dd>${p.prints.map((pr) => `${SIDE_LABEL[pr.side]}：${pr.area === "chest" ? "胸ワンポイント" : "全面"}`).join(" / ")}${p.finish === "vintage" ? "（ヴィンテージ風のかすれ加工）" : ""}</dd><dt>生産</dt><dd>注文後に1点ずつプリントする受注生産です。発送まで目安7〜10営業日。</dd></dl>
</div></article>`;
  files.set(`p/${p.slug}.html`, page({ title: `${p.name} | ${shop.brand}`, body, depth: 1, description: p.description }));
}

files.set(
  "cart.html",
  page({
    title: `カート | ${shop.brand}`,
    body: `<h1>カート</h1><div data-cart></div>`,
  }),
);
files.set(
  "success.html",
  page({
    title: `ご注文ありがとうございます | ${shop.brand}`,
    body: `<section class="hero small"><h1>ご注文ありがとうございます</h1><p>確認メールをお送りしました。受注生産のため、発送まで目安7〜10営業日です。発送時に追跡番号をメールでお知らせします。</p><p><a href="index.html">トップへ戻る</a></p></section>
<script>try{localStorage.removeItem("lowbatt-cart")}catch(e){}</script>`,
  }),
);
const legal = readFileSync(join(ROOT, "docs/legal.html"), "utf8")
  .replaceAll("{{shippingFee}}", shop.shippingFee.toLocaleString("ja-JP"))
  .replaceAll("{{freeShippingThreshold}}", shop.freeShippingThreshold.toLocaleString("ja-JP"));
if (legal.includes("【要入力】")) console.warn("警告: docs/legal.html に【要入力】が残っています（特定商取引法の表記は公開前に必須）");
files.set("legal.html", page({ title: `特定商取引法に基づく表記 | ${shop.brand}`, body: legal }));

// 公開用カタログ（カート画面の表示用。価格の正はWorker側のカタログ）
files.set(
  "catalog.json",
  JSON.stringify({
    shop: { brand: shop.brand, shippingFee: shop.shippingFee, freeShippingThreshold: shop.freeShippingThreshold },
    products: visible.map((p) => ({ slug: p.slug, name: p.name, price: p.price, status: p.status, sizes: p.sizes, colors: p.colors.map((c) => c.name), img: p.colors.map((_, i) => imgPath(p, i)) })),
  }) + "\n",
);
files.set("assets/style.css", readFileSync(join(ROOT, "scripts/assets/style.css"), "utf8"));
files.set("assets/cart.js", readFileSync(join(ROOT, "scripts/assets/cart.js"), "utf8"));
files.set("assets/icon.svg", readFileSync(join(ROOT, "scripts/assets/icon.svg"), "utf8"));
if (shop.storeUrl) {
  const urls = ["index.html", ...visible.map((p) => `p/${p.slug}.html`)].map((u) => `<url><loc>${shop.storeUrl.replace(/\/$/, "")}/${u}</loc></url>`);
  files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`);
}

// 書き出し / 差分チェック
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath ?? d.path, d.name)));
}
if (check) {
  const existing = new Set(listFiles(OUT));
  const stale = [...files].filter(([f, c]) => !existing.has(f) || readFileSync(join(OUT, f), "utf8") !== c).map(([f]) => f);
  const extra = [...existing].filter((f) => !files.has(f));
  if (stale.length || extra.length) {
    console.error(`store/ が古いです。node apparel/scripts/build.mjs を実行してコミットしてください。\n変更: ${stale.join(", ")}\n余分: ${extra.join(", ")}`);
    process.exit(1);
  }
  console.log(`store/ は最新です（${files.size}ファイル）`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [f, c] of files) {
    mkdirSync(dirname(join(OUT, f)), { recursive: true });
    writeFileSync(join(OUT, f), c);
  }
  console.log(`store/ に ${files.size} ファイルを生成しました（商品 ${visible.length} 点）`);
}
