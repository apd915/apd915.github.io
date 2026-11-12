// About-page hero: a wireframe rover crossing rough terrain while a VTOL lifts off its back.
// Built from Three.js primitives only. Rover style (default industrial): ?rover=current | industrial | planetary
import { THREE, createStage, run, hash, vnoise, fbm, smooth, ease, at, ring, params } from './scene-kit.js';

const canvas = document.getElementById('hero-scene');
const ROVER_STYLE = params.get('rover') || canvas?.dataset.rover || 'industrial';
const stage = canvas && createStage(canvas, { fogNear: 14, fogFar: 46 });
if (stage) init(stage);

function init({ renderer, scene, camera, C, part }) {
  // ---------- terrain: rough ground, gentler on the rover's track (z ~ 0), ridges in the distance ----------
  const height = (x, z) => {
    const near = fbm(x * 0.11, z * 0.11) * 2.4 - 1.2;
    const bumps = (vnoise(x * 0.9, z * 0.9) - 0.5) * 0.35;
    const track = 0.45 + 0.55 * smooth(1.5, 7, Math.abs(z));
    const ridge = 1 - Math.abs(fbm(x * 0.045 + 7, z * 0.045) * 2 - 1);
    const far = smooth(8, 30, -z) * (ridge * ridge * 9);
    return (near + bumps) * track + far;
  };
  const SIZE = 110, SEG = 110, CELL = SIZE / SEG;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate(10, 0, -SIZE / 2 + 14);
  const tPos = terrainGeo.attributes.position;
  const baseX = Float32Array.from({ length: tPos.count }, (_, i) => tPos.getX(i));
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshBasicMaterial({ color: C.terrain, wireframe: true, transparent: true, opacity: 0.55 }));
  scene.add(terrain);
  let lastSnap = null;
  // The grid scrolls with the ground and jumps back one cell at a time, so it looks endless.
  function updateTerrain(offset) {
    const snap = Math.floor(offset / CELL) * CELL;
    terrain.position.x = snap - offset;
    if (snap === lastSnap) return;
    lastSnap = snap;
    for (let i = 0; i < tPos.count; i++) tPos.setY(i, height(baseX[i] + snap, tPos.getZ(i)));
    tPos.needsUpdate = true;
  }

  // ---------- rover ----------
  const rv = buildRover(ROVER_STYLE, part, C.main);
  scene.add(rv.group);
  const wx = rv.wheels.map((w) => w.x), wz = rv.wheels.map((w) => w.z);
  const xMax = Math.max(...wx), xMin = Math.min(...wx);
  const wheelbase = xMax - xMin, track = 2 * Math.max(...wz);

  // ---------- VTOL (quadplane: 4 lift rotors + pusher) ----------
  const vtolFade = [];
  const vtol = new THREE.Group();
  const V = C.bright, vo = { fade: vtolFade };
  const body = new THREE.Group(); vtol.add(body);
  const prof = [[0, -1.0], [0.08, -0.95], [0.14, -0.8], [0.17, -0.5], [0.17, 0.2], [0.13, 0.6], [0.06, 0.85], [0, 0.9]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const fus = part(new THREE.LatheGeometry(prof, 14), V, { ...vo, wire: 0.25 });
  fus.rotation.z = -Math.PI / 2; body.add(fus);
  body.add(at(part(new THREE.BoxGeometry(0.42, 0.035, 3.0, 2, 1, 12), V, { ...vo, wire: 0.22 }), 0.05, 0.1, 0));
  for (const z of [-0.62, 0.62]) {
    const boom = part(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), V, { ...vo, wire: 0 });
    boom.rotation.z = Math.PI / 2; boom.position.set(-0.05, 0.08, z); body.add(boom);
    const fin = part(new THREE.BoxGeometry(0.3, 0.32, 0.02, 2, 2, 1), V, { ...vo, wire: 0.2 });
    fin.position.set(-1.0, 0.22, z); fin.rotation.x = z > 0 ? -0.5 : 0.5; body.add(fin);
  }
  for (const z of [-0.25, 0.25]) {
    body.add(at(part(new THREE.BoxGeometry(0.9, 0.02, 0.03), V, { ...vo, wire: 0, fill: false }), 0, -0.3, z));
    for (const x of [-0.25, 0.25]) body.add(at(part(new THREE.BoxGeometry(0.02, 0.16, 0.02), V, { ...vo, wire: 0, fill: false }), x, -0.21, z));
  }
  const rotors = [];
  function rotor(r, blades) {
    const g = new THREE.Group();
    const disc = new THREE.LineLoop(ring(r, 36), new THREE.LineBasicMaterial({ color: V, transparent: true, opacity: 0.35 }));
    vtolFade.push([disc.material, 0.35]);
    disc.rotation.x = -Math.PI / 2; g.add(disc);
    const spin = new THREE.Group(); g.add(spin);
    for (let i = 0; i < blades; i++) {
      const b = part(new THREE.BoxGeometry(r * 0.95, 0.012, 0.06), V, { ...vo, wire: 0, fill: false });
      b.position.x = r * 0.47; const p = new THREE.Group(); p.rotation.y = (i / blades) * Math.PI * 2; p.add(b); spin.add(p);
    }
    g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), V, { ...vo, wire: 0 }));
    rotors.push(spin);
    return g;
  }
  for (const x of [-0.95, 0.85]) for (const z of [-0.62, 0.62]) vtol.add(at(rotor(0.36, 2), x, 0.16, z));
  const pusher = rotor(0.2, 3); pusher.rotation.z = Math.PI / 2; pusher.position.set(-1.12, 0.05, 0); vtol.add(pusher);
  vtol.scale.setScalar(0.85);
  scene.add(vtol);

  // ---------- scattered rocks behind the track ----------
  const rocks = [];
  for (let i = 0; i < 18; i++) {
    const z = -2.4 - hash(i, 3.1) * 10;
    const g = new THREE.IcosahedronGeometry(0.18 + hash(i, 7.7) * 0.45, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.8 + hash(k, i) * 0.4), p.getY(k) * 0.5, p.getZ(k) * (0.8 + hash(i, k) * 0.4));
    const rock = part(g, C.terrain.clone().lerp(C.main, 0.35), { edge: 0.8, wire: 0.25 });
    rock.userData = { x: hash(i, 1.3) * 70 - 20, z };
    rock.rotation.y = hash(i, 9.2) * 6;
    scene.add(rock); rocks.push(rock);
  }

  if (params.has('scene_bare')) { rv.group.visible = false; vtol.visible = false; }   // terrain only (used for page-band textures)

  // ---------- animation ----------
  let wide = true;
  const SPEED = 1.1, LOOP = 20;
  const tmp = new THREE.Vector3(), q = new THREE.Quaternion(), qLevel = new THREE.Quaternion();
  const CAM = { px: 4.4, py: 2.0, pz: 11.5, tx: -3.6, ty: -0.2, k: 0.3 };
  let camY = null;

  function frame(t) {
    const offset = t * SPEED;
    updateTerrain(offset);

    // rover pose from wheel contact heights
    const hw = rv.wheels.map(({ x, z }) => height(x + offset, z));
    const mean = (f) => { let s = 0, n = 0; hw.forEach((h, i) => { if (f(i)) { s += h; n++; } }); return s / n; };
    const front = mean((i) => wx[i] === xMax), back = mean((i) => wx[i] === xMin);
    const left = mean((i) => wz[i] < 0), right = mean((i) => wz[i] > 0);
    const avg = mean(() => true);
    const grp = rv.group;
    grp.position.set(0, avg + rv.ride, 0);
    grp.rotation.set(Math.atan2(left - right, track) * 0.9, 0, Math.atan2(front - back, wheelbase) * 0.9, 'XYZ');
    grp.updateMatrixWorld(true);
    if (camY === null) camY = grp.position.y;
    rv.wheels.forEach((w, i) => {
      tmp.set(w.x, hw[i] + rv.R, w.z);
      grp.worldToLocal(tmp);
      w.obj.position.y = Math.max(rv.yRange[0], Math.min(rv.yRange[1], tmp.y));
      w.spin.rotation.z = -offset / rv.R;
    });
    rv.update(t);

    for (const r of rocks) {
      let x = r.userData.x - offset;
      x = ((x + 30) % 85 + 85) % 85 - 30;
      r.position.set(x, height(x + offset, r.userData.z) - 0.06, r.userData.z);
    }

    // VTOL cycle: docked, spin up, vertical climb, transition to forward flight, bank away
    const c = t % LOOP;
    const dock = tmp.copy(rv.dock); grp.localToWorld(dock);
    const climb = ease((c - 3) / 5) * 2.4;
    const sF = Math.max(0, c - 7.5);
    const TURN = 2.1;
    const heading = (s) => ease(s / 2.6) * TURN;
    let px = 0, pz = 0;
    for (let k = 0, n = 40, ds = sF / n; k < n; k++) {
      const s = (k + 0.5) * ds, v = 0.25 + s * 0.85, th = heading(s);
      px += Math.cos(th) * v * ds; pz -= Math.sin(th) * v * ds;
    }
    const bank = Math.sin(Math.min(sF / 3.2, 1) * Math.PI) * 0.3;
    const lift = ease((c - 2.6) / 2.5);
    const baseY = dock.y + ((camY + 0.6) - dock.y) * lift;
    vtol.position.set(dock.x + px, baseY + climb + sF * 0.05, dock.z + pz);
    q.setFromEuler(grp.rotation);
    qLevel.setFromEuler(new THREE.Euler(-bank, heading(sF), -0.08 * ease(sF / 1.5), 'YZX'));
    vtol.quaternion.copy(q).slerp(qLevel, lift);
    const rpm = ease((c - 1) / 2) * 32;
    rotors.forEach((r, i) => { r.rotation.y += (i === rotors.length - 1 ? (c > 7 ? 40 : 0) : rpm) * 0.016; });
    const fade = Math.min(ease(c / 1.2), 1 - ease((c - 15) / 3));
    for (const [m, o] of vtolFade) m.opacity = o * fade;

    // camera: slow drift, framed so the rover sits right of the headline
    const sway = Math.sin(t * 0.12);
    camY += (grp.position.y - camY) * 0.04;
    if (params.get('scene_view') === 'rover') {          // review close-up
      camera.position.set(3.4, camY + 1.5, 6.4);
      camera.lookAt(-0.1, camY + 0.25, 0);
    } else if (wide) {
      camera.position.set(CAM.px + sway * 1.0, camY + CAM.py + Math.sin(t * 0.09) * 0.25, CAM.pz);
      camera.lookAt(CAM.tx, camY + CAM.ty + climb * CAM.k, -0.6);
    } else {
      camera.position.set(2.6 + sway * 0.5, camY + 2.0, 9.6);
      camera.lookAt(0.6, camY + 1.0 + climb * 0.45, -1.0);
    }
    renderer.render(scene, camera);
  }

  run({ canvas, renderer, camera, frame, stillT: 5.5,
    onResize: (w, h) => { wide = w / h > 1.25; camera.fov = wide ? 30 : 42; },
    debug: { rover: rv.group, vtol, CAM } });
}

// ======================================================================================
// Rover builds. Each returns the group plus what the animation needs:
//   wheels [{obj, spin, x, z}], R (wheel radius), ride (body height above ground),
//   yRange (wheel travel, local), dock (VTOL pad, local), update(t) for moving parts.
// ======================================================================================
function buildRover(style, part, R) {
  const group = new THREE.Group();
  const lineMat = (o = 0.9) => new THREE.LineBasicMaterial({ color: R, transparent: true, opacity: o });
  const pad = (x, y, r = 0.5) => {
    const p = new THREE.LineLoop(ring(r, 40), lineMat(0.6)); p.rotation.x = -Math.PI / 2; p.position.set(x, y, 0); group.add(p);
    const p2 = new THREE.LineLoop(ring(r * 0.6, 32), lineMat(0.3)); p2.rotation.x = -Math.PI / 2; p2.position.set(x, y, 0); group.add(p2);
  };
  // A wheel: everything inside `spin` is built in the x-y plane with the axle along z.
  function wheel(x, z, r, width, extras) {
    const obj = new THREE.Group(), spin = new THREE.Group();
    const tyre = part(new THREE.CylinderGeometry(r, r, width, 22, 2), R, { wire: 0.25 });
    tyre.rotation.x = Math.PI / 2; spin.add(tyre);
    extras(spin, r, width);
    obj.add(spin); obj.position.set(x, -0.4, z); group.add(obj);
    return { obj, spin, x, z };
  }
  const around = (spin, n, make) => {
    for (let i = 0; i < n; i++) { const p = new THREE.Group(); p.rotation.z = (i / n) * Math.PI * 2; p.add(make(i)); spin.add(p); }
  };
  // dynamic linkage lines (suspension), updated every frame from wheel positions
  function links(nSegments) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nSegments * 6), 3));
    group.add(new THREE.LineSegments(geo, lineMat(0.95)));
    let k = 0;
    return {
      begin() { k = 0; },
      seg(a, b) { const p = geo.attributes.position; p.setXYZ(k++, a.x, a.y, a.z); p.setXYZ(k++, b.x, b.y, b.z); },
      end() { geo.attributes.position.needsUpdate = true; },
    };
  }
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  if (style === 'industrial') {
    // Rugged field UGV: armoured hull with sloped plates, big lugged tyres, roll bar with sensors.
    const shape = new THREE.Shape([[-1.35, -0.2], [1.2, -0.2], [1.45, 0.05], [1.3, 0.32], [-1.15, 0.32], [-1.4, 0.1]].map(([x, y]) => new THREE.Vector2(x, y)));
    const hull = new THREE.ExtrudeGeometry(shape, { depth: 1.35, bevelEnabled: false });
    hull.translate(0, 0, -0.675);
    group.add(part(hull, R, { wire: 0.1 }));
    group.add(at(part(new THREE.BoxGeometry(2.1, 0.04, 1.15, 10, 1, 5), R, { wire: 0.2 }), -0.1, 0.34, 0));      // deck plate
    for (const z of [-0.55, 0.55]) group.add(at(part(new THREE.BoxGeometry(0.06, 0.48, 0.06), R, { wire: 0 }), 0.8, 0.58, z));
    group.add(at(part(new THREE.BoxGeometry(0.06, 0.06, 1.2), R, { wire: 0 }), 0.8, 0.82, 0));                   // roll bar
    for (const z of [-0.36, 0.36]) group.add(at(part(new THREE.BoxGeometry(0.12, 0.1, 0.14), R, { wire: 0 }), 0.86, 0.82, z)); // cameras
    const lidar = at(part(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 16), R), 0.8, 0.94, 0); group.add(lidar);
    for (const z of [-0.45, 0.45]) group.add(at(part(new THREE.BoxGeometry(0.05, 0.08, 0.16), R, { wire: 0 }), 1.39, 0.12, z)); // lights
    group.add(at(part(new THREE.BoxGeometry(0.1, 0.14, 1.45, 1, 1, 4), R, { wire: 0 }), 1.5, -0.12, 0));        // bumper
    group.add(at(part(new THREE.BoxGeometry(0.14, 0.08, 0.2), R, { wire: 0 }), -1.45, -0.12, 0));              // tow hitch
    group.add(at(part(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4), R, { wire: 0 }), -0.95, 0.77, -0.52));  // whip antenna
    pad(-0.6, 0.37, 0.48);
    const r = 0.44;
    const wheels = [];
    for (const x of [-0.95, 0, 0.95]) for (const z of [-0.9, 0.9]) wheels.push(wheel(x, z, r, 0.36, (spin, rr, w) => {
      const rim = part(new THREE.CylinderGeometry(rr * 0.55, rr * 0.55, w + 0.02, 10), R, { wire: 0.3 }); rim.rotation.x = Math.PI / 2; spin.add(rim);
      around(spin, 14, (i) => at(part(new THREE.BoxGeometry(0.1, 0.07, 0.16), R, { wire: 0, fill: false, edge: 0.75 }), 0, rr + 0.025, i % 2 ? 0.09 : -0.09));
    }));
    const L = links(6), a = V3(), b = V3();
    return { group, wheels, R: r, ride: r + 0.33, yRange: [-0.7, -0.2], dock: V3(-0.6, 0.62, 0),
      update(t) {
        lidar.rotation.y = t * 4;
        L.begin();
        for (const w of wheels) L.seg(a.set(w.x, -0.18, Math.sign(w.z) * 0.62), b.set(w.x, w.obj.position.y, Math.sign(w.z) * 0.72));
        L.end();
      } };
  }

  if (style === 'planetary') {
    // Exploration rover: low body under a wide solar deck, tall camera mast, dish antenna,
    // thin spoked wheels on an exposed rocker-bogie suspension.
    group.add(part(new THREE.BoxGeometry(1.9, 0.4, 1.0, 8, 2, 4), R));
    group.add(at(part(new THREE.BoxGeometry(2.5, 0.04, 1.7, 14, 1, 9), R, { wire: 0.28 }), -0.05, 0.25, 0));   // solar deck
    group.add(at(part(new THREE.CylinderGeometry(0.04, 0.05, 1.15, 8), R, { wire: 0 }), 0.85, 0.85, -0.4));     // mast
    const head = new THREE.Group(); head.position.set(0.85, 1.48, -0.4); group.add(head);
    head.add(part(new THREE.BoxGeometry(0.22, 0.17, 0.5, 2, 2, 3), R));
    for (const z of [-0.13, 0.13]) { const eye = part(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), R, { wire: 0 }); eye.rotation.z = Math.PI / 2; eye.position.set(0.13, 0, z); head.add(eye); }
    group.add(at(part(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6), R, { wire: 0 }), 0.95, 0.42, 0.6));
    const dish = part(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 22), R, { wire: 0.3 }); dish.position.set(0.95, 0.62, 0.6); dish.rotation.z = 0.9; group.add(dish);
    pad(-0.4, 0.29, 0.5);
    const r = 0.3;
    const wheels = [];
    for (const x of [-1.05, 0.05, 1.1]) for (const z of [-1.0, 1.0]) wheels.push(wheel(x, z, r, 0.22, (spin, rr) => {
      around(spin, 6, () => at(part(new THREE.BoxGeometry(0.015, rr * 0.9, 0.02), R, { wire: 0, fill: false, edge: 0.7 }), 0, rr * 0.45, 0));
      around(spin, 12, () => at(part(new THREE.BoxGeometry(0.03, 0.03, 0.24), R, { wire: 0, fill: false, edge: 0.7 }), 0, rr + 0.012, 0));
    }));
    const L = links(12), P = V3(), B = V3(), H = V3();
    const hub = (w) => H.set(w.x, w.obj.position.y, w.z * 0.92);
    return { group, wheels, R: r, ride: r + 0.6, yRange: [-0.85, -0.3], dock: V3(-0.4, 0.55, 0),
      update(t) {
        head.rotation.y = Math.sin(t * 0.5) * 0.6;
        L.begin();
        for (const side of [-1, 1]) {
          const ws = wheels.filter((w) => Math.sign(w.z) === side).sort((a, b) => a.x - b.x);   // rear, mid, front
          P.set(-0.15, -0.08, side * 0.62);                                                    // rocker pivot on the body
          const mid = ws[1], fr = ws[2];
          B.set((mid.x + fr.x) / 2, Math.max(mid.obj.position.y, fr.obj.position.y) + 0.22, side * 0.92);
          L.seg(P, hub(ws[0]).clone()); L.seg(P, B); L.seg(B, hub(mid).clone()); L.seg(B, hub(fr).clone());
          L.seg(P, H.set(P.x, P.y, side * 0.5));                                                // axle into the body
          L.seg(B, H.set(B.x, B.y + 0.02, side * 0.92));
        }
        L.end();
      } };
  }

  // 'current': the first version, in between the two
  group.add(part(new THREE.BoxGeometry(2.5, 0.42, 1.25, 8, 2, 4), R));
  group.add(at(part(new THREE.BoxGeometry(2.1, 0.12, 1.05, 6, 1, 3), R, { wire: 0.12 }), -0.1, 0.27, 0));
  pad(-0.3, 0.34, 0.5);
  group.add(at(part(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), R, { wire: 0 }), 1.0, 0.6, 0));
  group.add(at(part(new THREE.BoxGeometry(0.28, 0.2, 0.5, 2, 2, 3), R), 1.0, 1.0, 0));
  const lidar = at(part(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 16, 1), R), 1.0, 1.18, 0); group.add(lidar);
  group.add(at(part(new THREE.BoxGeometry(0.12, 0.18, 1.1, 1, 1, 4), R), 1.3, -0.05, 0));
  const r = 0.38;
  const wheels = [];
  for (const x of [-0.95, 0.05, 1.05]) for (const z of [-0.82, 0.82]) wheels.push(wheel(x, z, r, 0.3, (spin, rr) => {
    around(spin, 10, () => at(part(new THREE.BoxGeometry(0.06, 0.05, 0.32), R, { wire: 0, fill: false, edge: 0.7 }), 0, rr + 0.02, 0));
  }));
  const L = links(6), a = V3(), b = V3();
  return { group, wheels, R: r, ride: r + 0.38, yRange: [-0.75, -0.1], dock: V3(-0.3, 0.6, 0),
    update(t) {
      lidar.rotation.y = t * 4;
      L.begin();
      for (const w of wheels) L.seg(a.set(w.x * 0.6, -0.18, w.z * 0.7), b.set(w.x, w.obj.position.y, w.z * 0.82));
      L.end();
    } };
}
