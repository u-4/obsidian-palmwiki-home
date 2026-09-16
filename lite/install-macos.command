#!/bin/bash
# Current authorization: iCloud Drive / Obsidian / PalmWiki (2026-09-16).
# Only the three plugin assets are changed. No note/config edits or service calls.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SRC="$HERE/palmwiki-home-lite"
if [[ "$(uname -s)" != Darwin ]]; then echo 'This installer is for macOS.'; exit 1; fi
if /usr/bin/pgrep -x Obsidian >/dev/null; then
  echo 'MacのObsidianを終了してから、もう一度実行してください。'; exit 1
fi
for name in main.js manifest.json styles.css; do
  [[ -f "$SRC/$name" && ! -L "$SRC/$name" ]] || { echo "配布ファイルがありません: $name"; exit 1; }
done
[[ -f "$HERE/SHA256SUMS" && ! -L "$HERE/SHA256SUMS" ]] || { echo 'SHA256SUMSがありません。'; exit 1; }
(cd "$SRC" && /usr/bin/shasum -a 256 -c "$HERE/SHA256SUMS")

# Use only the standard Obsidian iCloud container and this exact Vault name.
# Do not search the user's disk or silently fall back to a test/different Vault.
ICLOUD_DOCS="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
VAULT="$ICLOUD_DOCS/PalmWiki"
[[ -d "$ICLOUD_DOCS" && -d "$VAULT" && ! -L "$VAULT" ]] || {
  echo 'iCloud Drive → Obsidian → PalmWikiがMacに見つかりません。配置せず停止しました。'
  echo 'Finderでこの既存Vaultの同期・ダウンロード状態を確認してください。'; exit 1
}
ICLOUD_DOCS="$(cd "$ICLOUD_DOCS" && pwd -P)"
VAULT="$(cd "$VAULT" && pwd -P)"
[[ "$VAULT" == "$ICLOUD_DOCS/PalmWiki" ]] || { echo '配置先の実パスが一致しません。'; exit 1; }
[[ -d "$VAULT/.obsidian" && ! -L "$VAULT/.obsidian" ]] || { echo '既存の.obsidianがないかリンクのため停止しました。'; exit 1; }
[[ ! -L "$VAULT/.obsidian/plugins" ]] || { echo 'pluginsがシンボリックリンクのため停止しました。'; exit 1; }
DEST="$VAULT/.obsidian/plugins/palmwiki-home-lite"
[[ ! -L "$DEST" ]] || { echo '配置先がシンボリックリンクのため停止しました。'; exit 1; }
SAME=true
for name in main.js manifest.json styles.css; do
  [[ ! -L "$DEST/$name" ]] || { echo '配置先ファイルがシンボリックリンクのため停止しました。'; exit 1; }
  [[ ! -e "$DEST/$name" || -f "$DEST/$name" ]] || { echo '配置先ファイルの種類が不正です。'; exit 1; }
  if [[ ! -f "$DEST/$name" ]] || ! cmp -s "$SRC/$name" "$DEST/$name"; then SAME=false; fi
done
if [[ "$SAME" == true ]]; then
  echo '同じ3成果物がPalmWikiに配置済みです。上書きや退避は行いません。'
  echo 'iCloud同期後、iPhone/iPadでLiteの版番号を確認してください。端末への反映は未確認です。'; exit 0
fi

BACKUP_ROOT="$HOME/PalmWikiHomeLite-Backups"
[[ ! -L "$BACKUP_ROOT" ]] || { echo '退避先がシンボリックリンクのため停止しました。'; exit 1; }
mkdir -p "$BACKUP_ROOT"
BACKUP="$(mktemp -d "$BACKUP_ROOT/PalmWiki-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
for name in main.js manifest.json styles.css; do
  if [[ -f "$DEST/$name" ]]; then
    cp -p "$DEST/$name" "$BACKUP/$name"
    cmp -s "$DEST/$name" "$BACKUP/$name" || { echo '退避の照合に失敗しました。配置はしません。'; exit 1; }
  fi
done
printf 'Destination: %s\nOnly the three plugin assets are backed up. Settings and notes are unchanged.\n' "$DEST" > "$BACKUP/restore-info.txt"
printf '\n配置先: %s\n退避先: %s\n' "$DEST" "$BACKUP"
mkdir -p "$DEST"
rollback() {
  trap - ERR INT TERM
  set +e
  echo '配置を中止し、今回の3ファイルだけを元へ戻します。'
  local failed=0
  for name in main.js manifest.json styles.css; do
    if [[ -f "$BACKUP/$name" ]]; then
      cp -p "$BACKUP/$name" "$DEST/$name" || failed=1
      cmp -s "$BACKUP/$name" "$DEST/$name" || failed=1
    else
      rm -f "$DEST/$name" || failed=1
    fi
  done
  if [[ "$failed" == 0 ]]; then echo '3ファイルの復旧を確認しました。';
  else echo "復旧を完了できませんでした。Obsidianを開かず、退避先を確認してください: $BACKUP"; fi
  exit 1
}
trap rollback ERR INT TERM
# Manifest last. iCloud synchronization across devices is not a transaction;
# keep Obsidian closed on those devices until synchronization has finished.
for name in main.js styles.css manifest.json; do cp "$SRC/$name" "$DEST/$name"; done
(cd "$DEST" && /usr/bin/shasum -a 256 -c "$HERE/SHA256SUMS")
trap - ERR INT TERM
printf '\nMac上のiCloud配置先へコピー・照合が完了しました: %s\n' "$DEST"
echo 'iCloud同期後、iPhone/iPadでPalmWikiを開き、Liteの版番号を確認してください。'
echo 'このスクリプトでは端末への同期完了やモバイルでの動作は確認していません。'
echo 'data.json、コマンド設定、プラグインの有効/無効、ノート本文は変更していません。'
echo '問題があれば画像表示をOFF、またはObsidianを終了して退避した3ファイルを戻してください。'
