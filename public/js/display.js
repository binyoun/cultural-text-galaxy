import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createOrbitState, stepVortex, VORTEX_CONSTANTS } from './vortex.js';

const MAX_PARTICIPANTS_EXPECTED_DEFAULT = 20;

const canvas = document.getElementById('scene');
const hudCount = document.getElementById('participant-count');

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
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.4, // strength
  0.9, // radius
  0.15 // threshold
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
const nebula = new THREE.Points(nebulaGeometry, nebulaMaterial);
nebula.geometry.setDrawRange(0, 0); // grows as participants join
scene.add(nebula);

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
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Over-exposure: push color channels above 1.0 via tone-mapped intensity,
    // bloom pass then reads the brightness and blooms it out.
    const boost = entry.intensity; // 1.0 (standard) .. 5.0 (over-exposed)
    material.color.setScalar(boost);

    const sprite = new THREE.Sprite(material);
    const aspect = texture.image.width / texture.image.height;
    const baseScale = 1.6;
    sprite.scale.set(baseScale * aspect, baseScale, 1);
    sprite.userData.baseOpacity = entry.transparency;

    scene.add(sprite);

    particles.push({
      sprite,
      orbit: createOrbitState(Math.random()),
      baseScale,
      aspect,
    });

    updateNebulaDrawRange();
  });
}

function updateNebulaDrawRange() {
  const ratio = Math.min(1, particles.length / maxParticipantsExpected);
  nebula.geometry.setDrawRange(0, Math.floor(NEBULA_MAX * ratio));
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

const socket = io();
socket.on('newEntry', spawnParticle);
socket.on('count', ({ count, maxParticipantsExpected: max }) => setCount(count, max));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const density = densityFactor();

  for (const p of particles) {
    const pos = stepVortex(p.orbit, dt, density);
    p.sprite.position.set(pos.x, pos.y, pos.z);

    // Volumetric Depth Engine: distance-driven scale + fade so near text
    // dominates and far text dissolves into the nebula haze.
    const distToCamera = camera.position.distanceTo(p.sprite.position);
    const depthScale = THREE.MathUtils.clamp(1.6 - distToCamera / 40, 0.35, 1.6);
    p.sprite.scale.set(p.baseScale * p.aspect * depthScale, p.baseScale * depthScale, 1);

    const farFade = THREE.MathUtils.clamp(1.4 - distToCamera / 30, 0.2, 1);
    p.sprite.material.opacity = farFade * p.sprite.userData.baseOpacity;
  }

  scene.rotation.y += 0.02 * dt * (0.5 + density * 0.5);
  bloomPass.strength = 1.1 + density * 0.9;

  composer.render();
}

animate();
