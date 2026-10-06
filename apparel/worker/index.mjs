// 決済・受注自動化 Worker（Cloudflare Workers）
//   POST /checkout  カート → Stripe Checkout セッションを作り、決済URLを返す
//   POST /webhook   Stripe の支払い完了通知 → Printful に製造・発送を発注
// 必要な環境変数（wrangler secret put で登録）:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PRINTFUL_API_KEY
// 任意の環境変数（wrangler.toml の [vars]）:
//   STORE_URL       例 https://example.github.io/kugi/store
//   PRINTFUL_CONFIRM "true" で Printful の注文を即確定（既定は下書き＝人が確認してから確定）
import catalog from "../data/products.json" with { type: "json" };
import { resolveCart, cartTotals, cartToMetadata, cartFromMetadata, variantKey } from "../lib/catalog.mjs";

const STRIPE_API = "https://api.stripe.com/v1";
const PRINTFUL_API = "https://api.printful.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (request.method === "POST" && url.pathname === "/checkout") return await checkout(request, env, cors);
      if (request.method === "POST" && url.pathname === "/webhook") return await webhook(request, env);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      console.error(e);
      return json({ error: e.publicMessage || "サーバーエラーが発生しました" }, e.status || 500, cors);
    }
  },
};

function corsHeaders(env, request) {
  const origin = env.STORE_URL ? new URL(env.STORE_URL).origin : "*";
  return {
    "access-control-allow-origin": origin === "*" ? request.headers.get("origin") || "*" : origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function clientError(message) {
  return Object.assign(new Error(message), { status: 400, publicMessage: message });
}

export function buildCheckoutParams(lines, shop, storeUrl) {
  const { shipping } = cartTotals(shop, lines);
  const base = storeUrl.replace(/\/$/, "");
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("locale", "ja");
  p.set("success_url", `${base}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  p.set("cancel_url", `${base}/cart.html`);
  p.set("shipping_address_collection[allowed_countries][0]", "JP");
  p.set("phone_number_collection[enabled]", "true");
  for (const [k, v] of Object.entries(cartToMetadata(lines))) p.set(`metadata[${k}]`, v);
  lines.forEach((l, i) => {
    p.set(`line_items[${i}][quantity]`, String(l.qty));
    p.set(`line_items[${i}][price_data][currency]`, shop.currency);
    p.set(`line_items[${i}][price_data][unit_amount]`, String(l.unitPrice));
    p.set(`line_items[${i}][price_data][product_data][name]`, `${l.product.name}（${l.color.name} / ${l.size}）`);
  });
  p.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  p.set("shipping_options[0][shipping_rate_data][display_name]", shipping ? "通常配送" : "通常配送（送料無料）");
  p.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shipping));
  p.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", shop.currency);
  return p;
}

async function checkout(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw clientError("リクエストが不正です");
  }
  let lines;
  try {
    lines = resolveCart(catalog, body.items);
  } catch (e) {
    throw clientError(e.message);
  }
  const params = buildCheckoutParams(lines, catalog.shop, env.STORE_URL || catalog.shop.storeUrl);
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const session = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${session.error?.message}`);
  return json({ url: session.url }, 200, cors);
}

// Stripe-Signature ヘッダの検証（t=タイムスタンプ, v1=HMAC-SHA256）
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300, now = Date.now() / 1000) {
  const parts = Object.fromEntries((header || "").split(",").map((kv) => kv.split("=")));
  const sigs = (header || "").split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function webhook(request, env) {
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)))
    return new Response("invalid signature", { status: 400 });
  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") return new Response("ignored");
  const session = event.data.object;
  if (session.payment_status !== "paid") return new Response("not paid");

  const order = buildPrintfulOrder(session, catalog);
  if (!order.items.length) {
    console.warn(`Printful 未連携の商品のみの注文: ${session.id}（手動で発注してください）`);
    return new Response("no fulfillable items");
  }
  const confirm = env.PRINTFUL_CONFIRM === "true" ? "?confirm=true" : "";
  const res = await fetch(`${PRINTFUL_API}/orders${confirm}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.PRINTFUL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    // 500 を返すと Stripe が時間をおいて再送する
    console.error(`Printful 発注失敗 ${session.id}: ${res.status} ${await res.text()}`);
    return new Response("fulfillment failed", { status: 500 });
  }
  return new Response("ok");
}

export function buildPrintfulOrder(session, catalog) {
  const ship = session.collected_information?.shipping_details || session.shipping_details || {};
  const addr = ship.address || {};
  const items = [];
  const unmapped = [];
  for (const it of cartFromMetadata(session.metadata)) {
    const p = (catalog.products || []).find((x) => x.slug === it.slug);
    const color = p?.colors[it.color];
    const id = color && p.fulfillment?.variantIds?.[variantKey(color.name, it.size)];
    if (id) items.push({ sync_variant_id: id, quantity: it.qty });
    else unmapped.push(`${it.slug}:${it.color}:${it.size}`);
  }
  if (unmapped.length) console.warn(`variantIds 未設定のため発注から除外: ${unmapped.join(", ")}（注文 ${session.id}）`);
  return {
    external_id: session.id.slice(-32), // Printful の external_id は32文字まで。同じ注文の二重発注防止に使う
    recipient: {
      name: ship.name || session.customer_details?.name || "",
      address1: addr.line1 || "",
      address2: addr.line2 || "",
      city: addr.city || "",
      state_name: addr.state || "",
      country_code: addr.country || "JP",
      zip: addr.postal_code || "",
      phone: session.customer_details?.phone || "",
      email: session.customer_details?.email || "",
    },
    items,
  };
}
