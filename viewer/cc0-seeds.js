import { compactGrid } from './art-snapshot.js';
import { hashInt } from './tree-walker.js';

let registryCache = null;
let registryFetch = null;

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeProject(raw, index) {
  const contract = normalizeAddress(raw.contract || raw.address);
  const tokenCount = Math.max(0, Math.floor(Number(raw.tokenCount || raw.tokens || raw.supply || 0)));
  return {
    id: String(raw.id || raw.slug || raw.name || `cc0-${index}`).toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
    name: String(raw.name || raw.id || `CC0 Project ${index + 1}`),
    chainId: Number(raw.chainId || raw.chain || 1),
    chain: String(raw.chainName || raw.chainSlug || (Number(raw.chainId || 1) === 1 ? 'ethereum' : `chain-${raw.chainId}`)),
    contract,
    tokenCount,
    license: String(raw.license || 'CC0-1.0'),
    provenance: String(raw.provenance || raw.url || ''),
  };
}

function normalizeRegistry(raw) {
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.projects) ? raw.projects : []);
  return rows
    .map(normalizeProject)
    .filter(project => project.contract && project.tokenCount > 0)
    .sort((a, b) => {
      if (a.chainId !== b.chainId) return a.chainId - b.chainId;
      if (a.contract !== b.contract) return a.contract < b.contract ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function loadCC0Projects() {
  if (registryCache) return registryCache;
  if (!registryFetch) {
    registryFetch = fetch('/data/cc0-projects.json')
      .then(res => res.ok ? res.json() : null)
      .then(raw => normalizeRegistry(raw || {}))
      .catch(() => []);
  }
  registryCache = await registryFetch;
  return registryCache;
}

function hashString(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function seedGrid(project, tokenId) {
  const size = 40;
  const len = size * size;
  const bits = new Uint8Array(len);
  const grayscale = new Float32Array(len);
  const depthValues = new Float32Array(len);
  const seed = hashString(`${project.chainId}:${project.contract}:${tokenId}:${project.name}`);
  let ones = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const nx = (x - 19.5) / 19.5;
      const ny = (y - 19.5) / 19.5;
      const radial = Math.sqrt(nx * nx + ny * ny);
      const a = hashInt(seed ^ x, y, tokenId);
      const b = hashInt(seed + y * 17, x * 31, tokenId + 7);
      const wave = 0.5 + 0.5 * Math.sin((nx * (3 + (seed & 3)) + ny * (4 + ((seed >> 4) & 3))) * Math.PI + a * 2.8);
      const value = Math.max(0, Math.min(1, wave * 0.55 + b * 0.45 - radial * 0.22));
      grayscale[i] = value;
      depthValues[i] = Math.max(0, Math.min(1, value * 0.7 + radial * 0.25));
      bits[i] = value > 0.48 ? 1 : 0;
      ones += bits[i];
    }
  }

  return {
    discarded: false,
    kind: 'smooth',
    gridSize: size,
    depthLayers: 40,
    depthMode: 'grayscale',
    ones,
    bits,
    grayscale,
    intensity: grayscale,
    depthValues,
  };
}

export async function cc0SeedSourcesForWallet(walletAddress, count, startIndex, mintedSourceKeys = new Set()) {
  const projects = await loadCC0Projects();
  if (!projects.length || count <= 0) return [];
  const picked = [];
  const walletSeed = hashString(String(walletAddress || '').toLowerCase());
  let attempt = 0;
  while (picked.length < count && attempt < projects.length * 4096) {
    const pickIndex = startIndex + picked.length + attempt;
    const project = projects[Math.floor(hashInt(walletSeed, pickIndex, projects.length) * projects.length) % projects.length];
    const tokenId = Math.floor(hashInt(walletSeed ^ hashString(project.contract), pickIndex + 31, project.tokenCount) * project.tokenCount);
    const sourceKey = `cc0:${project.chainId}:${project.contract}:${tokenId}`;
    if (!mintedSourceKeys.has(sourceKey)) {
      const art = { v: 1, k: 'x', g: compactGrid(seedGrid(project, tokenId)) };
      picked.push({
        chain: project.chain,
        chainId: project.chainId,
        contract: project.contract,
        tokenId: String(tokenId),
        name: `${project.name} Seed #${tokenId}`,
        collection: project.name,
        imageUrl: '',
        animationUrl: '',
        unsupportedMedia: false,
        isNormie: false,
        isCC0Seed: true,
        cc0ProjectId: project.id,
        cc0ProjectName: project.name,
        cc0License: project.license,
        cc0Provenance: project.provenance,
        agentic: false,
        agentId: '',
        art,
        sourceKey,
      });
    }
    attempt++;
  }
  return picked;
}
