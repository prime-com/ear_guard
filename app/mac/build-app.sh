#!/bin/bash
# Builds build/EarGuard.app (menu-bar app, ad-hoc signed — fine for running on your own Mac).
# Usage: ./build-app.sh   then   open build/EarGuard.app
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release --product EarGuardMac
APP="build/EarGuard.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$(swift build -c release --show-bin-path)/EarGuardMac" "$APP/Contents/MacOS/EarGuardMac"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.earguard.mac</string>
  <key>CFBundleName</key><string>EarGuard</string>
  <key>CFBundleDisplayName</key><string>EarGuard</string>
  <key>CFBundleExecutable</key><string>EarGuardMac</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.2</string>
  <key>LSUIElement</key><true/>
  <key>NSAudioCaptureUsageDescription</key>
  <string>EarGuard measures how loud the sound your Mac plays is, so it can estimate your headphone listening level. Audio is analysed on this Mac and never recorded or sent anywhere.</string>
</dict></plist>
PLIST
plutil -lint "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"
codesign --verify --verbose=1 "$APP"
echo "Built $APP"
