// Scroll-driven 3D scenes for the capsule concepts.
//
// Design notes worth keeping:
//
// 1. ONE renderer and ONE canvas, moved into whichever scene is on screen.
//    Only one is ever visible, so a second WebGL context bought nothing and
//    risked failing to create on machines that are already holding several.
//
// 2. Both GLB files are Z-up and three.js is Y-up, so an inner group carries
//    the quarter turn and parts separate along their local Z. An outer group
//    owns the scroll-driven spin, which keeps the separation axis vertical.
//
// 3. Groups separate in sequence, not all at once, each over its own slice of
//    the scroll. That is what makes it read as an explanation rather than an
//    object inflating.
//
// 4. No OrbitControls. It swallows the mouse wheel over the canvas, which on a
//    pinned full-viewport stage means the page stops scrolling and the camera
//    zooms instead. A second instance bound to the same shared canvas also
//    fought the first. This is scroll only, and the canvas takes no pointer
//    events at all.
//
// 5. One animation loop, alive while any scene is on screen, recomputing which
//    scene is active and where it should be from the rects every frame. Earlier
//    versions kept per-scene run flags and only restarted on an observed target
//    change, which stranded whichever scene was inactive at the wrong moment.
//    The render itself is skipped when nothing moved.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** [pattern, offset in model radii along local Z, scroll window start, end] */
type Rule = [RegExp, number, number, number];

const RULES: Record<string, Rule[]> = {
  concept1: [
    [/^Leg\d_(Boss|Strut|Foot)$/, -1.02, 0.08, 0.34],
    [/^OuterShell_Top$/, 0.78, 0.3, 0.58],
    [/^OuterShell_Bottom$/, -0.7, 0.3, 0.58],
    [/^Equator_Seam$/, 0.5, 0.3, 0.58],
    [/^CrushLayer$/, 0.3, 0.54, 0.78],
    [/^Ballast$/, -0.28, 0.72, 0.94],
    [/^PayloadSphere$/, 0, 0, 1],
  ],
  concept2: [
    [/^IndicatorLens$/, 1.0, 0.06, 0.3],
    [/^ShellTop$/, 0.78, 0.26, 0.54],
    [/^ShellBottom$/, -0.7, 0.26, 0.54],
    [/^Equator_Seam$/, 0.5, 0.26, 0.54],
    [/^Leg\d_(Boss|Strut|Foot)$/, -1.02, 0.44, 0.7],
    [/^Electronics_[AB]$/, -0.48, 0.6, 0.84],
    [/^Isolator_\d(_Ring.*)?$/, -0.27, 0.72, 0.95],
    [/^PayloadBox$/, 0, 0, 1],
  ],
};

/** Scroll positions at which each numbered step becomes the active one. */
const STEP_AT: Record<string, number[]> = {
  concept1: [0, 0.16, 0.4, 0.62, 0.82],
  concept2: [0, 0.14, 0.36, 0.56, 0.78],
};

const SPIN = 0.8; // radians of turn across the whole scroll

function ruleFor(concept: string, name: string): Rule | null {
  for (const r of RULES[concept] ?? []) if (r[0].test(name)) return r;
  return null;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

let shared: { canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer } | null = null;
function sharedRenderer() {
  if (!shared) {
    const canvas = document.createElement("canvas");
    // The stage is pinned across the whole viewport; the canvas must never
    // intercept a wheel, drag or tap meant for the page.
    canvas.style.pointerEvents = "none";
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    shared = { canvas, renderer };
  }
  return shared;
}

interface Part {
  obj: THREE.Object3D;
  baseZ: number;
  dz: number;
  from: number;
  to: number;
}

interface Scene3D {
  section: HTMLElement;
  rail: HTMLElement;
  pin: HTMLElement;
  stage: HTMLElement;
  lift: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spin: THREE.Group;
  parts: Part[];
  steps: HTMLElement[];
  stepAt: number[];
  bar: HTMLElement;
  target: number;
  shown: number;
  reduced: boolean;
}

const scenes: Scene3D[] = [];
let pending: HTMLElement[] = [];
let active: Scene3D | null = null;
let loop = 0;
let pass = 0;
let lastDrawn = -1;
let lastScene: Scene3D | null = null;
let lastW = 0;
let lastH = 0;

// setTimeout, not requestAnimationFrame: a tab that starts hidden never fires
// rAF, and booting must not wait on paint.
function schedulePass() {
  if (pass) return;
  pass = window.setTimeout(() => {
    pass = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      const el = pending[i];
      const r = el.getBoundingClientRect();
      if (r.bottom < -700 || r.top > window.innerHeight + 700) continue;
      pending.splice(i, 1);
      boot(el).catch((err) => console.error("[capsule-scene] boot failed", err));
    }
    ensureLoop();
  });
}

// Progress is measured against the PIN's own height, not window.innerHeight.
// On a phone the URL bar hides as you scroll, innerHeight changes mid-gesture,
// and a span computed from it makes the animation jump. The pin and the rail
// come from the same layout pass, so their heights stay consistent.
function railProgress(s: Scene3D): number {
  const r = s.rail.getBoundingClientRect();
  const span = r.height - s.pin.offsetHeight;
  if (span <= 0) return s.target;
  return Math.min(1, Math.max(0, -r.top / span));
}

function coverage(s: Scene3D): number {
  const r = s.rail.getBoundingClientRect();
  return Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
}

/** Whichever scene covers most of the viewport owns the shared canvas. */
function pickActive(): Scene3D | null {
  let best: Scene3D | null = null;
  let bestCover = 0;
  for (const s of scenes) {
    const c = coverage(s);
    if (c > bestCover) {
      bestCover = c;
      best = s;
    }
  }
  if (best && best !== active) {
    const { canvas } = sharedRenderer();
    active?.stage.removeAttribute("data-live");
    best.stage.appendChild(canvas);
    best.stage.setAttribute("data-live", "");
    active = best;
    lastW = 0; // the new scene needs its own resize regardless of dimensions
    lastH = 0;
    resize();
  }
  return best;
}

function resize() {
  if (!active) return;
  const { renderer } = sharedRenderer();
  const w = Math.max(1, active.stage.clientWidth);
  const h = Math.max(1, active.stage.clientHeight);
  // Hiding the URL bar on a phone fires resize repeatedly. Reallocating the
  // drawing buffer on every twitch is expensive, so only touch it on a real
  // change of size.
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;

  const narrow = w < 900;
  // A phone is typically 3x. Rendering line art at 3x costs a lot of fill rate
  // and shows almost nothing, so cap harder on small screens.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow ? 1.25 : 1.5));
  renderer.setSize(w, h, false);
  active.camera.aspect = w / h;
  active.camera.updateProjectionMatrix();
  // On mobile the copy sits across the bottom, so raise the model clear of it.
  active.spin.position.y = narrow ? active.lift : 0;
  lastDrawn = -1; // force a redraw at the new size
}

function draw(s: Scene3D) {
  const t = s.shown;
  for (const p of s.parts) {
    p.obj.position.z = p.baseZ + p.dz * smoothstep(p.from, p.to, t);
  }
  s.spin.rotation.y = t * SPIN;
  s.bar.style.width = `${Math.round(t * 100)}%`;

  let idx = 0;
  for (let i = 0; i < s.stepAt.length; i++) if (t >= s.stepAt[i]) idx = i;
  s.steps.forEach((el, i) => el.toggleAttribute("data-on", i === idx));

  sharedRenderer().renderer.render(s.scene, s.camera);
}

// One loop, alive for as long as any scene is on screen. Earlier versions kept
// per-scene run flags and only restarted the loop when a target was observed to
// change, which stranded whichever scene happened to be inactive at the wrong
// moment. Recomputing from the rects every frame cannot get out of step; the
// render itself is skipped when nothing moved, so an idle scene costs nothing.
function tick() {
  const on = pickActive();
  if (!on) {
    loop = 0;
    return; // nothing on screen; a scroll or resize will restart us
  }
  on.target = railProgress(on);
  const d = on.target - on.shown;
  on.shown += !on.reduced && Math.abs(d) > 0.0006 ? d * 0.15 : d;

  if (on !== lastScene || on.shown !== lastDrawn) {
    draw(on);
    lastScene = on;
    lastDrawn = on.shown;
  }
  loop = requestAnimationFrame(tick);
}

function ensureLoop() {
  if (!loop) loop = requestAnimationFrame(tick);
}

async function boot(section: HTMLElement) {
  const concept = section.dataset.scene ?? "concept1";
  const gltf = await new GLTFLoader().loadAsync(section.dataset.src!);

  const stage = section.querySelector<HTMLElement>("[data-stage]")!;
  const rail = section.querySelector<HTMLElement>(".scene__rail")!;
  const pin = section.querySelector<HTMLElement>(".scene__pin")!;
  const bar = section.querySelector<HTMLElement>("[data-bar]")!;
  const steps = Array.from(section.querySelectorAll<HTMLElement>(".step"));

  const FOV = 36;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(3.1, 1.9, 3.9);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9384, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-4, 1, -3);
  scene.add(fill);

  // spin owns the scroll turn, tilt owns the Z-up to Y-up correction, so the
  // separation axis stays vertical no matter how far it has turned.
  const spin = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = -Math.PI / 2;
  spin.add(tilt);
  scene.add(spin);

  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  model.position.sub(centre);
  spin.scale.setScalar(1 / radius);
  tilt.add(model);

  const parts: Part[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const rule = ruleFor(concept, o.name || o.parent?.name || "");
    const dz = (rule?.[1] ?? 0) * radius;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    lo = Math.min(lo, bb.min.z - centre.z + dz);
    hi = Math.max(hi, bb.max.z - centre.z + dz);
    if (rule && dz !== 0) {
      parts.push({ obj: o, baseZ: o.position.z, dz, from: rule[2], to: rule[3] });
    }
  });

  // Frame for this model's own fully separated height so nothing clips, and
  // aim at the middle of that separated stack rather than the world origin.
  // OrbitControls used to point the camera every frame; without it the camera
  // keeps its default heading and the model sits off screen entirely.
  const apart = (hi - lo) / radius;
  const midY = (hi + lo) / 2 / radius;
  camera.position.setLength((apart / 2 / Math.tan((FOV / 2) * (Math.PI / 180))) * 1.2);
  camera.position.y += midY;
  camera.lookAt(0, midY, 0);
  camera.updateProjectionMatrix();

  const s: Scene3D = {
    section,
    rail,
    pin,
    stage,
    lift: apart * 0.17,
    scene,
    camera,
    spin,
    parts,
    steps,
    stepAt: STEP_AT[concept] ?? [0],
    bar,
    target: 0,
    shown: 0,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  scenes.push(s);
  // Mark the section itself as booted. The watchdog must not use data-live for
  // this: only the scene currently holding the shared canvas carries that, so
  // the other one would be declared failed and have its scroll rail collapsed.
  section.setAttribute("data-ready", "");

  new ResizeObserver(() => {
    if (active === s) resize();
    ensureLoop();
  }).observe(stage);

  ensureLoop();
}

export function initCapsuleScenes() {
  if (!hasWebGL()) return;
  const found = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
  if (found.length === 0) return;
  pending = found;

  window.addEventListener("scroll", schedulePass, { passive: true });
  window.addEventListener("resize", schedulePass, { passive: true });
  document.addEventListener("visibilitychange", schedulePass);
  schedulePass();
  setTimeout(schedulePass, 400);
  setTimeout(schedulePass, 1500);
}
