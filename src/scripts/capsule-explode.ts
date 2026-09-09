// Scroll-driven exploded views for the capsule concept models.
// Loaded dynamically by the ideation page only when a viewer nears the viewport.
//
// Two deliberate choices:
//
// 1. Both GLB files are Z-up. Three.js is Y-up, so the root is rotated a
//    quarter turn about X to stand the capsule upright, and parts separate
//    along their local Z, which is the model's own vertical.
//
// 2. Nothing is scaled while separating. Shrinking the assembly to keep a
//    taller stack in frame moved every part inward on X and Z too, which read
//    as horizontal drift. The camera is simply framed for the exploded state.
//
// 3. Rendering is dirty-flagged and the loop stops once the model settles and
//    the camera is still. Two continuously rendering WebGL canvases on a page
//    the user is scrolling was the cause of the jank.
//
// It also avoids IntersectionObserver and requestAnimationFrame for boot, since
// a tab that starts hidden fires neither and the viewer would never start.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Separation offset for each named part, along the model's own up axis (local
 *  Z, since these files are Z-up). Units are model radii. Ordered top to bottom
 *  so the list reads like the exploded stack itself. */
const RULES: Record<string, [RegExp, number][]> = {
  concept1: [
    [/^OuterShell_Top$/, 0.78],
    [/^Equator_Seam$/, 0.5],
    [/^CrushLayer$/, 0.3],
    [/^PayloadSphere$/, 0],
    [/^Ballast$/, -0.28],
    [/^OuterShell_Bottom$/, -0.7],
    [/^Leg\d_(Boss|Strut|Foot)$/, -1.02],
  ],
  concept2: [
    [/^IndicatorLens$/, 1.0],
    [/^ShellTop$/, 0.78],
    [/^Equator_Seam$/, 0.5],
    [/^PayloadBox$/, 0],
    [/^Isolator_\d(_Ring.*)?$/, -0.27],
    [/^Electronics_[AB]$/, -0.48],
    [/^ShellBottom$/, -0.7],
    [/^Leg\d_(Boss|Strut|Foot)$/, -1.02],
  ],
};

function offsetFor(concept: string, name: string): number | null {
  for (const [re, dy] of RULES[concept] ?? []) if (re.test(name)) return dy;
  return null;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

function nearViewport(el: Element, margin: number): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > -margin && r.top < window.innerHeight + margin;
}

interface Part {
  obj: THREE.Object3D;
  baseZ: number;
  dz: number;
}

const viewers: { update: () => void }[] = [];
let pending: HTMLElement[] = [];
let pass = 0;

// setTimeout rather than requestAnimationFrame: a tab that starts hidden never
// fires rAF, and booting must not wait on paint.
function schedulePass() {
  if (pass) return;
  pass = window.setTimeout(() => {
    pass = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      const section = pending[i];
      if (!nearViewport(section, 700)) continue;
      pending.splice(i, 1);
      boot(section).catch((err) => {
        console.error("[capsule-explode] boot failed", err);
      });
    }
    for (const v of viewers) v.update();
  });
}

async function boot(section: HTMLElement) {
  const concept = section.dataset.explode ?? "concept1";
  const src = section.dataset.src!;
  const canvas = section.querySelector<HTMLCanvasElement>("[data-canvas]")!;
  const stage = canvas.parentElement as HTMLElement;
  const bar = section.querySelector<HTMLElement>("[data-bar]")!;
  const rail = section.querySelector<HTMLElement>(".explode__rail")!;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gltf = await new GLTFLoader().loadAsync(src);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  // 1.5 rather than 2: on a Retina panel the extra fragments cost far more than
  // they show on a line-art model.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const FOV = 38;
  const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.1, 100);
  // Direction only. The distance is set below, once the exploded height of this
  // particular model is known, so nothing has to scale or dolly while it comes
  // apart and motion stays on one axis.
  camera.position.set(3.1, 1.95, 3.9);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9384, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-4, 1, -3);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.4;
  controls.maxDistance = 8;

  const root = new THREE.Group();
  scene.add(root);

  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  model.position.sub(centre);
  root.scale.setScalar(1 / radius);
  // These GLB files are Z-up; three.js is Y-up. Stand the assembly upright.
  root.rotation.x = -Math.PI / 2;
  root.add(model);

  const parts: Part[] = [];
  let apartLo = Infinity;
  let apartHi = -Infinity;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const dz = (offsetFor(concept, o.name || o.parent?.name || "") ?? 0) * radius;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    apartLo = Math.min(apartLo, bb.min.z - centre.z + dz);
    apartHi = Math.max(apartHi, bb.max.z - centre.z + dz);
    if (dz !== 0) parts.push({ obj: o, baseZ: o.position.z, dz });
  });

  // Frame the camera for the fully separated stack of this model, with a little
  // headroom, so nothing clips at either end of the scroll.
  const apartHeight = (apartHi - apartLo) / radius;
  const needed = (apartHeight / 2 / Math.tan((FOV / 2) * (Math.PI / 180))) * 1.14;
  camera.position.setLength(needed);
  controls.maxDistance = Math.max(8, needed * 1.6);

  let target = 0;
  let shown = 0;
  let running = false;
  let dirty = true;

  function resize() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function draw() {
    for (const p of parts) p.obj.position.z = p.baseZ + p.dz * shown;
    bar.style.width = `${Math.round(shown * 100)}%`;
    renderer.render(scene, camera);
  }

  function frame() {
    const delta = target - shown;
    const settling = !reduced && Math.abs(delta) > 0.0006;
    shown += settling ? delta * 0.16 : delta;

    // OrbitControls returns true while damping is still easing the camera.
    const camMoving = controls.update();

    if (settling || camMoving || dirty) {
      dirty = false;
      draw();
      requestAnimationFrame(frame);
    } else {
      running = false; // settled and still: stop burning frames
    }
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  resize();
  draw();
  canvas.hidden = false;
  canvas.removeAttribute("aria-hidden");
  stage.setAttribute("data-live", "");

  new ResizeObserver(() => {
    resize();
    start();
  }).observe(stage);

  controls.addEventListener("change", () => {
    dirty = true;
    start();
  });

  viewers.push({
    update() {
      const r = rail.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      const span = r.height - window.innerHeight;
      if (span <= 0) return;
      const next = Math.min(1, Math.max(0, -r.top / span));
      if (Math.abs(next - target) < 0.0005) return;
      target = next;
      start();
    },
  });
  start();
}

export function initCapsuleExplode() {
  if (!hasWebGL()) return; // posters stay, nothing else to do
  const found = Array.from(document.querySelectorAll<HTMLElement>("[data-explode]"));
  if (found.length === 0) return;
  pending = found;

  window.addEventListener("scroll", schedulePass, { passive: true });
  window.addEventListener("resize", schedulePass, { passive: true });
  document.addEventListener("visibilitychange", schedulePass);
  schedulePass();
  setTimeout(schedulePass, 400);
  setTimeout(schedulePass, 1500);
}
