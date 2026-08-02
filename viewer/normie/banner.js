// Banner font loading + text-texture rendering, shared by the source-contract
// banner (buildNonNormieBanner). The old Normie traits-hash banner was removed —
// its data (traits.raw) came from the normies API and isn't in the self-contained
// path; every cube now shows its source contract instead.

const BANNER_CHAR_PX  = 64;
const BANNER_CANVAS_W = 96;
const BANNER_GLOW_PX  = BANNER_CHAR_PX * 0.10;
const BANNER_FONT_NAME = 'NormiesFont';

let _fontReady       = false;
let _fontLoadStarted = false;
let _bannerCanvas    = null;

let _onDataReady = null;
export function setBannerDataReadyCallback(cb) { _onDataReady = cb; }

export function ensureBannerFont() {
  if (_fontReady) return true;
  if (typeof document === 'undefined' || !document.fonts) { _fontReady = true; return true; }
  // Synchronous fast-path: if the (baked) font is already loaded, we're ready NOW.
  // This is what lets the one-shot on-chain animation draw banners — main() awaits
  // document.fonts.load first, then this returns true on the single render pass.
  if (document.fonts.check(`${BANNER_CHAR_PX}px ${BANNER_FONT_NAME}`)) { _fontReady = true; return true; }
  if (_fontLoadStarted) return false;
  _fontLoadStarted = true;
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
