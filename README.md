# 傾斜計修理 引継ぎツール（my-tool）

傾斜計の修理を「①初期診断 → ②部品手配 → ③修理作業 → ④動作確認」の4工程で進め、途中で作業者が交代しても続きから作業できるようにするツールです。Cloudflare Workers と D1 で動きます。ビルド工程はありません。

## 構成

| パス | 内容 |
| --- | --- |
| `public/index.html`, `public/style.css`, `public/app.js` | 画面（S-01 案件一覧〜S-06 動作確認） |
| `public/logic.js` | 切り分けガイド・角度判定・完了ロックなどの判定ロジック |
| `public/config.js` | 機種・部品・手順・許容誤差などの設定値（`[ ]` は仮の値） |
| `src/index.js` | API（`/api/cases`）。D1 に案件を保存する |
| `schema.sql` | 案件テーブルの作成 SQL |
| `test/logic.test.js` | 判定ロジックのテスト（テスト仕様書の境界値など） |

## 初回の準備

```bash
npm install
npm run db:init:local    # ローカルの D1 にテーブルを作る
npm run db:init:remote   # 本番の D1 にテーブルを作る
```

## 開発・テスト・デプロイ

```bash
npm run dev      # http://localhost:8787
npm test
npm run deploy
```

## 設定値を変えるとき

`public/config.js` を編集します。許容誤差（`TOLERANCE`）を変えたら、`test/logic.test.js` の境界値も合わせて直してください。
