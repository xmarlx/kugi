// 商品カタログの検証・カート計算。ビルド・決済Worker・テストで共用する。

export const GARMENT_TYPES = ["tee", "babytee", "longsleeve", "hoodie", "quarterzip", "badges"];
export const SIDES = ["front", "back"];
export const AREAS = ["full", "chest"];
export const MAX_QTY = 10;
export const FULFILLMENT_PROVIDERS = ["printful", "printify"];

export function validateCatalog(catalog, { designExists = () => true } = {}) {
  const errors = [];
  const warnings = [];
  const shop = catalog.shop || {};
  if (!shop.brand) errors.push("shop.brand がありません");
  if (shop.currency !== "jpy") errors.push("shop.currency は jpy のみ対応");
  if (!Number.isInteger(shop.shippingFee) || shop.shippingFee < 0) errors.push("shop.shippingFee は0以上の整数");
  if (!Number.isInteger(shop.freeShippingThreshold)) errors.push("shop.freeShippingThreshold は整数");
  if (!shop.checkoutEndpoint) warnings.push("shop.checkoutEndpoint が未設定（決済ボタンは無効表示になります）");

  const slugs = new Set();
  for (const p of catalog.products || []) {
    const at = `products[${p.slug || "?"}]`;
    if (!/^[a-z0-9-]+$/.test(p.slug || "")) errors.push(`${at}: slug は英小文字・数字・ハイフンのみ`);
    if (slugs.has(p.slug)) errors.push(`${at}: slug が重複`);
    slugs.add(p.slug);
    if (!p.name) errors.push(`${at}: name がありません`);
    if (!GARMENT_TYPES.includes(p.type)) errors.push(`${at}: type は ${GARMENT_TYPES.join("/")} のいずれか`);
    if (!Number.isInteger(p.price) || p.price <= 0) errors.push(`${at}: price は正の整数（円）`);
    if (!["active", "draft", "soldout"].includes(p.status)) errors.push(`${at}: status は active/draft/soldout`);
    if (!Array.isArray(p.prints) || !p.prints.length) errors.push(`${at}: prints が空`);
    for (const pr of p.prints || []) {
      if (!SIDES.includes(pr.side)) errors.push(`${at}: prints.side は ${SIDES.join("/")}`);
      if (!AREAS.includes(pr.area)) errors.push(`${at}: prints.area は ${AREAS.join("/")}`);
      if (!pr.design || !designExists(pr.design)) errors.push(`${at}: designs/${pr.design}.svg がありません`);
    }
    if (new Set((p.prints || []).map((pr) => pr.side)).size !== (p.prints || []).length) errors.push(`${at}: 同じ面に prints が重複`);
    if (p.hero && !(p.prints || []).some((pr) => pr.side === p.hero)) errors.push(`${at}: hero の面に prints がありません`);
    if (!Array.isArray(p.colors) || !p.colors.length) errors.push(`${at}: colors が空`);
    for (const c of p.colors || []) {
      if (!c.name || !/^#[0-9a-f]{6}$/i.test(c.hex || "") || !/^#[0-9a-f]{6}$/i.test(c.ink || ""))
        errors.push(`${at}: colors の各要素に name / hex / ink（#rrggbb）が必要`);
    }
    if (!Array.isArray(p.sizes) || !p.sizes.length) errors.push(`${at}: sizes が空`);
    if (p.cost == null) warnings.push(`${at}: cost（原価）未入力のため粗利を計算できません`);
    else if (p.cost >= p.price) warnings.push(`${at}: cost が price 以上です`);
    const f = p.fulfillment || {};
    if (!FULFILLMENT_PROVIDERS.includes(f.provider)) errors.push(`${at}: fulfillment.provider は ${FULFILLMENT_PROVIDERS.join("/")}`);
    else if (p.status === "active") {
      const label = f.provider === "printify" ? "Printify" : "Printful";
      if (f.provider === "printify" && !f.productId) warnings.push(`${at}: Printify の productId 未設定（自動発注されません）`);
      const ids = f.variantIds || {};
      const missing = [];
      for (const c of p.colors || []) for (const s of p.sizes || []) if (!ids[variantKey(c.name, s)]) missing.push(variantKey(c.name, s));
      if (missing.length) warnings.push(`${at}: ${label} の variantIds 未設定 ${missing.length}件（自動発注されません）`);
    }
  }
  return { errors, warnings };
}

export function variantKey(colorName, size) {
  return `${colorName}/${size}`;
}

export function findProduct(catalog, slug) {
  return (catalog.products || []).find((p) => p.slug === slug);
}

// カート行を検証し、価格はカタログから引き直す（クライアントの金額は信用しない）
export function resolveCart(catalog, items) {
  if (!Array.isArray(items) || !items.length) throw new Error("カートが空です");
  if (items.length > 20) throw new Error("カートの行数が多すぎます");
  return items.map((it) => {
    const p = findProduct(catalog, it.slug);
    if (!p || p.status !== "active") throw new Error(`販売していない商品です: ${it.slug}`);
    const color = p.colors[it.color];
    if (!Number.isInteger(it.color) || !color) throw new Error(`カラーが不正です: ${it.slug}`);
    if (!p.sizes.includes(it.size)) throw new Error(`サイズが不正です: ${it.slug}`);
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_QTY) throw new Error(`数量は1〜${MAX_QTY}です`);
    return { product: p, color, colorIndex: it.color, size: it.size, qty: it.qty, unitPrice: p.price, lineTotal: p.price * it.qty };
  });
}

export function cartTotals(shop, lines) {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = subtotal >= shop.freeShippingThreshold ? 0 : shop.shippingFee;
  return { subtotal, shipping, total: subtotal + shipping };
}

// Stripe の metadata（1値500文字まで）に収めるための短い表現
export function encodeCart(lines) {
  return lines.map((l) => `${l.product.slug}:${l.colorIndex}:${l.size}:${l.qty}`).join(",");
}

export function decodeCart(str) {
  return String(str || "")
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [slug, color, size, qty] = part.split(":");
      return { slug, color: Number(color), size, qty: Number(qty) };
    });
}

// metadata の値は1つ500文字までなので cart_0, cart_1 … に分割して入れる
export function cartToMetadata(lines) {
  const enc = encodeCart(lines);
  const meta = {};
  for (let i = 0; i * 500 < enc.length; i++) meta[`cart_${i}`] = enc.slice(i * 500, (i + 1) * 500);
  return meta;
}

export function cartFromMetadata(meta = {}) {
  let s = "";
  for (let i = 0; meta[`cart_${i}`] != null; i++) s += meta[`cart_${i}`];
  return decodeCart(s);
}
