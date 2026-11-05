# The commander map is a baked top-down image, not a live 3D world

Each map is a Blender scene (built by scripts, per ADR 0001) that is baked offline into a detailed top-down image, plus the height and cover data the simulation reads. The game draws that image as one textured plane under an orthographic three.js camera and puts every live element on top as 2D layers: symbology for soldiers, top-down sprites for vehicles, and 2D effects for combat. Soldiers are still simulated individually, but on a 2D grid with height data, and they have no 3D bodies.

We chose this because Gridline's fantasy is BF4's commander tablet, not the battle underneath it. The Commander spends almost all their time looking at the map, and an offline bake can carry far more detail (dense villages, long shadows, ambient occlusion) than a live low-poly world a browser hobby project could build and run. The live 3D route mostly paid for the Soldier Cam, which has now left the slice. See [Does Gridline need a live 3D world, and what is the Soldier Cam?](https://github.com/artsaraiva/gridline/issues/24).

## Considered Options

- **Live low-poly 3D world** (the original plan, shown by the soldier cam spike and the first aesthetic prototype): every frame renders terrain, buildings, soldiers and vehicles. It looked like an indie game at commander zoom, and its fidelity was capped by what a solo project can model, animate and keep fast.
- **2D library (PixiJS) or plain Canvas 2D** for the baked map: lighter, but the VHS and glitch post chain would need rebuilding, and a later Soldier Cam would need a second renderer.

## Consequences

- No live 3D zoom-in and no visible building destruction. Battle damage is drawn as 2D marks (craters, smoke, fire) over the bake.
- Night and weather become baked variants of the map or a colour grade over the bake, not live lighting.
- The Soldier Cam, when it returns, renders a low-poly 3D export of the same Blender scene with simple figures, through a degraded helmet-cam treatment. One scene stays the single source of truth for map image, simulation data and cam geometry.
- Map detail costs bake time and image size, not frame time. The bake resolution must hold up at the maximum commander zoom.
