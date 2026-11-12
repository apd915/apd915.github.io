// Research-page hero: a quadrotor flies a smooth trajectory through a chain of safe flight corridors
// over farmland, while its downward camera segments the roads below into a road graph.
// (COAST planning + road-topology perception in one scene.) Built from Three.js primitives only.
import { THREE, createStage, run, hash, fbm, ease, at, ring, params } from './scene-kit.js';

const canvas = document.getElementById('research-scene');
const inset = document.querySelector('.scene-inset');
const stage = canvas && createStage(canvas, {
  fogNear: 16, fogFar: 62,
  colors: { seg: '#f0b860', sfc: '#8fa8ff' },
});
if (stage) init(stage);

function init({ renderer, scene, camera, C, part }) {
  const OVERLAY = 1;                       // layer for things only the main camera sees (drone, corridors, path)
  camera.layers.enable(OVERLAY);
  const lineMat = (color, opacity, extra = {}) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, ...extra });

  // ---------- ground ----------
  const ground = (x, z) => (fbm(x * 0.035 + 3, z * 0.035) - 0.5) * 2.2 + Math.max(0, -z - 26) * 0.18 * fbm(x * 0.08, z * 0.08);
  const gGeo = new THREE.PlaneGeometry(150, 150, 75, 75);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, ground(gp.getX(i), gp.getZ(i)));
  scene.add(new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({ color: C.terrain, wireframe: true, transparent: true, opacity: 0.32 })));
  const onGround = (pts, lift = 0.04) => pts.map(([x, z]) => new THREE.Vector3(x, ground(x, z) + lift, z));
  const polyline = (pts, mat, loop = false) => new (loop ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry().setFromPoints(pts), mat);
  // a straight edge sampled along the terrain so it hugs the ground
  const groundSeg = (a, b, step = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)), out = [];
    for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    return out;
  };

  // ---------- roads (polylines sampled every ~0.35 units) ----------
  const sampleRoad = (f, s0, s1, step = 0.35) => { const out = []; for (let s = s0; s <= s1; s += step) out.push(f(s)); return out; };
  const roads = [
    sampleRoad((s) => [s, -2 + 5 * Math.sin(s / 14)], -60, 60),            // main road, east-west
    sampleRoad((s) => [3 + 4 * Math.sin(s / 11), s], -60, 45),             // crossing road, north-south
    sampleRoad((s) => [-10 - s * 0.55, -2 + 5 * Math.sin(-10 / 14) + s], 0, 14),   // farm lane to the barn
    sampleRoad((s) => [3 + 4 * Math.sin(-16 / 11) + s, -16 - s * 0.25], 0, 22),    // lane to the east fields
  ];
  const roadEdge = lineMat(C.terrain.clone().lerp(C.main, 0.35), 0.5);
  // Segmentation state lives per road sample: when it was last inside the camera footprint.
  const samples = [];                      // {x, z, road, i}
  roads.forEach((pts, r) => pts.forEach(([x, z], i) => samples.push({ x, z, r, i })));
  const seenAt = new Float32Array(samples.length).fill(-1e9);
  const inView = new Uint8Array(samples.length);

  // road surface ribbons (segmentation mask) + edges, and centrelines (graph edges)
  const ribbonColor = [], graphColor = [];
  let sIdx = 0;
  roads.forEach((pts) => {
    const L = [], R = [], cl = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], [x2, z2] = pts[Math.min(i + 1, pts.length - 1)], [x0, z0] = pts[Math.max(i - 1, 0)];
      const dx = x2 - x0, dz = z2 - z0, len = Math.hypot(dx, dz) || 1, nx = -dz / len * 0.55, nz = dx / len * 0.55;
      L.push([x + nx, z + nz]); R.push([x - nx, z - nz]); cl.push([x, z]);
    }
    scene.add(polyline(onGround(L, 0.05), roadEdge), polyline(onGround(R, 0.05), roadEdge));
    // ribbon
    const pos = [], idx = [], col = [];
    const l3 = onGround(L, 0.06), r3 = onGround(R, 0.06);
    for (let i = 0; i < pts.length; i++) {
      pos.push(l3[i].x, l3[i].y, l3[i].z, r3[i].x, r3[i].y, r3[i].z);
      col.push(0, 0, 0, 0, 0, 0);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rg.setIndex(idx);
    scene.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    ribbonColor.push({ attr: rg.attributes.color, start: sIdx, n: pts.length, perSample: 2 });
    // centreline graph edges
    const c3 = onGround(cl, 0.1);
    const lg = new THREE.BufferGeometry().setFromPoints(c3);
    lg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pts.length * 3), 3));
    scene.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true })));
    graphColor.push({ attr: lg.attributes.color, start: sIdx, n: pts.length, perSample: 1 });
    sIdx += pts.length;
  });
  // graph nodes: every ~10 samples plus road ends
  const nodes = [];
  const nodeGeo = new THREE.OctahedronGeometry(0.16, 0);
  samples.forEach((s, k) => {
    const n = roads[s.r].length;
    if (s.i % 10 === 0 || s.i === n - 1) {
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(nodeGeo), lineMat(C.seg, 0, { blending: THREE.AdditiveBlending }));
      m.position.set(s.x, ground(s.x, s.z) + 0.25, s.z);
      scene.add(m); nodes.push({ m, k });
    }
  });

  // ---------- fields with crop rows ----------
  const fieldMat = lineMat(C.terrain.clone().lerp(C.main, 0.3), 0.55), rowMat = lineMat(C.terrain.clone().lerp(C.main, 0.2), 0.3);
  const fields = [[-15, -13, 11, 7, 0.2], [14, -24, 10, 6, -0.1], [17, 7, 9, 10, 0.15], [-20, 6, 8, 8, -0.2],
                  [-3, 13, 9, 6, 0.05], [12, -8, 7, 5, 0.3], [-30, -12, 9, 9, 0.1], [28, -6, 8, 10, -0.15]];
  for (const [cx, cz, w, h, a] of fields) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v) => [cx + u * ca - v * sa, cz + u * sa + v * ca];
    const corners = [P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)];
    for (let i = 0; i < 4; i++) scene.add(polyline(onGround(groundSeg(corners[i], corners[(i + 1) % 4]), 0.05), fieldMat));
    for (let v = -h / 2 + 0.7; v < h / 2; v += 0.7) scene.add(polyline(onGround(groundSeg(P(-w / 2 + 0.3, v), P(w / 2 - 0.3, v)), 0.03), rowMat));
  }

  // ---------- trajectory through safe flight corridors ----------
  // The loop follows the road network (main road, then the crossing road, then the east lane)
  // and returns across the fields, so the camera has roads to segment for most of the flight.
  const mainZ = (x) => -2 + 5 * Math.sin(x / 14), crossX = (z) => 3 + 4 * Math.sin(z / 11), lane0 = crossX(-16);
  const W = [
    ...[-17, -12, -7, -2].map((x) => [x, mainZ(x)]),
    [crossX(mainZ(2.5)) - 0.5, mainZ(2.5) - 0.5],
    ...[-7, -11.5].map((z) => [crossX(z), z]),
    [lane0 + 0.5, -16.3],
    ...[5, 10, 15].map((sl) => [lane0 + sl, -16 - sl * 0.25]),
    [13, -26], [1, -28], [-11, -23], [-19, -14],
  ];
  const alt = (i) => 4.1 + 0.5 * Math.sin(i * 1.3);
  const wps = W.map(([x, z], i) => new THREE.Vector3(x, ground(x, z) + alt(i), z));
  const curve = new THREE.CatmullRomCurve3(wps, true, 'centripetal');
  // trajectory samples by arc length; u = 0..1 around the loop
  const NP = 700;
  const tPts = curve.getSpacedPoints(NP);
  const uOf = (v) => { let best = 0, bd = Infinity; tPts.forEach((p, i) => { const d = p.distanceToSquared(v); if (d < bd) { bd = d; best = i; } }); return best / NP; };

  // Safe flight corridors: one box per path segment, sized to its surroundings. Each knows the
  // stretch of the loop [u0, u1] it covers, so the planner can reveal it when it enters the horizon.
  const corridors = new THREE.Group(); corridors.layers.set(OVERLAY); scene.add(corridors);
  const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const boxFace = new THREE.BoxGeometry(1, 1, 1);
  const sfc = wps.map((a, i) => {
    const b = wps[(i + 1) % wps.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z), L = len + 1.8;
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const edgeMat = lineMat(C.sfc, 0), faceMat = new THREE.MeshBasicMaterial({ color: C.sfc, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    g.scale.set(L, 1.7 + Math.abs(a.y - b.y), 1.6 + hash(i, 4.2) * 1.3);
    const e = new THREE.LineSegments(boxEdges, edgeMat), f = new THREE.Mesh(boxFace, faceMat);
    e.layers.set(OVERLAY); f.layers.set(OVERLAY);
    g.add(e, f); corridors.add(g);
    let u0 = uOf(a), u1 = uOf(b); if (u1 <= u0) u1 += 1;
    return { g, L, dir, mid, edgeMat, faceMat, u0, u1 };
  });

  // trajectory line (additive, so unplanned stretches are simply not drawn)
  const tGeo = new THREE.BufferGeometry().setFromPoints(tPts);
  tGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((NP + 1) * 3), 3));
  const trajLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
  trajLine.layers.set(OVERLAY); scene.add(trajLine);
  // control points (a nod to the B-spline formulation), revealed with the trajectory
  const cpGeo = new THREE.OctahedronGeometry(0.07, 0);
  const cps = curve.getSpacedPoints(60).slice(0, 60).map((p, i) => {
    const m = new THREE.LineSegments(new THREE.EdgesGeometry(cpGeo), lineMat(C.bright, 0)); m.position.copy(p); m.layers.set(OVERLAY); scene.add(m);
    return { m, u: i / 60 };
  });

  // ---------- trees (kept clear of roads and of the flight path) ----------
  const nearRoad = (x, z, d) => samples.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < d * d);
  const pathXZ = curve.getSpacedPoints(200);
  const nearPath = (x, z, d) => pathXZ.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d);
  const treeCol = C.terrain.clone().lerp(C.main, 0.55);
  let placed = 0;
  for (let i = 0; placed < 62 && i < 900; i++) {
    // clusters: pick a copse centre, then scatter around it
    const cx = (hash(Math.floor(i / 6), 1.1) - 0.5) * 70, cz = (hash(Math.floor(i / 6), 2.3) - 0.5) * 56 - 4;
    const x = cx + (hash(i, 5.5) - 0.5) * 6, z = cz + (hash(i, 6.6) - 0.5) * 6;
    if (nearRoad(x, z, 1.5) || nearPath(x, z, 1.6)) continue;
    const h = 1.5 + hash(i, 7.7) * 1.9, conifer = hash(i, 8.8) > 0.5;
    const t = new THREE.Group();
    t.add(at(part(new THREE.CylinderGeometry(0.05, 0.08, h * 0.45, 5), treeCol, { wire: 0 }), 0, h * 0.22, 0));
    const crown = conifer ? new THREE.ConeGeometry(h * 0.26, h * 0.75, 7, 2) : new THREE.IcosahedronGeometry(h * 0.27, 0);
    t.add(at(part(crown, treeCol, { wire: 0.22, edge: 0.75 }), 0, conifer ? h * 0.62 : h * 0.68, 0));
    t.position.set(x, ground(x, z), z); t.rotation.y = hash(i, 9.9) * 6;
    scene.add(t); placed++;
  }

  // ---------- farm buildings ----------
  const bCol = C.main.clone().lerp(C.terrain, 0.25);
  function barn(x, z, w, d, h, rot) {
    const g = new THREE.Group();
    g.add(at(part(new THREE.BoxGeometry(w, h, d, 3, 2, 2), bCol, { wire: 0.12 }), 0, h / 2, 0));
    const roof = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.1, 0), new THREE.Vector2(w / 2 + 0.1, 0), new THREE.Vector2(0, h * 0.55)]);
    const rg = new THREE.ExtrudeGeometry(roof, { depth: d + 0.2, bevelEnabled: false }); rg.translate(0, h, -(d + 0.2) / 2);
    g.add(part(rg, bCol, { wire: 0.15 }));
    g.position.set(x, ground(x, z), z); g.rotation.y = rot; scene.add(g);
    return g;
  }
  const bx = -10 - 14 * 0.55 - 1.5, bz = -2 + 5 * Math.sin(-10 / 14) + 14 + 1;
  barn(bx, bz, 2.6, 1.8, 1.5, 0.5);
  const silo = new THREE.Group();
  silo.add(at(part(new THREE.CylinderGeometry(0.55, 0.55, 2.8, 14, 3), bCol, { wire: 0.15 }), 0, 1.4, 0));
  silo.add(at(part(new THREE.SphereGeometry(0.55, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), bCol, { wire: 0.15 }), 0, 2.8, 0));
  silo.position.set(bx + 2.3, ground(bx + 2.3, bz - 0.8), bz - 0.8); scene.add(silo);
  barn(24, 14, 1.8, 1.4, 1.0, -0.3);

  // ---------- quadrotor with downward camera ----------
  const D = C.bright;
  const drone = new THREE.Group(); drone.layers.set(OVERLAY);
  const quad = new THREE.Group(); drone.add(quad);
  quad.add(part(new THREE.BoxGeometry(0.34, 0.1, 0.26, 2, 1, 2), D, { wire: 0.25 }));
  quad.add(at(part(new THREE.BoxGeometry(0.24, 0.07, 0.18, 2, 1, 2), D, { wire: 0.2 }), -0.02, 0.085, 0));
  const props = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ax = sx * 0.3, az = sz * 0.3;
    const arm = part(new THREE.BoxGeometry(0.42, 0.03, 0.04), D, { wire: 0 });
    arm.position.set(ax / 2, 0.02, az / 2); arm.rotation.y = -Math.atan2(az, ax); quad.add(arm);
    quad.add(at(part(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 10), D, { wire: 0 }), ax, 0.06, az));
    const disc = new THREE.LineLoop(ring(0.19, 32), lineMat(D, 0.4)); disc.rotation.x = -Math.PI / 2; disc.position.set(ax, 0.1, az); quad.add(disc);
    const spin = new THREE.Group(); spin.position.set(ax, 0.1, az); quad.add(spin);
    for (const r of [0, Math.PI]) { const b = part(new THREE.BoxGeometry(0.17, 0.008, 0.03), D, { wire: 0, fill: false }); b.position.x = 0.085; const p = new THREE.Group(); p.rotation.y = r; p.add(b); spin.add(p); }
    props.push(spin);
  }
  for (const z of [-0.12, 0.12]) {
    quad.add(at(part(new THREE.BoxGeometry(0.34, 0.015, 0.02), D, { wire: 0, fill: false }), 0, -0.16, z));
    quad.add(at(part(new THREE.BoxGeometry(0.015, 0.11, 0.015), D, { wire: 0, fill: false }), 0.08, -0.1, z));
    quad.add(at(part(new THREE.BoxGeometry(0.015, 0.11, 0.015), D, { wire: 0, fill: false }), -0.08, -0.1, z));
  }
  quad.add(at(part(new THREE.SphereGeometry(0.055, 10, 6), D, { wire: 0.3 }), 0.06, -0.09, 0));     // camera gimbal
  drone.scale.setScalar(1.6);
  drone.traverse((o) => o.layers.set(OVERLAY));
  scene.add(drone);

  // camera footprint: frustum lines from the camera to the ground, and the footprint outline
  const FOV_X = THREE.MathUtils.degToRad(74), FOV_Z = THREE.MathUtils.degToRad(56);
  const fpGeo = new THREE.BufferGeometry(); fpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  const fp = new THREE.LineSegments(fpGeo, lineMat(C.seg, 0.55, { blending: THREE.AdditiveBlending })); fp.layers.set(OVERLAY); fp.frustumCulled = false; scene.add(fp);

  // the inset "downward camera" view
  const insetBg = C.bg.clone().lerp(C.terrain, 0.18);
  const downCam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(FOV_Z), Math.tan(FOV_X / 2) / Math.tan(FOV_Z / 2), 0.1, 60);

  // ---------- animation ----------
  const LOOP = Math.round(curve.getLength() / 2.4);
  const HORIZON = 0.13, REPLAN = 1.1, DRAW_IN = 0.5;   // planning horizon (fraction of loop), replan period (s), draw-in time (s)
  let wide = true;
  const D3 = new THREE.Vector3(), T3 = new THREE.Vector3(), T2 = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const segColor = C.seg, black = new THREE.Color(0, 0, 0);
  const tmpC = new THREE.Color();
  let simT = -1;

  function droneState(t) {
    const u = ((t / LOOP) % 1 + 1) % 1;
    curve.getPointAt(u, D3);
    curve.getTangentAt(u, T3);
    curve.getTangentAt((u + 0.01) % 1, T2);
    return u;
  }
  // mark road samples inside the camera footprint at time t
  function cover(t) {
    droneState(t);
    fwd.set(T3.x, 0, T3.z).normalize(); right.set(-fwd.z, 0, fwd.x);
    const h = D3.y - ground(D3.x, D3.z);
    const hx = h * Math.tan(FOV_X / 2), hz = h * Math.tan(FOV_Z / 2);
    for (let k = 0; k < samples.length; k++) {
      const dx = samples[k].x - D3.x, dz = samples[k].z - D3.z;
      const a = dx * fwd.x + dz * fwd.z, s = dx * right.x + dz * right.z;
      const iv = Math.abs(a) < hx && Math.abs(s) < hz;
      inView[k] = iv ? 1 : 0;
      if (iv) seenAt[k] = t;
    }
    return { hx, hz, h };
  }
  // keep the coverage history consistent even for still frames / jumps in time
  function simulateTo(t) {
    if (simT < 0 || t < simT || t - simT > 1) { seenAt.fill(-1e9); simT = Math.max(0, t - LOOP); }
    for (; simT < t - 0.2; simT += 0.2) cover(simT);
    simT = t;
    return cover(t);
  }

  function frame(t) {
    const { hx, hz } = simulateTo(t);
    const u = droneState(t);

    // drone pose: nose along the path, pitched forward, banked into turns
    drone.position.copy(D3);
    const yaw = Math.atan2(-T3.z, T3.x);
    const turn = Math.atan2(-T2.z, T2.x) - yaw;
    const turnRate = Math.atan2(Math.sin(turn), Math.cos(turn));
    drone.rotation.set(-THREE.MathUtils.clamp(turnRate * 6, -0.45, 0.45), yaw, -0.14, 'YXZ');
    props.forEach((p, i) => { p.rotation.y = t * (i % 2 ? 60 : -60); });

    // footprint geometry
    fwd.set(T3.x, 0, T3.z).normalize(); right.set(-fwd.z, 0, fwd.x);
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, s]) => {
      const x = D3.x + fwd.x * a * hx + right.x * s * hz, z = D3.z + fwd.z * a * hx + right.z * s * hz;
      return [x, ground(x, z) + 0.08, z];
    });
    const fpp = fpGeo.attributes.position; let k = 0;
    const camY = D3.y - 0.15;
    for (let i = 0; i < 4; i++) {
      fpp.setXYZ(k++, D3.x, camY, D3.z); fpp.setXYZ(k++, ...corners[i]);
      fpp.setXYZ(k++, ...corners[i]); fpp.setXYZ(k++, ...corners[(i + 1) % 4]);
    }
    fpp.needsUpdate = true;

    // segmentation colours: bright in view, fading "mapped" glow after
    const level = (j) => inView[j] ? 1 : Math.max(0, 0.3 * (1 - (t - seenAt[j]) / (LOOP * 0.6)));
    for (const set of [...ribbonColor, ...graphColor]) {
      const isGraph = graphColor.includes(set);
      for (let i = 0; i < set.n; i++) {
        const l = level(set.start + i) * (isGraph ? 1 : 0.55);
        tmpC.copy(black).lerp(segColor, l);
        for (let p = 0; p < set.perSample; p++) set.attr.setXYZ(i * set.perSample + p, tmpC.r, tmpC.g, tmpC.b);
      }
      set.attr.needsUpdate = true;
    }
    for (const n of nodes) n.m.material.opacity = level(n.k) > 0.02 ? Math.min(1, level(n.k) * 1.6) : 0;

    // ---- receding planning horizon ----
    // Every REPLAN seconds the planner extends its horizon to HORIZON (fraction of the loop) ahead of
    // the drone. New corridors grow in from their entry face; the new stretch of trajectory draws in.
    const p = t / LOOP;                                   // unwrapped progress (laps)
    const tr = Math.floor(t / REPLAN) * REPLAN;           // last replan instant
    const hPrev = (tr - REPLAN) / LOOP + HORIZON, hNow = tr / LOOP + HORIZON;
    const hEnd = hPrev + (hNow - hPrev) * ease((t - tr) / DRAW_IN);   // trajectory drawn up to here

    for (const c of sfc) {
      // the instance of this corridor (this lap or the next) that hasn't been left behind yet
      const k = Math.ceil(p - c.u1 - 0.02);
      const S = c.u0 + k, E = c.u1 + k;
      const tAppear = Math.ceil(((S - HORIZON) * LOOP) / REPLAN) * REPLAN;
      const age = t - tAppear;
      const grow = age < 0 ? 0 : ease(age / 0.6);
      const leave = 1 - ease((p - E) * LOOP / 1.2);          // fade out after the drone exits
      const inside = p >= S && p <= E;
      const vis = grow * Math.min(1, leave);
      c.g.visible = vis > 0.001;
      if (!c.g.visible) continue;
      c.g.scale.x = c.L * Math.max(0.02, grow);
      c.g.position.copy(c.mid).addScaledVector(c.dir, -c.L * (1 - grow) / 2);  // grows from the entry face
      const flash = age < 0.9 ? 1 - age / 0.9 : 0;
      c.edgeMat.opacity = vis * (inside ? 0.95 : 0.6 + 0.4 * flash);
      c.faceMat.opacity = vis * (inside ? 0.07 : 0.035 + 0.05 * flash);
    }

    const tc = tGeo.attributes.color;
    for (let i = 0; i <= NP; i++) {
      let q = i / NP + Math.floor(p); if (q < p - 0.5) q += 1; else if (q > p + 0.5) q -= 1;
      const ahead = q - p;
      let l = 0;
      if (ahead >= 0 && q <= hEnd) l = 1 - 0.55 * (ahead / HORIZON);           // planned, brightest near the drone
      else if (ahead < 0) l = Math.max(0, 0.45 * (1 + ahead / 0.05));           // short flown trail
      tmpC.setRGB(0, 0, 0).lerp(C.bright, l); tc.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    }
    tc.needsUpdate = true;
    for (const c of cps) {
      let q = c.u + Math.floor(p); if (q < p - 0.5) q += 1; else if (q > p + 0.5) q -= 1;
      c.m.material.opacity = q >= p && q <= hEnd ? 0.55 : 0;
    }

    // main camera: slow orbit around the drone, offset so the drone sits right of the headline
    const a = -0.9 + t * 0.035;
    const dist = wide ? 12.5 : 11;
    camera.position.set(D3.x + Math.cos(a) * dist, D3.y + (wide ? 9 : 8), D3.z + Math.sin(a) * dist);
    camera.lookAt(D3);
    camera.updateMatrixWorld();
    const camRight = T2.setFromMatrixColumn(camera.matrixWorld, 0);
    const look = D3.clone().addScaledVector(camRight, wide ? -4.4 : 0).add(new THREE.Vector3(0, wide ? -1.2 : -0.6, 0));
    camera.lookAt(look);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    renderer.render(scene, camera);

    // inset: what the downward camera sees (ground layer only: roads, fields, trees, segmentation)
    if (wide && inset && !params.has('scene_noinset')) {
      const r = inset.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      const x = r.left - c.left, y = c.bottom - r.bottom, w = r.width, h = r.height;
      downCam.position.set(D3.x, camY, D3.z);
      downCam.up.set(fwd.x, 0, fwd.z);
      downCam.lookAt(D3.x, camY - 5, D3.z);
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
      renderer.setClearColor(insetBg, 1); renderer.clear();
      renderer.render(scene, downCam);
      renderer.setClearColor(0x000000, 0);
      renderer.setScissorTest(false);
    }
  }

  run({ canvas, renderer, camera, frame, stillT: 9,
    onResize: (w, h) => { wide = w / h > 1.25; camera.fov = wide ? 32 : 44; },
    debug: { drone, curve, sfc, LOOP } });
}
