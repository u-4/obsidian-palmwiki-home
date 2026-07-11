# 手動テストチェックリスト

状態の目安:

- `[x]` 自動 build / static check で確認済み
- `[ ]` Obsidian UI 上で手動確認が必要

## Build check

- `[x]` `npm install` を実行する。
- `[x]` `npm run build` を実行する。
- `[x]` `npm run eslint` を実行する。現在は TypeScript typecheck 相当。
- `[x]` `git diff --check` を実行する。

## テスト Vault での smoke test

- `[ ]` プラグインをテスト Vault にインストールする。
- `[ ]` Obsidian でプラグインを有効化する。
- `[ ]` command palette から `Open PalmWiki Home` を実行する。
- `[ ]` Home view が開くことを確認する。
- `[ ]` Markdown ページが card として表示されることを確認する。
- `[ ]` card をクリックすると正しい note が開くことを確認する。
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
- `[ ]` Home tab に戻った時、既存 index の UI が先に使える状態になり、その後 dirty rebuild が走る。
- `[ ]` Home view を開いた状態で Markdown を編集すると、debounce 後に表示が更新される。
- `[ ]` Home view を開いた状態で複数の metadata / file change が連続しても、index rebuild が同時に複数本走らない。
- `[ ]` index rebuild 中に Refresh を押しても、同時 rebuild ではなく follow-up rebuild として処理される。
- `[ ]` 既存 Home tab を command / ribbon から開く時、view が再生成されず既存 leaf が reveal される。
- `[ ]` pin 済み note を rename しても pin が維持される。
- `[ ]` pin 済みの一時 note を delete しても crash せず、古い pin が削除または無害に無視される。
- `[ ]` card 本体を mouse click すると note が開く。
- `[ ]` pin button を mouse click すると pin だけが切り替わり、note は開かない。
- `[ ]` card の title / body open area を keyboard で Enter / Space 操作すると note が開く。
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
- `[ ]` 大きく絞り込んだ後でも card/table virtualization の visible range が壊れず、空白表示にならない。
- `[ ]` `Performance debug logging` が PalmWiki Home 設定の `Index on startup` 直下に表示される。
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
