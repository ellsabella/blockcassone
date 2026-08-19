/**
 * TheBLOCK Global Configuration
 *
 * Single source of truth for all colours, materials, and shared constants.
 * Both the main renderer and dev tools reference this file.
 */

var CONFIG = {

  // --- Axis colours ---
  // RGB arrays for WebGL/p5 renderer, hex for SVG renderer
  axisColors: {
    x: { rgb: [255, 0, 0], hex: "#ff0000" },       // pure red
    y: { rgb: [0, 255, 0], hex: "#00ff00" },       // pure green
    z: { rgb: [0, 0, 255], hex: "#0000ff" }        // pure blue
  },

  // --- Materials ---
  materials: ["water", "stone", "forest"],

  // Material → pattern family mapping
  materialPatterns: {
    stone:  "straight",
    water:  "flow",
    forest: "perlin"
  },

  // --- Edge / grid structure ---
  edgeSubdivisions: 8,     // grid divisions per edge (produces n-1 sub-vertex points)
  edgePointProbability: 0.5, // probability each sub-vertex is active

  // --- Fade ---
  fadeBands: 5,            // alpha bands for stepped fade

  // --- Line styles (used by 3D renderer / linestyles.js) ---
  lineStyle: {
    steps: 30,             // segments per polyline
    noiseScale: 4.0,       // spatial frequency of noise
    noiseAmp: 0.38,        // displacement strength (fraction of line length)
    flowJitter: 0.15,      // flow field drift strength
    strandsPerPoint: 1,    // lines per edge point
    strandSpread: 0.25     // how far strands fan apart
  },

  // --- Stone infill ---
  stone: {
    noiseScale: 0.01,
    minOpacity: 0.01,
    maxOpacity: 0.45,
    power: 3.0,
    darkThreshold: 0.25,
    emphasisMinW: 2.5,
    emphasisMaxW: 9.5,
    emphasisMinO: 0.15,
    emphasisMaxO: 0.9,
    // WebGL point cloud params
    pointGridDensity: 0.03,
    usePointShader: true
  },

  // --- Water infill ---
  water: {
    gridRes: 80,
    contourLevels: 9,
    noiseScale: 0.012,
    noiseOctaves: 3,
    noisePersistence: 0.5,
    // Contour lines: weight/opacity at edge vs deep interior
    lineEdgeW: 2.0,          // stroke weight near edge points
    lineDeepW: 0.3,          // stroke weight far from edges
    lineEdgeO: 0.85,         // opacity near edge points
    lineDeepO: 0.12,         // opacity far from edges
    // Gradient band fills between contour levels
    bandFillMaxO: 0.15,      // max fill opacity for bands near edge points
    // Spring influence: how strongly edge points warp the noise field
    springStrength: 0.4,     // 0 = no warping, 1 = heavy warping
    springRadius: 0.5,       // influence radius as fraction of plane diagonal
    // Ridge shader params (WebGL)
    ridgeGridSize: 0.02,     // quantization grid size (smaller = finer ridges)
    ridgeSurfaceScale: 2.0,  // spatial scale of the minimal surface
    ridgeSurfaceParam: 0.3,  // catenoid c parameter
    useRidgeShader: true     // enable WebGL ridge renderer for water
  },

  // --- Forest infill (fractal trees) ---
  forest: {
    edgePointProbability: 1.0,  // all edge points active
    maxDepth: 5,                // recursion depth (2^5 = 32 leaf branches per tree)
    branchLenFrac: 0.18,       // initial branch length as fraction of plane diagonal
    spreadMin: 0.2,            // minimum fork angle (radians)
    spreadMax: 0.6,            // maximum fork angle (radians)
    lenDecay: 0.7,             // child branch length = parent * decay
    lineW: 2.0,                // trunk stroke weight
    wDecay: 0.7,               // weight multiplier per depth
    baseOpacity: 0.8,          // trunk opacity
    opacityDecay: 0.75,        // opacity multiplier per depth
    // WebGL point cloud params
    trunkPointWeight: 0.04,    // point size at trunk level
    pointWeightDecay: 0.7,     // size multiplier per depth
    usePointShader: true        // enable WebGL renderer for forest
  },

  // --- SVG dev viewer ---
  svg: {
    size: 600,
    padding: 60,
    background: "#111111"
  }
};
