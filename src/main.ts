import * as THREE from "three";
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
scene.fog = new THREE.Fog("#b5d8e6", 65, 155);

const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.1, 220);
const clock = new THREE.Clock();
const worldColliders: Array<{ x: number; z: number; width: number; depth: number }> = [];
const destructibles: Destructible[] = [];
const particles: Particle[] = [];
const popups: Popup[] = [];

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

function makePavingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Impossible de creer la texture du pave.");
  context.fillStyle = "#b5a995";
  context.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      const shade = 160 + Math.floor(Math.random() * 27);
      context.fillStyle = `rgb(${shade}, ${shade - 10}, ${shade - 27})`;
      context.fillRect(x + 1, y + 1, 30, 30);
      context.strokeStyle = "rgba(80, 68, 54, .18)";
      context.strokeRect(x + 0.5, y + 0.5, 31, 31);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
}

function makeFacadeTexture(base: string, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Impossible de creer la texture des facades.");
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,.15)";
  for (let i = 0; i < 22; i++) {
    const x = ((i * 41 + seed * 17) % 224) + 10;
    const y = ((i * 67 + seed * 29) % 480) + 16;
    context.fillRect(x, y, 5, 8);
  }
  const rows = 5;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < 3; column++) {
      const x = 30 + column * 76 + ((row + seed) % 2) * 5;
      const y = 40 + row * 90;
      context.fillStyle = "#f4dcaa";
      context.fillRect(x - 5, y - 5, 42, 57);
      context.fillStyle = row % 2 ? "#477484" : "#547e89";
      context.fillRect(x, y, 32, 46);
      context.fillStyle = "rgba(247,223,169,.46)";
      context.fillRect(x + 3, y + 3, 11, 40);
      context.fillStyle = "#eee2ca";
      context.fillRect(x - 5, y + 45, 42, 5);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const hemi = new THREE.HemisphereLight("#e7f8ff", "#78684f", 2.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff0d3", 3.15);
sun.position.set(-32, 55, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -52;
sun.shadow.camera.right = 52;
sun.shadow.camera.top = 58;
sun.shadow.camera.bottom = -58;
sun.shadow.normalBias = 0.035;
scene.add(sun);

function addCity(): void {
  const pave = makePavingTexture();
  const ground = mesh(
    new THREE.PlaneGeometry(110, 125),
    new THREE.MeshStandardMaterial({ map: pave, roughness: 0.96 }),
    scene,
    [0, -0.13, 18],
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;

  const sea = mesh(
    new THREE.PlaneGeometry(130, 62),
    new THREE.MeshStandardMaterial({ color: "#318aa4", roughness: 0.32, metalness: 0.08 }),
    scene,
    [0, -0.32, -53],
  );
  sea.rotation.x = -Math.PI / 2;

  const waveMaterial = new THREE.MeshBasicMaterial({ color: "#9bd8d9", transparent: true, opacity: 0.33 });
  for (let i = 0; i < 12; i++) {
    const wave = mesh(new THREE.TorusGeometry(1.3 + (i % 3) * 0.55, 0.025, 5, 36), waveMaterial, scene, [
      -49 + ((i * 19) % 96),
      -0.27,
      -65 + ((i * 11) % 28),
    ]);
    wave.rotation.x = Math.PI / 2;
  }

  box(scene, [110, 0.55, 3], new THREE.MeshStandardMaterial({ color: "#d0b894", roughness: 0.89 }), [0, 0.05, -27]);
  box(scene, [110, 0.28, 8], new THREE.MeshStandardMaterial({ color: "#c5b498", roughness: 0.91 }), [0, -0.02, -21.5]);
  box(scene, [110, 0.22, 0.45], new THREE.MeshStandardMaterial({ color: "#eee2c9" }), [0, 0.2, -25.6]);

  const roadMat = new THREE.MeshStandardMaterial({ color: "#74797a", roughness: 0.96 });
  const road = mesh(new THREE.PlaneGeometry(110, 10), roadMat, scene, [0, -0.03, 1.5]);
  road.rotation.x = -Math.PI / 2;
  for (let x = -48; x <= 48; x += 8) {
    box(scene, [3.2, 0.025, 0.16], new THREE.MeshStandardMaterial({ color: "#ead9a5" }), [x, 0, 1.5]);
  }
  box(scene, [1.4, 0.18, 9.5], new THREE.MeshStandardMaterial({ color: "#ceb990" }), [-20.5, 0.03, 1.5]);
  box(scene, [1.4, 0.18, 9.5], new THREE.MeshStandardMaterial({ color: "#ceb990" }), [20.5, 0.03, 1.5]);

  const palette = ["#dfae84", "#e7c2a0", "#d89479", "#dbc99d", "#c5a68b", "#e1b695"];
  const placements: Array<[number, number, number, number, number]> = [];
  for (const x of [-32, 32]) {
    for (const z of [-10, 9, 28, 47]) {
      placements.push([x, z, 12, 13, 10 + ((Math.abs(x + z) % 4) + 1) * 1.65]);
    }
  }
  for (const x of [-25, -9, 8, 24]) placements.push([x, 53, 14, 14, 13 + (Math.abs(x) % 3) * 1.4]);

  placements.forEach(([x, z, width, depth, height], index) => {
    const texture = makeFacadeTexture(palette[index % palette.length], index + 2);
    const wallMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
    const block = box(scene, [width, height, depth], wallMaterial, [x, height / 2, z], true);
    block.castShadow = true;
    worldColliders.push({ x, z, width, depth });
    const roof = box(scene, [width + 0.35, 0.45, depth + 0.35], new THREE.MeshStandardMaterial({ color: "#b9715d", roughness: 0.92 }), [
      x,
      height + 0.18,
      z,
    ]);
    roof.castShadow = true;
    for (let side = -1; side <= 1; side += 2) {
      for (let row = 0; row < 3; row++) {
        const balcony = box(
          scene,
          [0.95, 0.13, 0.47],
          new THREE.MeshStandardMaterial({ color: "#e8d8ba", roughness: 0.8 }),
          [x + side * (width / 2 + 0.18), 2.7 + row * 2.5, z - 1 + (row % 2) * 2],
        );
        balcony.castShadow = true;
      }
    }
  });

  const boatMaterial = new THREE.MeshStandardMaterial({ color: "#f0eee3", roughness: 0.74 });
  for (let i = 0; i < 7; i++) {
    const x = -37 + i * 12;
    const z = -36 - (i % 2) * 3.6;
    const boat = new THREE.Group();
    scene.add(boat);
    boat.position.set(x, -0.12, z);
    const hull = mesh(new THREE.CylinderGeometry(0.2, 0.85, 6, 7), boatMaterial, boat);
    hull.rotation.z = Math.PI / 2;
    hull.scale.set(1, 0.72, 0.7);
    box(boat, [1.9, 0.85, 1.3], new THREE.MeshStandardMaterial({ color: i % 2 ? "#d76c5f" : "#467e91" }), [0.3, 0.45, 0]);
    box(boat, [0.08, 2.8, 0.08], new THREE.MeshStandardMaterial({ color: "#dac9a9" }), [0.2, 1.4, 0]);
    const sail = mesh(new THREE.ConeGeometry(1.25, 2.2, 3), new THREE.MeshStandardMaterial({ color: "#f3ead2", side: THREE.DoubleSide }), boat, [-0.5, 1.45, 0]);
    sail.rotation.z = -Math.PI / 2;
  }

  for (const x of [-17, 17]) {
    for (const z of [-19, -10, 13, 23, 35]) addPalm(x + (z % 3), z);
  }
  for (const [x, z] of [[-13, -17], [-7, -18], [8, -18], [14, -17], [-16, 5], [16, 8]]) {
    addCafeSet(x, z);
  }
}

function addPalm(x: number, z: number): void {
  const palm = new THREE.Group();
  scene.add(palm);
  palm.position.set(x, 0, z);
  const trunk = mesh(new THREE.CylinderGeometry(0.19, 0.32, 5.3, 7), new THREE.MeshStandardMaterial({ color: "#9a7958", roughness: 1 }), palm, [0, 2.65, 0]);
  trunk.castShadow = true;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const leaf = mesh(new THREE.ConeGeometry(0.35, 3.1, 5), materials.leaf, palm, [
      Math.cos(angle) * 1.08,
      5.1 - (i % 2) * 0.2,
      Math.sin(angle) * 1.08,
    ]);
    leaf.rotation.z = Math.cos(angle) * 0.9;
    leaf.rotation.x = Math.sin(angle) * 0.9;
    leaf.castShadow = true;
  }
}

function addCafeSet(x: number, z: number): void {
  const table = new THREE.Group();
  scene.add(table);
  table.position.set(x, 0, z);
  const leg = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), materials.darkBlue, table, [0, 0.5, 0]);
  leg.castShadow = true;
  const top = mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 12), materials.white, table, [0, 0.98, 0]);
  top.castShadow = true;
  for (const side of [-1, 1]) {
    const chair = box(table, [0.42, 0.58, 0.42], side < 0 ? materials.coral : materials.blue, [side * 1.25, 0.35, 0.2], true);
    chair.rotation.y = side * 0.18;
  }
  const parasol = mesh(
    new THREE.ConeGeometry(1.7, 0.78, 10),
    new THREE.MeshStandardMaterial({ color: x % 2 ? "#ed876b" : "#55bfd0", roughness: 0.83 }),
    table,
    [0, 2.32, 0],
  );
  parasol.rotation.x = Math.PI;
  parasol.castShadow = true;
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 2, 8), materials.white, table, [0, 1.35, 0]);
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
  player.position.set(0, 0, 8);
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
  for (const [kind, x, z, tint] of layout) destructibles.push(createProp(kind, x, z, tint));
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
      <div class="panel controls-card"><kbd>ZQSD</kbd> / <kbd>WASD</kbd> bouger · <kbd>Shift</kbd> sprinter<br><kbd>Souris</kbd> glissee tourner · <kbd>Espace</kbd> sauter<br><kbd>E</kbd> / clic impulsion arcade</div>
    </aside>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <footer class="bottom-bar">
      <div class="district-tag">● &nbsp; QUARTIER DU PORT · ZONE FICTIVE</div>
      <div class="version-tag">Prototype jouable · solo</div>
    </footer>
    <section class="modal" id="modal" aria-modal="true" role="dialog" aria-labelledby="modal-title">
      <div class="modal-card">
        <div class="modal-kicker" id="modal-kicker">Prototype solo · V0.1–V0.3</div>
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
    ui.modalKicker.textContent = "Prototype solo · V0.1–V0.3";
    ui.modalTitle.innerHTML = "MARSEILLE <span>BB</span>";
    ui.modalCopy.textContent = "Un petit quartier mediterraneen, une impulsion arcade et des accessoires qui repartent en confettis. Enchaine les combos, puis seme les voitures de patrouille-jouets.";
    ui.modalMeta.innerHTML = "<kbd>ZQSD</kbd>/<kbd>WASD</kbd> bouger · <kbd>Shift</kbd> sprinter · <kbd>Espace</kbd> sauter<br><kbd>E</kbd> ou clic gauche pres d'un accessoire pour le faire rebondir.";
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
  player.position.set(0, 0, 8);
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
  if (x < -48 + radius || x > 48 - radius || z < -23 + radius || z > 62 - radius) return true;
  return worldColliders.some((block) =>
    Math.abs(x - block.x) < block.width / 2 + radius && Math.abs(z - block.z) < block.depth / 2 + radius,
  );
}

function updatePlayer(delta: number): void {
  const forward = Number(keys.has("KeyW") || keys.has("KeyZ")) - Number(keys.has("KeyS"));
  const sideways = Number(keys.has("KeyD")) - Number(keys.has("KeyA") || keys.has("KeyQ"));
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
      player.position.set(0, 0, 8);
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

function drawMinimap(): void {
  const context = minimapContext!;
  const canvas = ui.minimap;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#287c91";
  context.fillRect(0, 0, canvas.width, canvas.height * 0.25);
  context.fillStyle = "#d1c1a0";
  context.fillRect(0, canvas.height * 0.25, canvas.width, canvas.height * 0.1);
  context.fillStyle = "#a99c83";
  context.fillRect(0, canvas.height * 0.35, canvas.width, canvas.height * 0.65);
  const mapPoint = (x: number, z: number) => ({
    x: ((x + 50) / 100) * canvas.width,
    y: ((z + 32) / 100) * canvas.height,
  });
  context.fillStyle = "rgba(90, 71, 58, .62)";
  for (const block of worldColliders) {
    const point = mapPoint(block.x, block.z);
    context.fillRect(point.x - block.width * 1.5, point.y - block.depth * 1.05, block.width * 3, block.depth * 2.1);
  }
  context.strokeStyle = "rgba(255,255,255,.4)";
  context.lineWidth = 2;
  context.beginPath();
  const roadY = mapPoint(0, 1.5).y;
  context.moveTo(0, roadY);
  context.lineTo(canvas.width, roadY);
  context.stroke();
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
}

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
  drawMinimap();
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
updateCamera(1);
updateHud();
animate();
