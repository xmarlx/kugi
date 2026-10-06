# LOWBATT — アパレルEC 仕組み一式

若者向けアパレルブランド「LOWBATT」の、企画・デザインから販売・発送までの仕組み。

- コンセプト：充電中につき、通知オフ。（SNS疲れ＝アテンション・デトックス）
- キャラクター：残り1%の電池にぶら下がって眠るコウモリ「ローバット」
- 販売方式：受注生産（在庫を持たない）。注文が入ってから Printful または Printify が1点ずつプリントして発送する（商品ごとに選べる）
- デザインの根拠：[docs/research.md](docs/research.md)

## 全体の流れ

```
企画・デザイン          商品登録             販売                 受注・製造・発送
designs/*.svg  ──▶  data/products.json ──▶  store/（静的サイト）──▶ Stripe 決済
                        │ npm run build         │ カート                │ webhook
                        ▼                       ▼                      ▼
                   モックアップ自動生成      worker /checkout      worker /webhook ──▶ Printful 発注
                   入稿PNG（npm run print）  （価格はサーバー側で再計算）              または Printify 発注
```

| 工程 | 人がやること | 自動で行われること |
|---|---|---|
| デザイン | `designs/` に SVG を置く（`{{INK}}`＝プリント色、`{{BG}}`＝生地色） | 全色×表裏のモックアップ生成 |
| 商品登録 | `data/products.json` に追記（`npm run new` で下書き作成） | 入力チェック（slug重複・価格・色・デザインの有無） |
| 入稿 | `npm run print` の PNG を Printful / Printify の商品に登録し、ID を `products.json` に書く | — |
| 公開 | `npm run build` → コミット → push | CI が生成物とテストを確認 |
| 決済 | — | Stripe Checkout（カード等）。送料は合計金額から自動計算 |
| 製造・発送 | 最初は下書き注文を確認して確定（Printful）／製造へ回す（Printify） | `PRINTFUL_CONFIRM=true` / `PRINTIFY_AUTO_PRODUCE=true` で自動 |
| 分析 | `npm run margin` で粗利、Stripe ダッシュボードで売上を見る | — |

## ディレクトリ

```
apparel/
  data/products.json   商品カタログ（唯一の正。価格・色・サイズ・プリント位置・発注ID）
  designs/*.svg        デザイン原稿
  lib/catalog.mjs      カタログ検証・カート計算（サイト・Worker・テストで共用）
  lib/mockup.mjs       モックアップ生成（ボクシーTee / ベビーT / ロンT / フーディー / ハーフジップ / 缶バッジ）
  scripts/build.mjs    store/ を生成
  scripts/export-print.mjs  入稿用PNG（背景透過）を print/ に出力
  scripts/new-product.mjs   新商品の下書きを追加
  scripts/margin.mjs        粗利表
  worker/index.mjs     決済 API（Cloudflare Workers）
  worker/fulfillment.mjs  Printful / Printify への発注
  docs/legal.html      特定商取引法の表記（【要入力】を埋める）
  docs/research.md     トレンド調査とデザインの根拠
  test/                テスト
store/                 生成された EC サイト（GitHub Pages でそのまま公開できる）
```

## コマンド（`apparel/` で実行）

| コマンド | 内容 |
|---|---|
| `npm run build` | `store/` を生成。未入力項目は警告として表示 |
| `npm test` | カタログ検証・価格計算・Stripe署名検証・Printful発注データ・モックアップ生成のテスト |
| `npm run check` | `store/` が最新か確認（CI用） |
| `npm run print [slug]` | 入稿用PNG。全面 3600px 幅、胸ワンポイント 1200px 幅（300dpi相当）。Playwright が必要 |
| `npm run new -- <slug> <type> "<名前>" <価格>` | 下書き商品とデザインのひな形を追加 |
| `npm run margin` | 価格・原価・決済手数料（既定3.6%）から粗利を表示 |

## 公開までの手順

1. **特定商取引法の表記**：`docs/legal.html` の【要入力】を埋める（通販では表示が義務）。
2. **発注先**：商品ごとに Printful か Printify を選び、各商品を作成して `npm run print` の PNG を登録する。原価を `cost` に入れる。`products.json` の書き方は下の「発注先の設定」。
3. **Stripe**：アカウントを作り、シークレットキーを取得する。
4. **Worker のデプロイ**（Cloudflare アカウントが必要）
   ```sh
   cd apparel/worker
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put PRINTFUL_API_KEY     # Printful を使う場合
   npx wrangler secret put PRINTIFY_API_TOKEN   # Printify を使う場合（wrangler.toml の PRINTIFY_SHOP_ID も設定）
   npx wrangler deploy
   ```
5. **Stripe の Webhook**：送信先を `https://<worker>/webhook`、イベントを `checkout.session.completed` にし、表示される署名シークレットを `STRIPE_WEBHOOK_SECRET` に登録する。
6. **サイト**：`products.json` の `shop.checkoutEndpoint` に Worker の URL、`shop.storeUrl` に公開URLを入れて `npm run build`。GitHub Pages を有効にすると `/<repo>/store/` で公開される。
7. **テスト注文**：Stripe のテストキーで注文し、Printful / Printify に注文ができることを確認する（自動確定・自動製造は空のままにしておく）。確認後に本番キーへ切り替える。

## 決済まわりの仕様

- カートはブラウザ内（localStorage）に保存。購入時に Worker へ `{slug, color, size, qty}` だけを送る。
- 価格・送料は Worker がカタログから計算し直す（ブラウザから送られた金額は使わない）。
- 注文内容は Stripe の metadata（`cart_0`, `cart_1`…）に入れ、webhook で取り出して Printful に送る。
- webhook は Stripe の署名（HMAC-SHA256、5分以内）を検証する。Printful への発注が失敗したら 500 を返し、Stripe が再送する。
- ID 未設定の商品は自動発注されず、Worker のログに出る（手動で発注する）。
- 1つの注文に Printful と Printify の商品が混ざると、それぞれに発注する。片方だけ失敗した場合も 500 を返して Stripe が再送するため、成功した側に同じ注文がもう一度送られる。重複した注文がどう扱われるかは未検証なので、最初は自動確定・自動製造を空にして、各管理画面で重複がないか確認してから確定する。
- 送料：`shippingFee`（600円）、`freeShippingThreshold`（8,000円）以上で無料。配送先は日本のみ。

## 発注先の設定（`products.json` の `fulfillment`）

Printful の場合：
```json
"fulfillment": { "provider": "printful", "variantIds": { "オフホワイト/M": 4011234567 } }
```
`variantIds` は色・サイズごとの **sync variant ID**（Printful で作った商品のバリエーションID）。

Printify の場合：
```json
"fulfillment": { "provider": "printify", "productId": "5bfd0b66a342bcc9b5563216", "variantIds": { "オフホワイト/M": 17887 } }
```
`productId` は Printify で作った商品のID、`variantIds` はその商品の色・サイズごとの variant ID。
発注は `POST /v1/shops/{PRINTIFY_SHOP_ID}/orders.json`、製造開始は `POST /v1/shops/{PRINTIFY_SHOP_ID}/orders/{id}/send_to_production.json`。
宛名の姓名は、Stripe で入力された氏名を空白で分け、先頭を姓、残りを名として送る。

Printify の製造業者（Print Provider）が日本に発送できるか、送料と日数は、Printify で商品を作るときに日本宛ての条件で確認する。
