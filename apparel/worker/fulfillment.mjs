// 製造・発送の発注先（Printful / Printify）
// 商品ごとに products.json の fulfillment.provider で発注先を選ぶ。
import { cartFromMetadata, variantKey } from "../lib/catalog.mjs";

export const PROVIDERS = ["printful", "printify"];
const PRINTFUL_API = "https://api.printful.com";
const PRINTIFY_API = "https://api.printify.com/v1";

function shippingOf(session) {
  const ship = session.collected_information?.shipping_details || session.shipping_details || {};
  return {
    name: ship.name || session.customer_details?.name || "",
    address: ship.address || {},
    phone: session.customer_details?.phone || "",
    email: session.customer_details?.email || "",
  };
}

// 注文の各行を発注先ごとに振り分ける。ID 未設定の行は unmapped（手動発注）
export function splitByProvider(session, catalog) {
  const byProvider = {};
  const unmapped = [];
  for (const it of cartFromMetadata(session.metadata)) {
    const p = (catalog.products || []).find((x) => x.slug === it.slug);
    const color = p?.colors[it.color];
    const f = p?.fulfillment || {};
    const variantId = color && f.variantIds?.[variantKey(color.name, it.size)];
    const ready = variantId && PROVIDERS.includes(f.provider) && (f.provider !== "printify" || f.productId);
    if (!ready) {
      unmapped.push(`${it.slug}:${it.color}:${it.size}`);
      continue;
    }
    (byProvider[f.provider] ||= []).push({ productId: f.productId, variantId, qty: it.qty });
  }
  return { byProvider, unmapped };
}

// 同じ注文の二重発注を防ぐための注文ID（Printful の external_id は32文字まで）
const externalId = (session) => session.id.slice(-32);

export function buildPrintfulOrder(session, lines) {
  const s = shippingOf(session);
  return {
    external_id: externalId(session),
    recipient: {
      name: s.name,
      address1: s.address.line1 || "",
      address2: s.address.line2 || "",
      city: s.address.city || "",
      state_name: s.address.state || "",
      country_code: s.address.country || "JP",
      zip: s.address.postal_code || "",
      phone: s.phone,
      email: s.email,
    },
    items: lines.map((l) => ({ sync_variant_id: l.variantId, quantity: l.qty })),
  };
}

// 日本の氏名は「姓 名」の順で入力される前提で分ける
export function splitJapaneseName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { last_name: parts[0] || "", first_name: "" };
  return { last_name: parts[0], first_name: parts.slice(1).join(" ") };
}

export function buildPrintifyOrder(session, lines) {
  const s = shippingOf(session);
  return {
    external_id: externalId(session),
    label: externalId(session).slice(-12),
    line_items: lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.qty })),
    shipping_method: 1,
    send_shipping_notification: true,
    address_to: {
      ...splitJapaneseName(s.name),
      email: s.email,
      phone: s.phone,
      country: s.address.country || "JP",
      region: s.address.state || "",
      address1: s.address.line1 || "",
      address2: s.address.line2 || "",
      city: s.address.city || "",
      zip: s.address.postal_code || "",
    },
  };
}

async function failIfNotOk(res, label) {
  if (res.ok) return res;
  throw new Error(`${label}: ${res.status} ${await res.text()}`);
}

// PRINTFUL_CONFIRM="true" で即確定。それ以外は下書き
export async function submitPrintful(env, order, fetchImpl = fetch) {
  const confirm = env.PRINTFUL_CONFIRM === "true" ? "?confirm=true" : "";
  await failIfNotOk(
    await fetchImpl(`${PRINTFUL_API}/orders${confirm}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.PRINTFUL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(order),
    }),
    "Printful 発注失敗",
  );
}

// PRINTIFY_AUTO_PRODUCE="true" で作成後すぐ製造へ。それ以外は Printify 管理画面で確認してから製造へ回す
export async function submitPrintify(env, order, fetchImpl = fetch) {
  const headers = {
    authorization: `Bearer ${env.PRINTIFY_API_TOKEN}`,
    "content-type": "application/json",
    "user-agent": "lowbatt-checkout",
  };
  const base = `${PRINTIFY_API}/shops/${env.PRINTIFY_SHOP_ID}/orders`;
  const res = await failIfNotOk(await fetchImpl(`${base}.json`, { method: "POST", headers, body: JSON.stringify(order) }), "Printify 発注失敗");
  const { id } = await res.json();
  if (env.PRINTIFY_AUTO_PRODUCE === "true") {
    await failIfNotOk(await fetchImpl(`${base}/${id}/send_to_production.json`, { method: "POST", headers }), `Printify 製造開始失敗（注文 ${id}）`);
  }
  return id;
}

const SUBMIT = {
  printful: (env, session, lines, f) => submitPrintful(env, buildPrintfulOrder(session, lines), f),
  printify: (env, session, lines, f) => submitPrintify(env, buildPrintifyOrder(session, lines), f),
};

// 発注先ごとに送信する。1つでも失敗したら例外（Worker が 500 を返し、Stripe が再送する）
export async function fulfill(env, session, catalog, fetchImpl = fetch) {
  const { byProvider, unmapped } = splitByProvider(session, catalog);
  if (unmapped.length) console.warn(`発注IDが未設定のため自動発注から除外: ${unmapped.join(", ")}（注文 ${session.id}）。手動で発注してください`);
  const errors = [];
  for (const [provider, lines] of Object.entries(byProvider)) {
    try {
      await SUBMIT[provider](env, session, lines, fetchImpl);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) throw new Error(errors.join(" / "));
  return { providers: Object.keys(byProvider), unmapped };
}
