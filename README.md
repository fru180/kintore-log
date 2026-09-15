# 筋トレログ

スマートフォンで素早く記録できる筋トレ記録アプリです。

## 主な機能

- アカウント登録・ログイン（複数ユーザー対応）
- 筋トレ、有酸素運動、体重の日別記録・更新・削除
- 端末ごとの前回入力値の保存
- カレンダー形式の履歴
- 種目別重量／距離と体重の推移グラフ
- 任意の通知間隔を指定できるタイマーモーダル
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

## 確認コマンド

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

コミット時には Husky と lint-staged により、ステージ済みのファイルへESLintとPrettierが自動実行されます。
