#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/android-env.sh
source "$ROOT/scripts/android-env.sh"

cd "$ROOT"
npm install
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon --console=plain)

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$HOME/Android/Avercast"
cp "$APK" "$HOME/Android/Avercast/Avercast-debug.apk"
echo "APK: $HOME/Android/Avercast/Avercast-debug.apk"

if command -v adb >/dev/null 2>&1 && adb devices | grep -q $'\tdevice$'; then
  adb install -r "$APK"
  echo "Installed on the connected Android device/emulator."
fi
