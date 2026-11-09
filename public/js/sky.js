import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import {
  CHART,
  createSlotAllocator,
  behaviorFromId,
  behaviorPoint,
  project,
  toSphere,
  buildFrameLines,
  buildBraids,
  buildArmDust,
  minimumSpanningTree,
} from './chartGeometry.js';

const canvas = document.getElementById('scene');
const hudCount = document.getElementById('participant-count');
const newEntryToast = document.getElementById('newEntryToast');

const urlParams = new URLSearchParams(window.location.search);

function clampNum(value, min, max, fallback) {
  return Number.isNaN(value) ? fallback : Math.min(max, Math.max(min, value));
}

let rotationMultiplier = clampNum(parseFloat(urlParams.get('rotation')), 0, 3, 1);
let bloomOffset = clampNum(parseFloat(urlParams.get('bloom')), -0.5, 1.5, 0);
const baseTrail = clampNum(parseFloat(urlParams.get('trail')), 0, 0.97, 0.2);

const GOLD = 0xe8c99d;

const scene = new THREE.Scene();
const FOG_SPHERE = 0.021; // the far side of the sphere falls away into the dark
const FOG_CHART = 0.008;
scene.fog = new THREE.FogExp2(0x000003, FOG_SPHERE);

const sky = new THREE.Group(); // everything that turns with the chart
scene.add(sky);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000003, 1);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const afterimagePass = new AfterimagePass(baseTrail);
composer.addPass(afterimagePass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.8, 0.4);
composer.addPass(bloomPass);

function dotTexture() {
  const size = 32;
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(el);
}

function flareTexture() {
  const size = 256;
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.12, 'rgba(255,236,205,0.7)');
  glow.addColorStop(0.35, 'rgba(232,201,157,0.18)');
  glow.addColorStop(1, 'rgba(232,201,157,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(el);
}

const gold = new THREE.Color(GOLD);

function lineMaterial() {
  return new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// The fixed frame: circles, 28 lodges, inner rings and the polar axis.
const frame = buildFrameLines();
const frameVertexCount = frame.sphere.length / 3;
const frameColors = new Float32Array(frameVertexCount * 3);
frame.glow.forEach((g, i) => frameColors.set([gold.r * g, gold.g * g, gold.b * g], i * 3));
const frameGeometry = new THREE.BufferGeometry();
frameGeometry.setAttribute('position', new THREE.BufferAttribute(frame.sphere.slice(), 3));
frameGeometry.setAttribute('color', new THREE.BufferAttribute(frameColors, 3));
const frameLines = new THREE.LineSegments(frameGeometry, lineMaterial());
frameLines.frustumCulled = false;
sky.add(frameLines);

// The arms and their strands, regenerated from the stars.
let braid = null;
let braidsStale = true;
const braidGeometry = new THREE.BufferGeometry();
const braidLines = new THREE.LineSegments(braidGeometry, lineMaterial());
braidLines.frustumCulled = false;
sky.add(braidLines);

const DUST_COUNT = 2600;
const DUST_OPACITY = 0.9;
const dustPoints = buildArmDust(DUST_COUNT);
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPoints.sphere.slice(), 3));
const dustMaterial = new THREE.PointsMaterial({
  map: dotTexture(),
  color: 0xdfe5ff,
  size: 0.2,
  transparent: true,
  opacity: DUST_OPACITY,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const dust = new THREE.Points(dustGeometry, dustMaterial);
dust.frustumCulled = false;
sky.add(dust);

function lerpInto(target, flat, sphere, inflate) {
  for (let i = 0; i < target.length; i++) target[i] = flat[i] + (sphere[i] - flat[i]) * inflate;
}

const flareMaterial = new THREE.SpriteMaterial({
  map: flareTexture(),
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const flare = new THREE.Sprite(flareMaterial);
flare.scale.setScalar(2.6);
sky.add(flare);

// Constellation lines: one stable tree, recomputed only when a star arrives.
const treeGeometry = new THREE.BufferGeometry();
const treeMaterial = lineMaterial();
treeMaterial.opacity = 0.7;
const treeLines = new THREE.LineSegments(treeGeometry, treeMaterial);
treeLines.frustumCulled = false;
sky.add(treeLines);
let treePairs = [];

const textureLoader = new THREE.TextureLoader();
const allocator = createSlotAllocator();
const stars = [];

function goldenSeed(index) {
  const g = (Math.sqrt(5) - 1) / 2;
  const v = (index + 1) * g;
  return v - Math.floor(v);
}

function scatterPoint(seed) {
  const s = seed * 97.13;
  const r = CHART.R_FLAT * (0.75 + 0.55 * (Math.sin(s * 3.1) * 0.5 + 0.5));
  const angle = s * Math.PI * 2;
  return { x: Math.cos(angle) * r, y: 11 * Math.sin(s * 5.7), z: Math.sin(angle) * r, angle };
}

// Each link is a curve that bows inward through the volume of the sphere.
const TREE_SEGMENTS = 14;

function rebuildTree() {
  treePairs = minimumSpanningTree(stars.map((s) => toSphere(s.slot)));
  const vertices = treePairs.length * TREE_SEGMENTS * 2;
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const DIM = 0.7;
  const c = new THREE.Color();
  treePairs.forEach(([a, b], i) => {
    for (let k = 0; k < TREE_SEGMENTS; k++) {
      [k, k + 1].forEach((m, e) => {
        c.copy(stars[a].tint).lerp(stars[b].tint, m / TREE_SEGMENTS).multiplyScalar(DIM);
        colors.set([c.r, c.g, c.b], (i * TREE_SEGMENTS * 2 + k * 2 + e) * 3);
      });
    }
  });
  treeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  treeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function rebuildBraids() {
  braid = buildBraids(stars.map((s) => ({ arm: s.slot.arm, t: s.slot.t, index: s.index })));
  const colors = new Float32Array(braid.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < braid.count; i++) {
    const owner = braid.starIndex[i];
    // Strands take on the colour of the star they are passing through.
    c.copy(gold);
    if (owner >= 0) c.lerp(stars[owner].tint, Math.min(1, braid.weight[i] * 1.2));
    c.multiplyScalar(braid.glow[i]);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  braidGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(braid.count * 3), 3));
  braidGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  braidsStale = false;
}

function sizeFit() {
  return THREE.MathUtils.clamp(Math.sqrt(24 / Math.max(stars.length, 1)), 0.62, 1);
}

function viewportBoost() {
  return THREE.MathUtils.clamp(1920 / window.innerWidth, 1, 1.5);
}

const clock = new THREE.Clock();

// Slots are claimed before the image loads, so a slow download can't change
// the order and every viewer gets the same layout.
function addStar(entry, live) {
  const slot = allocator.place(entry.region);
  const index = stars.length;
  const star = {
    entry,
    slot,
    seed: goldenSeed(index),
    behavior: BEHAVIORS_ALLOWED.has(entry.behavior) ? entry.behavior : behaviorFromId(entry.id),
    tint: new THREE.Color(entry.color || '#ffffff'),
    sprite: null,
    aspect: 1,
    magnitude: 0.7 + ((entry.intensity - 1) / 4) * 0.9,
    arriveAt: live ? clock.elapsedTime : -100,
    index,
  };
  star.scatter = scatterPoint(star.seed);
  star.offset = { x: 0, y: 0, z: 0 };
  stars.push(star);
  rebuildTree();
  braidsStale = true;

  textureLoader.load(entry.url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: entry.transparency,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    material.color.setScalar(1 + (entry.intensity - 1) * 0.25);
    star.aspect = texture.image.width / texture.image.height;
    star.sprite = new THREE.Sprite(material);
    sky.add(star.sprite);
  });
}

const BEHAVIORS_ALLOWED = new Set(['turbulence', 'attraction', 'clustering']);

function setCount(count) {
  hudCount.textContent = count;
}

fetch('/api/entries')
  .then((r) => r.json())
  .then((data) => {
    setCount(data.count);
    data.entries.forEach((entry) => addStar(entry, false));
    if (urlParams.get('reveal') === 'auto') setTimeout(startReveal, 2500);
  });

let toastTimer = null;
function showToast(entry) {
  if (!entry.place) return;
  clearTimeout(toastTimer);
  newEntryToast.textContent = `New star from ${entry.place}`;
  newEntryToast.hidden = false;
  requestAnimationFrame(() => newEntryToast.classList.add('visible'));
  toastTimer = setTimeout(() => newEntryToast.classList.remove('visible'), 4000);
}

const socket = io();
socket.on('newEntry', (entry) => addStar(entry, true));
socket.on('newEntry', showToast);
socket.on('count', ({ count }) => setCount(count));
socket.on('reset', () => window.location.reload());
socket.on('removeEntry', () => window.location.reload());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// The reveal, about a minute long:
//   0-8s   camera rises to look straight down, like the printed chart
//   6-20s  the chart draws itself, stars still scattered
//  20-40s  stars sweep along the arms to their slots
//  38-46s  the constellation lines connect
//  46-60s  the flat chart rises into a sphere and the behaviours switch on
const REVEAL_LENGTH = 60;
let revealStart = null;

function startReveal() {
  revealStart = clock.elapsedTime;
}

function ramp(t, from, to) {
  const x = THREE.MathUtils.clamp((t - from) / (to - from), 0, 1);
  return x * x * (3 - 2 * x);
}

const VIEW_OBLIQUE = { elevation: 0.62, distance: 37 };
const VIEW_PLAN = { elevation: 1.56, distance: 37 };

function placeCamera(planAmount) {
  const elevation = THREE.MathUtils.lerp(VIEW_OBLIQUE.elevation, VIEW_PLAN.elevation, planAmount);
  const distance = THREE.MathUtils.lerp(VIEW_OBLIQUE.distance, VIEW_PLAN.distance, planAmount);
  camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
  camera.lookAt(0, 0, 0);
}

// ?revealAt=30 holds the reveal at that second, for checking a single moment.
const heldMoment = parseFloat(urlParams.get('revealAt'));

function revealState(now) {
  if (Number.isNaN(heldMoment) && revealStart === null) return null;
  const t = Number.isNaN(heldMoment) ? now - revealStart : heldMoment;
  if (t >= REVEAL_LENGTH) {
    revealStart = null;
    return null;
  }
  return {
    t,
    plan: ramp(t, 0, 8) * (1 - ramp(t, 46, 58)),
    chart: ramp(t, 6, 16),
    arms: ramp(t, 12, 26),
    inflate: ramp(t, 46, 58),
    tree: ramp(t, 38, 46),
    behavior: ramp(t, 48, 60),
    streak: ramp(t, 19, 22) * (1 - ramp(t, 38, 42)),
  };
}

function flightProgress(star, state, now) {
  if (state) {
    const stagger = (star.index / Math.max(stars.length - 1, 1)) * 11;
    return ramp(state.t, 20 + stagger, 29 + stagger);
  }
  return ramp(now - star.arriveAt, 0, 5);
}

const worldPosition = new THREE.Vector3();
let lastInflate = 1;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;
  const state = revealState(now);

  if (braidsStale) rebuildBraids();

  const inflate = state ? state.inflate : 1;
  placeCamera(state ? state.plan : 0);
  scene.fog.density = THREE.MathUtils.lerp(FOG_CHART, FOG_SPHERE, inflate);
  sky.rotation.z = 0.3 * inflate;

  if (inflate !== lastInflate) {
    lerpInto(frameGeometry.attributes.position.array, frame.flat, frame.sphere, inflate);
    frameGeometry.attributes.position.needsUpdate = true;
    lerpInto(dustGeometry.attributes.position.array, dustPoints.flat, dustPoints.sphere, inflate);
    dustGeometry.attributes.position.needsUpdate = true;
    lastInflate = inflate;
  }
  frameGeometry.setDrawRange(0, Math.floor(frameVertexCount * (state ? state.chart : 1)));
  dustMaterial.opacity = DUST_OPACITY * (state ? 0.35 + 0.65 * state.chart : 1);
  flare.position.y = CHART.R * Math.cos(CHART.PHI_MIN) * inflate;
  flare.scale.setScalar(THREE.MathUtils.lerp(2.6, 1.3, inflate));

  const behaviorAmount = state ? state.behavior : 1;
  const fit = sizeFit() * viewportBoost();

  for (const star of stars) {
    const rest = project(behaviorPoint(star, now, behaviorAmount), inflate);
    const still = project(star.slot, inflate);
    // Attraction and clustering travel along the arm, so the arm itself stays put.
    const bends = star.behavior === 'turbulence';
    star.offset.x = bends ? rest.x - still.x : 0;
    star.offset.y = bends ? rest.y - still.y : 0;
    star.offset.z = bends ? rest.z - still.z : 0;

    // On arrival a star sweeps around the pole as it settles onto its arm.
    const f = flightProgress(star, state, now);
    const turn = (1 - f) * star.scatter.angle;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const x = rest.x * cos - rest.z * sin;
    const z = rest.x * sin + rest.z * cos;
    star.position = {
      x: THREE.MathUtils.lerp(star.scatter.x, x, f),
      y: THREE.MathUtils.lerp(star.scatter.y, rest.y, f),
      z: THREE.MathUtils.lerp(star.scatter.z, z, f),
    };

    if (star.sprite) {
      star.sprite.position.set(star.position.x, star.position.y, star.position.z);
      worldPosition.copy(star.sprite.position).applyMatrix4(sky.matrixWorld);
      const distance = camera.position.distanceTo(worldPosition);
      const depth = THREE.MathUtils.clamp(1.5 - distance / 58, 0.72, 1.4);
      const scale = 5 * star.magnitude * depth * fit;
      star.sprite.scale.set(scale * star.aspect, scale, 1);
      star.sprite.material.opacity = THREE.MathUtils.clamp(1.55 - distance / 52, 0.6, 1) * star.entry.transparency;
    }
  }

  // The arm lines follow their stars, so a moving word bends what runs through it.
  if (braid) {
    const array = braidGeometry.attributes.position.array;
    for (let i = 0; i < braid.count; i++) {
      const j = i * 3;
      const owner = braid.starIndex[i];
      const w = owner >= 0 ? braid.weight[i] : 0;
      const off = owner >= 0 ? stars[owner].offset : null;
      for (let k = 0; k < 3; k++) {
        array[j + k] = braid.flat[j + k] + (braid.sphere[j + k] - braid.flat[j + k]) * inflate;
      }
      if (off) {
        array[j] += off.x * w;
        array[j + 1] += off.y * w;
        array[j + 2] += off.z * w;
      }
    }
    braidGeometry.attributes.position.needsUpdate = true;
    braidGeometry.setDrawRange(0, Math.floor(braid.count * (state ? state.arms : 1)));
  }

  const treePositions = treeGeometry.attributes.position;
  if (treePositions && treePairs.length) {
    const bow = THREE.MathUtils.lerp(0.14, 0.42, inflate);
    treePairs.forEach(([a, b], i) => {
      const pa = stars[a].position;
      const pb = stars[b].position;
      if (!pa || !pb) return;
      const cx = ((pa.x + pb.x) / 2) * (1 - bow);
      const cy = ((pa.y + pb.y) / 2) * (1 - bow);
      const cz = ((pa.z + pb.z) / 2) * (1 - bow);
      const curve = (u) => [
        (1 - u) * (1 - u) * pa.x + 2 * (1 - u) * u * cx + u * u * pb.x,
        (1 - u) * (1 - u) * pa.y + 2 * (1 - u) * u * cy + u * u * pb.y,
        (1 - u) * (1 - u) * pa.z + 2 * (1 - u) * u * cz + u * u * pb.z,
      ];
      for (let k = 0; k < TREE_SEGMENTS; k++) {
        const at = (i * TREE_SEGMENTS * 2 + k * 2) * 3;
        treePositions.array.set(curve(k / TREE_SEGMENTS), at);
        treePositions.array.set(curve((k + 1) / TREE_SEGMENTS), at + 3);
      }
    });
    treePositions.needsUpdate = true;
    treeGeometry.setDrawRange(0, Math.floor(treePairs.length * TREE_SEGMENTS * 2 * (state ? state.tree : 1)));
  }

  afterimagePass.uniforms.damp.value = state ? THREE.MathUtils.lerp(baseTrail, 0.82, state.streak) : baseTrail;
  sky.rotation.y += 0.03 * dt * rotationMultiplier;
  bloomPass.strength = Math.max(0, 0.75 + bloomOffset);

  composer.render();
}

animate();

// Operator panel, toggled with the ` key. R runs the reveal.
const operatorPanel = document.getElementById('operatorPanel');
const opRotation = document.getElementById('opRotation');
const opBloom = document.getElementById('opBloom');
const opReveal = document.getElementById('opReveal');

opRotation.value = rotationMultiplier;
opBloom.value = bloomOffset;

window.addEventListener('keydown', (e) => {
  if (e.key === '`') operatorPanel.hidden = !operatorPanel.hidden;
  if (e.key === 'r' || e.key === 'R') startReveal();
});
opRotation.addEventListener('input', () => {
  rotationMultiplier = parseFloat(opRotation.value);
});
opBloom.addEventListener('input', () => {
  bloomOffset = parseFloat(opBloom.value);
});
opReveal.addEventListener('click', startReveal);
