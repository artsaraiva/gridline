#!/bin/sh
# Full Auental bake (#150): play area at 8192 with its mip chain and data, then the surroundings.
# Writes public/maps/auental/ and assets/maps/auental/previews/. Commit both with the script.
set -e
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
cd "$(dirname "$0")/../../.."
mkdir -p assets/maps/auental/work
for mode in play outer; do
  "$BLENDER" -b --factory-startup -Y --python-exit-code 1 -P assets/maps/auental/build.py -- $mode \
    > assets/maps/auental/work/$mode.log 2>&1
  tail -1 assets/maps/auental/work/$mode.log
done
