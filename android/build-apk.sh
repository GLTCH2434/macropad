#!/usr/bin/env bash
# Builds the DeskPad APK on a Linux box with Java 17.
# First run downloads the Android SDK + Gradle (~800 MB) into $HOME.
#
# Usage:  android/build-apk.sh            # debug APK (fast, debug-signed)
#         android/build-apk.sh release    # signed release APK (keystore auto-created)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-debug}"
SDK="${ANDROID_HOME:-$HOME/Android/sdk}"
GRADLE_HOME="$HOME/tools/gradle-8.7"
JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"

echo "== Java: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

# --- Android SDK --------------------------------------------------------
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "== Downloading Android SDK command-line tools..."
  mkdir -p "$SDK/cmdline-tools" /tmp/deskpad-dl
  curl -sSL -o /tmp/deskpad-dl/cmdtools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -qo /tmp/deskpad-dl/cmdtools.zip -d "$SDK/cmdline-tools"
  mv -f "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
export ANDROID_HOME="$SDK"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" "platforms;android-34" "build-tools;34.0.0" >/dev/null

# --- Gradle -------------------------------------------------------------
if [ ! -x "$GRADLE_HOME/bin/gradle" ]; then
  echo "== Downloading Gradle 8.7..."
  mkdir -p /tmp/deskpad-dl
  curl -sSL -o /tmp/deskpad-dl/gradle.zip https://services.gradle.org/distributions/gradle-8.7-bin.zip
  unzip -qo /tmp/deskpad-dl/gradle.zip -d "$HOME/tools"
fi

# --- Release keystore (auto-created on first release build) -------------
if [ "$MODE" = "release" ] && [ ! -f "$ROOT/android/keystore/deskpad.jks" ]; then
  echo "== Creating release keystore (password: deskpad)..."
  mkdir -p "$ROOT/android/keystore"
  "$JAVA_HOME/bin/keytool" -genkeypair -v \
    -keystore "$ROOT/android/keystore/deskpad.jks" \
    -storepass deskpad -keypass deskpad -alias deskpad \
    -dname "CN=DeskPad, OU=DeskPad, O=VayavyaLabs, C=IN" \
    -keyalg RSA -keysize 2048 -validity 10000
fi

# --- Sync web assets + launcher icons ------------------------------------
bash "$ROOT/scripts/sync_assets.sh"

# --- Build ---------------------------------------------------------------
cd "$ROOT/android"
GRADLE="$GRADLE_HOME/bin/gradle"
if [ "$MODE" = "release" ]; then
  "$GRADLE" :app:assembleRelease --no-daemon --console=plain
  APK="$ROOT/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  # If signed via our keystore the file is app-release.apk; check both.
  [ -f "$ROOT/android/app/build/outputs/apk/release/app-release.apk" ] && APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
else
  "$GRADLE" :app:assembleDebug --no-daemon --console=plain
  APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
fi

echo
echo "== APK ready:"
ls -lh "$APK"
echo
echo "Install on the tablet (USB or adb):"
echo "  adb install $APK"
echo
echo "Then: enable Bluetooth on the tablet, open DeskPad, and pair"
echo "\"DeskPad\" with your computer like any Bluetooth keyboard."
