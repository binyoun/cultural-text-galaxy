import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { createOrbitState, stepVortex, regionToAngle, VORTEX_CONSTANTS } from './vortex.js';

const MAX_PARTICIPANTS_EXPECTED_DEFAULT = 20;

const canvas = document.getElementById('scene');
const hudCount = document.getElementById('participant-count');

// Operator tuning: mirrors what the TD side can already tune on its
// Particle COMP (rate, density, glow), but here it's a hidden show-runner
// control, never participant-facing. Values load from the URL so a
// configuration can be bookmarked, and adjust live via the ` panel.
function clampNum(value, min, max, fallback) {
  return Number.isNaN(value) ? fallback : Math.min(max, Math.max(min, value));
}

const urlParams = new URLSearchParams(window.location.search);
let operatorRotationMultiplier = clampNum(parseFloat(urlParams.get('rotation')), 0.2, 3, 1);
let operatorBloomOffset = clampNum(parseFloat(urlParams.get('bloom')), -0.5, 1.5, 0);
let operatorNebulaBaseline = clampNum(parseInt(urlParams.get('nebula'), 10), 0, 800, 250);
const operatorTrailDamp = clampNum(parseFloat(urlParams.get('trail')), 0, 0.97, 0.35);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02010a, 0.028);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 4, 22);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x02010a, 1);

// Render & Bloom TOP equivalent: layer-blend + dual-blur glow pass.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Trailing afterimage: blends each frame with the last so moving stars and
// dust leave a soft fading streak instead of a flat, instant redraw. This is
// the main fix for the scene reading as flat, motion is what gives it depth.
const afterimagePass = new AfterimagePass(operatorTrailDamp);
composer.addPass(afterimagePass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.0, // strength, lower base so body text isn't washed out at rest
  0.9, // radius
  0.35 // threshold, raised so only genuinely bright spots (the flare) bloom hard
);
composer.addPass(bloomPass);

// Background nebula: diffuse typographic haze that thickens with participation.
const nebulaGeometry = new THREE.BufferGeometry();
const NEBULA_MAX = 1200;
const nebulaPositions = new Float32Array(NEBULA_MAX * 3);
for (let i = 0; i < NEBULA_MAX; i++) {
  const radius = VORTEX_CONSTANTS.SPAWN_RADIUS * (0.6 + Math.random() * 1.8);
  const angle = Math.random() * Math.PI * 2;
  nebulaPositions[i * 3] = Math.cos(angle) * radius;
  nebulaPositions[i * 3 + 1] = (Math.random() - 0.5) * 14;
  nebulaPositions[i * 3 + 2] = Math.sin(angle) * radius;
}
nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(nebulaPositions, 3));
const nebulaMaterial = new THREE.PointsMaterial({
  color: 0x6677ff,
  size: 0.06,
  transparent: true,
  opacity: 0.15,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
// idle ambient count (operatorNebulaBaseline), so the screen isn't dead at 0 participants
const nebula = new THREE.Points(nebulaGeometry, nebulaMaterial);
nebula.geometry.setDrawRange(0, operatorNebulaBaseline);
scene.add(nebula);

// Central flare: a bright core at the pole every orbit converges toward
// but never reaches, the fixed point the Three Enclosures research figure
// describes, made visible instead of left as an empty "keep clear" gap.
function createFlareTexture() {
  const size = 256;
  const cx = size / 2;
  const cy = size / 2;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.12, 'rgba(220,230,255,0.7)');
  glow.addColorStop(0.35, 'rgba(150,180,255,0.2)');
  glow.addColorStop(0.7, 'rgba(120,150,255,0.05)');
  glow.addColorStop(1, 'rgba(120,150,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvasEl);
}

const flareMaterial = new THREE.SpriteMaterial({
  map: createFlareTexture(),
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const flareSprite = new THREE.Sprite(flareMaterial);
scene.add(flareSprite);

const textureLoader = new THREE.TextureLoader();
const particles = []; // { sprite, orbit, baseScale, intensity }

let maxParticipantsExpected = MAX_PARTICIPANTS_EXPECTED_DEFAULT;

function densityFactor() {
  return Math.min(1.5, particles.length / maxParticipantsExpected);
}

function spawnParticle(entry) {
  textureLoader.load(entry.url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: entry.transparency,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    // Intensity now mostly speaks through size (magnitudeScale below), matching
    // the chart's own convention. Keep a mild color boost so bloom still reads
    // brighter entries as brighter, but additive blending plus a boost near
    // 5x was blowing every glyph out to a flat white blob, unreadable. Normal
    // blending above keeps letterforms crisp; this stays a gentle nudge.
    const boost = 1 + (entry.intensity - 1) * 0.25; // 1.0 (standard) .. 2.0 (glowing)
    material.color.setScalar(boost);

    const sprite = new THREE.Sprite(material);
    const aspect = texture.image.width / texture.image.height;
    const baseScale = 1.6;
    // Magnitude has a size, not just a glow: Cheonsang Yeolcha Bunyajido draws
    // brighter stars larger on the page, not just brighter. intensity 1..5 maps
    // to a 0.7x..1.6x size range so a dim entry reads as genuinely smaller.
    const magnitudeScale = 0.7 + ((entry.intensity - 1) / 4) * 0.9;
    sprite.scale.set(baseScale * aspect * magnitudeScale, baseScale * magnitudeScale, 1);
    sprite.userData.baseOpacity = entry.transparency;

    scene.add(sprite);

    // Field allocation: an entry with a region picked lands in that
    // region's sky sector instead of a purely random angle.
    const angleOverride = entry.region ? regionToAngle(entry.region) : null;

    particles.push({
      sprite,
      orbit: createOrbitState(Math.random(), angleOverride),
      baseScale,
      aspect,
      magnitudeScale,
    });

    updateNebulaDrawRange();
  });
}

function updateNebulaDrawRange() {
  const ratio = Math.min(1, particles.length / maxParticipantsExpected);
  const count = operatorNebulaBaseline + Math.floor((NEBULA_MAX - operatorNebulaBaseline) * ratio);
  nebula.geometry.setDrawRange(0, count);
}

function setCount(count, maxExpected) {
  if (maxExpected) maxParticipantsExpected = maxExpected;
  hudCount.textContent = count;
}

// hydrate existing entries on load/reconnect, then stream new ones live
fetch('/api/entries')
  .then((r) => r.json())
  .then((data) => {
    maxParticipantsExpected = data.maxParticipantsExpected || MAX_PARTICIPANTS_EXPECTED_DEFAULT;
    setCount(data.count, maxParticipantsExpected);
    data.entries.forEach(spawnParticle);
  });

// Surfaces the optional "place" text somewhere, otherwise a participant who
// types one has no way to know it went anywhere. Only for live arrivals,
// not the entries hydrated on load, which would fire a burst all at once.
const newEntryToast = document.getElementById('newEntryToast');
let toastTimer = null;

function showNewEntryToast(entry) {
  if (!entry.place) return;
  clearTimeout(toastTimer);
  newEntryToast.textContent = `New star from ${entry.place}`;
  newEntryToast.hidden = false;
  requestAnimationFrame(() => newEntryToast.classList.add('visible'));
  toastTimer = setTimeout(() => newEntryToast.classList.remove('visible'), 4000);
}

const socket = io();
socket.on('newEntry', spawnParticle);
socket.on('newEntry', showNewEntryToast);
socket.on('count', ({ count, maxParticipantsExpected: max }) => setCount(count, max));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Local gravity well: the cursor perturbs nearby stars without touching
// their underlying orbit state, so releasing it lets them fall right back
// onto their normal path instead of drifting off permanently.
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const interactionPlane = new THREE.Plane();
const camForward = new THREE.Vector3();
const attractorWorld = new THREE.Vector3();
const attractorLocal = new THREE.Vector3();
const toAttractor = new THREE.Vector3();
let pointerActive = false;

const PULL_RADIUS = 6;
const PULL_STRENGTH = 8;

function setPointerFromEvent(event) {
  pointerNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
  pointerActive = true;
}

window.addEventListener('pointermove', setPointerFromEvent);
window.addEventListener('pointerdown', setPointerFromEvent);
window.addEventListener('pointerup', () => { pointerActive = false; });
window.addEventListener('pointercancel', () => { pointerActive = false; });
window.addEventListener('pointerleave', () => { pointerActive = false; });

function updateAttractor() {
  if (!pointerActive) return;

  camera.getWorldDirection(camForward);
  interactionPlane.setFromNormalAndCoplanarPoint(camForward, scene.position);

  raycaster.setFromCamera(pointerNDC, camera);
  const hit = raycaster.ray.intersectPlane(interactionPlane, attractorWorld);
  if (!hit) return;

  // particles live in the scene's local space, which spins over time,
  // so bring the world-space hit point into that same rotating frame
  const theta = scene.rotation.y;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  attractorLocal.set(
    attractorWorld.x * cosT - attractorWorld.z * sinT,
    attractorWorld.y,
    attractorWorld.x * sinT + attractorWorld.z * cosT
  );
}

function applyGravityWell(sprite, dt) {
  if (!pointerActive) return;

  toAttractor.copy(attractorLocal).sub(sprite.position);
  const dist = toAttractor.length();
  if (dist <= 0.0001 || dist >= PULL_RADIUS) return;

  const falloff = 1 - dist / PULL_RADIUS;
  toAttractor.normalize().multiplyScalar(falloff * falloff * PULL_STRENGTH * dt);
  sprite.position.add(toAttractor);
  sprite.material.opacity = Math.min(1, sprite.material.opacity + falloff * 0.25);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const density = densityFactor();

  updateAttractor();

  for (const p of particles) {
    const pos = stepVortex(p.orbit, dt, density);
    p.sprite.position.set(pos.x, pos.y, pos.z);

    // Volumetric Depth Engine: distance-driven scale + fade so near text
    // dominates and far text dissolves into the nebula haze.
    const distToCamera = camera.position.distanceTo(p.sprite.position);
    const depthScale = THREE.MathUtils.clamp(1.6 - distToCamera / 40, 0.35, 1.6) * p.magnitudeScale;
    p.sprite.scale.set(p.baseScale * p.aspect * depthScale, p.baseScale * depthScale, 1);

    const farFade = THREE.MathUtils.clamp(1.4 - distToCamera / 30, 0.2, 1);
    p.sprite.material.opacity = farFade * p.sprite.userData.baseOpacity;

    applyGravityWell(p.sprite, dt);
  }

  flareSprite.scale.setScalar(3.5 + density * 2.5);
  flareMaterial.opacity = 0.6 + density * 0.4;

  scene.rotation.y += 0.02 * dt * (0.5 + density * 0.5) * operatorRotationMultiplier;
  bloomPass.strength = Math.max(0, 0.7 + density * 0.5 + operatorBloomOffset);

  composer.render();
}

animate();

// Operator panel: hidden show-runner controls, toggled with the ` key.
const operatorPanel = document.getElementById('operatorPanel');
const opRotation = document.getElementById('opRotation');
const opBloom = document.getElementById('opBloom');
const opNebula = document.getElementById('opNebula');
const opTrail = document.getElementById('opTrail');
const opCopyLink = document.getElementById('opCopyLink');
const opCopyStatus = document.getElementById('opCopyStatus');

opRotation.value = operatorRotationMultiplier;
opBloom.value = operatorBloomOffset;
opNebula.value = operatorNebulaBaseline;
opTrail.value = operatorTrailDamp;

window.addEventListener('keydown', (e) => {
  if (e.key === '`') {
    operatorPanel.hidden = !operatorPanel.hidden;
  }
});

opRotation.addEventListener('input', () => {
  operatorRotationMultiplier = parseFloat(opRotation.value);
});

opBloom.addEventListener('input', () => {
  operatorBloomOffset = parseFloat(opBloom.value);
});

opNebula.addEventListener('input', () => {
  operatorNebulaBaseline = parseInt(opNebula.value, 10);
  updateNebulaDrawRange();
});

opTrail.addEventListener('input', () => {
  afterimagePass.uniforms['damp'].value = parseFloat(opTrail.value);
});

opCopyLink.addEventListener('click', async () => {
  const url = new URL(window.location.href);
  url.searchParams.set('rotation', operatorRotationMultiplier);
  url.searchParams.set('bloom', operatorBloomOffset);
  url.searchParams.set('nebula', operatorNebulaBaseline);
  url.searchParams.set('trail', afterimagePass.uniforms['damp'].value);
  try {
    await navigator.clipboard.writeText(url.toString());
    opCopyStatus.textContent = 'Copied.';
  } catch (err) {
    opCopyStatus.textContent = url.toString();
  }
});
