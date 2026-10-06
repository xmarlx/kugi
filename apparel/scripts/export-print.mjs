#!/usr/bin/env node
// 入稿用PNG（背景透過）を print/ に書き出す。Printful などにアップロードして使う。
// 幅: 全面 3600px（12インチ@300dpi）/ 胸ワンポイント 1200px（4インチ@300dpi）
// 必要: Playwright（Chromium）とネット接続（Google Fonts を読み込むため）
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPrintFile } from "../lib/mockup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "print");
const FONTS = "https://fonts.googleapis.com/css2?family=DotGothic16&family=Graduate&family=Zen+Old+Mincho:wght@900&display=swap";
const WIDTH = { full: 3600, chest: 1200 };

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright が見つかりません。npm i -D playwright を実行してください。");
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(join(ROOT, "data/products.json"), "utf8"));
const only = process.argv[2]; // 例: node scripts/export-print.mjs lowbatt-bat-tee
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
let count = 0;
for (const p of catalog.products.filter((x) => x.status !== "draft" && (!only || x.slug === only))) {
  const seen = new Set();
  for (const [i, color] of p.colors.entries()) {
    for (const pr of p.prints) {
      const svg = renderPrintFile({ designSvg: readFileSync(join(ROOT, "designs", `${pr.design}.svg`), "utf8"), color });
      // 同じデザイン×同じ色の組み合わせは1回だけ書き出す
      const key = `${pr.design}/${color.ink}/${color.hex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [, , vw, vh] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
      const w = WIDTH[pr.area];
      const h = Math.round((w * vh) / vw);
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(
        `<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`,
        { waitUntil: "networkidle" },
      );
      await page.evaluate(() => document.fonts.ready);
      const file = join(OUT, `${p.slug}_${i}-${color.name}_${pr.side}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      console.log(`${file}  ${w}x${h}`);
      count++;
    }
  }
}
await browser.close();
console.log(`${count} ファイルを書き出しました`);
