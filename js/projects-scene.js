// Projects-page hero: three units of the autonomous robotic fleet, rendered from the car's own CAD
// (models/fleet-car.*), driving a loop around obstacle blocks with ultrasonic pings ahead of each car.
import { THREE, createStage, run, hash, smooth } from './scene-kit.js';

const canvas = document.getElementById('projects-scene');
const stage = canvas && createStage(canvas, { fogNear: 18, fogFar: 60, colors: { seg: '#f0b860' } });
if (stage) loadCar().then((car) => init(stage, car)).catch(() => canvas.remove());

// models/fleet-car.json describes each part; fleet-car.bin holds quantized positions + indices.
async function loadCar() {
  const base = new URL('../models/fleet-car', import.meta.url);
  const [meta, buf] = await Promise.all([
    fetch(base + '.json').then((r) => r.json()),
    fetch(base + '.bin').then((r) => r.arrayBuffer()),
  ]);
  const parts = {};
  for (const p of meta.parts) {
    const q = new Uint16Array(buf, p.vOff, p.vCount * 3);
    const pos = new Float32Array(p.vCount * 3);
    for (let i = 0; i < p.vCount; i++) for (let a = 0; a < 3; a++)
      pos[i * 3 + a] = p.min[a] + (q[i * 3 + a] / 65535) * (p.max[a] - p.min[a]);
    const idx = p.i32 ? new Uint32Array(buf, p.iOff, p.iCount) : new Uint16Array(buf, p.iOff, p.iCount);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    parts[p.name] = { geo: g, centre: new THREE.Vector3(...p.centre) };
  }
  return parts;
}

function init({ renderer, scene, camera, C, part }, car) {
  const lineMat = (color, opacity, extra = {}) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, ...extra });

  // ---------- lab floor ----------
  const grid = new THREE.GridHelper(120, 60, C.terrain, C.terrain);
  grid.material.transparent = true; grid.material.opacity = 0.45;
  scene.add(grid);
  const fine = new THREE.GridHelper(120, 240, C.terrain, C.terrain);
  fine.material.transparent = true; fine.material.opacity = 0.12; fine.position.y = -0.005;
  scene.add(fine);

  // ---------- route: a closed loop that weaves between obstacle blocks ----------
  const route = new THREE.CatmullRomCurve3([
    [-14, -2], [-9, -9], [0, -8], [6, -3], [12, -8], [18, -2], [15, 7], [6, 6], [-2, 10], [-11, 7],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const LEN = route.getLength();
  // dashed route line on the floor
  const rPts = route.getSpacedPoints(400).map((p) => p.clone().setY(0.02));
  const routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rPts),
    new THREE.LineDashedMaterial({ color: C.main, dashSize: 0.35, gapSize: 0.35, transparent: true, opacity: 0.35 }));
  routeLine.computeLineDistances();
  scene.add(routeLine);

  // obstacle blocks just outside the bends (they fade out when they come between camera and fleet)
  const blocks = [];
  const blockCol = C.terrain.clone().lerp(C.main, 0.45);
  for (const [x, z, w, d, h] of [[-3, -3, 3, 2.4, 1.6], [9, 0, 2.6, 2.6, 2.2], [12, -12, 3, 2, 1.4], [2, 13.5, 3.4, 2.2, 1.8],
                                 [-8, 2, 2.2, 3, 2.4], [-17, -9, 2.6, 2.6, 1.6], [20, 4, 2, 3, 2], [-15, 11, 3, 2, 1.4]]) {
    const fade = [];
    const b = part(new THREE.BoxGeometry(w, h, d, 2, 2, 2), blockCol, { wire: 0.16, fade });
    b.position.set(x, h / 2, z); b.rotation.y = hash(x, z) * 1.2 - 0.6;
    scene.add(b); blocks.push({ b, fade });
  }

  // ---------- the car, from CAD ----------
  const R = C.main, B = C.bright;
  function makeCar() {
    const g = new THREE.Group();
    g.add(part(car.chassis.geo, R, { wire: 0.08, angle: 25 }));
    g.add(part(car.camera.geo, B, { wire: 0.1, angle: 25 }));
    g.add(part(car.caster.geo, R, { wire: 0, angle: 30, edge: 0.6 }));
    const wheels = ['wheelL', 'wheelR'].map((n) => {
      const geo = car[n].geo.clone(); geo.translate(-car[n].centre.x, -car[n].centre.y, -car[n].centre.z);
      const w = part(geo, B, { wire: 0.12, angle: 25 }); w.position.copy(car[n].centre); g.add(w);
      return w;
    });
    // axle stubs (the drive motors aren't in the CAD) so the outboard wheels read as attached
    for (const zs of [-1, 1]) {
      const ax = part(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), R, { wire: 0 });
      ax.rotation.x = Math.PI / 2; ax.position.set(0, 0.5, zs * 1.45); g.add(ax);
    }
    // ultrasonic pings: arcs that expand ahead of the camera mount and fade
    const pings = [];
    const arcPts = []; for (let i = 0; i <= 24; i++) { const a = -0.45 + (i / 24) * 0.9; arcPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Line(arcGeo, lineMat(C.seg, 0, { blending: THREE.AdditiveBlending }));
      m.position.set(0.95, 2.05, 0); g.add(m); pings.push(m);
    }
    scene.add(g);
    return { g, wheels, pings };
  }
  const fleet = [makeCar(), makeCar(), makeCar()];
  const GAP = 9.5 / LEN;                   // spacing between cars along the route (fraction of loop)

  // ---------- animation ----------
  const SPEED = 1.7, LOOP = LEN / SPEED;
  let wide = true;
  const P = new THREE.Vector3(), T = new THREE.Vector3(), F = new THREE.Vector3(), NDC = new THREE.Vector3(), camRight = new THREE.Vector3();

  function frame(t) {
    const u0 = ((t / LOOP) % 1 + 1) % 1;
    fleet.forEach((c, i) => {
      const u = ((u0 - i * GAP) % 1 + 1) % 1;
      route.getPointAt(u, P); route.getTangentAt(u, T);
      c.g.position.copy(P);
      c.g.rotation.y = Math.atan2(-T.z, T.x);
      const dist = u * LEN;
      for (const w of c.wheels) w.rotation.z = -dist / 0.5;
      c.pings.forEach((m, k) => {
        const ph = ((t + i * 0.27) / 0.9 + k / 3) % 1;   // three arcs in flight, staggered
        m.scale.setScalar(0.2 + ph * 3.6);
        m.material.opacity = (1 - ph) * 1.0;
      });
    });

    // camera: off the lead car's front-left quarter, following its (smoothed) heading, so the
    // followers trail away to the right and the lead car sits right of the headline
    const lead = fleet[0].g.position;
    F.set(0, 0, 0);
    for (let k = -4; k <= 4; k++) { route.getTangentAt((((u0 + k * 0.008) % 1) + 1) % 1, T); F.add(T); }
    F.y = 0; F.normalize();
    const phi = 0.6 + Math.sin(t * 0.15) * 0.12;
    const dist = wide ? 15 : 14;
    // left of forward is (f.z, 0, -f.x)
    camera.position.set(
      lead.x + (Math.cos(phi) * F.x + Math.sin(phi) * F.z) * dist,
      wide ? 6.8 : 7,
      lead.z + (Math.cos(phi) * F.z - Math.sin(phi) * F.x) * dist);
    camera.lookAt(lead.x, 1, lead.z);
    camera.updateMatrixWorld();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const off = wide ? 4.2 : 0;
    camera.lookAt(lead.x - camRight.x * off, wide ? 0.6 : 0.8, lead.z - camRight.z * off);
    for (const { b, fade } of blocks) {
      const k = smooth(-4, -1, b.position.distanceTo(camera.position) - camera.position.distanceTo(lead));   // hide blocks in front of the lead car
      // ...and, on wide layouts, blocks drifting behind the headline on the left
      const kx = wide ? smooth(-0.25, 0.15, NDC.copy(b.position).project(camera).x) : 1;
      const kk = Math.min(k, kx);
      for (const [m, o] of fade) m.opacity = o * kk;
      b.visible = kk > 0.01;
    }
    renderer.render(scene, camera);
  }

  run({ canvas, renderer, camera, frame, stillT: 6,
    onResize: (w, h) => { wide = w / h > 1.25; camera.fov = wide ? 32 : 44; },
    debug: { fleet } });
}
