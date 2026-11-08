// Geometry of the shared sky, drawn from Cheonsang Yeolcha Bunyajido (1395):
// a pole, concentric circles and 28 divisions, with six spiral arms for the
// six regions (and the six rays of the writing template). Every star gets a
// fixed slot from its place in the upload order, so all viewers see one sky.

const TAU = Math.PI * 2;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
const SILVER = Math.SQRT2 - 1;

export const CHART = {
  R_POLE: 3.2,
  R_OUTER: 18.5,
  ARMS: 6,
  LODGES: 28,
  WINDING: Math.PI * 1.15, // how far each arm turns from pole to rim
  LIFT: 1.8, // height of the helical lift, in world units
  OBLIQUITY: (23.5 * Math.PI) / 180,
};

const REGION_ARM = {
  asia: 0,
  'middle-east': 1,
  africa: 2,
  europe: 3,
  americas: 4,
  oceania: 5,
};

export const BEHAVIORS = ['turbulence', 'attraction', 'clustering'];

function frac(x) {
  return x - Math.floor(x);
}

function radiusAt(t) {
  const inner = CHART.R_POLE * 1.35;
  return inner * Math.pow(CHART.R_OUTER / inner, t);
}

function armBaseAngle(arm) {
  return (arm / CHART.ARMS) * TAU;
}

function polarOnArm(arm, t) {
  const r = radiusAt(t);
  const theta = armBaseAngle(arm) + CHART.WINDING * t;
  const y = CHART.LIFT * Math.sin(2 * theta + arm) * Math.pow(t, 0.7);
  return { r, theta, y };
}

export function toCartesian({ r, theta, y }) {
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

// Hands out slots in upload order. A star with a region joins that region's
// arm; a star without one joins the emptiest arm. The golden-ratio sequence
// spreads each arm's stars evenly at any count, so they never pile up.
export function createSlotAllocator() {
  const counts = new Array(CHART.ARMS).fill(0);
  return {
    place(region) {
      let arm = REGION_ARM[region];
      if (arm === undefined) {
        arm = counts.indexOf(Math.min(...counts));
      }
      const n = counts[arm]++;
      // The power spreads stars outward, where the arms have more room.
      const t = Math.pow(frac((n + 1) * GOLDEN + arm * SILVER), 0.62);
      const polar = polarOnArm(arm, t);
      const sideways = 1 + 0.07 * (frac((n + 1) * SILVER) - 0.5);
      return { arm, n, t, r: polar.r * sideways, theta: polar.theta, y: polar.y };
    },
  };
}

// The point on an arm where its clustering stars gather.
export function armAnchor(arm) {
  return polarOnArm(arm, 0.5);
}

// A stable pick from the id, for stars that have no chosen behaviour.
export function behaviorFromId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BEHAVIORS[Math.abs(hash) % BEHAVIORS.length];
}

function smooth(x) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

// Applies a star's behaviour to its resting slot. `amount` fades the motion
// in and out; offsets stay small so the handwriting remains readable.
export function behaviorPolar(star, time, amount) {
  const { slot, seed, behavior } = star;
  let { r, theta, y } = slot;

  if (behavior === 'turbulence') {
    // Layered incommensurate sines: a noise field that never quite repeats.
    const s = seed * TAU;
    r += amount * (0.42 * Math.sin(time * 0.31 + s) + 0.24 * Math.sin(time * 0.73 + s * 2.3));
    theta += (amount * (0.3 * Math.sin(time * 0.23 + s * 1.7) + 0.16 * Math.sin(time * 0.59 + s * 3.1))) / Math.max(r, 1);
    y += amount * (0.5 * Math.sin(time * 0.37 + s * 0.6) + 0.26 * Math.sin(time * 0.83 + s * 4.3));
  } else if (behavior === 'attraction') {
    // Damped radial oscillation: pulled toward the pole, then settling back.
    const period = 15;
    const u = frac(time / period + seed);
    r -= amount * slot.r * 0.34 * Math.exp(-3 * u) * Math.sin(u * TAU * 2);
  } else if (behavior === 'clustering') {
    // Each arm shares one cycle, so its clustering stars form and dissolve together.
    const period = 19;
    const u = frac(time / period + slot.arm / CHART.ARMS);
    const gather = amount * 0.52 * smooth(u * 3.2) * smooth((1 - u) * 3.2);
    const anchor = armAnchor(slot.arm);
    r += (anchor.r - r) * gather;
    theta += (anchor.theta - theta) * gather;
    y += (anchor.y - y) * gather;
  }

  return { r, theta, y };
}

// Line vertices in drawing order: circles, then the 28 lodges, then the arms,
// so a growing draw range sketches the chart from the pole outward.
export function buildChartLines() {
  const v = [];
  const glow = [];
  let level = 0.34;
  const segment = (a, b) => {
    v.push(a.x, a.y, a.z, b.x, b.y, b.z);
    glow.push(level, level);
  };

  const circle = (radius, tilt = 0, steps = 160) => {
    for (let i = 0; i < steps; i++) {
      const point = (k) => {
        const a = (k / steps) * TAU;
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        return { x, y: Math.sin(tilt) * z, z: Math.cos(tilt) * z };
      };
      segment(point(i), point(i + 1));
    }
  };

  const { R_POLE, R_OUTER, LODGES, ARMS, OBLIQUITY } = CHART;
  circle(R_POLE);
  circle(R_OUTER * 0.54); // equator
  circle(R_OUTER * 0.54, OBLIQUITY); // ecliptic, inclined to the equator
  circle(R_OUTER);

  level = 0.13; // the lodges stay faintest, a grid behind the arms
  for (let i = 0; i < LODGES; i++) {
    const a = (i / LODGES) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    segment({ x: c * R_POLE, y: 0, z: s * R_POLE }, { x: c * R_OUTER, y: 0, z: s * R_OUTER });
  }

  level = 0.62;
  for (let arm = 0; arm < ARMS; arm++) {
    const steps = 90;
    for (let i = 0; i < steps; i++) {
      segment(toCartesian(polarOnArm(arm, i / steps)), toCartesian(polarOnArm(arm, (i + 1) / steps)));
    }
  }

  return { positions: new Float32Array(v), glow: new Float32Array(glow) };
}

// Dust that follows the arms, thickest along each arm's centre line.
export function buildArmDust(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const arm = i % CHART.ARMS;
    const t = frac(i * GOLDEN);
    const p = polarOnArm(arm, t);
    const a = frac(i * SILVER) * TAU;
    const b = frac(i * GOLDEN * GOLDEN);
    // Box-Muller gives a soft Gaussian falloff away from the arm.
    const spread = Math.sqrt(-2 * Math.log(Math.max(b, 0.0001))) * Math.cos(a) * (0.35 + t * 0.9);
    const q = toCartesian({ r: p.r + spread, theta: p.theta + spread * 0.04, y: p.y + spread * 0.25 });
    positions[i * 3] = q.x;
    positions[i * 3 + 1] = q.y;
    positions[i * 3 + 2] = q.z;
  }
  return positions;
}

// Minimum spanning tree (Prim) over the resting slots: the shortest set of
// lines joining every star. Returns index pairs.
export function minimumSpanningTree(points) {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  const pairs = [];
  best[0] = 0;

  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i;
    }
    inTree[u] = true;
    if (from[u] !== -1) pairs.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const dx = points[u].x - points[v].x;
      const dy = points[u].y - points[v].y;
      const dz = points[u].z - points[v].z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[v]) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  return pairs;
}
