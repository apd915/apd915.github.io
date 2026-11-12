// Shared plumbing for the wireframe hero scenes (About page and Research page).
// Each scene module calls createStage() for the renderer/scene/colours, builds its objects with
// makePart(), then hands its frame(t) function to run().
import * as THREE from 'three';
export { THREE };

// ---------- small math helpers ----------
export const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export const vnoise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const fbm = (x, y, oct = 5) => {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
};
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
/** A circle outline (no centre vertex) for LineLoop. */
export const ring = (r, n) => new THREE.BufferGeometry().setAttribute('position',
  new THREE.BufferAttribute(new THREE.CircleGeometry(r, n).attributes.position.array.slice(3), 3));

export const params = new URLSearchParams(location.search);

/** Renderer, scene and colours read from CSS custom properties on the canvas. Returns null without WebGL. */
export function createStage(canvas, { fogNear = 14, fogFar = 46, colors = {} } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true,
      preserveDrawingBuffer: params.has('scene_t') });   // still frames survive compositing when reviewing
  } catch (e) {
    canvas.remove();               // no WebGL: the CSS gradient alone remains
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const css = getComputedStyle(canvas);
  const C = {};
  for (const [k, fallback] of Object.entries({ bg: '#0b1210', terrain: '#2c6652', main: '#7fc4a8', bright: '#c9f5e2', ...colors }))
    C[k] = new THREE.Color(css.getPropertyValue('--scene-' + k).trim() || fallback);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.bg, fogNear, fogFar);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  return { renderer, scene, camera, C, part: makePart(C) };
}

/**
 * CAD-style part: a dark fill hides lines behind solid surfaces, crisp edges give the outline,
 * and a faint wireframe adds mesh density. Pass `fade: someArray` to collect [material, opacity]
 * pairs so a whole object can be faded in and out.
 */
export function makePart(C) {
  return function part(geo, color, { edge = 0.95, wire = 0.18, fill = true, fade = null, angle = 20 } = {}) {
    const g = new THREE.Group();
    if (fill) {
      const m = new THREE.MeshBasicMaterial({ color: C.bg, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: !!fade });
      fade?.push([m, 1]);
      g.add(new THREE.Mesh(geo, m));
    }
    if (wire > 0) {
      const m = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: wire });
      fade?.push([m, wire]);
      g.add(new THREE.Mesh(geo, m));
    }
    if (edge > 0) {
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: edge });
      fade?.push([m, edge]);
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), m));
    }
    return g;
  };
}

/**
 * Drives the animation: pauses off-screen or in hidden tabs, shows one still frame for
 * reduced-motion users, and supports review URLs:
 *   ?scene_t=6                    one still frame at t = 6 s
 *   ?scene_t=0&scene_sheet=2,5,8  a contact sheet of several moments over the page (&scene_clean: no labels)
 */
export function run({ canvas, renderer, camera, frame, onResize, stillT = 5, debug = {} }) {
  let raf = 0, visible = true, booted = false, lastT = stillT, t0 = performance.now(), paused = performance.now();
  const draw = (t) => { lastT = t; frame(t); };
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    onResize?.(w, h);
    camera.updateProjectionMatrix();
    if (booted && !raf) draw(lastT);         // a resize clears the canvas; redraw the still frame
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = params.get('scene_t');
  const loop = (now) => { draw((now - t0) / 1000); raf = requestAnimationFrame(loop); };
  const start = () => { if (still === null && !raf && visible && !reduce.matches && !document.hidden) { t0 += performance.now() - paused; raf = requestAnimationFrame(loop); } };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; paused = performance.now(); } };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduce.addEventListener?.('change', () => (reduce.matches ? (stop(), draw(stillT)) : start()));

  if (still !== null) {
    window.__scene = { ...debug, camera, frame: draw,
      sheet(times, cols = 3) {
        const w = canvas.width, h = canvas.height, rows = Math.ceil(times.length / cols);
        const out = document.createElement('canvas'); out.width = w * cols / 2; out.height = h * rows / 2;
        const g = out.getContext('2d'); g.fillStyle = '#0b1210'; g.fillRect(0, 0, out.width, out.height);
        times.forEach((tt, i) => {
          draw(tt);
          const x = (i % cols) * w / 2, y = Math.floor(i / cols) * h / 2;
          g.drawImage(canvas, x, y, w / 2, h / 2);
          if (!params.has('scene_clean')) { g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText('t=' + tt, x + 10, y + 26); }
        });
        return out.toDataURL('image/jpeg', 0.88);
      } };
    draw(parseFloat(still) || 0);
    setTimeout(() => draw(lastT), 500);
    const sheetT = params.get('scene_sheet');
    if (sheetT) setTimeout(() => {
      const im = document.createElement('img');
      im.src = window.__scene.sheet(sheetT.split(',').map(Number), +(params.get('scene_cols') || 3));
      im.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:9999;background:#000';
      document.body.appendChild(im);
    }, 700);
  } else if (reduce.matches) draw(stillT);
  else start();
  booted = true;
  canvas.classList.add('ready');
}
