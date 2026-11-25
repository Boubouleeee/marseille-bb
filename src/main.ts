import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { nextCombo, policeCount, scoreForProp, wantedStars, type PropKind } from "./gameLogic";
import "./style.css";

const root = document.querySelector<HTMLElement>("#game-root");
if (!root) throw new Error("L'element #game-root est introuvable.");

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#b5d8e6");
scene.fog = new THREE.Fog("#b5d8e6", 850, 2100);

const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 3500);
const clock = new THREE.Clock();
const colliderGrid = new Map<string, Array<{ x: number; z: number; width: number; depth: number }>>();
const destructibles: Destructible[] = [];
const particles: Particle[] = [];
const popups: Popup[] = [];
const cellSize = 32;

interface OSMMap {
  schemaVersion: number;
  attribution: string;
  source: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { x: number; z: number; street: string };
  roads: Array<{ name: string; kind: string; width: number; lines: number[][][] }>;
  buildings: Array<{ id: string; points: number[][]; height: number; kind: string; levels: number | null }>;
  waters: Array<{ id: string; points: number[][] }>;
}

const mapResponse = await fetch(`${import.meta.env.BASE_URL}maps/vieux-port.json`);
if (!mapResponse.ok) throw new Error(`Impossible de charger la carte OSM du Vieux-Port (${mapResponse.status}).`);
const osmMap = await mapResponse.json() as OSMMap;
if (osmMap.schemaVersion !== 1 || !osmMap.roads.length || !osmMap.buildings.length) {
  throw new Error("La carte OSM du Vieux-Port est invalide ou incomplete.");
}
const mapBounds = osmMap.bounds;
const mapWidth = mapBounds.maxX - mapBounds.minX;
const mapDepth = mapBounds.maxZ - mapBounds.minZ;
const startPosition = new THREE.Vector3(osmMap.spawn.x, 0, osmMap.spawn.z);

const materials = {
  white: new THREE.MeshStandardMaterial({ color: "#f4f3eb", roughness: 0.8 }),
  blue: new THREE.MeshStandardMaterial({ color: "#36b9df", roughness: 0.64 }),
  darkBlue: new THREE.MeshStandardMaterial({ color: "#173d55", roughness: 0.78 }),
  skin: new THREE.MeshStandardMaterial({ color: "#b87554", roughness: 0.85 }),
  hair: new THREE.MeshStandardMaterial({ color: "#26303b", roughness: 0.96 }),
  sole: new THREE.MeshStandardMaterial({ color: "#f7f5eb", roughness: 0.8 }),
  rubber: new THREE.MeshStandardMaterial({ color: "#222d37", roughness: 0.95 }),
  gold: new THREE.MeshStandardMaterial({ color: "#f8c64b", roughness: 0.74 }),
  coral: new THREE.MeshStandardMaterial({ color: "#e56f5d", roughness: 0.8 }),
  leaf: new THREE.MeshStandardMaterial({ color: "#327d68", roughness: 0.9 }),
};

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  position: THREE.Vector3 | [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  if (position instanceof THREE.Vector3) item.position.copy(position);
  else item.position.set(position[0], position[1], position[2]);
  parent.add(item);
  return item;
}

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
  castShadow = false,
): THREE.Mesh {
  const item = mesh(new THREE.BoxGeometry(...size), material, parent, position);
  item.castShadow = castShadow;
  item.receiveShadow = true;
  return item;
}

const hemi = new THREE.HemisphereLight("#e7f8ff", "#78684f", 2.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff0d3", 3.15);
sun.position.set(-32, 55, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
sun.shadow.normalBias = 0.035;
scene.add(sun);

function addCollider(collider: { x: number; z: number; width: number; depth: number }): void {
  const minCellX = Math.floor((collider.x - collider.width / 2) / cellSize);
  const maxCellX = Math.floor((collider.x + collider.width / 2) / cellSize);
  const minCellZ = Math.floor((collider.z - collider.depth / 2) / cellSize);
  const maxCellZ = Math.floor((collider.z + collider.depth / 2) / cellSize);
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      const key = `${cellX},${cellZ}`;
      const cell = colliderGrid.get(key) ?? [];
      cell.push(collider);
      colliderGrid.set(key, cell);
    }
  }
}

function addCity(): void {
  const ground = mesh(
    new THREE.PlaneGeometry(mapWidth + 20, mapDepth + 20),
    new THREE.MeshStandardMaterial({ color: "#c5b89f", roughness: 0.96 }),
    scene,
    [(mapBounds.minX + mapBounds.maxX) / 2, -0.2, (mapBounds.minZ + mapBounds.maxZ) / 2],
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;

  const roadPositions: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];
  const roadColor = new THREE.Color();
  for (const road of osmMap.roads) {
    roadColor.set(["primary", "secondary", "tertiary", "trunk", "motorway"].includes(road.kind) ? "#727a7d" : "#8a8b86");
    for (const line of road.lines) {
      for (let index = 1; index < line.length; index++) {
        const [ax, az] = line[index - 1];
        const [bx, bz] = line[index];
        const dx = bx - ax;
        const dz = bz - az;
        const length = Math.hypot(dx, dz);
        if (length < 0.3) continue;
        const halfWidth = road.width / 2;
        const offsetX = (-dz / length) * halfWidth;
        const offsetZ = (dx / length) * halfWidth;
        const base = roadPositions.length / 3;
        roadPositions.push(
          ax + offsetX, -0.08, az + offsetZ,
          ax - offsetX, -0.08, az - offsetZ,
          bx - offsetX, -0.08, bz - offsetZ,
          bx + offsetX, -0.08, bz + offsetZ,
        );
        for (let vertex = 0; vertex < 4; vertex++) roadColors.push(roadColor.r, roadColor.g, roadColor.b);
        roadIndices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute("position", new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeometry.setAttribute("color", new THREE.Float32BufferAttribute(roadColors, 3));
  roadGeometry.setIndex(roadIndices);
  roadGeometry.computeVertexNormals();
  const roadMesh = mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 }),
    scene,
  );
  roadMesh.receiveShadow = true;

  const buildingGeometries: THREE.BufferGeometry[][] = Array.from({ length: 6 }, () => []);
  const facadeColors = ["#dfb58e", "#d89c80", "#e6c9a2", "#cfad8e", "#d7c19a", "#c99c84"];
  const windowSpecs: Array<{ x: number; y: number; z: number; yaw: number; width: number }> = [];
  for (let index = 0; index < osmMap.buildings.length; index++) {
    const building = osmMap.buildings[index];
    const shape = new THREE.Shape();
    building.points.slice(0, -1).forEach(([x, z], pointIndex) => {
      if (pointIndex === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: building.height,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.05, 0);
    buildingGeometries[index % buildingGeometries.length].push(geometry);

    const xs = building.points.map(([x]) => x);
    const zs = building.points.map(([, z]) => z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    addCollider({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ });

    if (index % 3 !== 0) continue;
    const floors = Math.min(7, Math.max(1, Math.floor(building.height / 3.2)));
    for (let edge = 1; edge < building.points.length; edge++) {
      const [ax, az] = building.points[edge - 1];
      const [bx, bz] = building.points[edge];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      const count = Math.min(8, Math.floor(length / 8));
      for (let floor = 0; floor < floors; floor++) {
        for (let window = 0; window < count; window++) {
          const ratio = (window + 1) / (count + 1);
          windowSpecs.push({
            x: ax + dx * ratio,
            y: 1.25 + floor * 3.1,
            z: az + dz * ratio,
            yaw: Math.atan2(-dz, dx),
            width: Math.min(1.6, length / (count + 1) * 0.45),
          });
        }
      }
    }
  }

  for (let index = 0; index < buildingGeometries.length; index++) {
    const geometries = buildingGeometries[index];
    if (!geometries.length) continue;
    const merged = mergeGeometries(geometries, false);
    if (!merged) throw new Error("Impossible de regrouper les facades OSM.");
    mesh(
      merged,
      new THREE.MeshStandardMaterial({ color: facadeColors[index], roughness: 0.91 }),
      scene,
    ).castShadow = true;
    geometries.forEach((geometry) => geometry.dispose());
  }

  if (windowSpecs.length) {
    const windowInstances = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1.35, 0.14),
      new THREE.MeshStandardMaterial({ color: "#477889", roughness: 0.52, metalness: 0.12 }),
      windowSpecs.length,
    );
    const dummy = new THREE.Object3D();
    windowSpecs.forEach((window, index) => {
      dummy.position.set(window.x, window.y, window.z);
      dummy.rotation.set(0, window.yaw, 0);
      dummy.scale.set(window.width, 1, 1);
      dummy.updateMatrix();
      windowInstances.setMatrixAt(index, dummy.matrix);
    });
    windowInstances.instanceMatrix.needsUpdate = true;
    windowInstances.castShadow = false;
    scene.add(windowInstances);
  }

  const waterGeometries: THREE.BufferGeometry[] = [];
  for (const water of osmMap.waters) {
    const shape = new THREE.Shape();
    water.points.slice(0, -1).forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.16, 0);
    waterGeometries.push(geometry);
  }
  if (waterGeometries.length) {
    const waterGeometry = mergeGeometries(waterGeometries, false);
    if (waterGeometry) {
      mesh(
        waterGeometry,
        new THREE.MeshStandardMaterial({ color: "#328ca2", roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide }),
        scene,
      );
    }
    waterGeometries.forEach((geometry) => geometry.dispose());
  }
}

function createPlayer(): THREE.Group {
  const player = new THREE.Group();
  const torso = mesh(new THREE.CapsuleGeometry(0.36, 0.55, 4, 8), materials.white, player, [0, 1.17, 0]);
  torso.scale.set(0.94, 1, 0.68);
  torso.castShadow = true;
  box(player, [0.13, 0.77, 0.49], materials.blue, [0, 1.17, -0.085], false);
  mesh(new THREE.SphereGeometry(0.28, 12, 10), materials.skin, player, [0, 1.88, 0]);
  mesh(new THREE.SphereGeometry(0.29, 10, 8), materials.hair, player, [0, 2.04, -0.015]).scale.set(1, 0.62, 0.98);
  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.42, 1.48, 0);
    player.add(arm);
    const sleeve = mesh(new THREE.CapsuleGeometry(0.12, 0.47, 3, 7), materials.white, arm, [0, -0.28, 0]);
    sleeve.rotation.z = side * -0.14;
    sleeve.castShadow = true;
    mesh(new THREE.SphereGeometry(0.11, 8, 7), materials.skin, arm, [0, -0.57, 0]);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(side * 0.19, 0.81, 0);
    player.add(leg);
    const pant = mesh(new THREE.CapsuleGeometry(0.14, 0.46, 3, 7), materials.darkBlue, leg, [0, -0.28, 0]);
    pant.castShadow = true;
    box(leg, [0.25, 0.14, 0.39], materials.sole, [0, -0.57, -0.085], false);
    legs.push(leg);
  }
  player.userData.limbs = { arms, legs };
  player.position.copy(startPosition);
  scene.add(player);
  return player;
}

interface Destructible {
  mesh: THREE.Group;
  kind: PropKind;
  tint: string;
  active: boolean;
  respawnAt: number;
  basePosition: THREE.Vector3;
}

function createProp(kind: PropKind, x: number, z: number, tint: string): Destructible {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);
  const colored = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.78 });
  if (kind === "crate") {
    box(group, [1, 0.9, 0.9], colored, [0, 0.47, 0], true);
    box(group, [0.12, 0.94, 0.96], materials.gold, [0, 0.47, 0], false);
  } else if (kind === "bin") {
    const body = mesh(new THREE.CylinderGeometry(0.42, 0.35, 0.9, 10), colored, group, [0, 0.48, 0]);
    body.castShadow = true;
    mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 10), materials.darkBlue, group, [0, 0.98, 0]);
  } else if (kind === "parasol") {
    mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.25, 8), materials.white, group, [0, 1.12, 0]);
    const shade = mesh(new THREE.ConeGeometry(1.15, 0.65, 8), colored, group, [0, 2.13, 0]);
    shade.rotation.x = Math.PI;
    shade.castShadow = true;
  } else if (kind === "barrel") {
    const barrel = mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.9, 10), colored, group, [0, 0.47, 0]);
    barrel.castShadow = true;
    for (const y of [0.18, 0.76]) mesh(new THREE.TorusGeometry(0.43, 0.045, 5, 12), materials.gold, group, [0, y, 0]);
  } else {
    box(group, [0.85, 0.9, 0.18], colored, [0, 1.1, 0], true);
    box(group, [0.12, 1.4, 0.12], materials.darkBlue, [0, 0.7, 0]);
    box(group, [0.46, 0.09, 0.19], materials.white, [0, 1.1, 0.11]);
  }
  return { mesh: group, kind, tint, active: true, respawnAt: 0, basePosition: group.position.clone() };
}

const player = createPlayer();

function addProps(): void {
  const layout: Array<[PropKind, number, number, string]> = [
    ["crate", -7.5, -8, "#d99052"],
    ["bin", 2.3, -9.5, "#4d8c83"],
    ["parasol", 10.2, -12, "#e67b67"],
    ["crate", -12.2, -13.6, "#d2a35f"],
    ["barrel", 12.5, -3.2, "#5596ac"],
    ["sign", -2.1, 4.1, "#e5bd53"],
    ["bin", 7.5, 7.4, "#60927d"],
    ["parasol", -13.4, 5.4, "#e88e72"],
    ["crate", -6.8, 14.2, "#c98b55"],
    ["barrel", 13.8, 13.4, "#628fa0"],
    ["sign", 2.4, 18.5, "#e2bb4d"],
    ["crate", -15, 18.8, "#d99052"],
  ];
  for (const [kind, x, z, tint] of layout) {
    destructibles.push(createProp(kind, startPosition.x + x, startPosition.z + z, tint));
  }
}

interface PoliceCar {
  group: THREE.Group;
  lights: THREE.MeshStandardMaterial[];
  wheels: THREE.Mesh[];
  active: boolean;
}

function createPoliceCar(): PoliceCar {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: "#edf0e9", roughness: 0.58, metalness: 0.08 });
  const glassMat = new THREE.MeshStandardMaterial({ color: "#64a6bb", roughness: 0.34, metalness: 0.18 });
  box(group, [1.65, 0.58, 3.15], bodyMat, [0, 0.65, 0], true);
  box(group, [1.28, 0.66, 1.55], materials.white, [0, 1.2, -0.14], true);
  box(group, [1.32, 0.25, 3.17], materials.blue, [0, 0.68, 0], false);
  box(group, [1.18, 0.52, 0.08], glassMat, [0, 1.27, -0.94]);
  box(group, [1.18, 0.48, 0.08], glassMat, [0, 1.24, 0.63]);
  box(group, [0.08, 0.45, 0.55], glassMat, [-0.65, 1.25, -0.12]);
  box(group, [0.08, 0.45, 0.55], glassMat, [0.65, 1.25, -0.12]);
  const wheels: THREE.Mesh[] = [];
  for (const x of [-0.83, 0.83]) {
    for (const z of [-0.98, 0.98]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.23, 10), materials.rubber, group, [x, 0.38, z]);
      wheel.rotation.z = Math.PI / 2;
      wheels.push(wheel);
    }
  }
  const lights: THREE.MeshStandardMaterial[] = [];
  for (const [x, color] of [[-0.31, "#298eff"], [0.31, "#ff465c"]] as const) {
    const lightMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8 });
    mesh(new THREE.BoxGeometry(0.48, 0.13, 0.22), lightMaterial, group, [x, 1.58, 0.05]);
    lights.push(lightMaterial);
  }
  group.visible = false;
  scene.add(group);
  return { group, lights, wheels, active: false };
}

const policeCars = [createPoliceCar(), createPoliceCar(), createPoliceCar()];

const ui = buildUi(root);
const minimapContext = ui.minimap.getContext("2d");
if (!minimapContext) throw new Error("Impossible d'initialiser la mini-carte.");

function buildUi(container: HTMLElement) {
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="vignette"></div>
    <header class="topbar">
      <div class="brand"><div class="brand-name">MARSEILLE <span>BB</span></div><div class="brand-subtitle">Le quartier est a toi</div></div>
      <div class="top-actions">
        <button class="icon-button" id="sound-button" type="button" aria-label="Activer ou couper le son" title="Son">Son : on</button>
        <button class="icon-button" id="pause-button" type="button" aria-label="Mettre en pause" title="Pause">Pause</button>
        <button class="icon-button" id="restart-button" type="button" aria-label="Recommencer la partie" title="Recommencer">↻</button>
      </div>
    </header>
    <section class="hud-grid" aria-label="Score et indice de recherche">
      <div class="panel score-panel">
        <div class="eyebrow">Score du quartier</div>
        <div class="score-line"><div class="score" id="score">0</div><div class="combo" id="combo">x1</div></div>
      </div>
      <div class="panel heat-panel">
        <div class="heat-row"><span class="eyebrow">Indice arcade</span><span class="stars" id="stars">☆☆☆☆☆☆</span></div>
        <div class="heat-track"><div class="heat-fill" id="heat-fill"></div></div>
      </div>
    </section>
    <aside class="right-stack">
      <div class="minimap-wrap"><canvas class="minimap" id="minimap" width="300" height="210" aria-label="Mini-carte du quartier"></canvas><div class="mini-label">PORT &amp; QUARTIER</div></div>
      <div class="panel controls-card"><kbd>ZQSD</kbd> / <kbd>WASD</kbd> / <kbd>↑↓←→</kbd> bouger · <kbd>Shift</kbd> sprinter<br><kbd>Souris</kbd> glissee tourner · <kbd>Espace</kbd> sauter<br><kbd>E</kbd> / clic impulsion arcade</div>
    </aside>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <footer class="bottom-bar">
      <div class="location-stack">
        <div class="district-tag">MARSEILLE · <span id="street-name">LE PORT</span></div>
        <div class="map-credit">© OpenStreetMap contributors · ODbL</div>
      </div>
      <div class="version-tag">Carte réelle · prototype solo</div>
    </footer>
    <section class="modal" id="modal" aria-modal="true" role="dialog" aria-labelledby="modal-title">
      <div class="modal-card">
        <div class="modal-kicker" id="modal-kicker">Carte OpenStreetMap · zone test</div>
        <h1 class="modal-title" id="modal-title">MARSEILLE <span>BB</span></h1>
        <p class="modal-copy" id="modal-copy">Un petit quartier mediterraneen, une impulsion arcade et des accessoires qui repartent en confettis. Enchaine les combos, puis seme les voitures de patrouille-jouets.</p>
        <div class="modal-meta" id="modal-meta"><kbd>ZQSD</kbd>/<kbd>WASD</kbd> bouger · <kbd>Shift</kbd> sprinter · <kbd>Espace</kbd> sauter<br><kbd>E</kbd> ou clic gauche pres d'un accessoire pour le faire rebondir.</div>
        <button class="control-button" id="modal-action" type="button">Entrer dans le quartier</button>
      </div>
    </section>`;
  container.append(hud);

  return {
    score: hud.querySelector<HTMLElement>("#score")!,
    combo: hud.querySelector<HTMLElement>("#combo")!,
    stars: hud.querySelector<HTMLElement>("#stars")!,
    heatFill: hud.querySelector<HTMLElement>("#heat-fill")!,
    minimap: hud.querySelector<HTMLCanvasElement>("#minimap")!,
    toast: hud.querySelector<HTMLElement>("#toast")!,
    modal: hud.querySelector<HTMLElement>("#modal")!,
    modalKicker: hud.querySelector<HTMLElement>("#modal-kicker")!,
    modalTitle: hud.querySelector<HTMLElement>("#modal-title")!,
    modalCopy: hud.querySelector<HTMLElement>("#modal-copy")!,
    modalMeta: hud.querySelector<HTMLElement>("#modal-meta")!,
    modalAction: hud.querySelector<HTMLButtonElement>("#modal-action")!,
    soundButton: hud.querySelector<HTMLButtonElement>("#sound-button")!,
    pauseButton: hud.querySelector<HTMLButtonElement>("#pause-button")!,
    restartButton: hud.querySelector<HTMLButtonElement>("#restart-button")!,
    streetName: hud.querySelector<HTMLElement>("#street-name")!,
  };
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Popup {
  sprite: THREE.Sprite;
  life: number;
}

function showToast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  toastTimer = 1.6;
}

function addPopup(position: THREE.Vector3, message: string, color: string): void {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Impossible de creer le texte du combo.");
  context.font = "800 39px Segoe UI, sans-serif";
  context.textAlign = "center";
  context.lineWidth = 9;
  context.strokeStyle = "rgba(4,20,30,.76)";
  context.strokeText(message, 128, 54);
  context.fillStyle = color;
  context.fillText(message, 128, 54);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position).add(new THREE.Vector3(0, 2, 0));
  sprite.scale.set(3.4, 1.05, 1);
  scene.add(sprite);
  popups.push({ sprite, life: 0.95 });
}

function spawnBurst(position: THREE.Vector3, tint: string): void {
  const color = new THREE.Color(tint);
  const ring = mesh(
    new THREE.TorusGeometry(0.65, 0.055, 5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    scene,
    [position.x, 0.12, position.z],
  );
  ring.rotation.x = Math.PI / 2;
  particles.push({ mesh: ring, velocity: new THREE.Vector3(0, 2.1, 0), life: 0.45, maxLife: 0.45 });
  for (let i = 0; i < 8; i++) {
    const chip = mesh(
      new THREE.BoxGeometry(0.15 + Math.random() * 0.18, 0.12 + Math.random() * 0.17, 0.14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.68 }),
      scene,
      [position.x, 0.45 + Math.random() * 0.8, position.z],
    );
    chip.castShadow = true;
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 3.2;
    particles.push({
      mesh: chip,
      velocity: new THREE.Vector3(Math.cos(angle) * speed, 1.4 + Math.random() * 3, Math.sin(angle) * speed),
      life: 0.85 + Math.random() * 0.65,
      maxLife: 1.5,
    });
  }
}

let audioContext: AudioContext | null = null;
let soundEnabled = true;
function playPop(): void {
  if (!soundEnabled) return;
  audioContext ??= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(460, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(170, audioContext.currentTime + 0.12);
  gain.gain.setValueAtTime(0.07, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.13);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.14);
}

let score = 0;
let combo = 0;
let comboTime = 0;
let lastHitTime = 0;
let heat = 0;
let toastTimer = 0;
let playerY = 0;
let jumpVelocity = 0;
let cameraYaw = 0;
let cameraDistance = 7.8;
let modalMode: "intro" | "pause" | null = "intro";
let lastPoliceBlink = 0;
let captureCooldown = 0;
let footstepPhase = 0;
const keys = new Set<string>();
let dragging = false;
let dragMoved = false;
let lastPointerX = 0;

function setModal(mode: "intro" | "pause" | null): void {
  modalMode = mode;
  ui.modal.hidden = mode === null;
  if (mode === "intro") {
    ui.modalKicker.textContent = "Carte OpenStreetMap · zone test";
    ui.modalTitle.innerHTML = "MARSEILLE <span>BB</span>";
    ui.modalCopy.textContent = "Explore les rues et les empreintes de batiments du Vieux-Port, converties depuis OpenStreetMap. Fais rebondir les accessoires fictifs, enchaine les combos et seme les voitures de patrouille-jouets.";
    ui.modalMeta.innerHTML = "<kbd>ZQSD</kbd>/<kbd>WASD</kbd>/<kbd>↑↓←→</kbd> bouger · <kbd>Shift</kbd> sprinter · <kbd>Espace</kbd> sauter<br><kbd>E</kbd> ou clic gauche pres d'un accessoire pour le faire rebondir.";
    ui.modalAction.textContent = "Entrer dans le quartier";
  } else if (mode === "pause") {
    ui.modalKicker.textContent = "La partie est en pause";
    ui.modalTitle.innerHTML = "A toi de <span>jouer</span>";
    ui.modalCopy.textContent = "Le quartier attend. Reprends ta balade ou relance une nouvelle partie.";
    ui.modalMeta.textContent = `Score conserve : ${score.toLocaleString("fr-FR")} points.`;
    ui.modalAction.textContent = "Reprendre";
  }
}

function updateHud(): void {
  const stars = wantedStars(heat);
  ui.score.textContent = score.toLocaleString("fr-FR");
  ui.combo.textContent = `x${Math.max(1, Math.min(combo, 8))}`;
  ui.combo.classList.toggle("is-active", combo > 1 && comboTime > 0);
  ui.stars.textContent = `${"★".repeat(stars)}${"☆".repeat(6 - stars)}`;
  ui.heatFill.style.width = `${heat}%`;
  ui.pauseButton.textContent = modalMode === null ? "Pause" : "Reprendre";
  ui.pauseButton.setAttribute("aria-label", modalMode === null ? "Mettre en pause" : "Reprendre la partie");
}

function resetGame(): void {
  score = 0;
  combo = 0;
  comboTime = 0;
  heat = 0;
  player.position.copy(startPosition);
  player.rotation.y = 0;
  playerY = 0;
  jumpVelocity = 0;
  for (const prop of destructibles) {
    prop.active = true;
    prop.mesh.visible = true;
    prop.mesh.position.copy(prop.basePosition);
  }
  for (const car of policeCars) {
    car.active = false;
    car.group.visible = false;
  }
  clearEffects();
  showToast("Nouvelle balade dans le quartier !");
  setModal(null);
  updateHud();
}

function clearEffects(): void {
  for (const particle of particles) {
    scene.remove(particle.mesh);
    particle.mesh.geometry.dispose();
    const material = particle.mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }
  particles.length = 0;
  for (const popup of popups) {
    scene.remove(popup.sprite);
    const material = popup.sprite.material;
    if (material.map) material.map.dispose();
    material.dispose();
  }
  popups.length = 0;
}

function interact(): void {
  if (modalMode !== null) return;
  const now = performance.now();
  let affected = 0;
  const impulseRadius = 3.6;
  for (const prop of destructibles) {
    if (!prop.active || prop.mesh.position.distanceTo(player.position) > impulseRadius) continue;
    prop.active = false;
    prop.mesh.visible = false;
    prop.respawnAt = now + 11000;
    const elapsed = lastHitTime === 0 ? Number.POSITIVE_INFINITY : now - lastHitTime;
    combo = nextCombo(combo, elapsed);
    comboTime = 2.8;
    lastHitTime = now;
    const points = scoreForProp(prop.kind, combo);
    score += points;
    heat = Math.min(100, heat + 12 + Math.min(combo, 8) * 1.5);
    spawnBurst(prop.mesh.position, prop.tint);
    addPopup(prop.mesh.position, `+${points.toLocaleString("fr-FR")}`, combo > 2 ? "#ffd46a" : "#ffffff");
    affected++;
  }
  if (affected === 0) {
    showToast("Approche-toi d'un accessoire pour l'impulsion.");
    return;
  }
  playPop();
  showToast(combo > 2 ? `Combo x${Math.min(combo, 8)} · joli rebond !` : `${affected > 1 ? `${affected} accessoires` : "Accessoire"} en rebond !`);
  updateHud();
}

function collides(x: number, z: number, radius: number): boolean {
  if (
    x < mapBounds.minX + radius
    || x > mapBounds.maxX - radius
    || z < mapBounds.minZ + radius
    || z > mapBounds.maxZ - radius
  ) return true;
  const minCellX = Math.floor((x - radius) / cellSize);
  const maxCellX = Math.floor((x + radius) / cellSize);
  const minCellZ = Math.floor((z - radius) / cellSize);
  const maxCellZ = Math.floor((z + radius) / cellSize);
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (const block of colliderGrid.get(`${cellX},${cellZ}`) ?? []) {
        if (
          Math.abs(x - block.x) < block.width / 2 + radius
          && Math.abs(z - block.z) < block.depth / 2 + radius
        ) return true;
      }
    }
  }
  return false;
}

function updatePlayer(delta: number): void {
  const forward = Number(keys.has("KeyW") || keys.has("KeyZ") || keys.has("ArrowUp"))
    - Number(keys.has("KeyS") || keys.has("ArrowDown"));
  const sideways = Number(keys.has("KeyD") || keys.has("ArrowRight"))
    - Number(keys.has("KeyA") || keys.has("KeyQ") || keys.has("ArrowLeft"));
  const input = new THREE.Vector2(sideways, forward);
  if (input.lengthSq() > 0) {
    input.normalize();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const direction = new THREE.Vector3(input.x * cos - input.y * sin, 0, -input.x * sin - input.y * cos).normalize();
    const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = sprinting ? 10 : 6.2;
    const distance = speed * delta;
    const nextX = player.position.x + direction.x * distance;
    const nextZ = player.position.z + direction.z * distance;
    if (!collides(nextX, player.position.z, 0.55)) player.position.x = nextX;
    if (!collides(player.position.x, nextZ, 0.55)) player.position.z = nextZ;
    player.rotation.y = Math.atan2(-direction.x, -direction.z);
    footstepPhase += delta * (sprinting ? 13 : 8);
    const limbs = player.userData.limbs as { arms: THREE.Group[]; legs: THREE.Group[] };
    const swing = Math.sin(footstepPhase) * (sprinting ? 0.68 : 0.46);
    limbs.legs[0].rotation.x = swing;
    limbs.legs[1].rotation.x = -swing;
    limbs.arms[0].rotation.x = -swing * 0.72;
    limbs.arms[1].rotation.x = swing * 0.72;
  } else {
    const limbs = player.userData.limbs as { arms: THREE.Group[]; legs: THREE.Group[] };
    for (const limb of [...limbs.legs, ...limbs.arms]) limb.rotation.x *= Math.max(0, 1 - delta * 8);
  }

  if (keys.has("Space") && playerY <= 0.001) jumpVelocity = 8.6;
  if (jumpVelocity !== 0 || playerY > 0) {
    playerY += jumpVelocity * delta;
    jumpVelocity -= 20 * delta;
    if (playerY <= 0) {
      playerY = 0;
      jumpVelocity = 0;
    }
  }
  player.position.y = playerY;
}

function updatePolice(delta: number, now: number): void {
  const desired = policeCount(wantedStars(heat));
  for (let i = 0; i < policeCars.length; i++) {
    const car = policeCars[i];
    if (i >= desired) {
      car.active = false;
      car.group.visible = false;
      continue;
    }
    if (!car.active) {
      const angle = ((i + 1) / (desired + 1)) * Math.PI * 2 + 0.35;
      car.group.position.set(player.position.x + Math.cos(angle) * 19, 0, player.position.z + Math.sin(angle) * 19);
      car.active = true;
      car.group.visible = true;
    }
    const dx = player.position.x - car.group.position.x;
    const dz = player.position.z - car.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.001) {
      const speed = 3.1 + wantedStars(heat) * 0.36;
      car.group.position.x += (dx / distance) * Math.min(distance, speed * delta);
      car.group.position.z += (dz / distance) * Math.min(distance, speed * delta);
      car.group.rotation.y = Math.atan2(-dx, -dz);
      for (const wheel of car.wheels) wheel.rotation.x += speed * delta * 1.3;
    }
    if (now - lastPoliceBlink > 0.28) {
      car.lights[0].emissiveIntensity = car.lights[0].emissiveIntensity > 0.5 ? 0.18 : 2.4;
      car.lights[1].emissiveIntensity = car.lights[1].emissiveIntensity > 0.5 ? 0.18 : 2.4;
    }
    if (distance < 1.75 && captureCooldown <= 0) {
      score = Math.max(0, Math.floor(score * 0.72));
      heat = 0;
      combo = 0;
      comboTime = 0;
      lastHitTime = 0;
      player.position.copy(startPosition);
      playerY = 0;
      captureCooldown = 2.5;
      showToast("Capture arcade ! -28 % du score, puis retour au quartier.");
      updateHud();
      break;
    }
  }
  if (now - lastPoliceBlink > 0.28) lastPoliceBlink = now;
}

function updateEffects(delta: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.life -= delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.velocity.y -= 8 * delta;
    particle.mesh.rotation.x += delta * 5;
    particle.mesh.rotation.z += delta * 3;
    if (particle.mesh.position.y < 0.08) {
      particle.mesh.position.y = 0.08;
      particle.velocity.y *= -0.35;
      particle.velocity.x *= 0.75;
      particle.velocity.z *= 0.75;
    }
    const material = particle.mesh.material;
    const opacity = Math.max(0, Math.min(1, particle.life / particle.maxLife));
    if (material instanceof THREE.Material && "opacity" in material) {
      material.transparent = true;
      material.opacity = opacity;
    }
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
      particles.splice(i, 1);
    }
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const popup = popups[i];
    popup.life -= delta;
    popup.sprite.position.y += delta * 0.9;
    popup.sprite.material.opacity = Math.max(0, popup.life);
    if (popup.life <= 0) {
      scene.remove(popup.sprite);
      popup.sprite.material.map?.dispose();
      popup.sprite.material.dispose();
      popups.splice(i, 1);
    }
  }
}

function updateCamera(delta: number): void {
  const behind = new THREE.Vector3(Math.sin(cameraYaw) * cameraDistance, 4.25, Math.cos(cameraYaw) * cameraDistance);
  const desired = player.position.clone().add(behind);
  desired.y = Math.max(desired.y, playerY + 2.5);
  camera.position.lerp(desired, 1 - Math.exp(-5.4 * delta));
  camera.lookAt(player.position.x, playerY + 1.05, player.position.z);
}

function closestStreetName(x: number, z: number): string {
  let closestName = "";
  let closestDistance = 35;
  for (const road of osmMap.roads) {
    if (!road.name) continue;
    for (const line of road.lines) {
      for (let index = 1; index < line.length; index++) {
        const [ax, az] = line[index - 1];
        const [bx, bz] = line[index];
        const dx = bx - ax;
        const dz = bz - az;
        const lengthSq = dx * dx + dz * dz;
        const ratio = lengthSq === 0
          ? 0
          : THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
        const distance = Math.hypot(x - (ax + ratio * dx), z - (az + ratio * dz));
        if (distance < closestDistance) {
          closestDistance = distance;
          closestName = road.name;
        }
      }
    }
  }
  return closestName || "VIEUX-PORT";
}

function drawMinimap(): void {
  const context = minimapContext!;
  const canvas = ui.minimap;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#b9ad96";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const mapPoint = (x: number, z: number) => ({
    x: ((x - mapBounds.minX) / mapWidth) * canvas.width,
    y: ((mapBounds.maxZ - z) / mapDepth) * canvas.height,
  });
  context.fillStyle = "#328ca2";
  for (const water of osmMap.waters) {
    context.beginPath();
    water.points.forEach(([x, z], index) => {
      const point = mapPoint(x, z);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fill();
  }
  context.fillStyle = "rgba(91, 74, 59, .66)";
  for (const building of osmMap.buildings) {
    context.beginPath();
    building.points.forEach(([x, z], index) => {
      const point = mapPoint(x, z);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fill();
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const road of osmMap.roads) {
    context.strokeStyle = road.kind === "primary" || road.kind === "secondary" ? "#eee1c8" : "#f7f1e4";
    context.lineWidth = Math.max(0.7, (road.width / mapWidth) * canvas.width * 0.75);
    for (const line of road.lines) {
      context.beginPath();
      line.forEach(([x, z], index) => {
        const point = mapPoint(x, z);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
    }
  }
  for (const car of policeCars) {
    if (!car.active) continue;
    const point = mapPoint(car.group.position.x, car.group.position.z);
    context.fillStyle = "#ff6568";
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fill();
  }
  const playerPoint = mapPoint(player.position.x, player.position.z);
  context.fillStyle = "#bff5ff";
  context.beginPath();
  context.arc(playerPoint.x, playerPoint.y, 6, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#087d9a";
  context.lineWidth = 2;
  context.stroke();
  ui.streetName.textContent = closestStreetName(player.position.x, player.position.z);
}

let minimapRefresh = 0;
let streetRefresh = 0;
function animate(): void {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.04);
  const now = performance.now();
  if (modalMode === null) {
    updatePlayer(delta);
    heat = Math.max(0, heat - delta * 0.65);
    comboTime = Math.max(0, comboTime - delta);
    if (comboTime === 0) combo = 0;
    captureCooldown = Math.max(0, captureCooldown - delta);
    for (const prop of destructibles) {
      if (!prop.active && now >= prop.respawnAt) {
        prop.active = true;
        prop.mesh.visible = true;
        prop.mesh.position.copy(prop.basePosition);
        showToast("Un accessoire est de retour dans le quartier.");
      }
    }
    updatePolice(delta, now);
    updateEffects(delta);
    if (toastTimer > 0) {
      toastTimer -= delta;
      if (toastTimer <= 0) ui.toast.classList.remove("visible");
    }
    updateHud();
  }
  updateCamera(delta);
  if (now - minimapRefresh > 250) {
    drawMinimap();
    minimapRefresh = now;
  }
  if (now - streetRefresh > 650) {
    ui.streetName.textContent = closestStreetName(player.position.x, player.position.z);
    streetRefresh = now;
  }
  renderer.render(scene, camera);
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  dragging = true;
  dragMoved = false;
  lastPointerX = event.clientX;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!dragging || modalMode !== null) return;
  const movement = event.clientX - lastPointerX;
  if (Math.abs(movement) > 2) dragMoved = true;
  cameraYaw -= movement * 0.006;
  lastPointerX = event.clientX;
});
renderer.domElement.addEventListener("pointerup", () => {
  dragging = false;
});
renderer.domElement.addEventListener("click", () => {
  if (!dragMoved) interact();
});
renderer.domElement.addEventListener("wheel", (event) => {
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + Math.sign(event.deltaY) * 0.6, 5.2, 11);
}, { passive: true });

window.addEventListener("keydown", (event) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  if (event.code === "Escape") {
    setModal(modalMode === null ? "pause" : null);
    updateHud();
    return;
  }
  if (event.code === "KeyE" && !event.repeat) interact();
  if (!event.repeat) keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

ui.modalAction.addEventListener("click", () => {
  if (modalMode === "intro") setModal(null);
  else if (modalMode === "pause") setModal(null);
  updateHud();
});
ui.pauseButton.addEventListener("click", () => {
  setModal(modalMode === null ? "pause" : null);
  updateHud();
});
ui.restartButton.addEventListener("click", resetGame);
ui.soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  ui.soundButton.textContent = `Son : ${soundEnabled ? "on" : "off"}`;
  if (soundEnabled) playPop();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

addCity();
addProps();
ui.streetName.textContent = osmMap.spawn.street || "VIEUX-PORT";
updateCamera(1);
updateHud();
animate();
