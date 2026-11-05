// Stand-in map: a flat plane under the Play Area outline.
import * as THREE from 'three/webgpu';
import type { MapData } from '../../sim/types';
import { COLOR, flat, layer } from '../renderer';

export function drawMap(map: MapData) {
  layer.add(new THREE.Mesh(new THREE.PlaneGeometry(640, 640), flat(COLOR.ground)));
  const outline = [...map.playArea, map.playArea[0]!].map((p) => new THREE.Vector3(p.x, p.y, 0.1)); // WebGPURenderer has no LineLoop
  layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: COLOR.bone })));
}
