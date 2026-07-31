// Assemble the CC0 aesthetic-proof comparison page from the flattened manifest +
// forge thumbnails + the production token-renderer bundle. Emits:
//   dev/cc0-proof/bundle.js         (copy of the on-chain animation bundle)
//   dev/cc0-proof/cube-<i>.html     (the real animation_url: config + bundle)
//   dev/cc0-proof/compare.html      (4-column side-by-side, open this in a browser)
import fs from 'node:fs/promises';

const HERE = new URL('./', import.meta.url);
const REPO = new URL('../../', import.meta.url);
const samples = JSON.parse(await fs.readFile(new URL('./out/manifest.json', HERE), 'utf8'));
const bundle = await fs.readFile(new URL('./dist/token-renderer/token-renderer.bundle.js', REPO), 'utf8');
await fs.writeFile(new URL('./bundle.js', HERE), bundle);
// Subset NormiesFont (16 hex glyphs, 604B) baked as a data-URI @font-face so the
// self-contained cube renders its contract/traits banner (mirrors the on-chain head).
const bannerFontB64 = (await fs.readFile(new URL('viewer/assets/NormiesFont-hex.woff2', REPO))).toString('base64');
const fontFace = `@font-face{font-family:'NormiesFont';src:url(data:font/woff2;base64,${bannerFontB64}) format('woff2');font-display:block}`;

const thumbs = [];
for (let i = 0; i < samples.length; i++) thumbs.push(await fs.readFile(new URL(`./data/cc0/thumb-${i}.svg`, REPO), 'utf8'));

// One self-contained cube page per sample == exactly what tokenURI's animation_url
// emits: the token config then the dependency-free WebGL bundle.
for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const tonalB64 = Buffer.from(s.payloadHex.replace(/^0x/, ''), 'hex').toString('base64');
  const cfg = { tokenId: i + 1, slot: s.slot, sourceTokenId: s.id, seed: s.seed, agentic: false, agentId: 0, raw: s.rawBase64, tonal: tonalB64, sourceContract: s.contract };
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFace}html,body{margin:0;height:100%;background:#020203;overflow:hidden}canvas{width:100vw;height:100vh;display:block}#h{position:fixed;left:8px;bottom:6px;color:#ff98d9;font:11px monospace;opacity:.75;text-shadow:0 0 8px #ff3ab8}</style></head><body><canvas id="c"></canvas><div id="h">${s.name}</div><script>window.BLOCKCASSONE_TOKEN=${JSON.stringify(cfg)};</script><script src="bundle.js"></script></body></html>`;
  await fs.writeFile(new URL(`./cube-${i}.html`, HERE), html);
}

const rows = samples.map((s, i) => `
  <div class="row">
    <div class="meta">
      <span class="tag ${s.kind}">${s.kind}</span>
      <b>#${s.id}</b>
      <span class="sub">${s.contractName}</span>
      <span class="sub">slot ${s.slot}</span>
      <span class="sub">${s.keyed ? 'bg-keyed' : 'otsu'}</span>
      <span class="sub">${s.lit}/1600 lit</span>
    </div>
    <div class="cells">
      <figure><div class="art src">${s.sourceSvg}</div><figcaption>source · on-chain 32×32</figcaption></figure>
      <figure><div class="art">${s.tonalSvg}</div><figcaption>flattened · 40×40 tonal (400 B)</figcaption></figure>
      <figure><div class="art"><img alt="tokenURI ${s.name}" src="data:image/svg+xml;base64,${Buffer.from(thumbs[i]).toString('base64')}"></div><figcaption>tokenURI image · on-chain SVG</figcaption></figure>
      <figure><div class="art cube" data-src="cube-${i}.html"><button>▶ render live cube</button></div><figcaption>animation_url · live WebGL</figcaption></figure>
    </div>
  </div>`).join('');

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blockcassone · CC0 flatten proof</title>
<style>
  :root{--bg:#050307;--panel:#0e0910;--ink:#f4dcea;--dim:#9c8494;--pink:#ff3ab8;--pinklt:#ff98d9;--line:#2a1622}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{padding:26px 30px 14px;border-bottom:1px solid var(--line)}
  h1{margin:0;font-size:20px;letter-spacing:.02em}
  h1 .rot{color:var(--pink);text-shadow:0 0 14px var(--pink)}
  .lede{margin:8px 0 0;color:var(--dim);max-width:80ch}
  .legend{margin:12px 0 0;color:var(--dim);font-size:12.5px}
  .legend b{color:var(--pinklt)}
  .head4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px;padding:14px 30px 0 calc(30px + 132px);color:var(--dim);font-size:11.5px;text-transform:uppercase;letter-spacing:.08em}
  .row{padding:16px 30px;border-bottom:1px solid var(--line);display:flex;gap:0;align-items:flex-start}
  .meta{width:132px;flex:0 0 132px;display:flex;flex-direction:column;gap:6px;padding-top:6px}
  .meta b{font-size:16px}
  .tag{display:inline-block;width:max-content;padding:2px 8px;border-radius:99px;font-size:11px;letter-spacing:.04em}
  .tag.runner{background:#12324a;color:#7fd2ff}
  .tag.skull{background:#3a1030;color:var(--pinklt)}
  .tag.noun{background:#3a2a10;color:#ffcf7f}
  .tag.pepe{background:#123a1c;color:#8dffb0}
  .tag.kevin{background:#2a1240;color:#c79dff}
  .sub{color:var(--dim);font-size:11.5px}
  .cells{flex:1;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px}
  figure{margin:0;display:flex;flex-direction:column;gap:6px}
  .art{position:relative;aspect-ratio:1;background:#161016;border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .art.src{background:repeating-conic-gradient(#1a1420 0% 25%,#120d16 0% 50%) 50%/16px 16px}
  .art svg,.art img{width:100%;height:100%;display:block}
  figcaption{color:var(--dim);font-size:11px;text-align:center}
  .cube{cursor:pointer}
  .cube button{background:#1b0f19;color:var(--pinklt);border:1px solid var(--pink);border-radius:6px;padding:8px 12px;font:12px ui-monospace,monospace;cursor:pointer}
  .cube button:hover{background:var(--pink);color:#0a0208}
  .cube iframe{width:100%;height:100%;border:0;display:block}
  footer{padding:20px 30px 60px;color:var(--dim);font-size:12px}
</style></head>
<body>
<header>
  <h1>Blockcassone · CC0 flatten proof — Runners · Skulls · Nouns · Pepes · <span class="rot">Kevin</span></h1>
  <p class="lede">Real on-chain source art from five fully-on-chain CC0 collections, read from the mainnet fork, flattened to the 400-byte 2-bit tonal payload with the repo's own banding, then rendered through <b>both</b> token surfaces. Nothing offchain: the cube is the exact dependency-free <code>animation_url</code> bundle, the thumbnail is <code>previewThumbnailSVG</code>.</p>
  <p class="legend">Columns → <b>source</b> (decoded 32×32) · <b>flattened</b> (40×40, 4 tonal bands) · <b>tokenURI thumbnail</b> (2-bit tonal, full frame/walkers/glass) · <b>animation_url cube</b> (live WebGL; currently reads the 1-bit silhouette, so it shows form not tonal shading). <b>bg-keyed</b> = clean background separated; <b>otsu</b> = luminance-banded fallback.</p>
</header>
<div class="head4"><span>source</span><span>flattened tonal</span><span>tokenURI image</span><span>animation_url cube</span></div>
${rows}
<footer>Generated by dev/cc0-proof (flatten.mjs → PreviewCC0.s.sol → build-page.mjs). Click a cube to render it live; drag to orbit.</footer>
<script>
  for (const cell of document.querySelectorAll('.cube')) {
    cell.querySelector('button')?.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = cell.dataset.src; f.setAttribute('loading','lazy'); f.allow='';
      cell.innerHTML=''; cell.appendChild(f);
    });
  }
</script>
</body></html>`;

await fs.writeFile(new URL('./compare.html', HERE), page);
console.log('wrote dev/cc0-proof/compare.html + cube-*.html + bundle.js');
