# 手動テストチェックリスト

状態の目安:

- `[x]` 自動確認またはObsidian実画面で確認済み
- `[ ]` 未実施、または公開操作時にだけ確認する項目

## 0.2.0 リリース判定

確認環境:

- 日付: 2026-07-12
- Release branch: `codex/home-button-ownership`
- Pull Request: [#7](https://github.com/u-4/obsidian-palmwiki-home/pull/7)
- Release tag commit: `62e7876`（タグ`0.2.0`）
- Main CI: [29191162028](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191162028)
- Release workflow: [29191216958](https://github.com/u-4/obsidian-palmwiki-home/actions/runs/29191216958)
- Obsidian: Desktop 1.12.7 / macOS
- テストVault: `PalmWiki_LocalTest`（コピーVault）

確認結果:

- `[x]` 利用者がテストVaultで基本機能とインターフェースに問題がないことを確認した。
- `[x]` Cardクリックが同じHomeタブでMarkdownページを開く。
- `[x]` 左ヘッダーが「戻る・進む」→PalmWiki Homeボタン→ノートタイトルの順で表示される。
- `[x]` PalmWiki Homeタブの中央タイトル文字が非表示になり、将来の検索欄用領域が残る。
- `[x]` production build、公式Obsidian ESLint、自動テスト50件、metadata検証、差分空白検査が成功する。
- `[x]` `npm ci`と`npm audit --audit-level=moderate`が成功し、既知の脆弱性が0件である。
- `[x]` 配布した`main.js`、`manifest.json`、`styles.css`のSHA-256が開発元と一致し、`data.json`と索引キャッシュを上書きしない。
- `[x]` PR CIとmain CIが成功し、タグ`0.2.0`がmainコミット`62e7876`を指す。
- `[x]` Release workflowが検証済みの3成果物だけを下書きへ添付し、全jobが成功する。
- `[x]` 下書きを通常のLatest Releaseとして公開し、公開URLから3成果物を再取得してSHA-256を照合する。
- `[ ]` ポップアウト、Hover Preview / Hover Editor、reduced motionなどの特殊条件は、下記の回帰確認項目として継続する。
- `[ ]` 起動直後の未読込・非アクティブ復元タブにおける相対ページ、ローカル見出し、文脈依存コマンドは継続確認とする。

公開結果: [PalmWiki Home 0.2.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.2.0)

公開成果物のSHA-256:

```text
c825710cf55057c86f2fed92de07f6ff77971648f1dc80ab111f9193f07088b3  main.js
13354511f0c91b881dd3f63e7e6f7e21a84ab6196d7b4b7f74c47a4a9a72aefd  manifest.json
23bfeced70b7f1c73e2a9efcbb16919c95ca1a7008d5bae14d4e5a2367e08c90  styles.css
```

## 0.1.0 リリース判定（必須）

この節を0.1.0の公開可否判定に使用する。後続の詳細一覧は回帰確認用の項目集であり、未確認項目が自動的に0.1.0の公開停止を意味するものではない。

確認環境:

- 日付: 2026-07-12
- Release tag commit: `ee4d684`（タグ`0.1.0`）
- Release workflow fix: `0bd3554`（PR #5、`main`へ反映済み）
- Obsidian: Desktop 1.12.7 / macOS
- テストVault: `PalmWiki_LocalTest`（コピーVault）

自動確認:

- `[x]` `npm ci`から`npm run check`まで成功する。
- `[x]` `npm audit --audit-level=moderate`が既知の脆弱性0件で成功する。
- `[x]` Obsidian公式ESLintが警告0件で成功する。
- `[x]` 自動テスト31件が全件成功する。
- `[x]` `manifest.json`、`package.json`、`package-lock.json`、`versions.json`が0.1.0 / Obsidian 1.12.7で一致する。
- `[x]` `main.js`、`manifest.json`、`styles.css`が存在し、production build、source mapなし、Git未追跡である。

Obsidian実画面:

- `[x]` 配布前バックアップが`.obsidian/plugins/`の外にあり、配布した3成果物のSHA-256が一致する。
- `[x]` `Index on startup` OFFで、Homeが非表示の起動時にfull index/cache writeが始まらない。
- `[x]` プラグイン再読み込み後、保存済みページが検証buildより先に表示される。
- `[x]` 状態が`Waiting`→`Indexing`→`Complete`と変化し、一覧は処理中も利用できる。
- `[x]` warm検証buildで未変更本文を全件読み直さない。
- `[x]` 待機中のRefreshが1回だけ実行され、後から不要な二重buildが始まらない。
- `[x]` Card/Table、PageRank/Inlinks/Outlinks、Asc/Desc、Quick filter 0件、リンク先filterがエラーなく動く。
- `[x]` PageRank上位が日記など単一hub由来だけで支配されず、PR 1.000の大量同率がない。
- `[x]` cardからnoteを開き、ribbonで既存Homeへ戻れる。
- `[x]` pin、include/exclude、表示設定が再読み込み後も保持される。
- `[x]` 破損した`index-cache.json`から起動不能にならず、再構築で復旧する。
- `[x]` PalmWiki Home由来の未処理エラー、二重build、`File not found`がない。コンソールの既存1件は別プラグイン由来。

公開物:

- `[x]` README、既知の制限、CHANGELOG、desktop-only表記を最終確認する。
- `[x]` Release verifierはタグ`0.1.0`（`v`なし）を受け付け、不正な形式をRelease作成前に拒否する。
- `[x]` Release workflowが添付する成果物は`main.js`、`manifest.json`、`styles.css`の3点だけである。
- `[x]` 実際のタグと下書きReleaseを作成し、GitHub画面で添付物を確認する。
- `[x]` Public化とRelease公開を利用者の明示承認後に実行する。
- `[x]` 公開URLから3成果物を再取得し、SHA-256と内容が検証済みArtifactに一致する。
- `[x]` `main.js`に同梱ライブラリのMIT許諾文が埋め込まれ、source mapがない。

公開結果: [PalmWiki Home 0.1.0](https://github.com/u-4/obsidian-palmwiki-home/releases/tag/0.1.0)

初回の自動下書き作成は、書き込みジョブにローカルGit checkoutがないためGitHub CLIのリポジトリ判定に失敗した。検証・build・監査・Artifact保存は成功していたため、その検証済みArtifactから下書きを作成して全項目を再確認した。PR #5で`--repo`を明示し、同じ失敗を防止済み。

## Build check

- `[x]` `npm ci` を実行する。
- `[x]` `npm run build` を実行する。
- `[x]` `npm run eslint` を実行する。Obsidian公式の型情報付きESLint。
- `[x]` `git diff --check` を実行する。

## 左上Homeボタン所有機能（今回の手動確認）

- `[ ]` Live Preview、Reading view、複数split、非アクティブsplitの通常Markdownタブに、タイトルより前の左上ボタンが各1個だけ表示される。
- `[ ]` 左ヘッダーが「戻る・進む」→PalmWiki Homeボタン→ノートタイトルの順に表示される。
- `[ ]` PalmWiki Homeタブでは中央の`PalmWiki Home`タイトル文字が表示されず、中央ヘッダー領域が空いたまま残る。
- `[ ]` Canvas、設定、他のカスタムビュー、Hover Preview、Hover Editor、popoverには左上ボタンが表示されない。
- `[ ]` ラベル空欄では現在のVault名、任意ラベルではその文字列になり、表示・tooltip・読み上げ名が全対象タブへ即時反映される。
- `[ ]` `Open PalmWiki Home`で、クリック元MarkdownタブだけがHomeへ置き換わり、新規タブや別の既存Homeへ移動しない。
- `[ ]` `Open a page`で、既存ページがクリック元タブに開く。ノート名、Vault相対パス、`.md`、Wiki link、alias、headingを確認する。
- `[ ]` 空欄または存在しないHome pageでは、ファイルを作らず元のMarkdown表示を維持し、Noticeを表示する。
- `[ ]` command chooserで選択しただけでは実行されず、左上ボタンクリック時はクリック元splitがactiveになってから実行される。
- `[ ]` 未選択、無効、現在の文脈で実行不能なcommandでは表示を変えずNoticeを表示する。
- `[ ]` Home設定だけを変更しても、索引再構築やVault本文の全件読み込みが始まらない。
- `[ ]` PalmWiki HomeのCard/Tableを下へscroll後、左上ボタンで同じHomeの最上部へ戻る。reduced motion有効時も確認する。
- `[ ]` ポップアウトウィンドウでも左上ボタンの表示、動作、最上部移動が正しい。
- `[ ]` leaf close、plugin disable/reload後にPalmWikiボタンやeventが残らず、再有効化後も二重表示にならない。
- `[ ]` 2Hop Links Plus併用時も右上2-hopボタンが変化せず、2Hopを無効化してもPalmWikiの左上ボタンが機能する。
- `[ ]` Cardクリックで、そのCardを表示していたHomeタブが正しいMarkdownページへ置き換わり、タブ数と他splitは変わらない。
- `[ ]` Cardのtitle/bodyをEnter / Spaceで操作した場合も同一タブで開き、pin buttonはpinだけを切り替える。
- `[ ]` Tableの既存ページ表示動作に回帰がない。

## テスト Vault での smoke test

- `[ ]` プラグインをテスト Vault にインストールする。
- `[ ]` Obsidian でプラグインを有効化する。
- `[ ]` command palette から `PalmWiki Home: Open home` を実行する。
- `[ ]` Home view が開くことを確認する。
- `[ ]` Markdown ページが card として表示されることを確認する。
- `[ ]` card をクリックすると、そのHomeタブが正しい note へ置き換わり、新しいタブが増えないことを確認する。
- `[ ]` Table view に切り替える。
- `[ ]` 同じ note が table 形式で表示されることを確認する。
- `[ ]` updated time descending で sort する。
- `[ ]` 新しい note が古い note より前に出ることを確認する。
- `[ ]` title ascending で sort する。
- `[ ]` title sort が安定していることを確認する。
- `[ ]` Page rank sort で、PageRank値の高い note が上位に出ることを確認する。
- `[ ]` Page rank sort で、`PR 1.000` が大量に並ばないことを確認する。
- `[ ]` `日記` などのhub由来だけで上位が支配されないことを確認する。
- `[ ]` PageRank ignored source folder / pattern を設定し、PageRank順位だけが変わり、Inlinks / Outlinks count は変わらないことを確認する。
- `[ ]` Inlinks sort で、被リンク数の多い note が上位に出ることを確認する。
- `[ ]` Outlinks sort で、リンク数の多い note が上位に出ることを確認する。
- `[ ]` note を pin する。
- `[ ]` card view と table view の両方で、pin した note が上部に出ることを確認する。
- `[ ]` pin を解除する。
- `[ ]` 通常の sort 順に戻ることを確認する。
- `[ ]` `Archive` などの folder を exclude に設定する。
- `[ ]` `Archive/` 以下の note が消えることを確認する。
- `[ ]` `Notes/Anesthesia` などの folder を include に設定する。
- `[ ]` include folder 以下だけが表示され、exclude folder が優先されることを確認する。
- `[ ]` Obsidian を再読み込みする。
- `[ ]` pin と settings が保持されていることを確認する。

## コピーした実 Vault での smoke test

- `[ ]` 本番 Vault ではなく、ローカルコピーした実 Vault を開く。
- `[ ]` プラグインをインストールする。
- `[ ]` PalmWiki Home を開く。
- `[ ]` 初回 index がエラーなく完了することを確認する。
- `[ ]` 実 note 数で card view が使えることを確認する。
- `[ ]` table view が使えることを確認する。
- `[ ]` default sort が updated-desc であることを確認する。
- `[ ]` 実際の folder 名で include / exclude folder settings が効くことを確認する。
- `[ ]` よく使う note をいくつか pin し、常に上部に残ることを確認する。
- `[ ]` よくリンクされている note を link target filter で選び、その note へリンクしているページだけが出ることを確認する。
- `[ ]` link target filter を clear できることを確認する。
- `[ ]` view を何度か開閉し、重複表示や stale rendering が目立たないことを確認する。

## Edge case / hardening 確認

- `[ ]` 別 folder にある同名 note が別 card として表示される。
- `[ ]` 同名 note が sort、filter、pin 後も別々に扱われる。
- `[ ]` metadata cache がない file でも view が crash しない。
- `[ ]` frontmatter aliases がある file でも crash しない。
- `[ ]` 壊れた frontmatter がある file でも crash しない。
- `[ ]` 本文が空の file でも表示される。
- `[ ]` 存在しない image embed がある file でも、壊れた thumbnail を出さずに表示される。
- `[ ]` 非 Markdown file が Phase 1 のページ一覧に出ない。
- `[ ]` `Index on startup` を有効化しない限り、Obsidian 起動時に full index が即時実行されない。
- `[ ]` PalmWiki Home を開くと、index が dirty または空の場合に indexing が始まる。
- `[ ]` Home view を閉じた状態で Markdown を編集すると、即時 full reindex せず stale / dirty 状態になる。
- `[ ]` Home view が別 tab の裏にある状態で Markdown を編集しても、即時 full rebuild せず stale / dirty 状態になる。
- `[ ]` Home表示を契機に始まった自動build中に別tabへ移ると、次の処理区切りで停止し、Homeへ戻った時に再開される。
- `[ ]` `Index on startup`をONにしたbuildと手動Refreshは、別tabへ移っても意図どおり完了する。
- `[ ]` 起動時索引の待機中に`Index on startup`をOFFへ戻しても、Home表示中なら保存済み索引を再利用して通常のidle更新へ移る。
- `[ ]` Home tab に戻った時、既存 index の UI が先に使える状態になり、その後 dirty rebuild が走る。
- `[ ]` Obsidian起動直後はPalmWiki Homeの本文索引が始まらず、画面とタブの復元後のidle時に開始する。
- `[ ]` warm起動では保存済み索引が先に表示され、未変更のMarkdown本文を全件読み直さない。
- `[ ]` `index-cache.json`が破損または設定不一致でも、エラーで起動不能にならず通常索引へ戻る。
- `[ ]` 本文読み込みの同時実行数が2件を超えない。
- `[ ]` Home view を開いた状態で Markdown を編集すると、debounce 後に表示が更新される。
- `[ ]` Home view を開いた状態で複数の metadata / file change が連続しても、index rebuild が同時に複数本走らない。
- `[ ]` index rebuild 中に Refresh を押しても、同時 rebuild ではなく follow-up rebuild として処理される。
- `[ ]` Home表示直後の自動待機中にRefreshしても、完了後に不要な二重rebuildが始まらない。
- `[ ]` index rebuild 中にpinを切り替えても、build完了後に新しいpin状態が維持される。
- `[ ]` 既存 Home tab を command / ribbon から開く時、view が再生成されず既存 leaf が reveal される。
- `[ ]` pin 済み note を rename しても pin が維持される。
- `[ ]` pin 済みの一時 note を delete しても crash せず、古い pin が削除または無害に無視される。
- `[ ]` card 本体を mouse click すると、そのCardを表示していたHomeタブでnoteが開く。
- `[ ]` pin button を mouse click すると pin だけが切り替わり、note は開かない。
- `[ ]` card の title / body open area を keyboard で Enter / Space 操作すると同じHomeタブでnoteが開く。
- `[ ]` pin button を keyboard で Enter / Space 操作すると pin だけが切り替わり、note は開かない。
- `[ ]` card view は `Load more` なしで全 filtered page を scroll できる。
- `[ ]` card view では mounted card 数が visible range + overscan 程度に抑えられる。
- `[ ]` table view は `Load more` なしで全 filtered page を scroll できる。
- `[ ]` table view では mounted row 数が viewport + overscan 程度に抑えられる。
- `[ ]` table view の description と tags が固定行高内に収まり、行高が変動しない。
- `[ ]` Card/Table 切り替えで index rebuild log が出ない。
- `[ ]` Card/Table 切り替え後も PageRank / Inlinks / Outlinks 表示が維持される。
- `[ ]` Asc / Desc の direction だけを切り替えた時、full sort ではなく reverse 相当の軽い動作になる。
- `[ ]` pinned page が Asc / Desc のどちらでも先頭 group に残る。
- `[ ]` Page rank / Inlinks / Outlinks sort でも pinned page が先頭 group に残る。
- `[ ]` link target filter の候補は最大20件程度に抑えられ、7,000ページ規模でも入力が重くならない。
- `[ ]` link target filter の候補popoverが入力欄の下に出て、隣接controlやtoolbar layoutを崩さない。
- `[ ]` link target filter の候補popoverが Escape / outside click / selection で閉じる。
- `[ ]` folder / tag / quick / link target filters が AND 条件として組み合わさる。
- `[ ]` filter結果が0件でも、保存済み索引がある場合は索引開始待ちと誤表示されない。
- `[ ]` 大きく絞り込んだ後でも card/table virtualization の visible range が壊れず、空白表示にならない。
- `[ ]` `Index on startup` の下に永続索引キャッシュの保存内容説明と `Performance debug logging` が表示される。
- `[ ]` `Performance debug logging` を ON にすると `[PalmWiki Home perf]` の timing log が出る。
- `[ ]` `Performance debug logging` を ON にすると `graph build` と `page rank` の timing log が出る。
- `[ ]` `PageRank debug path` を設定して rebuild すると、top authority contributors が debug log に出る。
- `[ ]` sort / filter 操作だけでは `graph build` と `page rank` が再実行されない。
- `[ ]` `.obsidian/plugins` の中に `palmwiki-home.backup-*` のような古い plugin backup が残っていない。
- `[ ]` quick filter で `ＣＶＣ` が `CVC` に match するなど、全角 / 半角が正規化される。
- `[ ]` quick filter で空白区切り query が AND 条件として扱われる。

## 記録しておく観察項目

- Markdown file 数:
- 初回 index にかかった時間:
- 他 tab から PalmWiki Home に戻った時の待ち時間:
- Asc / Desc 切り替えの待ち時間:
- sort key 変更時の待ち時間:
- card / table 切り替えの待ち時間:
- 非アクティブ Home tab 中に full rebuild が走っていないこと:
- table mount window log の mountedCount:
- graph build log の node / edge / ms:
- page rank log の node / edge / ms:
- link target filter 入力時の操作感:
- image URL cache hit / miss:
- 1 file 編集後の refresh 体感:
- console error の有無:

## 大規模コピーVaultで確認済みの項目

- `[x]` 約7,000ページで、Home tabへの復帰とsort direction切り替えが実用的な速度で動作する。
- `[x]` virtual table導入後、Card/Table切り替えに目立つ引っかかりがない。
- `[x]` sort操作も軽快に動作する。
- `[x]` plugin backupを`.obsidian/plugins/`の外へ置くことで、古いplugin候補の誤検出を防げる。
- `[x]` `Index on startup` OFFで新規Vaultウィンドウを開き、復元Markdownタブ3枚に「ファイルがありません」が出ない。
- `[x]` Homeを開く前にfull index/cache writeが始まらず、保存済み7,145ページが検証buildより先に表示される。
- `[x]` warm検証buildで7,145件すべてを再利用し、本文read 0件、最大同時read 0件で完了する。
- `[x]` 1ファイルだけ状態が変わった時は7,144件を再利用し、本文read 1件だけで完了する。
- `[x]` toolbar Refreshが1回で完了し、pending follow-upや本文再readを発生させない。
- `[x]` Card/Table、PageRank/Inlinks/Outlinks、Asc/Descの切替でindex rebuildやerrorが発生しない。
- `[x]` Quick filterが0件の時に、索引開始待ちではなく「No pages match the current filters.」を表示する。
- `[x]` cardからnoteを開いた後、ribbon操作で既存Home leafが選択状態へ戻る。
