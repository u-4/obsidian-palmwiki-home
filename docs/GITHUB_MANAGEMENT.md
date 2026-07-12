# GitHub管理方針

## 基本方針

- 安定版は`main`、開発は`codex/*`ブランチで管理する。
- `main`への変更はPull Request経由にし、CIの`ci-validate`成功を必須にする。
- 強制Pushと`main`の削除を許可しない。
- Pull RequestはSquash mergeを基本とし、merge後は作業ブランチを削除する。
- SemVer形式のReleaseタグ（例：`0.2.1`）は削除・強制更新しない。

## CIとRelease

- CIは`npm audit`、build、公式Obsidian ESLint、自動テスト、metadata検証、差分検査を実行する。
- GitHub Actionsの権限は読み取りを基本とし、Release作成ジョブだけが検証済み3成果物を書き込む。
- ActionsはコミットSHAで固定する。
- Release workflowはタグが`main`を指すことを確認してから下書きを作る。

## 脆弱性対応

- Dependabot alertsとsecurity updatesを有効にする。
- Secret scanningとPush protectionを有効にする。
- `SECURITY.md`とGitHubの非公開脆弱性報告を窓口にする。
- 秘密情報が見つかった場合は、公開履歴を書き換える前に資格情報を無効化し、影響を確認する。

## 定期確認

- 週次：DependabotのPull Requestとセキュリティ通知を確認する。
- Release前：`npm run check`、`npm run verify:release`、タグと成果物のSHA-256を確認する。
- 四半期：main保護、Actions権限、Release添付物、テストVault復旧手順を見直す。
