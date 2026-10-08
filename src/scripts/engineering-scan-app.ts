import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  ArrowRight,
  Box,
  Camera,
  Check,
  Cpu,
  createIcons,
  Crosshair,
  Download,
  Eraser,
  FileJson,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  Grid2X2,
  Grid3X3,
  Image as ImageIcon,
  Info,
  Laptop,
  Maximize,
  Menu,
  PackageOpen,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  Table,
  Trash2,
  Triangle,
  TriangleAlert,
  X,
} from "lucide";
import {
  buildHeightMap,
  calibrateScale,
  convertLength,
  distanceBetween,
  heightMapToCsv,
  measurementToCsv,
  summarizeHeightMap,
} from "./engineering-scan-core.mjs";

type ViewName = "projects" | "capture" | "processing" | "model" | "surface" | "measurements" | "export" | "settings";
type PhotoRecord = { name: string; size: number; type: string; width: number; height: number; url: string };
type Measurement = { id: string; rawDistance: number; distanceMm: number; status: string };
type Viewer = {
  name: string;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  model: THREE.Group;
  clipPlane: THREE.Plane;
};

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;
const $$ = <T extends Element>(selector: string) => [...document.querySelectorAll(selector)] as T[];
const app = $("#scanApp");
const STORAGE_KEY = "engineering-scan-web-v1";
const viewOrder: ViewName[] = ["projects", "capture", "processing", "model", "surface", "measurements", "export", "settings"];

let currentView: ViewName = "projects";
let workingUnit: "mm" | "in" = "mm";
let photos: PhotoRecord[] = [];
let measurements: Measurement[] = [];
let heightMap: ReturnType<typeof buildHeightMap> | null = null;
let scaleFactor = 1;
let scaleCalibration: ReturnType<typeof calibrateScale> | null = null;
let source = { name: "Synthetic step coupon", type: "Generated test geometry", synthetic: true };
let measurementMode = false;
let pendingPoint: THREE.Vector3 | null = null;
let toastTimer = 0;
let modelBounds = new THREE.Box3();
let viewers: Record<string, Viewer> = {};

function showToast(message: string) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setView(view: ViewName) {
  currentView = view;
  $$<HTMLElement>("[data-content]").forEach((section) => section.classList.toggle("is-active", section.dataset.content === view));
  $$<HTMLButtonElement>(".workflow-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $("#workflowCount").textContent = `${String(viewOrder.indexOf(view) + 1).padStart(2, "0")} / 08`;
  app.classList.remove("nav-open");
  $("#mobileNavButton").setAttribute("aria-expanded", "false");
  if (["model", "surface", "measurements"].includes(view)) {
    requestAnimationFrame(() => resizeViewer(viewers[view]));
  }
}

function projectState() {
  return {
    schema: "engscan.project.v1",
    projectId: ($<HTMLInputElement>("#projectId")).value.trim() || "UNTITLED",
    partIdentifier: ($<HTMLInputElement>("#partId")).value.trim(),
    material: ($<HTMLSelectElement>("#material")).value,
    units: workingUnit,
    desiredFeatures: ($<HTMLInputElement>("#features")).value.trim(),
    notes: ($<HTMLTextAreaElement>("#notes")).value.trim(),
    coatingUsed: ($<HTMLInputElement>("#coatingUsed")).checked,
    measurementStatus: "Unvalidated",
  };
}

function saveProject() {
  const state = projectState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $("#headerProjectId").textContent = state.projectId;
  showToast("Project saved in this browser.");
}

function restoreProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    ($<HTMLInputElement>("#projectId")).value = state.projectId || "BRACKET-001";
    ($<HTMLInputElement>("#partId")).value = state.partIdentifier || "";
    ($<HTMLSelectElement>("#material")).value = state.material || "Unknown";
    ($<HTMLInputElement>("#features")).value = state.desiredFeatures || "";
    ($<HTMLTextAreaElement>("#notes")).value = state.notes || "";
    ($<HTMLInputElement>("#coatingUsed")).checked = Boolean(state.coatingUsed);
    setUnit(state.units === "in" ? "in" : "mm");
    $("#headerProjectId").textContent = state.projectId || "BRACKET-001";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setUnit(unit: "mm" | "in") {
  workingUnit = unit;
  $$<HTMLButtonElement>("[data-unit]").forEach((button) => button.classList.toggle("is-selected", button.dataset.unit === unit));
  ($<HTMLSelectElement>("#settingsUnits")).value = unit;
  updateBoundsReadout();
  renderMeasurementList();
}

function createViewer(name: "model" | "surface" | "measurements", canvasSelector: string): Viewer {
  const canvas = $<HTMLCanvasElement>(canvasSelector);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e7df);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  const model = new THREE.Group();
  scene.add(model);
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100000);

  const grid = new THREE.GridHelper(240, 24, 0x6b6b6b, 0xc9c4b9);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.02;
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7b7b72, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(100, -80, 150);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9d3, 1.1);
  fill.position.set(-100, 70, 50);
  scene.add(fill);

  const viewer = { name, canvas, scene, camera, renderer, controls, model, clipPlane };
  new ResizeObserver(() => resizeViewer(viewer)).observe(canvas.parentElement!);
  return viewer;
}

function resizeViewer(viewer?: Viewer) {
  if (!viewer) return;
  const host = viewer.canvas.parentElement!;
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  if (viewer.canvas.width !== Math.floor(width * viewer.renderer.getPixelRatio()) || viewer.canvas.height !== Math.floor(height * viewer.renderer.getPixelRatio())) {
    viewer.renderer.setSize(width, height, false);
    viewer.camera.aspect = width / height;
    viewer.camera.updateProjectionMatrix();
  }
}

function materialFor(viewer: Viewer) {
  return new THREE.MeshStandardMaterial({
    color: 0xb9b6aa,
    metalness: 0.08,
    roughness: 0.62,
    side: THREE.DoubleSide,
    clippingPlanes: [viewer.clipPlane],
  });
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((item: any) => {
      item.geometry?.dispose?.();
      if (Array.isArray(item.material)) item.material.forEach((material: THREE.Material) => material.dispose());
      else item.material?.dispose?.();
    });
  }
}

function addEdges(mesh: THREE.Mesh) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 22),
    new THREE.LineBasicMaterial({ color: 0x494943, transparent: true, opacity: 0.45 }),
  );
  edges.userData.isModelEdge = true;
  edges.visible = ($<HTMLInputElement>("#edgeToggle")).checked;
  mesh.add(edges);
}

function putGeometriesInViewers(geometries: THREE.BufferGeometry[]) {
  Object.values(viewers).forEach((viewer) => {
    clearGroup(viewer.model);
    geometries.forEach((sourceGeometry) => {
      const geometry = sourceGeometry.clone();
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, materialFor(viewer));
      addEdges(mesh);
      viewer.model.add(mesh);
    });
  });
  modelBounds = new THREE.Box3().setFromObject(viewers.model.model);
  updateBoundsReadout();
  updateClipPlane(100);
  Object.values(viewers).forEach(fitViewer);
  heightMap = null;
  $("#surfaceState").classList.remove("is-ready");
}

function loadSyntheticModel(notify = false) {
  const base = new THREE.BoxGeometry(60, 70, 4);
  base.translate(-20, 0, 2);
  const step = new THREE.BoxGeometry(40, 70, 8);
  step.translate(30, 0, 4);
  source = { name: "Synthetic step coupon", type: "Generated test geometry", synthetic: true };
  putGeometriesInViewers([base, step]);
  $("#modelTitle").textContent = "SYNTHETIC_STEP_COUPON.PLY";
  $("#viewportNote").textContent = "Synthetic geometry / not a scan";
  updateSourceReadout();
  $("#modelState").classList.add("is-ready");
  if (notify) showToast("Synthetic 4 mm step coupon loaded.");
}

function updateSourceReadout() {
  $("#sourceName").textContent = source.name;
  $("#sourceType").textContent = source.type;
}

function updateBoundsReadout() {
  if (modelBounds.isEmpty()) return;
  const size = modelBounds.getSize(new THREE.Vector3()).multiplyScalar(scaleFactor);
  const values = [size.x, size.y, size.z].map((value) => workingUnit === "mm" ? value : convertLength(value, "mm", "in"));
  const suffix = workingUnit;
  $("#boundX").textContent = `${values[0].toFixed(2)} ${suffix}`;
  $("#boundY").textContent = `${values[1].toFixed(2)} ${suffix}`;
  $("#boundZ").textContent = `${values[2].toFixed(2)} ${suffix}`;
  let triangles = 0;
  viewers.model.model.traverse((child: any) => {
    if (child.isMesh) triangles += child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;
  });
  $("#triangleCount").textContent = Math.round(triangles).toLocaleString();
}

function fitViewer(viewer: Viewer) {
  const bounds = new THREE.Box3().setFromObject(viewer.model);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.72, 20);
  viewer.controls.target.copy(center);
  viewer.camera.position.copy(center).add(new THREE.Vector3(0.9, -1.1, 0.82).normalize().multiplyScalar(radius * 1.7));
  viewer.camera.near = Math.max(radius / 1000, 0.01);
  viewer.camera.far = radius * 20;
  viewer.camera.updateProjectionMatrix();
  viewer.controls.update();
}

function resetViewers() {
  Object.values(viewers).forEach(fitViewer);
}

function updateClipPlane(percent: number) {
  const minZ = modelBounds.min.z;
  const maxZ = modelBounds.max.z;
  const span = maxZ - minZ;
  const cutoff = minZ + (span * percent) / 100 + (percent === 100 ? Math.max(span * 0.05, 0.01) : 0);
  Object.values(viewers).forEach((viewer) => { viewer.clipPlane.constant = cutoff; });
  $("#clipOutput").textContent = `${percent}%`;
}

function setWireframe(enabled: boolean) {
  Object.values(viewers).forEach((viewer) => viewer.model.traverse((child: any) => {
    if (child.isMesh) child.material.wireframe = enabled;
  }));
  ($<HTMLInputElement>("#wireframeToggle")).checked = enabled;
  $("#inspectorWireframe").setAttribute("aria-pressed", String(enabled));
}

function setEdges(enabled: boolean) {
  Object.values(viewers).forEach((viewer) => viewer.model.traverse((child) => {
    if (child.userData.isModelEdge) child.visible = enabled;
  }));
  ($<HTMLInputElement>("#edgeToggle")).checked = enabled;
  $("#inspectorEdges").setAttribute("aria-pressed", String(enabled));
}

async function parseMesh(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["stl", "ply", "obj"].includes(extension)) throw new Error("Open an STL, PLY, or OBJ mesh.");
  const buffer = await file.arrayBuffer();
  let geometries: THREE.BufferGeometry[] = [];
  if (extension === "stl") geometries = [new STLLoader().parse(buffer)];
  if (extension === "ply") geometries = [new PLYLoader().parse(buffer)];
  if (extension === "obj") {
    const text = new TextDecoder().decode(buffer);
    const object = new OBJLoader().parse(text);
    object.traverse((child: any) => { if (child.isMesh) geometries.push(child.geometry.clone()); });
  }
  if (geometries.length === 0) throw new Error("No triangle geometry was found in this file.");
  source = { name: file.name, type: `${extension.toUpperCase()} mesh / assumed mm`, synthetic: false };
  putGeometriesInViewers(geometries);
  $("#modelTitle").textContent = file.name.toUpperCase();
  $("#viewportNote").textContent = "Imported mesh / units assumed mm";
  updateSourceReadout();
  $("#modelState").classList.add("is-ready");
  showToast(`${file.name} loaded locally.`);
  setView("model");
}

function imageDimensions(file: File): Promise<{ width: number; height: number; url: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, url });
    image.onerror = () => resolve({ width: 0, height: 0, url });
    image.src = url;
  });
}

async function addPhotos(files: FileList | File[]) {
  for (const file of [...files]) {
    if (!file.type.startsWith("image/")) continue;
    const dimensions = await imageDimensions(file);
    photos.push({ name: file.name, size: file.size, type: file.type, ...dimensions });
  }
  renderPhotos();
}

function renderPhotos() {
  const strip = $("#photoStrip");
  strip.innerHTML = "";
  if (photos.length === 0) strip.innerHTML = '<p class="empty-note">No images selected yet.</p>';
  photos.forEach((photo) => {
    const tile = document.createElement("div");
    tile.className = "photo-tile";
    tile.innerHTML = `<img alt="Capture ${photo.name}"><span>${photo.width} × ${photo.height}</span>`;
    (tile.querySelector("img") as HTMLImageElement).src = photo.url;
    strip.append(tile);
  });
  const megapixels = photos.map((photo) => (photo.width * photo.height) / 1_000_000).sort((a, b) => a - b);
  const median = megapixels.length ? megapixels[Math.floor(megapixels.length / 2)] : null;
  const warnings = photos.filter((photo) => photo.width < 1600 || photo.height < 1200 || photo.size < 250_000).length;
  $("#photoCount").textContent = String(photos.length);
  $("#captureMegapixels").textContent = median ? median.toFixed(1) : "—";
  $("#captureWarnings").textContent = String(warnings);
  $("#bundleStatus").textContent = photos.length ? `${photos.length} image records are ready for the manifest.` : "Add images to create a browser-side manifest.";
  $("#routeState").textContent = photos.length ? "MANIFEST READY" : "WAITING FOR IMAGES";
  $("#captureState").classList.toggle("is-ready", photos.length > 0);
  $("#processingState").classList.toggle("is-ready", photos.length > 0);
}

function manifest() {
  return {
    ...projectState(),
    generatedAt: new Date().toISOString(),
    source: { ...source },
    capture: {
      mode: "rgb_browser_capture",
      privacy: "local_only",
      imageCount: photos.length,
      images: photos.map(({ name, size, type, width, height }) => ({ name, size, type, width, height })),
      limitation: "This manifest records browser-selected images; source image binaries remain on the user's device.",
    },
    calibration: scaleCalibration ? { ...scaleCalibration, status: "Unvalidated" } : { status: "not_calibrated" },
    measurements,
    heightMap: heightMap ? { columns: heightMap.columns, rows: heightMap.rows, datumZ: Number(($<HTMLInputElement>("#datumZ")).value), status: "Unvalidated" } : null,
    processing: { reconstruction: source.synthetic ? "synthetic_demo" : "external_mesh_import", webAppVersion: "0.2.0" },
  };
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadManifest() {
  download(`${projectState().projectId}-manifest.json`, JSON.stringify(manifest(), null, 2), "application/json");
  showToast("Project manifest downloaded.");
}

function modelMeshes(viewer: Viewer) {
  const meshes: THREE.Mesh[] = [];
  viewer.model.traverse((child: any) => { if (child.isMesh) meshes.push(child); });
  return meshes;
}

function runHeightMap() {
  const viewer = viewers.surface;
  const bounds = new THREE.Box3().setFromObject(viewer.model);
  if (bounds.isEmpty()) return;
  const resolution = Number(($<HTMLSelectElement>("#gridResolution")).value);
  const datumZ = Number(($<HTMLInputElement>("#datumZ")).value);
  const raycaster = new THREE.Raycaster();
  const direction = new THREE.Vector3(0, 0, -1);
  const meshes = modelMeshes(viewer);
  heightMap = buildHeightMap({
    bounds: { minX: bounds.min.x, maxX: bounds.max.x, minY: bounds.min.y, maxY: bounds.max.y },
    columns: resolution,
    rows: resolution,
    sample: (x: number, y: number) => {
      raycaster.set(new THREE.Vector3(x, y, bounds.max.z + Math.max(10, bounds.getSize(new THREE.Vector3()).z)), direction);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit ? (hit.point.z - datumZ) * scaleFactor : null;
    },
  });
  const summary = summarizeHeightMap(heightMap);
  $("#heightValid").textContent = `${summary.validCount} / ${heightMap.cells.length}`;
  $("#heightRange").textContent = summary.maximum === null ? "—" : `${formatLength(summary.minimum!)} to ${formatLength(summary.maximum)}`;
  $("#heightMean").textContent = summary.mean === null ? "—" : formatLength(summary.mean);
  $("#surfaceState").classList.add("is-ready");
  drawHeightMap(heightMap, summary.minimum, summary.maximum);
  showToast(`${summary.validCount} surface samples recorded.`);
}

function heightColor(value: number, minimum: number, maximum: number) {
  const ratio = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const stops = [
    [0x27, 0x47, 0x66], [0x4c, 0x8a, 0x9b], [0xf5, 0xf2, 0xea], [0xe6, 0xad, 0x54], [0xb3, 0x40, 0x30],
  ];
  const scaled = ratio * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  return stops[index].map((channel, i) => Math.round(channel + (stops[index + 1][i] - channel) * mix));
}

function drawHeightMap(map: ReturnType<typeof buildHeightMap>, minimum: number | null, maximum: number | null) {
  const canvas = $<HTMLCanvasElement>("#heightMapCanvas");
  const context = canvas.getContext("2d")!;
  const cellWidth = canvas.width / map.columns;
  const cellHeight = canvas.height / map.rows;
  context.clearRect(0, 0, canvas.width, canvas.height);
  map.cells.forEach((cell, index) => {
    const column = index % map.columns;
    const row = Math.floor(index / map.columns);
    context.fillStyle = cell.valid ? `rgb(${heightColor(cell.height, minimum!, maximum!).join(",")})` : "#222";
    context.fillRect(column * cellWidth, canvas.height - (row + 1) * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
  });
  $("#legendMax").textContent = maximum === null ? "MAX —" : `MAX ${formatLength(maximum)}`;
  $("#legendMin").textContent = minimum === null ? "MIN —" : `MIN ${formatLength(minimum)}`;
}

function formatLength(valueMm: number) {
  const value = workingUnit === "mm" ? valueMm : convertLength(valueMm, "mm", "in");
  return `${value.toFixed(workingUnit === "mm" ? 3 : 4)} ${workingUnit}`;
}

function measurementClick(event: PointerEvent) {
  if (!measurementMode) return;
  const viewer = viewers.measurements;
  const bounds = viewer.canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, viewer.camera);
  const hit = raycaster.intersectObjects(modelMeshes(viewer), false)[0];
  if (!hit) return;
  addMeasurementMarker(viewer, hit.point);
  if (!pendingPoint) {
    pendingPoint = hit.point.clone();
    $("#measurementPrompt").textContent = "Start point set. Choose the second point.";
    return;
  }
  const rawDistance = distanceBetween(pendingPoint, hit.point, 1);
  measurements.push({ id: `M-${String(measurements.length + 1).padStart(3, "0")}`, rawDistance, distanceMm: rawDistance * scaleFactor, status: "Unvalidated" });
  addMeasurementLine(viewer, pendingPoint, hit.point);
  pendingPoint = null;
  measurementMode = false;
  $("#measureModeButton").setAttribute("aria-pressed", "false");
  $("#measurementPrompt").textContent = `${measurements.at(-1)!.id}: ${formatLength(measurements.at(-1)!.distanceMm)} / Unvalidated`;
  $("#measurementState").classList.add("is-ready");
  renderMeasurementList();
}

function addMeasurementMarker(viewer: Viewer, point: THREE.Vector3) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(modelBounds.getSize(new THREE.Vector3()).length / 150, 0.5), 16, 16), new THREE.MeshBasicMaterial({ color: 0xb34030, depthTest: false }));
  marker.position.copy(point);
  marker.renderOrder = 10;
  marker.userData.measurementGraphic = true;
  viewer.scene.add(marker);
}

function addMeasurementLine(viewer: Viewer, start: THREE.Vector3, end: THREE.Vector3) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0xb34030, depthTest: false }));
  line.renderOrder = 9;
  line.userData.measurementGraphic = true;
  viewer.scene.add(line);
}

function clearMeasurements() {
  measurements = [];
  pendingPoint = null;
  Object.values(viewers).forEach((viewer) => {
    const graphics = viewer.scene.children.filter((child) => child.userData.measurementGraphic);
    graphics.forEach((graphic: any) => {
      viewer.scene.remove(graphic);
      graphic.geometry?.dispose?.();
      graphic.material?.dispose?.();
    });
  });
  $("#measurementPrompt").textContent = "Select Start measure, then choose two points on the mesh.";
  $("#measurementState").classList.remove("is-ready");
  renderMeasurementList();
}

function renderMeasurementList() {
  const list = $("#measurementList");
  if (measurements.length === 0) {
    list.innerHTML = '<p class="empty-note">No measurements recorded.</p>';
    return;
  }
  list.innerHTML = measurements.map((measurement) => `<div class="measurement-item"><div><strong>${measurement.id}</strong><span>${formatLength(measurement.distanceMm)}</span></div><small>${measurement.status}</small></div>`).join("");
}

function applyCalibration() {
  const latest = measurements.at(-1);
  if (!latest) {
    showToast("Record a reference measurement first.");
    return;
  }
  const referenceMm = Number(($<HTMLInputElement>("#referenceLength")).value);
  const uncertaintyMm = Number(($<HTMLInputElement>("#referenceUncertainty")).value);
  try {
    scaleCalibration = calibrateScale(referenceMm, latest.rawDistance, uncertaintyMm);
    scaleFactor = scaleCalibration.factor;
    measurements = measurements.map((measurement) => ({ ...measurement, distanceMm: measurement.rawDistance * scaleFactor }));
    $("#scaleStatus").innerHTML = `<span style="background:#397650"></span> Scale factor ${scaleFactor.toFixed(6)} / Unvalidated`;
    updateBoundsReadout();
    renderMeasurementList();
    showToast("Reference scale applied. Measurements remain Unvalidated.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Calibration failed.");
  }
}

function bindEvents() {
  $$<HTMLButtonElement>(".workflow-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view as ViewName)));
  $$<HTMLButtonElement>("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go as ViewName)));
  $$<HTMLButtonElement>("[data-unit]").forEach((button) => button.addEventListener("click", () => setUnit(button.dataset.unit as "mm" | "in")));
  $("#projectForm").addEventListener("submit", (event) => { event.preventDefault(); saveProject(); });
  $("#saveProjectButton").addEventListener("click", saveProject);
  $("#mobileNavButton").addEventListener("click", () => {
    app.classList.toggle("nav-open");
    $("#mobileNavButton").setAttribute("aria-expanded", String(app.classList.contains("nav-open")));
  });
  $("#inspectorFab").addEventListener("click", () => app.classList.add("inspector-open"));
  $("#inspectorClose").addEventListener("click", () => app.classList.remove("inspector-open"));
  $("#addPhotosButton").addEventListener("click", () => ($<HTMLInputElement>("#photoInput")).click());
  $("#photoInput").addEventListener("change", (event) => addPhotos((event.target as HTMLInputElement).files!));
  $("#downloadManifestButton").addEventListener("click", downloadManifest);
  $("#loadDemoButton").addEventListener("click", () => { loadSyntheticModel(true); setView("model"); });
  const meshInputs = [$<HTMLInputElement>("#meshInput"), ...$$<HTMLInputElement>(".mesh-input-clone")];
  meshInputs.forEach((input) => input.addEventListener("change", async () => {
    if (!input.files?.[0]) return;
    try { await parseMesh(input.files[0]); } catch (error) { showToast(error instanceof Error ? error.message : "Mesh could not be opened."); }
    input.value = "";
  }));
  $("#fitViewButton").addEventListener("click", resetViewers);
  $("#resetViewButton").addEventListener("click", resetViewers);
  $("#clipSlider").addEventListener("input", (event) => updateClipPlane(Number((event.target as HTMLInputElement).value)));
  $("#inspectorWireframe").addEventListener("click", () => setWireframe($("#inspectorWireframe").getAttribute("aria-pressed") !== "true"));
  $("#inspectorEdges").addEventListener("click", () => setEdges($("#inspectorEdges").getAttribute("aria-pressed") !== "true"));
  $("#wireframeToggle").addEventListener("change", (event) => setWireframe((event.target as HTMLInputElement).checked));
  $("#edgeToggle").addEventListener("change", (event) => setEdges((event.target as HTMLInputElement).checked));
  $("#settingsUnits").addEventListener("change", (event) => setUnit((event.target as HTMLSelectElement).value as "mm" | "in"));
  $("#runHeightMapButton").addEventListener("click", runHeightMap);
  $("#runHeightMapTop").addEventListener("click", runHeightMap);
  $("#measureModeButton").addEventListener("click", () => {
    measurementMode = !measurementMode;
    pendingPoint = null;
    $("#measureModeButton").setAttribute("aria-pressed", String(measurementMode));
    $("#measurementPrompt").textContent = measurementMode ? "Choose the first point on the mesh." : "Select Start measure, then choose two points on the mesh.";
  });
  viewers.measurements.canvas.addEventListener("pointerup", measurementClick);
  $("#clearMeasurementsButton").addEventListener("click", clearMeasurements);
  $("#applyCalibrationButton").addEventListener("click", applyCalibration);
  $("#exportManifestButton").addEventListener("click", downloadManifest);
  $("#exportMeasurementsButton").addEventListener("click", () => download(`${projectState().projectId}-measurements.csv`, measurementToCsv(measurements, workingUnit), "text/csv"));
  $("#exportHeightButton").addEventListener("click", () => heightMap ? download(`${projectState().projectId}-height-map.csv`, heightMapToCsv(heightMap, workingUnit), "text/csv") : showToast("Run surface sampling first."));
  $("#exportHeightPngButton").addEventListener("click", () => {
    if (!heightMap) { showToast("Run surface sampling first."); return; }
    $<HTMLCanvasElement>("#heightMapCanvas").toBlob((blob) => blob && download(`${projectState().projectId}-height-map.png`, blob, "image/png"));
  });
  $("#clearLocalButton").addEventListener("click", () => {
    if (!window.confirm("Clear the saved project metadata from this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    showToast("Local project metadata cleared.");
  });
}

function animate() {
  const viewer = viewers[currentView];
  if (viewer) {
    viewer.controls.update();
    viewer.renderer.render(viewer.scene, viewer.camera);
  }
  requestAnimationFrame(animate);
}

function init() {
  createIcons({
    icons: {
      ArrowRight,
      Box,
      Camera,
      Check,
      Cpu,
      Crosshair,
      Download,
      Eraser,
      FileJson,
      FlaskConical,
      FolderKanban,
      FolderOpen,
      Grid2X2,
      Grid3X3,
      Image: ImageIcon,
      Info,
      Laptop,
      Maximize,
      Menu,
      PackageOpen,
      PanelRightOpen,
      Plus,
      RotateCcw,
      Ruler,
      Save,
      ScanLine,
      Settings2,
      ShieldCheck,
      Table,
      Trash2,
      Triangle,
      TriangleAlert,
      X,
    },
  });
  viewers = {
    model: createViewer("model", "#modelCanvas"),
    surface: createViewer("surface", "#surfaceCanvas"),
    measurements: createViewer("measurements", "#measurementCanvas"),
  };
  restoreProject();
  bindEvents();
  loadSyntheticModel();
  renderPhotos();
  animate();
}

init();
