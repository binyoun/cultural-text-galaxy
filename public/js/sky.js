import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import {
  CHART,
  createSlotAllocator,
  behaviorFromId,
  behaviorPolar,
  toCartesian,
  buildChartLines,
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
scene.fog = new THREE.FogExp2(0x000003, 0.009);

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

// The chart itself: circles, 28 lodges and six arms.
const chart = buildChartLines();
const chartVertexCount = chart.positions.length / 3;
const chartColors = new Float32Array(chartVertexCount * 3);
const gold = new THREE.Color(GOLD);
chart.glow.forEach((g, i) => chartColors.set([gold.r * g, gold.g * g, gold.b * g], i * 3));
const chartGeometry = new THREE.BufferGeometry();
chartGeometry.setAttribute('position', new THREE.BufferAttribute(chart.positions, 3));
chartGeometry.setAttribute('color', new THREE.BufferAttribute(chartColors, 3));
const chartMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const chartLines = new THREE.LineSegments(chartGeometry, chartMaterial);
sky.add(chartLines);

const DUST_COUNT = 2600;
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(buildArmDust(DUST_COUNT), 3));
const dustMaterial = new THREE.PointsMaterial({
  map: dotTexture(),
  color: 0xbfc9ff,
  size: 0.13,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const dust = new THREE.Points(dustGeometry, dustMaterial);
sky.add(dust);

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
const treeMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.6,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
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

function scatterPolar(seed) {
  const s = seed * 97.13;
  return {
    r: CHART.R_OUTER * (0.75 + 0.55 * (Math.sin(s * 3.1) * 0.5 + 0.5)),
    theta: s * Math.PI * 2,
    y: 11 * Math.sin(s * 5.7),
  };
}

function rebuildTree() {
  treePairs = minimumSpanningTree(stars.map((s) => toCartesian(s.slot)));
  const positions = new Float32Array(treePairs.length * 6);
  const colors = new Float32Array(treePairs.length * 6);
  const DIM = 0.6;
  treePairs.forEach(([a, b], i) => {
    const ca = stars[a].tint;
    const cb = stars[b].tint;
    colors.set([ca.r * DIM, ca.g * DIM, ca.b * DIM, cb.r * DIM, cb.g * DIM, cb.b * DIM], i * 6);
  });
  treeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  treeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
  star.scatter = scatterPolar(star.seed);
  stars.push(star);
  rebuildTree();

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
//  46-60s  camera tilts into 3D and the behaviours switch on
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
    chart: ramp(t, 6, 20),
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

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;
  const state = revealState(now);

  placeCamera(state ? state.plan : 0);
  chartGeometry.setDrawRange(0, Math.floor(chartVertexCount * (state ? state.chart : 1)));
  dustMaterial.opacity = 0.5 * (state ? 0.35 + 0.65 * state.chart : 1);

  const behaviorAmount = state ? state.behavior : 1;
  const fit = sizeFit() * viewportBoost();
  const treePositions = treeGeometry.attributes.position;

  for (const star of stars) {
    const rest = behaviorPolar(star, now, behaviorAmount);
    const f = flightProgress(star, state, now);
    const polar = {
      r: THREE.MathUtils.lerp(star.scatter.r, rest.r, f),
      // The extra half turn makes stars sweep around the pole as they settle.
      theta: rest.theta + (1 - f) * (star.scatter.theta % (Math.PI * 2) - Math.PI),
      y: THREE.MathUtils.lerp(star.scatter.y, rest.y, f),
    };
    star.position = toCartesian(polar);

    if (star.sprite) {
      star.sprite.position.set(star.position.x, star.position.y, star.position.z);
      worldPosition.copy(star.sprite.position).applyMatrix4(sky.matrixWorld);
      const distance = camera.position.distanceTo(worldPosition);
      const depth = THREE.MathUtils.clamp(1.5 - distance / 58, 0.72, 1.4);
      const scale = 3.6 * star.magnitude * depth * fit;
      star.sprite.scale.set(scale * star.aspect, scale, 1);
      star.sprite.material.opacity = THREE.MathUtils.clamp(1.55 - distance / 52, 0.6, 1) * star.entry.transparency;
    }
  }

  if (treePositions && treePairs.length) {
    treePairs.forEach(([a, b], i) => {
      const pa = stars[a].position;
      const pb = stars[b].position;
      if (!pa || !pb) return;
      treePositions.array.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], i * 6);
    });
    treePositions.needsUpdate = true;
    treeGeometry.setDrawRange(0, Math.floor(treePairs.length * 2 * (state ? state.tree : 1)));
  }

  afterimagePass.uniforms.damp.value = state ? THREE.MathUtils.lerp(baseTrail, 0.82, state.streak) : baseTrail;
  sky.rotation.y += 0.012 * dt * rotationMultiplier;
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
