#!/usr/bin/env node
// 商品ごとの粗利を表示する（cost を入力した商品のみ）。
// Stripe 手数料率は STRIPE_FEE_RATE（既定 0.036）で変更できる。
import { readFileSync } from "node:fs";
const catalog = JSON.parse(readFileSync(new URL("../data/products.json", import.meta.url), "utf8"));
const fee = Number(process.env.STRIPE_FEE_RATE || 0.036);
console.log("商品\t価格\t原価\t決済手数料\t粗利\t粗利率");
for (const p of catalog.products) {
  if (p.cost == null) {
    console.log(`${p.slug}\t${p.price}\t未入力`);
    continue;
  }
  const f = Math.round(p.price * fee);
  const g = p.price - p.cost - f;
  console.log(`${p.slug}\t${p.price}\t${p.cost}\t${f}\t${g}\t${((g / p.price) * 100).toFixed(1)}%`);
}
