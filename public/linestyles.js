/**
 * Line Style Module
 *
 * Each style function takes (start, end, plane, seed) and returns an array
 * of {x, y, z} points forming a polyline from start toward end.
 * The seed parameter (0-1) varies each strand within a bundle.
 *
 * Material → style mapping:
 *   stone  → straight (clean, rigid lines with slight fan)
 *   water  → flow field (wandering, fluid paths)
 *   forest → perlin (organic, gently displaced)
 */

var LINE_STYLE_STEPS = CONFIG.lineStyle.steps;
var NOISE_SCALE = CONFIG.lineStyle.noiseScale;
var NOISE_AMP = CONFIG.lineStyle.noiseAmp;
var FLOW_STEP_JITTER = CONFIG.lineStyle.flowJitter;
var STRANDS_PER_POINT = CONFIG.lineStyle.strandsPerPoint;
var STRAND_SPREAD = CONFIG.lineStyle.strandSpread;

/**
 * Straight line with slight fan offset for bundling. Used for "stone".
 */
function styleStraight(start, end, plane, seed) {
  var dx = end.x - start.x;
  var dy = end.y - start.y;
  var dz = end.z - start.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return [start, end];

  var perp = getPlanePerpendicular(plane, dx, dy, dz);
  var offset = (seed - 0.5) * STRAND_SPREAD * len;

  return [
    start,
    {
      x: end.x + perp.x * offset,
      y: end.y + perp.y * offset,
      z: end.z + perp.z * offset
    }
  ];
}

/**
 * Perlin-displaced line — organic wobble. Used for "forest".
 * Each strand gets a unique noise offset from the seed.
 */
function stylePerlin(start, end, plane, seed) {
  var dx = end.x - start.x;
  var dy = end.y - start.y;
  var dz = end.z - start.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return [start, end];

  var perp = getPlanePerpendicular(plane, dx, dy, dz);
  var noiseOffset = seed * 73.7; // unique noise layer per strand

  var pts = [];
  for (var i = 0; i <= LINE_STYLE_STEPS; i++) {
    var t = i / LINE_STYLE_STEPS;
    var px = start.x + dx * t;
    var py = start.y + dy * t;
    var pz = start.z + dz * t;

    // Two noise layers: base shape + strand variation
    var n1 = noise(px * NOISE_SCALE + 100, py * NOISE_SCALE + 200, pz * NOISE_SCALE + 300);
    var n2 = noise(px * NOISE_SCALE * 2 + noiseOffset, py * NOISE_SCALE * 2 + noiseOffset + 50, pz * NOISE_SCALE * 2);
    var disp = ((n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.6) * NOISE_AMP * len;

    // Fan out strands + taper at endpoints
    var fan = (seed - 0.5) * STRAND_SPREAD * len * t;
    var taper = Math.sin(t * Math.PI);
    disp = disp * taper + fan;

    pts.push({
      x: px + perp.x * disp,
      y: py + perp.y * disp,
      z: pz + perp.z * disp
    });
  }

  return pts;
}

/**
 * Flow field line — wanders following noise. Used for "water".
 * Each strand drifts differently based on seed.
 */
function styleFlowField(start, end, plane, seed) {
  var dx = end.x - start.x;
  var dy = end.y - start.y;
  var dz = end.z - start.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return [start, end];

  var perp = getPlanePerpendicular(plane, dx, dy, dz);
  var fwd = { x: dx / len, y: dy / len, z: dz / len };
  var stepLen = len / LINE_STYLE_STEPS;
  var noiseOffset = seed * 91.3;

  // Start position slightly fanned
  var fan = (seed - 0.5) * STRAND_SPREAD * len * 0.3;
  var cx = start.x + perp.x * fan;
  var cy = start.y + perp.y * fan;
  var cz = start.z + perp.z * fan;

  var pts = [{ x: cx, y: cy, z: cz }];

  for (var i = 1; i <= LINE_STYLE_STEPS; i++) {
    var n = noise(
      cx * NOISE_SCALE * 1.5 + 500 + noiseOffset,
      cy * NOISE_SCALE * 1.5 + 600,
      cz * NOISE_SCALE * 1.5 + 700
    );
    var drift = (n - 0.5) * 2 * FLOW_STEP_JITTER;

    // Add a second noise layer for richer variation
    var n2 = noise(
      cx * NOISE_SCALE * 3 + noiseOffset + 200,
      cy * NOISE_SCALE * 3 + 300,
      cz * NOISE_SCALE * 3 + 400
    );
    drift += (n2 - 0.5) * FLOW_STEP_JITTER * 0.5;

    var mx = fwd.x + perp.x * drift;
    var my = fwd.y + perp.y * drift;
    var mz = fwd.z + perp.z * drift;

    var ml = Math.sqrt(mx * mx + my * my + mz * mz);
    if (ml > 0) { mx /= ml; my /= ml; mz /= ml; }

    cx += mx * stepLen;
    cy += my * stepLen;
    cz += mz * stepLen;
    pts.push({ x: cx, y: cy, z: cz });
  }

  return pts;
}

/**
 * Computes a unit vector perpendicular to a direction, lying in the plane.
 */
function getPlanePerpendicular(plane, dx, dy, dz) {
  var nx = 0, ny = 0, nz = 0;
  if (plane.axis === "x") nx = 1;
  else if (plane.axis === "y") ny = 1;
  else nz = 1;

  var px = ny * dz - nz * dy;
  var py = nz * dx - nx * dz;
  var pz = nx * dy - ny * dx;
  var pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl > 0) { px /= pl; py /= pl; pz /= pl; }

  return { x: px, y: py, z: pz };
}

/**
 * Maps material names to style functions.
 */
var MATERIAL_STYLES = {
  stone: styleStraight,
  water: styleFlowField,
  forest: stylePerlin
};

/**
 * Returns the style function for a given plane based on its material.
 */
function getStyleForPlane(plane) {
  return MATERIAL_STYLES[plane.material] || styleStraight;
}
