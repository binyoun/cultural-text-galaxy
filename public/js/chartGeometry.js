// Geometry of the shared sky. Cheonsang Yeolcha Bunyajido (1395) is a flat
// polar projection of the celestial sphere, so this file builds the sphere and
// the flat chart from the same coordinates: every point has a position on each,
// and the reveal rises from one to the other.
//
// A point is { rho, theta, phi }: distance from the centre, longitude, and
// angle from the north pole. The six arms are loxodromes, the spirals a ship
// traces on a globe at a constant heading. Looking down the pole they become
// the spiral arms of a chart. Every star sits exactly on its arm.

const TAU = Math.PI * 2;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
const SILVER = Math.SQRT2 - 1;

export const CHART = {
  R: 15, // radius of the sphere
  R_FLAT: 20, // radius of the flat chart
  ARMS: 6,
  LODGES: 28,
  PHI_MIN: 0.26, // the polar circle, in radians from the pole
  HEADING: 1.12, // how tightly the loxodromes wind
  OBLIQUITY: (23.5 * Math.PI) / 180,
  ARM_CAPACITY: 12,
};

// Each arm runs at its own depth, so the arms pass in front of one another.
const ARM_SHELLS = [1, 0.84, 0.94, 0.77, 0.97, 0.88];

const REGION_ARM = {
  asia: 0,
  'middle-east': 1,
  africa: 2,
  europe: 3,
  americas: 4,
  oceania: 5,
};

export const BEHAVIORS = ['turbulence', 'attraction', 'clustering'];

const POLE_MARGIN = (1 - Math.cos(CHART.PHI_MIN)) / 2;

function frac(x) {
  return x - Math.floor(x);
}

function smooth(x) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

// t runs from pole to pole. The arccosine spaces equal t over equal sphere area.
function phiAt(t) {
  return Math.acos(1 - 2 * (POLE_MARGIN + (1 - 2 * POLE_MARGIN) * t));
}

function polarOnArm(arm, t) {
  const phi = phiAt(t);
  const theta = (arm / CHART.ARMS) * TAU + CHART.HEADING * Math.log(Math.tan(phi / 2));
  // Mid-arm the arms keep their own depth; at the poles they all rise to the
  // sphere, so each one begins and ends on the polar circle.
  const depth = smooth(t / 0.32) * smooth((1 - t) / 0.32);
  const rho = CHART.R * (1 + depth * (ARM_SHELLS[arm] - 1 + 0.05 * Math.sin(2 * theta + arm * 1.7)));
  return { rho, theta, phi };
}

export function toSphere({ rho, theta, phi }) {
  const s = Math.sin(phi);
  return { x: rho * s * Math.cos(theta), y: rho * Math.cos(phi), z: rho * s * Math.sin(theta) };
}

export function toFlat({ theta, phi }, scale = 1) {
  const r = (CHART.R_FLAT * phi * scale) / Math.PI;
  return { x: r * Math.cos(theta), y: 0, z: r * Math.sin(theta) };
}

// `inflate` is 0 for the flat chart and 1 for the sphere.
export function project(point, inflate) {
  const a = toFlat(point);
  const b = toSphere(point);
  return {
    x: a.x + (b.x - a.x) * inflate,
    y: a.y + (b.y - a.y) * inflate,
    z: a.z + (b.z - a.z) * inflate,
  };
}

// Hands out slots in upload order. A star joins its region's arm, or the
// emptiest arm if it has no region or its arm is full. The golden-ratio
// sequence spreads each arm's stars evenly at any count.
export function createSlotAllocator() {
  const counts = new Array(CHART.ARMS).fill(0);
  const emptiest = () => counts.indexOf(Math.min(...counts));
  return {
    place(region) {
      let arm = REGION_ARM[region];
      if (arm === undefined || counts[arm] >= CHART.ARM_CAPACITY) arm = emptiest();
      const n = counts[arm]++;
      const t = 0.11 + 0.78 * frac((n + 1) * GOLDEN + arm * SILVER);
      return { arm, n, t, ...polarOnArm(arm, t) };
    },
  };
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

// Applies a star's behaviour to its resting slot. `amount` fades the motion in
// and out; offsets stay small so the handwriting remains readable.
export function behaviorPoint(star, time, amount) {
  const { slot, seed, behavior } = star;
  let { rho, theta, phi } = slot;

  if (behavior === 'turbulence') {
    // Layered incommensurate sines: a noise field that never quite repeats.
    const s = seed * TAU;
    rho += amount * (0.5 * Math.sin(time * 0.31 + s) + 0.28 * Math.sin(time * 0.73 + s * 2.3));
    theta += (amount * (0.4 * Math.sin(time * 0.23 + s * 1.7) + 0.2 * Math.sin(time * 0.59 + s * 3.1))) / Math.max(rho * Math.sin(phi), 1);
    phi += (amount * (0.42 * Math.sin(time * 0.37 + s * 0.6) + 0.22 * Math.sin(time * 0.83 + s * 4.3))) / Math.max(rho, 1);
  } else if (behavior === 'attraction') {
    // Damped oscillation: drawn up its arm toward the pole, then settling back.
    const u = frac(time / 15 + seed);
    return polarOnArm(slot.arm, slot.t * (1 - amount * 0.3 * Math.exp(-3 * u) * Math.sin(u * TAU * 2)));
  } else if (behavior === 'clustering') {
    // Each arm shares one cycle, so its stars gather and dissolve together.
    // They slide along the arm itself, so a gathering word never leaves its line.
    const u = frac(time / 19 + slot.arm / CHART.ARMS);
    const gather = amount * 0.42 * smooth(u * 3.2) * smooth((1 - u) * 3.2);
    return polarOnArm(slot.arm, slot.t + (0.5 - slot.t) * gather);
  }

  return { rho, theta, phi };
}

// The fixed frame of the sphere, in drawing order so a growing draw range
// sketches the chart from the pole outward.
export function buildFrameLines() {
  const sphere = [];
  const flat = [];
  const glow = [];
  const { R, PHI_MIN, LODGES, OBLIQUITY } = CHART;

  const polyline = (pointAt, steps, level, flatScale = 1) => {
    for (let i = 0; i < steps; i++) {
      for (const k of [i, i + 1]) {
        const p = pointAt(k / steps);
        const a = toSphere(p);
        const b = toFlat(p, flatScale);
        sphere.push(a.x, a.y, a.z);
        flat.push(b.x, b.y, b.z);
        glow.push(level);
      }
    }
  };

  const parallel = (phi, level, ripple = 0, waves = 0, phase = 0) => {
    polyline((u) => {
      const theta = u * TAU;
      return { rho: R * (1 + ripple * Math.sin(waves * theta + phase)), theta, phi };
    }, 200, level);
  };

  // A great circle tipped by `tilt` about the x axis, then turned about the pole.
  const greatCircle = (rho, tilt, turn, level, flatScale = 1) => {
    polyline((u) => {
      const a = u * TAU;
      const x = Math.cos(a);
      const z = Math.sin(a) * Math.cos(tilt);
      const y = Math.sin(a) * Math.sin(tilt);
      return { rho, theta: Math.atan2(z, x) + turn, phi: Math.acos(y) };
    }, 200, level, flatScale);
  };

  parallel(PHI_MIN, 0.34);
  parallel(Math.PI / 2, 0.34); // equator
  greatCircle(R, OBLIQUITY, 0, 0.3); // ecliptic: off-centre on the chart, as on the stone
  parallel(Math.PI - PHI_MIN, 0.3);

  // The 28 lodges fall into four groups of seven, one for each direction.
  for (let i = 0; i < LODGES; i++) {
    const theta = (i / LODGES) * TAU;
    const level = i % 7 === 0 ? 0.26 : 0.09;
    polyline((u) => ({ rho: R, theta, phi: PHI_MIN + (Math.PI - 2 * PHI_MIN) * u }), 72, level);
  }

  // Fine parallels at golden spacing, each with its own slight ripple.
  for (let i = 1; i <= 9; i++) {
    const phi = PHI_MIN + (Math.PI - 2 * PHI_MIN) * frac(i * GOLDEN);
    parallel(phi, 0.05 + 0.06 * frac(i * SILVER), 0.006, 5 + (i % 7), i * 2.4);
  }

  // Inner rings at golden turns: structure in the middle of the volume.
  for (let i = 0; i < 5; i++) {
    const tilt = 0.5 + 1.4 * frac(i * GOLDEN);
    greatCircle(R * (0.34 + i * 0.07), tilt, i * TAU * GOLDEN, 0.2, 0.34 + i * 0.07);
  }

  // The polar axis. It has no length on the flat chart, so it rises with the sphere.
  for (const y of [R, -R]) {
    sphere.push(0, y, 0);
    flat.push(0, 0, 0);
    glow.push(0.32);
  }

  return {
    sphere: new Float32Array(sphere),
    flat: new Float32Array(flat),
    glow: new Float32Array(glow),
  };
}

const BRAID_STRANDS = 8;
const BRAID_STEPS = 240;
const BRAID_WIDTH = 1.2;
const BRAID_PITCH = 11; // length of arm per full twist; long enough that strands never loop
const PINCH_WIDTH = 0.05; // how far along an arm a star draws the strands in
const FOLLOW_WIDTH = 0.09; // how far along an arm the lines follow a moving star

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// Each arm is a centre line wrapped by strands that twist around it, open
// between stars and close to a point at each star, passing through the blank
// centre of the handwriting. Rebuilt from the real stars whenever one arrives.
// `slots` is [{ arm, t, index }]. Segments are ordered by distance along the
// arms, so a growing draw range grows every arm at once.
export function buildBraids(slots) {
  const { ARMS } = CHART;
  const perStep = ARMS * (BRAID_STRANDS + 1);
  const count = BRAID_STEPS * perStep * 2;
  const sphere = new Float32Array(count * 3);
  const flat = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  const weight = new Float32Array(count);
  const starIndex = new Int16Array(count).fill(-1);

  const byArm = Array.from({ length: ARMS }, () => []);
  slots.forEach((s) => byArm[s.arm].push(s));

  const arcLength = byArm.map((_, arm) => {
    const table = [0];
    for (let i = 1; i <= BRAID_STEPS; i++) {
      const a = toSphere(polarOnArm(arm, (i - 1) / BRAID_STEPS));
      const b = toSphere(polarOnArm(arm, i / BRAID_STEPS));
      table.push(table[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    return table;
  });

  const strandPoint = (arm, strand, t) => {
    const h = 0.002;
    const point = polarOnArm(arm, t);
    const centre = toSphere(point);
    const centreFlat = toFlat(point);

    let pinch = 1;
    let nearest = -1;
    let follow = 0;
    for (const s of byArm[arm]) {
      const d = Math.abs(t - s.t);
      pinch = Math.min(pinch, smooth(d / PINCH_WIDTH));
      const w = Math.exp(-((d / FOLLOW_WIDTH) ** 2));
      if (w > follow) {
        follow = w;
        nearest = s.index;
      }
    }

    // The ends of every arm stay fixed to the polar circles, whatever the stars do.
    follow *= smooth(t / 0.1) * smooth((1 - t) / 0.1);

    if (strand < 0) return { a: centre, b: centreFlat, follow, nearest };

    const phase = strand / BRAID_STRANDS;
    const swell = 0.5 + 0.5 * Math.sin(t * TAU * 2.3 + arm * 1.1) * Math.sin(t * TAU * 5.1 + strand * 0.7);
    // Strands stay closed where the arm climbs to the pole, so each arm leaves the
    // polar circle as one clean line instead of a coil seen end-on.
    const open = BRAID_WIDTH * pinch * smooth(t / 0.34) * smooth((1 - t) / 0.34) * (0.45 + 0.55 * swell);
    // The twist is spaced by distance along the arm, not by t, so the pitch stays even.
    const along = arcLength[arm][Math.round(t * BRAID_STEPS)];
    const twist = TAU * (along / BRAID_PITCH + phase) + 0.3 * Math.sin(t * TAU * 3.7 + strand * 2.39);

    const ahead = polarOnArm(arm, Math.min(1, t + h));
    const behind = polarOnArm(arm, Math.max(0, t - h));
    const out = normalize(centre);
    const side = normalize(cross(sub(toSphere(ahead), toSphere(behind)), out));
    const flatTangent = normalize(sub(toFlat(ahead), toFlat(behind)));

    const c = Math.cos(twist) * open;
    const s = Math.sin(twist) * open;
    return {
      a: {
        x: centre.x + out.x * c + side.x * s,
        y: centre.y + out.y * c + side.y * s,
        z: centre.z + out.z * c + side.z * s,
      },
      b: {
        x: centreFlat.x - flatTangent.z * s,
        y: c * 0.3,
        z: centreFlat.z + flatTangent.x * s,
      },
      follow,
      nearest,
    };
  };

  let v = 0;
  const writeVertex = (p, level) => {
    sphere.set([p.a.x, p.a.y, p.a.z], v * 3);
    flat.set([p.b.x, p.b.y, p.b.z], v * 3);
    glow[v] = level;
    weight[v] = p.follow;
    starIndex[v] = p.nearest;
    v++;
  };

  for (let step = 0; step < BRAID_STEPS; step++) {
    for (let arm = 0; arm < ARMS; arm++) {
      for (let strand = -1; strand < BRAID_STRANDS; strand++) {
        const level = strand < 0 ? 0.62 : 0.13 + 0.2 * frac((strand + 1) * GOLDEN + arm * SILVER);
        writeVertex(strandPoint(arm, strand, step / BRAID_STEPS), level);
        writeVertex(strandPoint(arm, strand, (step + 1) / BRAID_STEPS), level);
      }
    }
  }

  return { sphere, flat, glow, weight, starIndex, count };
}

// Dust that follows the arms, thickest along each arm's centre line.
export function buildArmDust(count) {
  const sphere = new Float32Array(count * 3);
  const flat = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const arm = i % CHART.ARMS;
    const t = frac(i * GOLDEN);
    const p = polarOnArm(arm, t);
    const a = frac(i * SILVER) * TAU;
    const b = frac(i * GOLDEN * GOLDEN);
    const c = frac(i * SILVER * GOLDEN) * TAU;
    // Box-Muller gives a soft Gaussian falloff away from the arm.
    const spread = Math.sqrt(-2 * Math.log(Math.max(b, 0.0001))) * Math.cos(a) * 1.3;
    const q = toSphere(p);
    const f = toFlat(p);
    sphere.set([q.x + spread * Math.cos(c), q.y + spread * Math.sin(c) * 0.8, q.z + spread * Math.sin(c + 1)], i * 3);
    flat.set([f.x + spread * Math.cos(c), 0, f.z + spread * Math.sin(c)], i * 3);
  }
  return { sphere, flat };
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
