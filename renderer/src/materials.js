// Material registry + shader program lifecycle.
//
// A material is a plain object: { name, phase, program, locations, uniforms,
// vertPath, fragPath }. `loadMaterial` fetches shader sources, compiles + links,
// caches uniform locations, and attaches the program. `reloadMaterial` reuses
// the same material object — called by the SSE hot-reload path.

export const PHASE = Object.freeze({
  DEPTH:       'DEPTH',
  OPAQUE:      'OPAQUE',
  TRANSPARENT: 'TRANSPARENT',
  POST:        'POST',
});

// Uniform names every program may read. Extra names in `def.uniforms` are
// added on top. getUniformLocation returns null for unused uniforms, which
// setFrameUniforms / drawDepthPass guard against.
const STANDARD_UNIFORMS = [
  'uView', 'uProj', 'uCamPos', 'uLightDir', 'uLightCol', 'uLightMVP', 'uTime',
  'uM', 'uNM', 'uBaseCol', 'uShadowMap', 'uSceneTex', 'uNormalMap', 'uResolution',
  'uAlpha',
  'uInvVP', 'uEnvTex', 'uEnvLayout',                       // raymarch
  'uPointLightPos', 'uPointLightCol', 'uPointLightCount',  // debug point lights
  'uPointLightPos[0]', 'uPointLightCol[0]',                // some drivers want [0]
  'uBloomTex', 'uBloomStrength', 'uThreshold', 'uDir',     // bloom chain
  'uStreakStrength', 'uStreakStep',                        // lens streaks
  'uCamRight', 'uCamUp', 'uBillboardSize',                 // billboards
  'uNoiseTex', 'uTint', 'uScale', 'uSpeed', 'uOpacity', 'uSliceOffset', 'uAmp', // volumes
  'uSpriteTex',                                                         // sprites
  'uLineOpacity',                                                       // lines
  'uEdgeCol', 'uFresnelPow', 'uEdgeAlpha',                              // fresnel shell
  'uPlaneVerts', 'uEdgeActive', 'uCubeMin', 'uCubeMax', 'uSeed',        // per-plane SDF
  'uBubCount', 'uBubOrigin', 'uBubDir',                                 // water bubbles
  'uBubRadius', 'uBubPhase', 'uBubSpeed', 'uBubTravel',
  'uPlaneOrigin', 'uPlaneNormal',                                       // water-rings (2D slice)
  'uPrev', 'uFluid', 'uPrevColor', 'uColorTex',                         // water fluid sim
  'uIntensity', 'uFrame',
  'uBitCount', 'uBitData',                                              // edge-bit force/colour sources
  'uTubeRadius',                                                        // forest backbone
  'uCamRight', 'uCamUp',                                                // camera basis
  'uNormieTex',                                                         // normie pixel overlay
  'uLightScale', 'uCubeCenter', 'uCubeHalfSize',                        // per-cube light anchoring
  'uTextTex', 'uMode', 'uGlitch', 'uTimeScale',                         // text-banner texture + mode + glitch
];

// ---------- Program compilation ----------

function compileShader(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const kind = (type === gl.VERTEX_SHADER) ? 'vert' : 'frag';
    console.error(`[${name}.${kind}] compile error:\n${log}`);
    console.error(numberedSource(src));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function numberedSource(src) {
  return src.split('\n').map((line, i) => String(i + 1).padStart(3, ' ') + ' | ' + line).join('\n');
}

export function compileProgram(gl, vs, fs, name) {
  const v = compileShader(gl, gl.VERTEX_SHADER,   vs, name);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs, name);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(`[${name}] link error:`, gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  gl.deleteShader(v);
  gl.deleteShader(f);
  return prog;
}

// ---------- Material lifecycle ----------

const shaderTextCache = new Map();
const shaderSourceCache = new Map();

async function fetchTextCached(path, label, { bust = false } = {}) {
  if (!bust && shaderTextCache.has(path)) return shaderTextCache.get(path);
  const promise = (async () => {
    const res = await fetch(path + (bust ? '?' + Date.now() : ''));
    if (!res.ok) throw new Error(`${label} failed: ${path} (${res.status})`);
    return res.text();
  })();
  if (!bust) shaderTextCache.set(path, promise);
  return promise;
}

async function fetchShader(path, { bust = false } = {}) {
  if (!bust && shaderSourceCache.has(path)) return shaderSourceCache.get(path);
  const promise = (async () => {
    // Cache-bust only on hot-reload. Initial material setup shares shader
    // sources across programs so common terrain/line shaders are fetched once.
    let src = await fetchTextCached(path, 'shader fetch', { bust });
    // Resolve `// #include "chunks/foo.glsl"` directives. Paths are relative to
    // /renderer/shaders/. Single-pass (no nested includes); add a loop here if
    // chunks ever need to include other chunks. The directive must be the only
    // thing on its line so the comment form stays a no-op for editors/linters.
    const re = /^[ \t]*\/\/[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;
    const matches = [...src.matchAll(re)];
    for (const m of matches) {
      const incPath = '/renderer/shaders/' + m[1];
      src = src.replace(m[0], await fetchTextCached(incPath, '#include', { bust }));
    }
    return src;
  })();
  if (!bust) shaderSourceCache.set(path, promise);
  return promise;
}

function cacheLocations(gl, prog, extraNames) {
  const locs = {};
  const allNames = new Set([...STANDARD_UNIFORMS, ...extraNames]);
  for (const name of allNames) {
    locs[name] = gl.getUniformLocation(prog, name);
  }
  return locs;
}

export async function loadMaterial(gl, def) {
  const [vs, fs] = await Promise.all([
    fetchShader(def.vertPath),
    fetchShader(def.fragPath),
  ]);
  const prog = compileProgram(gl, vs, fs, def.name);
  if (!prog) throw new Error(`compile failed: ${def.name}`);
  return {
    name:      def.name,
    phase:     def.phase,
    vertPath:  def.vertPath,
    fragPath:  def.fragPath,
    uniforms:  def.uniforms || {},
    program:   prog,
    locations: cacheLocations(gl, prog, Object.keys(def.uniforms || {})),
  };
}

export function loadMaterialFromSource(gl, def) {
  const prog = compileProgram(gl, def.vertSource, def.fragSource, def.name);
  if (!prog) throw new Error(`compile failed: ${def.name}`);
  return {
    name:      def.name,
    phase:     def.phase,
    vertPath:  def.vertPath || '',
    fragPath:  def.fragPath || '',
    uniforms:  def.uniforms || {},
    program:   prog,
    locations: cacheLocations(gl, prog, Object.keys(def.uniforms || {})),
  };
}

// Recompile in place and swap the program pointer; keeps the material
// reference stable so callers don't need to re-lookup.
export async function reloadMaterial(gl, mat) {
  const [vs, fs] = await Promise.all([
    fetchShader(mat.vertPath, { bust: true }),
    fetchShader(mat.fragPath, { bust: true }),
  ]);
  const newProg = compileProgram(gl, vs, fs, mat.name);
  if (!newProg) {
    console.warn(`[${mat.name}] kept previous program`);
    return false;
  }
  if (mat.program) gl.deleteProgram(mat.program);
  mat.program   = newProg;
  mat.locations = cacheLocations(gl, newProg, Object.keys(mat.uniforms));
  return true;
}
