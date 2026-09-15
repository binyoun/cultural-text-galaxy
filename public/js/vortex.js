// Dynamic Vector Field: replaces the TouchDesigner Metaball / Force / Noise SOP
// matrix. Each particle carries its own orbital state; this module advances
// that state one frame at a time inside the caller's requestAnimationFrame loop.

const MIN_ORBIT_RADIUS = 1.4;
const SPAWN_RADIUS = 14;
const INWARD_RATE = 0.18; // how fast a particle drifts toward the core per second
const BASE_ANGULAR_VELOCITY = 0.35; // radians/sec at spawn radius
const HEIGHT_DRIFT_SPEED = 0.4;
const SECTOR_COUNT = 12; // matches the twelve Yeolcha field-allocation sectors

/**
 * Creates the initial orbital state for a newly spawned particle,
 * placed at the peripheral boundary of the vector field.
 *
 * @param {number} seed random value, also drives height/noise variety
 * @param {number|null} angleOverride if given, used instead of a random angle
 */
export function createOrbitState(seed = Math.random(), angleOverride = null) {
  const angle = angleOverride !== null ? angleOverride : seed * Math.PI * 2;
  const height = (seed - 0.5) * 6;
  return {
    radius: SPAWN_RADIUS,
    spawnRadius: SPAWN_RADIUS,
    angle,
    height,
    noiseSeed: seed * 1000,
    age: 0,
  };
}

/**
 * Field allocation (bunya): hashes a place name into one of twelve sky
 * sectors, matching the chart's historical Yeolcha divisions, then picks a
 * random angle within that sector. Entries from the same place cluster in
 * the same region of sky instead of landing on the exact same point or
 * scattering uniformly at random.
 */
export function originToSectorAngle(origin) {
  let hash = 0;
  for (let i = 0; i < origin.length; i++) {
    hash = (hash * 31 + origin.charCodeAt(i)) >>> 0;
  }
  const sector = hash % SECTOR_COUNT;
  const sectorWidth = (Math.PI * 2) / SECTOR_COUNT;
  return sector * sectorWidth + Math.random() * sectorWidth;
}

/**
 * Advances one particle's orbital state by dt seconds.
 *
 * Physics model:
 *  - centripetal attraction pulls radius asymptotically toward a minimum
 *    orbit radius near the central gravity node (never collapsing to zero,
 *    so text stays legible instead of vanishing into a point).
 *  - tangential velocity increases as radius shrinks (angular-momentum-like
 *    conservation), producing the curved spiral sweep instead of a straight
 *    inward fall.
 *  - height drifts on a slow layered-sine field (a cheap stand-in for the
 *    Noise SOP) so the galaxy breathes instead of sitting on a flat plane.
 *
 * @param {object} state orbit state from createOrbitState (mutated in place)
 * @param {number} dt seconds since last frame
 * @param {number} densityFactor 0..1+ scales overall energy with participation
 * @returns {{x:number,y:number,z:number, radius:number}}
 */
export function stepVortex(state, dt, densityFactor = 0.5) {
  state.age += dt;

  const energy = 0.6 + densityFactor * 0.8; // more participants = livelier field

  state.radius += (MIN_ORBIT_RADIUS - state.radius) * INWARD_RATE * energy * dt;
  state.radius = Math.max(state.radius, MIN_ORBIT_RADIUS);

  const angularVelocity = BASE_ANGULAR_VELOCITY * (state.spawnRadius / state.radius) * energy;
  state.angle += angularVelocity * dt;

  const noiseT = state.age * HEIGHT_DRIFT_SPEED + state.noiseSeed;
  const heightNoise =
    Math.sin(noiseT) * 0.6 +
    Math.sin(noiseT * 2.13 + 1.7) * 0.3 +
    Math.sin(noiseT * 0.47 + 4.1) * 0.9;
  state.height += heightNoise * 0.15 * dt;
  state.height = Math.max(-5, Math.min(5, state.height));

  const x = Math.cos(state.angle) * state.radius;
  const z = Math.sin(state.angle) * state.radius;
  const y = state.height;

  return { x, y, z, radius: state.radius };
}

export const VORTEX_CONSTANTS = {
  MIN_ORBIT_RADIUS,
  SPAWN_RADIUS,
};
