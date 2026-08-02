// Fold decoded logs into per-cube records. `WorldState` holds the running fold so
// it works for both a one-shot backfill and incremental live updates. The record
// shape mirrors viewer/chain-cubes.js `recordFromChain` so the viewer consumes
// the snapshot as a drop-in for loadChainMintRecords().
import { keccak256, encodeAbiParameters } from 'viem';
import { ZERO_ADDRESS } from './events.js';

// Total order across logs: block number, then log index within the block.
const order = (l) => Number(l.blockNumber) * 1e6 + Number(l.logIndex);
const byOrder = (a, b) => order(a) - order(b);
const lc = (s) => String(s || '').toLowerCase();

// Matches NonNormieArtStore.sourceKey = keccak256(abi.encode(contract, tokenId)).
const sourceKey = (contract, tokenId) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [contract, BigInt(tokenId)]));

export class WorldState {
  constructor() {
    this.ownerByToken = new Map(); // tokenId(str) -> owner (lowercased); 0x0 = burned
    this.records = new Map();      // cubeId(str) -> record (owner attached at snapshot time)
    this.tsByBlock = new Map();    // blockNumber(str) -> unix seconds
    this.payloadHashByCube = new Map();   // cubeId(str) -> per-cube override tonal hash (customize/re-base)
    this.payloadHashBySource = new Map(); // sourceKey -> source-keyed tonal hash (genesis CC0 pool)
    this.history = new Map();      // cubeId(str) -> ordered [entries] (mint | rebase | move)
  }

  // A cube's current tonal art hash: per-cube override first (customize/re-base), else
  // the source-keyed hash for its current (sourceContract, sourceTokenId) — mirrors
  // NonNormieArtStore.payloadForCube so genesis CC0 cubes (no per-cube event) resolve.
  payloadHashForRecord(r) {
    const perCube = this.payloadHashByCube.get(String(r.cubeId));
    if (perCube) return perCube;
    return this.payloadHashBySource.get(sourceKey(r.source.contract, r.source.tokenId)) || null;
  }

  _ts(l) {
    return this.tsByBlock.get(String(l.blockNumber)) ?? 0;
  }

  _pushHistory(id, entry) {
    if (!this.history.has(id)) this.history.set(id, []);
    this.history.get(id).push(entry);
  }

  setBlockTimestamps(tsByBlock) {
    for (const [bn, ts] of tsByBlock) this.tsByBlock.set(String(bn), ts);
  }

  // Apply a batch of logs. Safe for both the full-history backfill and later
  // incremental batches (later batches are later blocks, so last-write-wins on
  // owner/slot stays correct across calls).
  applyLogs({ minted = [], moved = [], customized = [], transfers = [], payloadRecorded = [], sourcePayloadRecorded = [] }) {
    for (const l of [...transfers].sort(byOrder)) {
      this.ownerByToken.set(String(l.args.tokenId), lc(l.args.to));
    }
    // Latest wins. Per-cube (customize/re-base) overrides; source-keyed (genesis pool).
    for (const l of [...payloadRecorded].sort(byOrder)) {
      this.payloadHashByCube.set(String(l.args.cubeId), String(l.args.payloadHash));
    }
    for (const l of [...sourcePayloadRecorded].sort(byOrder)) {
      this.payloadHashBySource.set(sourceKey(l.args.sourceContract, l.args.sourceTokenId), String(l.args.payloadHash));
    }
    for (const l of [...minted].sort(byOrder)) {
      const a = l.args;
      const id = String(a.cubeId);
      if (this.records.has(id)) continue; // mint fires once per cube
      const kindNum = Number(a.sourceKind); // 1=normie, 2=external, 3=merged street
      // Origin entry — the genesis source, permanent provenance.
      this._pushHistory(id, {
        t: 'mint',
        kind: kindNum === 1 ? 'normie' : (kindNum === 3 ? 'merged' : 'external'),
        contract: lc(a.sourceContract),
        tokenId: String(a.sourceTokenId),
        slot: Number(a.slot),
        block: Number(l.blockNumber),
        ts: this._ts(l),
        tx: l.transactionHash,
      });
      this.records.set(id, {
        cubeId: Number(a.cubeId),
        slot: Number(a.slot),
        wallet: lc(a.minter), // replaced with current owner in toSnapshot()
        sourceKind: kindNum === 1 ? 'normie' : 'external',
        sourceKindNumber: kindNum,
        source: {
          chain: '', chainId: 0, // filled from cfg in toSnapshot()
          contract: lc(a.sourceContract),
          tokenId: String(a.sourceTokenId),
        },
        cc0: null,
        agentic: Boolean(a.agentic),
        agentId: a.agentId && a.agentId !== 0n ? String(a.agentId) : '',
        seed: a.seed,
        art: null, // hydrated by the viewer for now; indexer art-cache = M4
        _chain: {
          rendererVersion: 1,
          payloadVersion: 1,
          mintedAt: this.tsByBlock.get(String(l.blockNumber)) ?? 0,
        },
      });
    }
    for (const l of [...moved].sort(byOrder)) {
      const r = this.records.get(String(l.args.cubeId));
      if (r) r.slot = Number(l.args.toSlot);
      this._pushHistory(String(l.args.cubeId), {
        t: 'move',
        fromSlot: Number(l.args.fromSlot),
        toSlot: Number(l.args.toSlot),
        block: Number(l.blockNumber),
        ts: this._ts(l),
        tx: l.transactionHash,
      });
    }
    // NOTE (v1 limitation): CubeCustomized doesn't emit sourceKind, so a re-base
    // that changes kind keeps the mint-time kind. Fold CubeCustomizedWithPayload
    // (payloadHash) when the art cache lands.
    for (const l of [...customized].sort(byOrder)) {
      const r = this.records.get(String(l.args.cubeId));
      if (r) {
        r.source.contract = lc(l.args.sourceContract);
        r.source.tokenId = String(l.args.sourceTokenId);
        r._chain.payloadVersion = Number(l.args.payloadVersion);
      }
      // Re-base entry — a new current source (art changed). The genesis origin stays
      // the first ('mint') entry, so the full trail is origin → each spin → current.
      this._pushHistory(String(l.args.cubeId), {
        t: 'rebase',
        contract: lc(l.args.sourceContract),
        tokenId: String(l.args.sourceTokenId),
        payloadVersion: Number(l.args.payloadVersion),
        block: Number(l.blockNumber),
        ts: this._ts(l),
        tx: l.transactionHash,
      });
    }
  }

  // Per-cube history file: only cubes that are still live (minted, not burned),
  // each entry ordered by block. Lean — one 'mint' entry for a never-re-based cube.
  toHistory(cfg) {
    const history = {};
    for (const [id, entries] of this.history) {
      const owner = this.ownerByToken.get(id);
      if (!owner || owner === ZERO_ADDRESS) continue; // burned / merged-away
      history[id] = [...entries].sort((a, b) => a.block - b.block);
    }
    return {
      generatedAt: new Date().toISOString(),
      chainId: cfg.chainId,
      cubeNft: lc(cfg.cubeNft),
      history,
    };
  }

  // Live cube count (minted, not burned).
  count() {
    let n = 0;
    for (const r of this.records.values()) {
      const owner = this.ownerByToken.get(String(r.cubeId));
      if (owner && owner !== ZERO_ADDRESS) n++;
    }
    return n;
  }

  toSnapshot(cfg) {
    const chain = cfg.chainId === 1 ? 'ethereum' : `chain-${cfg.chainId}`;
    const out = [];
    for (const r of this.records.values()) {
      const owner = this.ownerByToken.get(String(r.cubeId));
      if (!owner || owner === ZERO_ADDRESS) continue; // burned / never owned
      out.push({ ...r, wallet: owner, source: { ...r.source, chain, chainId: cfg.chainId } });
    }
    out.sort((a, b) => a.cubeId - b.cubeId);
    return {
      generatedAt: new Date().toISOString(),
      chainId: cfg.chainId,
      cubeNft: lc(cfg.cubeNft),
      count: out.length,
      records: out,
    };
  }
}

// One-shot convenience used by the backfill entry point.
export function assembleSnapshot({ cfg, minted, moved, customized, transfers, tsByBlock }) {
  const ws = new WorldState();
  ws.setBlockTimestamps(tsByBlock);
  ws.applyLogs({ minted, moved, customized, transfers });
  return ws.toSnapshot(cfg);
}
