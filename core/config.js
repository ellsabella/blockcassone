export const CONFIG = {

  axisColors: {
    x: { rgb: [255, 0, 0], hex: '#ff0000' },
    y: { rgb: [0, 255, 0], hex: '#00ff00' },
    z: { rgb: [0, 0, 255], hex: '#0000ff' },
  },

  materials: ['water', 'stone', 'forest'],

  materialPatterns: {
    stone:  'straight',
    water:  'flow',
    forest: 'perlin',
  },

  edgeSubdivisions: 8,
  edgePointProbability: 0.5,

  fadeBands: 5,

  lineStyle: {
    steps:          30,
    noiseScale:     4.0,
    noiseAmp:       0.38,
    flowJitter:     0.15,
    strandsPerPoint: 1,
    strandSpread:   0.25,
  },

  stone: {
    noiseScale:       0.01,
    minOpacity:       0.01,
    maxOpacity:       0.45,
    power:            3.0,
    darkThreshold:    0.25,
    emphasisMinW:     2.5,
    emphasisMaxW:     9.5,
    emphasisMinO:     0.15,
    emphasisMaxO:     0.9,
    pointGridDensity: 0.03,
    usePointShader:   true,
  },

  water: {
    gridRes:          80,
    contourLevels:    9,
    noiseScale:       0.012,
    noiseOctaves:     3,
    noisePersistence: 0.5,
    lineEdgeW:        2.0,
    lineDeepW:        0.3,
    lineEdgeO:        0.85,
    lineDeepO:        0.12,
    bandFillMaxO:     0.15,
    springStrength:   0.4,
    springRadius:     0.5,
    ridgeGridSize:    0.02,
    ridgeSurfaceScale: 2.0,
    ridgeSurfaceParam: 0.3,
    useRidgeShader:   true,
  },

  forest: {
    edgePointProbability: 1.0,
    maxDepth:         5,
    branchLenFrac:    0.18,
    spreadMin:        0.2,
    spreadMax:        0.6,
    lenDecay:         0.7,
    lineW:            2.0,
    wDecay:           0.7,
    baseOpacity:      0.8,
    opacityDecay:     0.75,
    trunkPointWeight: 0.04,
    pointWeightDecay: 0.7,
    usePointShader:   true,
  },

  svg: {
    size:       600,
    padding:    60,
    background: '#111111',
  },
};
