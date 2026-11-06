"""Build the baked smoke puff sprite sheet used by shell trails (#53, #63) and reusable by impacts (#62).

Headless Blender script (ADR 0001, ADR 0002). Renders 4 top-down volumetric puff variants (same
noise field, different seeds) lit with Kaltenbach's sun (azimuth 45 deg NE, elevation 24 deg) and
sky fill, and packs them into `public/munitions/smoke-puff.png`.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P assets/munitions/smoke-puff/build.py
"""
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT_SHEET = os.path.join(ROOT, "public", "munitions", "smoke-puff.png")
os.makedirs(os.path.dirname(OUT_SHEET), exist_ok=True)

FRAME_PX = 128
VARIANTS = 4
SUN_ELEV = 24.0
SUN_AZ = 45.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# A unit sphere filled with a noisy volume that falls off to zero well inside the sphere, so the
# rendered puff never touches the frame edge.
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=48, ring_count=24, location=(0, 0, 0))
puff = bpy.context.object
puff.name = "SmokePuff"
puff.scale = (1.0, 1.0, 0.7)

mat = bpy.data.materials.new("Smoke")
puff.data.materials.append(mat)
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.remove(nodes["Principled BSDF"])
out = nodes["Material Output"]
vol = nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Color"].default_value = (0.78, 0.77, 0.74, 1.0)
vol.inputs["Anisotropy"].default_value = 0.2
links.new(vol.outputs["Volume"], out.inputs["Volume"])

coord = nodes.new("ShaderNodeTexCoord")
noise = nodes.new("ShaderNodeTexNoise")
noise.noise_dimensions = "4D"
noise.inputs["Scale"].default_value = 2.2
noise.inputs["Detail"].default_value = 6.0
noise.inputs["Roughness"].default_value = 0.6
links.new(coord.outputs["Object"], noise.inputs["Vector"])

# Radial falloff: 1 at the centre, 0 at r = 0.95, so density never reaches the sphere surface.
length = nodes.new("ShaderNodeVectorMath")
length.operation = "LENGTH"
links.new(coord.outputs["Object"], length.inputs[0])
falloff = nodes.new("ShaderNodeMapRange")
falloff.inputs["From Min"].default_value = 0.95
falloff.inputs["From Max"].default_value = 0.15
falloff.clamp = True
links.new(length.outputs["Value"], falloff.inputs["Value"])

# density = max(0, noise + falloff * 0.9 - 1.0) * 22
shaped = nodes.new("ShaderNodeMath")
shaped.operation = "MULTIPLY_ADD"
shaped.inputs[1].default_value = 0.9
shaped.inputs[2].default_value = -1.0
links.new(falloff.outputs["Result"], shaped.inputs[0])
add = nodes.new("ShaderNodeMath")
add.operation = "ADD"
links.new(noise.outputs["Fac"], add.inputs[0])
links.new(shaped.outputs["Value"], add.inputs[1])
clamp = nodes.new("ShaderNodeMath")
clamp.operation = "MAXIMUM"
clamp.inputs[1].default_value = 0.0
links.new(add.outputs["Value"], clamp.inputs[0])
gain = nodes.new("ShaderNodeMath")
gain.operation = "MULTIPLY"
gain.inputs[1].default_value = 22.0
links.new(clamp.outputs["Value"], gain.inputs[0])
links.new(gain.outputs["Value"], vol.inputs["Density"])

cam_d = bpy.data.cameras.new("TopDownCamera")
cam_d.type = "ORTHO"
cam_d.ortho_scale = 2.05
cam_d.clip_end = 50.0
cam = bpy.data.objects.new("TopDownCamera", cam_d)
cam.location = (0, 0, 5.0)
scene.collection.objects.link(cam)
scene.camera = cam

# Sun and sky matching assets/maps/kaltenbach/build.py and the artillery shell bake.
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 4.2
sun_d.angle = math.radians(0.6)
sun_d.color = (1.0, 0.95, 0.88)
sun = bpy.data.objects.new("sun", sun_d)
el = math.radians(SUN_ELEV)
az = math.radians(SUN_AZ)
sun_dir = Vector((-math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), -math.sin(el)))
sun.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("sky")
scene.world = world
bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.40, 0.48, 0.62, 1.0)
bg.inputs["Strength"].default_value = 0.55

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dv in prefs.devices:
    dv.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.cycles.volume_bounces = 2
scene.render.film_transparent = True
scene.render.resolution_x = FRAME_PX
scene.render.resolution_y = FRAME_PX
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"


def load_pixels(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def save_sheet(path, rgba):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new("sheet", w, h, alpha=True)
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    vt = scene.view_settings.view_transform
    scene.view_settings.view_transform = "Standard"
    img.save_render(path, scene=scene)
    scene.view_settings.view_transform = vt
    bpy.data.images.remove(img)


frames = []
with tempfile.TemporaryDirectory() as tmp:
    for idx in range(VARIANTS):
        noise.inputs["W"].default_value = 3.7 * idx + 0.5
        frame_path = os.path.join(tmp, f"puff-{idx}.png")
        scene.render.filepath = frame_path
        bpy.ops.render.render(write_still=True)
        px = load_pixels(frame_path)
        px[..., 3] = np.where(px[..., 3] < 0.02, 0.0, px[..., 3])
        frames.append(px)

sheet = np.concatenate(frames, axis=1)
save_sheet(OUT_SHEET, sheet)
print(f"Wrote {len(frames)}-frame smoke puff sheet ({sheet.shape[1]}x{sheet.shape[0]}) to {OUT_SHEET}")
