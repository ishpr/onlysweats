#!/bin/sh
set -eu
# Compiles native boundaries and runs synthetic-only checks. No model inference,
# credentials, HealthKit samples, provider requests, or signing are involved.
module_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
check_dir=$(mktemp -d "${TMPDIR:-/tmp}/samepace-intelligence-check.XXXXXX")
trap 'rm -rf "$check_dir"' EXIT HUP INT TERM
ios_sdk=$(xcrun --sdk iphoneos --show-sdk-path)
xcrun swiftc -typecheck -parse-as-library -sdk "$ios_sdk" -target arm64-apple-ios16.4 \
  "$module_dir/ios/IntelligenceContracts.swift" \
  "$module_dir/ios/WorkoutPhotoReader.swift" \
  "$module_dir/ios/AppleIntelligenceEngine.swift" \
  "$module_dir/ios/PrivateCloudIntelligence.swift" \
  "$module_dir/shortcuts/SamePaceShortcuts.swift"
# This checks the PCC source against SDK 27 when using Swift 6.4+. It neither
# enables a build target nor executes PCC. The plugin never sets this flag.
xcrun swiftc -typecheck -parse-as-library -sdk "$ios_sdk" -target arm64-apple-ios16.4 \
  -D SAMEPACE_PCC_ENTITLEMENT_ENABLED \
  "$module_dir/ios/IntelligenceContracts.swift" \
  "$module_dir/ios/PrivateCloudIntelligence.swift"
xcrun swiftc -parse-as-library \
  "$module_dir/ios/IntelligenceContracts.swift" \
  "$module_dir/ios/WorkoutPhotoReader.swift" \
  "$module_dir/ios/AppleIntelligenceEngine.swift" \
  "$module_dir/ios/PrivateCloudIntelligence.swift" \
  "$module_dir/tests/IntelligenceChecks.swift" -o "$check_dir/checks"
"$check_dir/checks"
