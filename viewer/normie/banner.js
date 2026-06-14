// Normie traits banner — per-plane perpendicular quad with NormiesFont texture.

import { createMeshGL } from '../../renderer/src/geometry.js';
import { mat4, identity } from '../../renderer/src/math.js';
import { uvToWorld } from '../materials/plane-2d.js';
import { hash1 } from '../tree-walker.js';
import { isNormieCube, normieIdForCube } from './status.js';
import { ensureFetched, getNormieData, getAllPlanes } from './api.js';

const BANNER_CHAR_PX  = 64;
const BANNER_CANVAS_W = 96;
const BANNER_GLOW_PX  = BANNER_CHAR_PX * 0.10;
const BANNER_FONT_NAME = 'NormiesFont';
const WHITE_TINT = new Float32Array([1.0, 1.0, 1.0]);

let _fontReady       = false;
let _fontLoadStarted = false;
let _bannerCanvas    = null;

let _onDataReady = null;
export function setBannerDataReadyCallback(cb) { _onDataReady = cb; }

export function ensureBannerFont() {
  if (_fontReady || _fontLoadStarted) return _fontReady;
  _fontLoadStarted = true;
  if (typeof document === 'undefined' || !document.fonts) { _fontReady = true; return true; }
  document.fonts.load(`${BANNER_CHAR_PX}px ${BANNER_FONT_NAME}`)
    .then(faces => {
      _fontReady = faces.length > 0;
      if (!_fontReady) console.warn(`[normies] ${BANNER_FONT_NAME} did not load — falling back to system font`);
      if (_onDataReady) _onDataReady();
    })
    .catch(err => {
      console.warn(`[normies] ${BANNER_FONT_NAME} load error:`, err);
      _fontReady = true;
      if (_onDataReady) _onDataReady();
    });
  return false;
}

export function renderBannerTexture(gl, text) {
  if (!_bannerCanvas) _bannerCanvas = document.createElement('canvas');
  const c = _bannerCanvas;
  c.width  = BANNER_CANVAS_W;
  c.height = BANNER_CHAR_PX * text.length;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle    = 'white';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(BANNER_CHAR_PX * 0.78)}px ${BANNER_FONT_NAME}, monospace`;
  const cx = c.width / 2;
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur  = BANNER_GLOW_PX;
  for (let i = 0; i < text.length; i++) ctx.fillText(text[i], cx, i * BANNER_CHAR_PX + BANNER_CHAR_PX / 2);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  for (let i = 0; i < text.length; i++) ctx.fillText(text[i], cx, i * BANNER_CHAR_PX + BANNER_CHAR_PX / 2);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export function buildNormieTraitsBanner(plane, hilbert, gl, meshes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  if (!isNormieCube(motifIdx)) return [];
  const id = normieIdForCube(motifIdx);
  if (id === null || id === undefined) return [];
  ensureFetched(id);
  const data    = getNormieData(id);
  const rawHash = data?.traits?.raw;
  if (!rawHash) return [];
  if (!ensureBannerFont()) return [];

  const hex  = String(rawHash).startsWith('0x') ? String(rawHash).slice(2) : String(rawHash);
  const text = hex.toUpperCase();

  const base = motifIdx * 8;
  const mn = [ Infinity,  Infinity,  Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const v = hilbert.rawVertices[base + i];
    if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x;
    if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y;
    if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
  }
  const cubeCenter = [(mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5];
  const halfExtent = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5;

  const p    = plane.vertices.positions;
  const uVec = [p[1].x-p[0].x, p[1].y-p[0].y, p[1].z-p[0].z];
  const vVec = [p[3].x-p[0].x, p[3].y-p[0].y, p[3].z-p[0].z];
  let nx = uVec[1]*vVec[2] - uVec[2]*vVec[1];
  let ny = uVec[2]*vVec[0] - uVec[0]*vVec[2];
  let nz = uVec[0]*vVec[1] - uVec[1]*vVec[0];
  const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const pc = uvToWorld(0.5, 0.5, p);
  const toCenter = [cubeCenter[0]-pc[0], cubeCenter[1]-pc[1], cubeCenter[2]-pc[2]];
  if (nx*toCenter[0] + ny*toCenter[1] + nz*toCenter[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const depthDist = Math.max(1e-4, nx*toCenter[0] + ny*toCenter[1] + nz*toCenter[2] + halfExtent);

  const bannerWCells = 3;
  const seed  = (plane.id || 0) * 0.137 + 1.71;
  const uStart = Math.floor(hash1([seed, 11, 0]) * (40 - bannerWCells + 1));
  const vPos   = Math.floor(hash1([seed, 22, 0]) * 40);

  const nearLeft  = uvToWorld(uStart / 40, (vPos + 0.5) / 40, p);
  const nearRight = uvToWorld((uStart + bannerWCells) / 40, (vPos + 0.5) / 40, p);
  const farLeft   = [nearLeft[0]  + nx*depthDist, nearLeft[1]  + ny*depthDist, nearLeft[2]  + nz*depthDist];
  const farRight  = [nearRight[0] + nx*depthDist, nearRight[1] + ny*depthDist, nearRight[2] + nz*depthDist];

  const meshKey = `traits-banner-quad-${plane.id}`;
  const texKey  = `traits-banner-tex-${plane.id}`;
  if (meshes[meshKey] === undefined) {
    const positions = new Float32Array([
      nearLeft[0], nearLeft[1], nearLeft[2], nearRight[0], nearRight[1], nearRight[2],
      farRight[0], farRight[1], farRight[2], farLeft[0],   farLeft[1],   farLeft[2],
    ]);
    const uvs     = new Float32Array([0, 1,  1, 1,  1, 0,  0, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    meshes[meshKey] = createMeshGL(gl, { positions, uvs, indices });
    meshes[texKey]  = renderBannerTexture(gl, text);
  }

  const transform = mat4(); identity(transform);
  const tex = meshes[texKey];
  return [
    { mesh: meshKey, material: 'text-banner', transform, blend: 'additive',  uniforms: { uTint: WHITE_TINT, uAlpha: 0.70, uMode: 0 }, samplers: { uTextTex: tex } },
    { mesh: meshKey, material: 'text-banner', transform, blend: 'alpha', transparentLayer: 1, uniforms: { uTint: WHITE_TINT, uAlpha: 0.15, uMode: 1 }, samplers: { uTextTex: tex } },
  ];
}
