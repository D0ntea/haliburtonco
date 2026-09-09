// Scroll-driven exploded views for the capsule concept models.
// Loaded dynamically by the ideation page only when a viewer nears the viewport.
//
// Deliberately does not rely on IntersectionObserver. Some embedded and
// non-painting browser contexts never fire it, which would leave the viewer
// stuck on its poster. Rect checks in a single passive scroll pass are cheap
// and work everywhere.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Dir = [number, number, number] | "radial";
type Rule = [RegExp, Dir, number];

/** How far each named part travels, and in what direction, at full separation.
 *  Distances are in model-radius units after the model is normalised. */
const RULES: Record<string, Rule[]> = {
  concept1: [
    [/^OuterShell_Top$/, [0, 1, 0], 1.35],
    [/^Equator_Seam$/, [0, 1, 0], 0.9],
    [/^CrushLayer$/, [0, 1, 0], 0.55],
    [/^PayloadSphere$/, [0, 0, 0], 0],
    [/^Ballast$/, [0, -1, 0], 0.5],
    [/^OuterShell_Bottom$/, [0, -1, 0], 1.2],
    [/^Leg\d_(Boss|Strut|Foot)$/, "radial", 1.0],
  ],
  concept2: [
    [/^ShellTop$/, [0, 1, 0], 1.35],
    [/^IndicatorLens$/, [0, 1, 0], 1.75],
    [/^Equator_Seam$/, [0, 1, 0], 0.9],
    [/^PayloadBox$/, [0, 0, 0], 0],
    [/^Isolator_\d$/, "radial", 0.45],
    [/^Isolator_\d_Ring/, "radial", 0.6],
    [/^Electronics_[AB]$/, [0, -1, 0], 0.62],
    [/^ShellBottom$/, [0, -1, 0], 1.2],
    [/^Leg\d_(Boss|Strut|Foot)$/, "radial", 1.0],
  ],
};

function ruleFor(concept: string, name: string): Rule | null {
  for (const r of RULES[concept] ?? []) if (r[0].test(name)) return r;
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
  base: THREE.Vector3;
  offset: THREE.Vector3;
}

interface Viewer {
  section: HTMLElement;
  rail: HTMLElement;
  update: () => void;
}

const viewers: Viewer[] = [];
let pending: HTMLElement[] = [];
let pass = 0;

// setTimeout rather than requestAnimationFrame: a tab that starts hidden never
// fires rAF, and booting must not wait on paint. Rendering still uses rAF.
function schedulePass() {
  if (pass) return;
  pass = window.setTimeout(() => {
    pass = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      const section = pending[i];
      if (!nearViewport(section, 700)) continue;
      pending.splice(i, 1);
      boot(section).catch((err) => {
        // Poster stays in place; the page still reads correctly.
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
  const sliderWrap = section.querySelector<HTMLElement>("[data-slider-wrap]")!;
  const slider = section.querySelector<HTMLInputElement>("[data-slider]")!;
  const hint = section.querySelector<HTMLElement>("[data-hint]")!;
  const rail = section.querySelector<HTMLElement>(".explode__rail")!;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gltf = await new GLTFLoader().loadAsync(src);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 4 / 3, 0.1, 100);
  camera.position.set(2.7, 1.7, 3.4);

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
  controls.minDistance = 2.2;
  controls.maxDistance = 8;

  const root = new THREE.Group();
  scene.add(root);

  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  model.position.sub(centre);
  root.scale.setScalar(1 / radius);
  root.add(model);

  const parts: Part[] = [];
  const partBox = new THREE.Box3();
  const partCentre = new THREE.Vector3();
  model.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const rule = ruleFor(concept, o.name || o.parent?.name || "");
    if (!rule) return;
    const [, dir, dist] = rule;
    if (dist === 0) return;

    let v: THREE.Vector3;
    if (dir === "radial") {
      partBox.setFromObject(o).getCenter(partCentre);
      v = new THREE.Vector3(partCentre.x, 0, partCentre.z);
      if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
      v.normalize().setY(-0.35).normalize();
    } else {
      v = new THREE.Vector3(...dir).normalize();
    }
    parts.push({ obj: o, base: o.position.clone(), offset: v.multiplyScalar(dist * radius) });
  });

  let target = 0;
  let shown = -1;
  let running = false;

  function resize() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function draw() {
    for (const p of parts) p.obj.position.copy(p.base).addScaledVector(p.offset, shown);
    bar.style.width = `${Math.round(shown * 100)}%`;
    controls.update();
    renderer.render(scene, camera);
  }

  function frame() {
    const delta = target - shown;
    shown += Math.abs(delta) < 0.0008 ? delta : delta * 0.14;
    draw();
    if (running) requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  resize();
  shown = 0;
  draw();
  canvas.hidden = false;
  canvas.removeAttribute("aria-hidden");
  stage.setAttribute("data-live", "");

  new ResizeObserver(() => {
    resize();
    draw();
  }).observe(stage);

  controls.addEventListener("change", () => {
    if (!running) draw();
  });

  if (reduced) {
    sliderWrap.hidden = false;
    hint.textContent = "Use the slider to pull it apart. Drag to turn it.";
    rail.style.height = "auto";
    const sticky = rail.firstElementChild as HTMLElement;
    sticky.style.position = "static";
    sticky.style.height = "auto";
    slider.addEventListener("input", () => {
      target = Number(slider.value) / 100;
      start();
      setTimeout(stop, 900);
    });
    viewers.push({ section, rail, update() {} });
    return;
  }

  viewers.push({
    section,
    rail,
    update() {
      const r = rail.getBoundingClientRect();
      const onScreen = r.bottom > -200 && r.top < window.innerHeight + 200;
      const span = r.height - window.innerHeight;
      if (span > 0) target = Math.min(1, Math.max(0, -r.top / span));
      if (onScreen) start();
      else stop();
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
  // Safety net for contexts that report a stale layout on first paint.
  setTimeout(schedulePass, 400);
  setTimeout(schedulePass, 1500);
}
