function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + ((end - start) * amount);
}

function smoothstep(value) {
  return value * value * (3 - (2 * value));
}

function hashNoise2d(x, z, seed = 0) {
  const value = Math.sin((x * 12.9898) + (z * 78.233) + (seed * 37.719)) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2d(x, z, seed = 0, frequency = 1) {
  const scaledX = x * frequency;
  const scaledZ = z * frequency;
  const baseX = Math.floor(scaledX);
  const baseZ = Math.floor(scaledZ);
  const fracX = smoothstep(scaledX - baseX);
  const fracZ = smoothstep(scaledZ - baseZ);
  const topLeft = hashNoise2d(baseX, baseZ, seed);
  const topRight = hashNoise2d(baseX + 1, baseZ, seed);
  const bottomLeft = hashNoise2d(baseX, baseZ + 1, seed);
  const bottomRight = hashNoise2d(baseX + 1, baseZ + 1, seed);
  const top = lerp(topLeft, topRight, fracX);
  const bottom = lerp(bottomLeft, bottomRight, fracX);

  return lerp(top, bottom, fracZ);
}

function signedValueNoise2d(x, z, seed = 0, frequency = 1) {
  return (valueNoise2d(x, z, seed, frequency) * 2) - 1;
}

function hashNoise3d(x, y, z, seed = 0) {
  const value = Math.sin(
    (x * 12.9898) +
    (y * 39.3467) +
    (z * 78.233) +
    (seed * 37.719)
  ) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise3d(x, y, z, seed = 0, frequency = 1) {
  const scaledX = x * frequency;
  const scaledY = y * frequency;
  const scaledZ = z * frequency;
  const baseX = Math.floor(scaledX);
  const baseY = Math.floor(scaledY);
  const baseZ = Math.floor(scaledZ);
  const fracX = smoothstep(scaledX - baseX);
  const fracY = smoothstep(scaledY - baseY);
  const fracZ = smoothstep(scaledZ - baseZ);

  const c000 = hashNoise3d(baseX, baseY, baseZ, seed);
  const c100 = hashNoise3d(baseX + 1, baseY, baseZ, seed);
  const c010 = hashNoise3d(baseX, baseY + 1, baseZ, seed);
  const c110 = hashNoise3d(baseX + 1, baseY + 1, baseZ, seed);
  const c001 = hashNoise3d(baseX, baseY, baseZ + 1, seed);
  const c101 = hashNoise3d(baseX + 1, baseY, baseZ + 1, seed);
  const c011 = hashNoise3d(baseX, baseY + 1, baseZ + 1, seed);
  const c111 = hashNoise3d(baseX + 1, baseY + 1, baseZ + 1, seed);

  const x00 = lerp(c000, c100, fracX);
  const x10 = lerp(c010, c110, fracX);
  const x01 = lerp(c001, c101, fracX);
  const x11 = lerp(c011, c111, fracX);
  const y0 = lerp(x00, x10, fracY);
  const y1 = lerp(x01, x11, fracY);

  return lerp(y0, y1, fracZ);
}

function signedValueNoise3d(x, y, z, seed = 0, frequency = 1) {
  return (valueNoise3d(x, y, z, seed, frequency) * 2) - 1;
}

function fbmNoise2d(x, z, seed = 0, options = {}) {
  const octaves = options.octaves ?? 4;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const frequency = options.frequency ?? 1;
  let amplitude = 1;
  let currentFrequency = frequency;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave++) {
    total += signedValueNoise2d(x, z, seed + (octave * 101), currentFrequency) * amplitude;
    weight += amplitude;
    amplitude *= persistence;
    currentFrequency *= lacunarity;
  }

  return weight > 0 ? total / weight : 0;
}

function fbmNoise3d(x, y, z, seed = 0, options = {}) {
  const octaves = options.octaves ?? 4;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const frequency = options.frequency ?? 1;
  let amplitude = 1;
  let currentFrequency = frequency;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave++) {
    total += signedValueNoise3d(x, y, z, seed + (octave * 101), currentFrequency) * amplitude;
    weight += amplitude;
    amplitude *= persistence;
    currentFrequency *= lacunarity;
  }

  return weight > 0 ? total / weight : 0;
}

function ridgeNoise2d(x, z, seed = 0, options = {}) {
  const base = fbmNoise2d(x, z, seed, options);
  return 1 - Math.abs(base);
}

function hashStringSeed(seed) {
  const normalizedSeed = `${seed}`;
  let hash = 2166136261;

  for (let index = 0; index < normalizedSeed.length; index++) {
    hash ^= normalizedSeed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

module.exports = {
  clamp,
  lerp,
  smoothstep,
  hashNoise2d,
  valueNoise2d,
  signedValueNoise2d,
  hashNoise3d,
  valueNoise3d,
  signedValueNoise3d,
  fbmNoise2d,
  fbmNoise3d,
  ridgeNoise2d,
  hashStringSeed
};
