#!/bin/sh
# Full Kaltenbach bake (#30): play area at 8192 with its mip chain and data, then the surroundings.
# Writes public/maps/kaltenbach/ and assets/maps/kaltenbach/previews/. Commit both with the script.
set -e
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
cd "$(dirname "$0")/../../.."
mkdir -p assets/maps/kaltenbach/work
for mode in play outer; do
  "$BLENDER" -b --factory-startup -Y --python-exit-code 1 -P assets/maps/kaltenbach/build.py -- $mode \
    > assets/maps/kaltenbach/work/$mode.log 2>&1
  tail -1 assets/maps/kaltenbach/work/$mode.log
done
