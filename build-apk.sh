#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "  Voltron Diagnostics - Android APK Generation Helper"
echo "=========================================================="
echo "This helper compiles the React Native / Expo companion project"
echo "and prepares an APK or cloud build for Android installation."
echo ""

cd /home/ubuntu/voltron-diagnostics-mobile

echo "Expo project ID: 85a61248-bd78-4e03-aa9f-d21aa470b6cc"

echo "1. Checking npm / pnpm dependencies..."
if [ ! -d "node_modules" ]; then
  pnpm install --no-frozen-lockfile || npm install
fi

echo "2. Validating Expo configuration..."
npx expo-doctor || true

echo ""
echo "=========================================================="
echo "To generate an installable Android .apk file:"
echo "Option A (Free Cloud Build with EAS - Recommended):"
echo "  npx eas-cli login"
echo "  npx eas-cli build -p android --profile preview"
echo "  (This outputs a direct .apk download link for your phone)"
echo ""
echo "Option B (Local Offline Gradle Build with Android SDK):"
echo "  npx expo prebuild --platform android"
echo "  cd android && ./gradlew assembleRelease"
echo "  (Artifact will be located at: android/app/build/outputs/apk/release/app-release.apk)"
echo "=========================================================="
