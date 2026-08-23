// Thumbnail prerender — bake every minted cube's on-chain SVG to disk so the
// site serves thumbnails with ZERO live RPC. Incremental: only cubes without a
// baked file are rendered (art is immutable until customize/rebase opens;
// customized cubes get their file invalidated and re-rendered).
//
// The thumbnailSVG view call is HEAVY (seconds each) — dedicated client with a
// long timeout, small concurrency, and failures are per-cube non-fatal (the
// server falls back to a live render for any missing file).
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http } from 'viem';

const THUMB_SELECTOR = '0x1df76ecc'; // thumbnailSVG(uint256)
const pad32 = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

function decodeAbiString(ret) {
  const hex = String(ret || '').replace(/^0x/, '');
  if (hex.length < 128) return '';
  const len = parseInt(hex.slice(64, 128), 16);
  return Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8');
}

export async function prerenderThumbnails(cfg, records, customizedCubeIds = []) {
  if (!cfg.thumbnailRenderer) {
    console.log('[indexer] thumbs: no thumbnailRenderer in chain config — skipped');
    return;
  }
  mkdirSync(cfg.thumbsOut, { recursive: true });
  for (const id of customizedCubeIds) {
    try { unlinkSync(join(cfg.thumbsOut, `${id}.svg`)); } catch (_) {}
  }
  const todo = (records || []).filter(
    (r) => r.cubeId && !existsSync(join(cfg.thumbsOut, `${r.cubeId}.svg`))
  );
  if (!todo.length) { console.log('[indexer] thumbs: up to date'); return; }
  console.log(`[indexer] thumbs: rendering ${todo.length} cube(s)…`);

  const client = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 90_000 }) });
  let done = 0, failed = 0;
  const queue = [...todo];
  const CONCURRENCY = 2;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const r = queue.shift();
      try {
        const ret = await client.call({
          to: cfg.thumbnailRenderer,
          data: THUMB_SELECTOR + pad32(BigInt(r.cubeId).toString(16)),
        });
        const svg = decodeAbiString(ret?.data);
        if (svg) { writeFileSync(join(cfg.thumbsOut, `${r.cubeId}.svg`), svg); done++; }
        else failed++;
      } catch (_) { failed++; }
    }
  }));
  console.log(`[indexer] thumbs: +${done} baked, ${failed} failed → ${cfg.thumbsOut}`);
}
