#!/bin/sh
set -eu
# Deliberately separate from routine tests. Uses only four fixed synthetic prompts.
if [ "$#" -ne 2 ] || [ "$1" != "--run" ]; then
  echo "Usage: run-plan-evaluation.sh --run OUTPUT.jsonl (explicit on-device model requests)" >&2
  exit 2
fi
umask 077
module_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
evaluation_dir=$(mktemp -d "${TMPDIR:-/tmp}/samepace-plan-evaluation.XXXXXX")
trap 'rm -rf "$evaluation_dir"' EXIT HUP INT TERM
xcrun swiftc -parse-as-library \
  "$module_dir/ios/IntelligenceContracts.swift" \
  "$module_dir/ios/WorkoutPhotoReader.swift" \
  "$module_dir/ios/AppleIntelligenceEngine.swift" \
  "$module_dir/tests/PlanGenerationChecks.swift" -o "$evaluation_dir/evaluate"
# Refuse to overwrite another artifact; response content stays in the protected file.
set -C
"$evaluation_dir/evaluate" > "$2"
echo "Synthetic local model results saved. Review the output; this is not an accuracy benchmark."
