// カート（ブラウザ内保存）と決済Workerへの受け渡し
(() => {
  const KEY = "lowbatt-cart";
  const root = (window.SHOP && window.SHOP.root) || "";
  const endpoint = window.SHOP && window.SHOP.endpoint;
  const yen = (n) => "¥" + n.toLocaleString("ja-JP");

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  };
  const save = (items) => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    updateCount(items);
  };
  const updateCount = (items) => {
    const n = items.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll("[data-cart-count]").forEach((el) => (el.textContent = n));
  };

  function initProduct(el) {
    const slug = el.dataset.slug;
    let color = 0;
    let size = (el.querySelector(".size.on") || {}).dataset?.size;
    const gallery = el.querySelector("[data-gallery]");
    const colorName = el.querySelector("[data-color-name]");
    el.querySelectorAll(".swatch").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === b));
        color = Number(b.dataset.color);
        gallery.replaceChildren(document.querySelector(`template[data-views="${color}"]`).content.cloneNode(true));
        colorName.textContent = b.dataset.name;
      }),
    );
    el.querySelectorAll(".size").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll(".size").forEach((x) => x.classList.toggle("on", x === b));
        size = b.dataset.size;
      }),
    );
    el.querySelector("[data-add]").addEventListener("click", () => {
      const items = load();
      const hit = items.find((i) => i.slug === slug && i.color === color && i.size === size);
      if (hit) hit.qty = Math.min(10, hit.qty + 1);
      else items.push({ slug, color, size, qty: 1 });
      save(items);
      el.querySelector("[data-added]").hidden = false;
    });
  }

  async function initCart(box) {
    const catalog = await fetch(root + "catalog.json").then((r) => r.json());
    const bySlug = Object.fromEntries(catalog.products.map((p) => [p.slug, p]));
    const render = () => {
      // 販売終了・不正な行は落とす
      const items = load().filter((i) => bySlug[i.slug] && bySlug[i.slug].status === "active" && bySlug[i.slug].colors[i.color] && bySlug[i.slug].sizes.includes(i.size) && Number.isInteger(i.qty) && i.qty > 0);
      save(items);
      if (!items.length) {
        box.innerHTML = '<p class="msg">カートは空です。<a href="' + root + 'index.html">商品を見る</a></p>';
        return;
      }
      const subtotal = items.reduce((s, i) => s + bySlug[i.slug].price * i.qty, 0);
      const ship = subtotal >= catalog.shop.freeShippingThreshold ? 0 : catalog.shop.shippingFee;
      box.innerHTML =
        '<ul class="lines">' +
        items
          .map((i, n) => {
            const p = bySlug[i.slug];
            return `<li class="line"><img src="${root + p.img[i.color]}" alt=""><div><b>${p.name}</b><br><small>${p.colors[i.color]} / ${i.size}</small>
<div class="qty"><button data-dec="${n}" aria-label="減らす">−</button><span>${i.qty}</span><button data-inc="${n}" aria-label="増やす">＋</button><button data-del="${n}" aria-label="削除">×</button></div></div>
<b class="lt">${yen(p.price * i.qty)}</b></li>`;
          })
          .join("") +
        `</ul><div class="totals"><div><span>小計</span><span>${yen(subtotal)}</span></div><div><span>送料</span><span>${ship ? yen(ship) : "無料"}</span></div>
<div class="sum"><span>合計（税込）</span><span>${yen(subtotal + ship)}</span></div>
${ship ? `<p class="msg">あと${yen(catalog.shop.freeShippingThreshold - subtotal)}で送料無料</p>` : ""}
<button class="checkout" data-checkout ${endpoint ? "" : "disabled"}>${endpoint ? "購入手続きへ" : "決済準備中"}</button><p class="msg" data-err></p></div>`;
      const mutate = (n, f) => { const it = load(); f(it, n); save(it.filter((x) => x.qty > 0)); render(); };
      box.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => mutate(+b.dataset.inc, (it, n) => (it[n].qty = Math.min(10, it[n].qty + 1)))));
      box.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => mutate(+b.dataset.dec, (it, n) => (it[n].qty -= 1))));
      box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => mutate(+b.dataset.del, (it, n) => (it[n].qty = 0))));
      const btn = box.querySelector("[data-checkout]");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "決済画面へ移動中…";
        try {
          const res = await fetch(endpoint.replace(/\/$/, "") + "/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ items: load() }),
          });
          const data = await res.json();
          if (!res.ok || !data.url) throw new Error(data.error || "決済を開始できませんでした");
          location.href = data.url;
        } catch (e) {
          box.querySelector("[data-err]").textContent = e.message;
          btn.disabled = false;
          btn.textContent = "購入手続きへ";
        }
      });
    };
    render();
  }

  updateCount(load());
  document.querySelectorAll(".product[data-slug]").forEach(initProduct);
  const box = document.querySelector("[data-cart]");
  if (box) initCart(box);
})();
