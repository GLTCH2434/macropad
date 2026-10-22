#!/usr/bin/env bash
# Syncs the web app into the Android project so the APK ships the same UI
# the PWA uses, plus launcher icons. Run before building the APK
# (build-apk.sh does this automatically).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT"
ASSETS="$ROOT/android/app/src/main/assets"
RES="$ROOT/android/app/src/main/res"

mkdir -p "$ASSETS/icons"

# Web app (the UI the PWA uses, unchanged)
cp "$SRC/index.html"      "$ASSETS/"
cp "$SRC/app.js"          "$ASSETS/"
cp "$SRC/styles.css"      "$ASSETS/"
cp "$SRC/manifest.json"   "$ASSETS/"
cp "$SRC"/icons/icon-*.png "$ASSETS/icons/"
cp "$SRC/icons/icon.svg"  "$ASSETS/icons/" 2>/dev/null || true

# Launcher icons (one PNG per density bucket)
declare -A BUCKETS=(
  [mdpi]=72 [hdpi]=96 [xhdpi]=144 [xxhdpi]=192 [xxxhdpi]=384
)
for bucket in "${!BUCKETS[@]}"; do
  size="${BUCKETS[$bucket]}"
  mkdir -p "$RES/mipmap-$bucket"
  cp "$SRC/icons/icon-$size.png" "$RES/mipmap-$bucket/ic_launcher.png"
done

echo "Assets synced to $ASSETS"
