// The map: the baked 8192 px Play Area plane and the low-detail surroundings plane under the tablet grade, with everything
// out of bounds dimmed and hatched beyond a cream boundary and the HQ zones tinted. A map without a bake (the test field)
// gets a flat plane under the Play Area outline.
import * as THREE from 'three/webgpu';
import { dot, float, floor, fract, fwidth, length, mix, positionWorld, screenCoordinate, smoothstep, step, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { BakedMap } from '../../maps/baked';
import type { MapData, SideId } from '../../sim/types';
import { SIDES } from '../../sim/types';
import { camera, COLOR, grade, layer } from '../renderer';
import { session } from '../session';
import { boundarySdf, SDF_PER_M } from './boundary';

const SDF_RES = 512;
/** Screen space the rails take either side of the map, and the margin above and below: the default view fits the Play Area between them. */
const RAILS_PX = 264;
const MARGIN_PX = 32;
const OOB_BLOCK_M = 4;
const HQ_TINT = 0.1; // blends in linear light, where a faint fill over this dark map reads stronger than in CSS

/** Zoom limits of the current map; the whole surroundings fill the screen at `min`, the bake's full detail is one texel per px at `max`. */
export const zoomRange = { min: 0.5, max: 20 };

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** Out of bounds: coarse blocks of the map, graded, grey-blue, dimmed, with a faint diagonal hatch. */
function oob(tex: THREE.Texture, blocks: number, level: number): THREE.Node<'vec3'> {
  const g = grade(texture(tex, floor(uv().mul(blocks)).add(0.5).div(blocks)).level(float(level)).rgb);
  const hatch = step(0.8, fract(screenCoordinate.x.add(screenCoordinate.y).div(9)));
  return vec3(dot(g, LUMA)).mul(vec3(0.6, 0.72, 0.82)).mul(0.5).add(hatch.mul(0.012));
}

async function bitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob(), { imageOrientation: 'flipY' });
}

interface Textures {
  play: THREE.Texture;
  outer: THREE.Texture;
  sdf: THREE.Texture;
}
const loaded = new Map<string, Promise<Textures>>();

/** three's GPU mip generation came out dark at 8192 on WebGPU, so the bake ships a ready-made chain and the Texture gets it whole. */
function textures(map: BakedMap): Promise<Textures> {
  let t = loaded.get(map.name);
  if (!t) {
    const dir = `${import.meta.env.BASE_URL}maps/${map.name.toLowerCase()}/`;
    t = (async () => {
      const [levels, outerImage] = await Promise.all([Promise.all(map.images.play.map((f) => bitmap(dir + f))), bitmap(dir + map.images.outer.file)]);
      const play = new THREE.Texture(levels[0]!);
      play.mipmaps = levels as unknown as HTMLCanvasElement[]; // three takes ImageBitmaps here; its types only list canvases
      play.generateMipmaps = false;
      play.minFilter = THREE.LinearMipmapLinearFilter;
      play.anisotropy = 8;
      const outer = new THREE.Texture(outerImage);
      const sdf = new THREE.DataTexture(boundarySdf(map.playArea, map.sizeM, SDF_RES), SDF_RES, SDF_RES, THREE.RedFormat, THREE.UnsignedByteType);
      sdf.minFilter = sdf.magFilter = THREE.LinearFilter;
      for (const x of [play, outer]) {
        x.colorSpace = THREE.SRGBColorSpace;
        x.flipY = false; // the bitmaps are flipped on decode so row 0 (north) lands at the top
      }
      for (const x of [play, outer, sdf]) x.needsUpdate = true;
      return { play, outer, sdf };
    })();
    loaded.set(map.name, t);
  }
  return t;
}

/** Metres per CSS pixel on screen at this fragment, for lines that keep their width at every zoom. */
const cssPx = () => fwidth(positionWorld.x).mul(devicePixelRatio);

/** Colour node of the play plane: bake inside the boundary, dimmed outside, HQ zones tinted, boundary line on the edge. */
function playColour(map: BakedMap, t: Textures, commander: SideId): THREE.Node<'vec3'> {
  const px = cssPx();
  const sd = texture(t.sdf, positionWorld.xy.div(map.sizeM).add(0.5)).r.mul(255).sub(128).div(SDF_PER_M); // metres, negative inside
  const inside = float(1).sub(smoothstep(px.negate(), px, sd));
  let c = mix(oob(t.play, map.sizeM / OOB_BLOCK_M, 5), grade(texture(t.play).rgb), inside);
  for (const side of SIDES) {
    const hq = map.hqs[side];
    const team = new THREE.Color(side === commander ? COLOR.friendly : COLOR.hostile);
    const d = length(positionWorld.xy.sub(vec2(hq.x, hq.y)));
    const fill = float(1).sub(smoothstep(float(hq.radius).sub(px), float(hq.radius).add(px), d));
    const ring = float(1).sub(smoothstep(px, px.mul(2), d.sub(hq.radius).abs()));
    c = mix(c, vec3(team.r, team.g, team.b), fill.mul(HQ_TINT).add(ring.mul(0.9)));
  }
  const casing = float(1).sub(smoothstep(px.mul(2.5), px.mul(3.5), sd.abs()));
  const cream = float(1).sub(smoothstep(px.mul(1.25), px.mul(2.25), sd.abs()));
  const line = new THREE.Color(0xece8ce);
  return mix(mix(c, vec3(0, 0, 0), casing.mul(0.55)), vec3(line.r, line.g, line.b), cream.mul(0.95));
}

/** Fits the Play Area between the rails and sets the zoom range from the whole surroundings down to the bake's full detail. */
export function fitView(map: MapData | BakedMap) {
  const xs = map.playArea.map((p) => p.x);
  const ys = map.playArea.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const zoomFor = (mpp: number) => (camera.top - camera.bottom) / (mpp * innerHeight);
  if ('images' in map) {
    zoomRange.min = zoomFor(map.images.outer.sizeM / innerWidth);
    zoomRange.max = zoomFor(map.sizeM / 2 ** (map.images.play.length - 1)); // the top level is a power of two px wide: one texel per px
  }
  const fit = zoomFor(Math.max(w / Math.max(1, innerWidth - 2 * RAILS_PX), h / (innerHeight - 2 * MARGIN_PX)));
  camera.zoom = fit;
  camera.position.x = (Math.min(...xs) + Math.max(...xs)) / 2;
  camera.position.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  camera.updateProjectionMatrix();
}

export async function drawMap(map: MapData | BakedMap) {
  fitView(map);
  if (!('images' in map)) {
    const ground = new THREE.MeshBasicNodeMaterial();
    const { r, g, b } = new THREE.Color(COLOR.ground); // linear
    ground.colorNode = grade(vec3(r, g, b));
    layer.add(new THREE.Mesh(new THREE.PlaneGeometry(640, 640), ground));
    const outline = [...map.playArea, map.playArea[0]!].map((p) => new THREE.Vector3(p.x, p.y, 0.1)); // WebGPURenderer has no LineLoop
    layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: COLOR.bone })));
    return;
  }
  const t = await textures(map);
  const outerM = map.images.outer.sizeM;
  const outerMat = new THREE.MeshBasicNodeMaterial();
  outerMat.colorNode = vec4(oob(t.outer, outerM / OOB_BLOCK_M, 1), 1);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(outerM, outerM), outerMat);
  outer.position.z = -1;
  const playMat = new THREE.MeshBasicNodeMaterial({ transparent: true });
  playMat.colorNode = vec4(playColour(map, t, session.commanderSide), 1);
  const edge = positionWorld.x.abs().max(positionWorld.y.abs());
  playMat.opacityNode = float(1).sub(smoothstep(map.sizeM / 2 - 40, map.sizeM / 2, edge)); // crossfade into the surroundings
  layer.add(outer, new THREE.Mesh(new THREE.PlaneGeometry(map.sizeM, map.sizeM), playMat));
}
