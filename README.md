# 筋トレログ

スマートフォンで素早く記録できる筋トレ記録アプリです。

## 主な機能

- アカウント登録・ログイン（複数ユーザー対応）
- 筋トレ、有酸素運動、体重の日別記録・更新・削除
- 当日に鍛えた筋肉を確認できる360度回転・拡大縮小対応の精密な3D解剖モデル
- 端末ごとの前回入力値の保存
- 筋力種目ごとの重量アップ候補マーク
- カレンダー形式の履歴
- 種目別重量／距離と体重の推移グラフ
- 3分・10分・無制限から選べ、1分ごとに音が鳴るカウントアップタイマー
- 管理者による種目の追加・編集・削除・並び替え

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
- 体重：`GET /api/v1/body-weights?from=2026-09-01&to=2026-11-03`（期間内の全件。最大366日）
- 種目別の推移：`GET /api/v1/stats?exerciseId=1&from=2026-09-01&to=2026-11-03`

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
