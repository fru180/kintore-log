# 筋トレログ

スマートフォンで素早く記録できる筋トレ記録アプリです。

## 主な機能

- アカウント登録・ログイン（複数ユーザー対応）
- 「筋トレ」「体組成」「推移」の3タブ
- 筋トレ、有酸素運動、体組成の日別記録・更新・削除
- 当日に鍛えた筋肉を確認できる360度回転・拡大縮小対応の精密な3D解剖モデル
- 端末ごとの前回入力値の保存
- 筋力種目ごとの重量アップ候補マーク
- カレンダー形式の履歴
- 種目別重量／距離と、項目を選択できる体組成の推移グラフ（直近90日）
- 3分・10分・無制限から選べ、1分ごとに音が鳴るカウントアップタイマー
- 管理者による種目の追加・編集・削除・並び替え

体組成は体重（kg）、身長（cm）、体脂肪率（%）、筋肉量（kg）、内臓脂肪レベル、基礎代謝量（kcal/日）を項目ごとに保存できます。選択日に未記録の項目は、全期間の最新保存値を初期表示します（履歴がなければ空欄）。表示のみでは保存されず、記録ボタンで確定します。BMIは入力できず、体重または身長を記録した日に、その日以前の最新値から自動計算します。両方の値がそろう前は表示せず、過去記録の修正・削除も計算に反映します。

## ローカル開発

Node.js 22 以上を使用します。

```bash
npm install
npx wrangler d1 migrations apply kintore-log --local
```

API と画面を別々のターミナルで起動します。

```bash
npm run dev:worker
npm run dev
```

`npm run dev:worker` の起動時には、ローカルD1へのマイグレーション適用とテストアカウントの登録も自動で行われます。

- アカウント名: `test`
- パスワード: `test1234`

このアカウントは `--local` のD1にのみ登録され、本番データベースには追加されません。

画面は `http://127.0.0.1:5173` です。

## Cloudflare の初期設定

1. D1 データベースを作成します。

   ```bash
   npx wrangler d1 create kintore-log
   ```

2. 表示された `database_id` を `wrangler.jsonc` の同名項目へ設定します。
3. 初回 migration を適用します。

   ```bash
   npx wrangler d1 migrations apply kintore-log --remote
   ```

4. Cloudflare Dashboard の Workers & Pages からGitHubリポジトリを接続し、`main` ブランチをデプロイ対象に設定します。

GitHub Actionsは型チェック・Lint・フォーマット・テスト・ビルドを実行します。本番デプロイは、既存プロジェクトと同様にCloudflare側のGit連携から実行します。

## 管理者への昇格

ユーザーが画面からアカウントを登録した後、対象のアカウント名を指定して D1 を直接更新します。

```bash
npx wrangler d1 execute kintore-log --remote --command "UPDATE users SET is_admin = 1 WHERE account_name = 'ACCOUNT_NAME'"
```

昇格後は一度ログアウトし、再度ログインしてください。

## 外部アプリとの連携

OAuth 2.0 Authorization Code + PKCEによる読み取り専用APIを提供します。管理者は「管理者設定」で連携クライアントを登録・無効化・削除でき、各ユーザーは「外部連携」で連携中のアプリの確認・解除ができます。APIはトークンの本人の記録だけを返します。

1. 「設定 → 管理者設定 → OAuthクライアント管理」で、連携先の名前・HTTPSのRedirect URL・シークレットの有無を登録します。
2. 発行されたClient IDと以下の接続情報を連携先アプリに設定します。シークレットありの場合は、登録直後に一度だけ表示される値も保存します。
3. 連携先アプリから認可を開始し、筋トレログにログインして読み取りを許可します。解除は「設定 → 外部連携」から行えます。

| 設定        | 値                                                                       |
| ----------- | ------------------------------------------------------------------------ |
| Issuer      | `https://curiosk.com/kintore-log`                                        |
| メタデータ  | `https://curiosk.com/.well-known/oauth-authorization-server/kintore-log` |
| 認可URL     | `https://curiosk.com/kintore-log/oauth/authorize`                        |
| トークンURL | `https://curiosk.com/kintore-log/oauth/token`                            |
| スコープ    | `workouts:read`                                                          |
| 方式        | Authorization Code + PKCE（S256必須）                                    |

取得例：

- 1日分：`GET /api/v1/records?date=2026-11-03`
- 日別の期間取得：`GET /api/v1/records?from=2026-11-01&to=2026-11-03`
- 体組成1日分：`GET /api/v1/body-composition?date=2026-11-03`
- 体組成の日別期間取得：`GET /api/v1/body-composition?from=2026-11-01&to=2026-11-03`
- 体組成全項目の推移：`GET /api/v1/body-composition/stats?from=2026-09-01&to=2026-11-03`
- 筋トレ・有酸素の種目別推移：`GET /api/v1/stats?exerciseId=1&from=2026-09-01&to=2026-11-03`

体組成は `weightKg`、`heightCm`、`bmi`、`bodyFatPercent`、`muscleMassKg`、`visceralFatLevel`、`basalMetabolismKcal` の7項目をまとめて返します。日別取得は `{date, bodyComposition: {全7項目}}`、期間取得は `{from, to, days: [日別データ]}` で、未記録日も含み、未記録項目は `null` です。推移は `{bodyComposition: [{date, 全7項目}]}` で、記録日のみを返します。期間は両端を含め最大366日、日付昇順、ページングなしです。

BMIは体重または身長の記録日に、その日以前の最新保存値から計算します。期間開始前の記録も参照し、両方がそろわない場合は `null`。未保存の入力初期値は外部APIに含めません。

外部APIの変更点：旧 `/api/v1/body-weights` は廃止しました（404）。`/api/v1/stats` は `{exercise: [...]}` のみを返し、`bodyWeights` は返しません。体組成の取得は上記の専用APIに移行してください。スコープは引き続き `workouts:read` です。

取得項目とAPIの形式は [OpenAPI定義](docs/external-api.openapi.json) を参照してください。

## 確認コマンド

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

コミット時には Husky と lint-staged により、ステージ済みのファイルへESLintとPrettierが自動実行されます。

## 3D人体モデル

「鍛えた部位」には、[Z-Anatomy](https://www.z-anatomy.com/) / BodyParts3Dを基に
[hpfrei/body-anatomy-3d-viewer](https://github.com/hpfrei/body-anatomy-3d-viewer)でWeb向けに最適化されたモデルを使用しています。
主要な筋肉をタップまたはクリックすると、筋肉名と対応する登録種目を確認できます。
モデルは[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)で提供されています。
