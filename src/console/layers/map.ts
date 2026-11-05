// Stand-in map: a flat plane under the Play Area outline, through the tablet grade (#42's baked texture goes in its place).
import * as THREE from 'three/webgpu';
import type { MapData } from '../../sim/types';
import { vec3 } from 'three/tsl';
import { COLOR, grade, layer } from '../renderer';

export function drawMap(map: MapData) {
  const ground = new THREE.MeshBasicNodeMaterial();
  const { r, g, b } = new THREE.Color(COLOR.ground); // linear
  ground.colorNode = grade(vec3(r, g, b));
  layer.add(new THREE.Mesh(new THREE.PlaneGeometry(640, 640), ground));
  const outline = [...map.playArea, map.playArea[0]!].map((p) => new THREE.Vector3(p.x, p.y, 0.1)); // WebGPURenderer has no LineLoop
  layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: COLOR.bone })));
}
