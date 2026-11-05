# Assets are code: headless Blender scripts are the source of truth

Every 3D asset (soldiers, vehicles, buildings, vegetation, props) is a Python script that runs in headless Blender. The script builds the mesh, rig and clips, renders preview images and exports a GLB. Script and GLB are committed together, and nobody needs to open the Blender GUI. We chose this because no CC0 source has modern soldiers or military vehicles, the repo is public so every byte must be redistributable, and scripts are reviewable, diffable and rebuildable by Claude. Meshes are colored through named material roles, not fixed colors, so the aesthetic can change without remodelling. See [Which assets do we make ourselves, and with what tools?](https://github.com/artsaraiva/gridline/issues/20).

## Considered Options

- **Asset packs (Kenney, Quaternius)**: no modern military content. Kenney's style clashes with ours, and Quaternius's licence is contradictory. Kenney stays a fallback for filler props only.
- **AI 3D generators**: outputs are vendor-owned or region-restricted, and they are dense textured meshes that need retopology.
- **Blender MCP server**: unauthenticated arbitrary Python over a localhost socket. The headless route gives the same power behind Claude Code's Bash permission gate.
- **Mixamo**: raw files may not be distributed, and a public repo distributes them.

## Consequences

- An asset hand-edited in the Blender GUI switches its source of truth to its `.blend`, permanently.
- CI never runs Blender. The committed GLB is the build output, so a script change must be re-run and its GLB committed with it.
