import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { validateCatalog, resolveCart, cartTotals, cartToMetadata, cartFromMetadata } from "../lib/catalog.mjs";
import { buildCheckoutParams, verifyStripeSignature, buildPrintfulOrder } from "../worker/index.mjs";

const catalog = JSON.parse(readFileSync(new URL("../data/products.json", import.meta.url), "utf8"));
const designExists = (d) => existsSync(new URL(`../designs/${d}.svg`, import.meta.url));

test("カタログにエラーがない", () => {
  assert.deepEqual(validateCatalog(catalog, { designExists }).errors, []);
});

test("不正なカタログを検出する", () => {
  const bad = structuredClone(catalog);
  bad.products[1].slug = bad.products[0].slug;
  bad.products[0].price = -1;
  bad.products[0].type = "dress";
  bad.products[2].prints.push({ side: "back", design: "nope", area: "full" });
  const { errors } = validateCatalog(bad, { designExists });
  assert.ok(errors.some((e) => e.includes("重複")));
  assert.ok(errors.some((e) => e.includes("price")));
  assert.ok(errors.some((e) => e.includes("type")));
  assert.ok(errors.some((e) => e.includes("nope.svg")));
  assert.ok(errors.some((e) => e.includes("重複")));
});

test("価格はカタログから計算し、送料無料ラインを適用する", () => {
  const lines = resolveCart(catalog, [{ slug: "lowbatt-bat-tee", color: 0, size: "M", qty: 1, price: 1 }]);
  assert.equal(lines[0].unitPrice, 4400);
  assert.deepEqual(cartTotals(catalog.shop, lines), { subtotal: 4400, shipping: 600, total: 5000 });
  const big = resolveCart(catalog, [{ slug: "lowbatt-college-hoodie", color: 1, size: "L", qty: 2 }]);
  assert.deepEqual(cartTotals(catalog.shop, big), { subtotal: 17600, shipping: 0, total: 17600 });
});

test("不正なカート行を拒否する", () => {
  assert.throws(() => resolveCart(catalog, []), /空/);
  assert.throws(() => resolveCart(catalog, [{ slug: "nope", color: 0, size: "M", qty: 1 }]), /販売していない/);
  assert.throws(() => resolveCart(catalog, [{ slug: "kengai-tee", color: 9, size: "M", qty: 1 }]), /カラー/);
  assert.throws(() => resolveCart(catalog, [{ slug: "kengai-tee", color: 0, size: "XXXL", qty: 1 }]), /サイズ/);
  assert.throws(() => resolveCart(catalog, [{ slug: "kengai-tee", color: 0, size: "M", qty: 0 }]), /数量/);
  assert.throws(() => resolveCart(catalog, [{ slug: "kengai-tee", color: 0, size: "M", qty: 1.5 }]), /数量/);
});

test("カートは metadata に分割保存でき、往復で一致する", () => {
  const items = catalog.products.flatMap((p) => p.sizes.map((size) => ({ slug: p.slug, color: 0, size, qty: 10 }))).slice(0, 20);
  const meta = cartToMetadata(resolveCart(catalog, items));
  assert.ok(Object.values(meta).every((v) => v.length <= 500));
  assert.deepEqual(cartFromMetadata(meta), items);
});

test("Stripe Checkout のパラメータ", () => {
  const lines = resolveCart(catalog, [{ slug: "teiden-quarter-zip", color: 0, size: "S", qty: 1 }]);
  const p = buildCheckoutParams(lines, catalog.shop, "https://shop.example/store/");
  assert.equal(p.get("line_items[0][price_data][unit_amount]"), "7900");
  assert.equal(p.get("line_items[0][price_data][currency]"), "jpy");
  assert.equal(p.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "600");
  assert.equal(p.get("success_url"), "https://shop.example/store/success.html?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(p.get("metadata[cart_0]"), "teiden-quarter-zip:0:S:1");
});

test("Stripe 署名検証", async () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t), true);
  assert.equal(await verifyStripeSignature(payload + " ", `t=${t},v1=${sig}`, secret, 300, t), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, "wrong", 300, t), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t + 301), false);
  assert.equal(await verifyStripeSignature(payload, "", secret, 300, t), false);
});

test("Printful 発注データ（variantIds 設定済みの行だけ発注）", () => {
  const cat = structuredClone(catalog);
  cat.products[0].fulfillment.variantIds["オフホワイト/M"] = 123456;
  const session = {
    id: "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8",
    metadata: { cart_0: "lowbatt-bat-tee:0:M:2,kengai-tee:1:L:1" },
    customer_details: { email: "buyer@example.com", phone: "+819012345678", name: "山田 太郎" },
    collected_information: { shipping_details: { name: "山田 太郎", address: { line1: "千代田1-1", line2: "", city: "千代田区", state: "東京都", postal_code: "100-0001", country: "JP" } } },
  };
  const order = buildPrintfulOrder(session, cat);
  assert.deepEqual(order.items, [{ sync_variant_id: 123456, quantity: 2 }]);
  assert.equal(order.recipient.zip, "100-0001");
  assert.equal(order.recipient.state_name, "東京都");
  assert.ok(order.external_id.length <= 32);
});

test("全商品・全色・全面のモックアップを生成できる", async () => {
  const { renderMockup } = await import("../lib/mockup.mjs");
  const designs = {};
  for (const p of catalog.products) for (const pr of p.prints) designs[pr.design] = readFileSync(new URL(`../designs/${pr.design}.svg`, import.meta.url), "utf8");
  for (const p of catalog.products)
    p.colors.forEach((color, i) => {
      for (const pr of p.prints) {
        const svg = renderMockup({ type: p.type, side: pr.side, color, prints: p.prints, designs, finish: p.finish, idPrefix: `${p.slug}-${i}` });
        assert.ok(!svg.includes("{{"), `${p.slug}: 置換されていないプレースホルダ`);
        assert.ok(svg.includes(color.ink), `${p.slug}: インク色が入っていない`);
      }
    });
});
