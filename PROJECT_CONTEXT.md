# プロジェクトコンテキスト

## 目的

PalmWiki Homeは、現在のObsidian VaultをCosense / Scrapbox風に閲覧するための独立したコミュニティプラグインです。`2hop-links-plus`とは別リポジトリで管理し、実行時依存も持たせません。

## 現在の管理状態

- GitHubリポジトリは`u-4/obsidian-palmwiki-home`です。
- リポジトリは2026-07-12にPublicへ変更しました。最新版は[0.3.1 Release](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.3.1)で、0.3.0、0.2.1、0.2.0、0.1.0も履歴として公開済みです。
- Obsidianコミュニティプラグインへの申請はまだ行っていません。
- 本文検索は0.3.0、ItemViewからMarkdownへの互換性小修正は0.3.1として公開済みです。通常Markdownへ検索欄とVault相対パスを追加する変更は、0.4.0 Release候補として準備しています。
- 0.4.0もObsidian Desktop 1.12.7以上を対象とし、モバイル対応は次の段階で検証します。
- 安定版の基準は`main`、開発作業は焦点を絞った`codex/*`ブランチを使用します。
- 生成済み`main.js`はGit管理せず、Releaseには`main.js`、`manifest.json`、`styles.css`だけを添付します。タグからは自動公開せず、検証後に下書きReleaseを作ります。

## 実装済みの範囲

- カード・テーブル表示、各種並べ替え、ピン留め
- include / excludeフォルダー設定と基本フィルター
- 大規模Vault向けの仮想化、レイアウト準備後のアイドル索引、永続キャッシュ
- 保存済み索引の先行表示と、Waiting / Indexing / Complete / Update failed状態表示
- 解決済みMarkdownリンクを利用したリンク数、被リンク数、PageRank風スコア
- PageRankのhub抑制、除外元設定、動作計測ログ
- 通常MarkdownタブとPalmWiki HomeタブをPalmWiki Home単独で管理する左上Homeボタン
- Markdownで選べるHome表示・既存ページ表示・Obsidianコマンド実行と、Home内の最上部移動
- PalmWiki HomeのCard、Table、最近のページ、ページ候補、検索結果からクリック元の同じタブへMarkdownページを開く経路
- Cardで選べる無効・Cmd/Ctrl＋hover・hoverのみのObsidian標準ページプレビュー
- 通常Markdownごとに所有する中央検索欄、Homeボタン直後の小さなcanonical path、検索欄設置成功時だけの中央ノートタイトル非表示（0.4.0 Release候補）
- Markdown検索欄からの最近・曖昧ページ候補と、検索を開始した同じleafをPalmWiki Home本文検索へ切り替える経路（0.4.0 Release候補）

## ItemViewからMarkdownへの互換性調査（2026-07-13）

- PalmWiki HomeのCardや検索結果からMarkdownへ移った直後だけ2Hop Links Plusの本文内表示が出ず、次のMarkdown移動または戻る・進むで表示される現象を再現しました。
- PalmWiki Home表示中にObsidian標準のファイルエクスプローラから開いても同じ現象が起きたため、PalmWiki Home独自のクリック処理ではなく、custom viewから新しいMarkdown viewへ切り替わる時点のDOM準備競合と確認しました。
- PalmWiki Homeは既存ファイルを公開APIの`WorkspaceLeaf.openFile()`で開く設計を維持します。workspaceイベントの二重発火、固定待機後の再オープン、2Hop Links Plusのimport・設定・DOM参照は追加しません。
- TableをCard・候補・検索結果と同じ所有leafおよび失敗時復元経路へ統一し、Card previewの所有者をworkspace leafから`PalmWikiHomeView`へ移しました。view終了時には残っているpreviewを明示的に解除します。
- 根本対策は、隣接する2Hop Links Plus側で現在のMarkdown表示モードに対応する注入先DOMが現れるまで、要素のowner documentに属するanimation frameを有限回だけ待つ一般的な互換処理として実装しました。対象leafがMarkdown以外へ戻った場合、別ファイルへ移った場合、inline表示が無効になった場合などは待機を中止します。PalmWiki Home固有の依存やイベント再発火は含みません。
- PalmWiki Homeの`npm run check`は113件、2Hop候補の自動テストは15件で成功しました。両候補は既存インストールをVault外へバックアップした上で`PalmWiki_LocalTest`へ3成果物だけ配置し、Obsidian 1.12.7でCard、Table、最近のページ、ページ名候補、本文検索結果、標準ファイルエクスプローラ、標準検索、Live Preview、Source mode、Reading view、Back / Forward、Home復帰後の清掃、連続するノート切替を実機確認しました。P1修正後はcurrent modeの準備待ちと全mode hostの注入・清掃を分離し、Live / Reading / Source往復、別ノートのhidden表示上書き、separate pane有効時の両方向清掃、plugin disable中の5秒待機と再有効化も再確認しました。複数splitとpop-outだけはこの最終候補で未再確認です。

## 0.3.1公開結果

- PR [#15](https://github.com/u-4/obsidian-palmwiki-home/pull/15)をマージし、タグ`0.3.1`と`main`はコミット`9a1a40c`を指しています。
- [Release workflow](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29245936423)が成功し、[PalmWiki Home 0.3.1](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.3.1)を公開しました。
- 公開Releaseには`main.js`、`manifest.json`、`styles.css`の3点だけがあり、GitHub上のDigest、公開URLから再取得したファイル、ローカルbuild、`PalmWiki_LocalTest`配置物のSHA-256が一致しました。
- SHA-256は`main.js`が`3c3be397fba13ccc9f369b213f753949927d8b63934882671dcc57717d896f16`、`manifest.json`が`7baffd8c734e7f89767a162c6bf4c5eacf721e0ff367d1b83d99d6a4bf057b6a`、`styles.css`が`939d092d5011d5441c37f150535962b5ff348dd876125b0ee1524d265f2fa799`です。

## 0.2.0実装・公開結果

- 左上Homeボタン所有機能とCard同一タブ遷移を0.2.0として公開しました。
- 2Hop Links Plusのコード、設定、DOM、実行時データには依存せず、PalmWiki Home固有のclassとmanagerだけを使用します。
- production build、公式Obsidian ESLint、50件の自動テスト、metadata検証、差分空白検査は成功済みです。
- 検証済みの機能更新は、利用者指定の`PalmWiki_LocalTest`へ再確認なしで配置する運用です。別のVaultへ配置する場合は改めて確認します。
- PR [#7](https://github.com/u-4/obsidian-palmwiki-home/pull/7)をCI成功後にsquash mergeし、タグ`0.2.0`はmainコミット`62e7876`を指しています。
- [Release workflow](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191216958)で依存監査、build、lint、50テスト、厳格なRelease検証、3成果物の下書き作成がすべて成功しました。
- 公開URLから3成果物を再取得し、ローカルbuild・GitHub Digest・テストVault配布物とSHA-256が一致しました。
- SHA-256は`main.js`が`c825710c…88b3`、`manifest.json`が`13354511…aefd`、`styles.css`が`23bfeced…8c90`です。

## 0.2.1実装・公開結果

- 複数splitと非アクティブleaf、Card/Tableの同一leaf遷移と最上部移動、ポップアウト、プラグイン再起動時の清掃、Obsidian完全再起動直後の復元leafを`PalmWiki_LocalTest`で確認しました。
- Hover Editor本体にはHomeボタンを追加しない一方、Hover Editorが通常Markdown leafへ一時的なpopover情報を付けると、その通常leafのHomeボタンまで消える不具合を再現しました。
- 除外判定を実際のHover Editor / Hover Preview / popover DOM内に限定し、通常leafに付く一時情報だけでは除外しない修正を`codex/fix-hover-home-navigation`で実装しました。Hover Editorの開閉後も通常leafのボタンが残ることを実機確認済みです。
- reduced motionは`ownerDocument.defaultView.matchMedia()`を使う自動テスト、Hover Previewは実popover DOMを使う再発防止テストで確認しました。ポインターを静止させるHover Previewの実UI操作だけは自動Computer Useの対象外です。
- `npm run check`は51件の自動テストを含めて成功し、修正版3成果物をバックアップ後に`PalmWiki_LocalTest`へ配置しました。未リリース`main.js`のSHA-256は`215f6f12…e852`です。
- Card previewを3段階で選ぶ機能を実装しました。`Hover`での実プレビュー、`Off`、修飾キーなしの`Cmd/Ctrl + hover`、Pin非干渉、Card同一タブクリックを`PalmWiki_LocalTest`で確認し、Obsidian標準設定への修飾キー対象登録も確認済みです。
- Card preview追加後の`npm run check`は56件の自動テストを含めて成功しました。設定変更は索引キャッシュを無効化せず、2Hop Links Plusへの依存も追加していません。
- 最終ビルドを`PalmWiki_LocalTest`へ配置し、`main.js`のSHA-256 `aa9ba96b…fd45`がローカル成果物と一致しました。再起動後は保存済み索引から`Complete`へ復帰しています。
- PR [#9](https://github.com/u-4/obsidian-palmwiki-home/pull/9)をCI成功後にsquash mergeし、タグ`0.2.1`はmainコミット`a27bc67`を指しています。
- [Release workflow](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29194603482)で依存監査、build、lint、56テスト、厳格なRelease検証、3成果物の下書き作成が成功し、[0.2.1 Release](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.2.1)を公開しました。
- 公開成果物のSHA-256は`main.js`が`aa9ba96b…fd45`、`manifest.json`が`ea12c27f…f831`、`styles.css`が`23bfeced…8c90`です。

## GitHub管理強化（2026-07-12）

- PublicリポジトリのGit履歴と追跡ファイルを監査し、主要なGitHub token、クラウドキー、秘密鍵形式に該当するファイルは見つかりませんでした。今後も公開履歴へVaultデータや認証情報を追加しない運用を続けます。
- `main`にPull Request必須、`ci-validate`必須、会話解決必須、Linear history、管理者にも適用、強制Push・ブランチ削除禁止の保護を設定しました。承認件数は単独管理で運用不能にならないよう0件です。
- マージ方法はSquashのみ、マージ後の作業ブランチは自動削除にしました。ActionsのCIジョブ名を`ci-validate`、Releaseジョブ名を`release-validate`へ分け、必須チェックの曖昧さを避けました。
- Dependabot alerts / security updates、Secret scanning、Push protection、GitHubの非公開脆弱性報告を有効化しました。Actionsの権限は従来どおり読み取り中心で、既存ActionはコミットSHA固定を維持しています。
- `SECURITY.md`、`CONTRIBUTING.md`、Dependabot設定、Issueテンプレート、[GitHub管理方針](docs/GITHUB_MANAGEMENT.md)を追加しました。
- GCMはユーザー設定のcredential helperとして既に有効でした。`manager-core`を指定した`git ls-remote`でこのリポジトリへのGitHub認証を確認したため、リポジトリ固有の重複設定は追加していません。

## 本文検索（0.3.0公開済み）

- Homeヘッダー中央へ検索欄を追加し、空欄フォーカス時の最近開いたページ、ページ名・ファイル名・別名の曖昧候補、`PalmWiki Home: Focus search`コマンドを実装しています。ショートカットキーはObsidian標準のホットキー設定から割り当てます。
- 候補未選択のEnterで専用検索結果へ移り、空白AND、引用符フレーズ、マイナス除外、本文・ページ名・タグ・パス、直接リンク、最大2-hop、PageRank風スコアを組み合わせます。Pinは同点時だけの補助です。
- include / exclude、folder、tag、Quick filter、`Links to page`は維持し、本文検索結果にも適用します。
- `search-cache.json`を表示用`index-cache.json`から分離しました。Home表示後のアイドル時に遅延作成し、変更ファイルだけを同時2件まで再読込します。範囲変更時は旧全文キャッシュを削除し、破損・64 MiB超過時は安全に再構築します。
- 公開前レビューに基づき、検索文は最大256文字・正負合計8語とし、1ファイル8 MiB・対象原文合計64 MiB・推定RAM 128 MiBを超える全文索引は部分公開せず停止します。永続キャッシュはentry単位で容量を先に数え、全体と同サイズのbyte配列を追加生成せず、互換文字の正規化膨張も保持前に上限判定します。
- 密なリンク構造による画面停止を避けるため、1語あたり直接リンク20,000辺、2-hop 50,000辺で決定的に打ち切ります。上限到達は個人パスや検索語を含めず性能診断へ記録します。
- Quick filterは計算済み全文結果だけを絞り込み、全文検索を再実行しません。Back時のscrollは非同期結果描画後まで保持し、作成確認中に元Home leafまたは状態が変わった場合は作成・移動を中止します。
- 検索結果は同じHome leafで開き、現在の原文を再読込して同じ行に最も多く検索語がある位置を選びます。Source modeでは選択・スクロール、Reading viewでは行へのbest-effort移動です。
- Obsidian標準の`button`固定高が複数行の検索結果を30pxへ潰す問題を修正しました。検索結果は見出し1行、パス1行、原文ハイライト約2行、理由badgeの独立した行として表示し、Pinは絶対配置ではなく隣接列へ置きます。
- 検索語と同名の既存ページがVault全体にない場合だけ作成候補を出し、Obsidianの新規ノート保存先と安全なファイル名を確認してから空のMarkdownを作ります。Enterだけでは作成しません。
- Back / Forwardでは検索語、フィルター、表示状態、スクロール位置を復元し、左上Homeボタンでは復元しません。結果表示は100件から最大500件までとし、広すぎる検索は絞り込みを求めます。
- OCR、添付本文、複数Vault、AI意味検索、同義語展開は対象外です。`2hop-links-plus`のコード・DOM・データは読まず、既存のMIT noticeと実行時独立性を維持します。
- `PalmWiki_LocalTest`を変更しない読み取り専用ベンチマークでは、7,147ページ、Markdown本文19,249,924 bytes、11,047,709文字、読込失敗0件でした。Nodeでの逐次読込＋正規化は約22.1秒、想定`search-cache.json`は約20.0 MB、準備後の3代表queryは約32.3〜64.3 msでした。これは実Obsidian UIの完了証明ではないため、同時2件の実キャッシュ作成、操作応答、warm再利用を配置後に別途確認します。
- 公開前安全修正後の`npm run check`は113件の自動テスト、production build、公式Obsidian ESLint、metadata検証、差分空白検査まで成功しました。削除済み・旧scope・破損entryを含む全文キャッシュの即時削除、削除失敗後の警告と再試行、対象外ノートによる不要な無効化防止も回帰テストに含みます。

## 0.1.0リリース候補で確認済み

- PageRank補正後の順位、PageRank / Inlinks / Outlinksの並べ替え、リンク先フィルターをコピーVaultで確認済み。
- 保存済み索引の先行表示、起動時の遅延索引、手動更新、設定保持、破損キャッシュ復旧を確認済み。
- README、既知の制限、バージョン、3成果物、チェックサムを確認済み。
- 公式Obsidian ESLint、`npm run check`、31件の自動テスト、依存関係監査を確認済み。

## 0.1.0公開結果

- タグ`0.1.0`は検証済みコミット`ee4d684`を指しています。
- 公開Releaseの添付物は`main.js`、`manifest.json`、`styles.css`の3点だけです。
- 公開URLから3成果物を再取得し、Release表示・ローカルbuild・テストVault配布物のSHA-256が一致しました。
- `main.js`には同梱するReact系ライブラリのMIT許諾文を埋め込み、Release検証で版番号と全文を確認します。
- 初回の下書き作成ジョブはリポジトリ自動判定に失敗しましたが、検証済みArtifactから安全に下書きを作成しました。PR #5でリポジトリを明示する修正を`main`へ反映済みです。

## 次の段階

- 0.4.0候補の通常Markdownヘッダー検索は、Vault外へ既存版をバックアップしてから`PalmWiki_LocalTest`へ3成果物だけを配置しました。Obsidian 1.12.7でLive Preview、Source mode、Reading view、最近・曖昧候補、候補と本文検索の同一leaf遷移、Back、Focus searchコマンド、狭いsplit、plugin再読込、PalmWiki Home無効化時にも2Hop Links Plusの右上ボタンと本文内表示が維持されることを確認しました。Vault本文と添付ファイルは変更していません。
- 0.4.0候補の残る手動確認は、pop-out、Hover Preview / Hover Editor / Canvas除外、splitごとの別queryとinactive leaf、rename、実際に割り当てた任意ホットキー、pointer hoverのパスツールチップ、2Hop Links Plus側だけの無効化・再有効化です。現在のmanifestはdesktop-onlyのため、iOS / Androidは今回の受入対象に含めません。
- 0.4.0用metadataは整合済みで、118件の自動テスト、production build、公式Obsidian ESLint、厳格なRelease検証、moderate基準の依存監査（既知脆弱性0件）が成功しました。Pull Request、CI、Release workflow、公開成果物を続けて検証し、0.3.1タグと公開成果物は変更しません。
- Windows / Linuxの実機互換性は未確認であり、現時点ではmacOSのみ確認済みと記載する。
- 本文検索の安定確認後、iOSを実機で検証する。macOSのiPhoneミラーリングとComputer Useは予備的な画面・タップ確認には使えるが、正式なiOS互換性の証明にはしない。
- 安定運用を確認後、Obsidianコミュニティプラグインへの申請を検討する。

## 継続時の注意

- 検証済み機能更新は、既定の`PalmWiki_LocalTest`へ自動配置する。別のVaultへ配布する場合は利用者へ確認する。
- 配布前に既存プラグインを`.obsidian/plugins/`の外へバックアップし、3成果物のチェックサムを照合する。
- Vault本文、添付ファイル、個人パス、ローカルレビュー記録をGitへ追加しない。
- `npm run build`、`npm run eslint`、`npm test`、`npm run verify:release`、`git diff --check`をRelease前に実行します。
