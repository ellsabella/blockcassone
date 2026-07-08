// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CubeNFT } from "./CubeNFT.sol";
import { GenesisMinterBase } from "./GenesisMinterBase.sol";
import { NonNormieArtStore } from "./NonNormieArtStore.sol";
import { NonNormieArt } from "./NonNormieArt.sol";

/// @notice Genesis mint across SEVERAL source collections in one drop, with a fixed
///         per-collection allocation of the total cube supply.
///
///         Collection 0 is always the LIVE collection (Normie): on-chain art, the
///         only collection with a holder allowlist ("mint your Normies"), drawing
///         from the inherited snapshot pool. Collections 1..N are STORED CC0
///         collections (Chain Runners, 1337 Skulls, Baby Pepes, Nouns, OnChainKevin):
///         off-chain art whose flattened 2-bit tonal payload is committed ONCE to the
///         shared art store (source-keyed) BEFORE finalize, so a genesis cube reads its
///         art directly by its source facts and the mint writes NO art of its own — no
///         placeholder, no per-cube duplicate.
///
///         The public phase is a single deterministic draw over the COMBINED remaining
///         allocation: a collection is picked weighted by how many of its cubes are
///         still unminted, then a token within it. Because the caps sum to the total
///         supply, a full sellout lands exactly on the configured allocation, and a
///         collection at its cap simply drops out of the draw. All snapshot / Merkle /
///         allowlist / plot logic is inherited from GenesisMinterBase; this contract
///         only adds the collection registry, the weighted draw, per-collection caps,
///         and the CC0 payload store.
contract MultiSourceGenesisMinter is GenesisMinterBase {
    uint8 public constant MODEL_LIVE = 0; // on-chain art (Normie)
    uint8 public constant MODEL_STORED = 1; // committed tonal payload (CC0)

    struct Collection {
        uint8 model;
        address contractAddr;
        uint32 cap;
        uint32 minted;
    }

    Collection[] private _collections;
    NonNormieArtStore public immutable artStore;

    // STORED collections' token pools (swap-and-pop as tokens are drawn). Collection 0
    // (LIVE/Normie) uses the inherited `_publicNormies` snapshot pool instead. Payloads
    // are NOT held here — they're committed once to the shared art store (source-keyed),
    // so a genesis cube reads its art directly and the mint writes none.
    mapping(uint8 collectionId => uint256[] tokenIds) private _pool;

    error NotStoredCollection(uint8 collectionId);
    error CapSumMismatch(uint256 sum, uint32 totalSlots);
    error CollectionListLengthMismatch();
    error CollectionCapReached(uint8 collectionId);
    error PoolSizeMismatch(uint8 collectionId, uint256 poolLength, uint32 cap);
    error MissingSourcePayload(uint256 tokenId);

    event CollectionRegistered(uint8 indexed collectionId, uint8 model, address contractAddr, uint32 cap);
    event SourcePoolExtended(uint8 indexed collectionId, uint256 count);

    /// @param normieCap allocation for collection 0 (Normie / live art).
    /// @param ccContracts the CC0 source collections (STORED), in allocation order.
    /// @param ccCaps each CC0 collection's cube allocation. normieCap + sum(ccCaps)
    ///        MUST equal the cube supply cap, so a sellout hits the allocation exactly.
    constructor(
        CubeNFT cubes_,
        bytes32 publicSeed_,
        address initialOwner_,
        NonNormieArtStore artStore_,
        uint32 normieCap,
        address[] memory ccContracts,
        uint32[] memory ccCaps
    ) GenesisMinterBase(cubes_, publicSeed_, initialOwner_) {
        artStore = artStore_;
        if (ccContracts.length != ccCaps.length) revert CollectionListLengthMismatch();

        _collections.push(
            Collection({ model: MODEL_LIVE, contractAddr: cubes_.normieContract(), cap: normieCap, minted: 0 })
        );
        emit CollectionRegistered(0, MODEL_LIVE, cubes_.normieContract(), normieCap);

        uint256 sum = normieCap;
        for (uint256 i = 0; i < ccContracts.length; i++) {
            _collections.push(
                Collection({ model: MODEL_STORED, contractAddr: ccContracts[i], cap: ccCaps[i], minted: 0 })
            );
            emit CollectionRegistered(uint8(i + 1), MODEL_STORED, ccContracts[i], ccCaps[i]);
            sum += ccCaps[i];
        }
        if (sum != totalSlots) revert CapSumMismatch(sum, totalSlots);
    }

    // ---- Pool + payload setup (owner, before finalize) ----------------------

    /// @notice Add source token ids to a STORED collection's draw pool. The pool must
    ///         end up exactly `cap` long (enforced at finalize) and every id needs a
    ///         committed payload before it can be minted.
    function addSourcePool(uint8 collectionId, uint256[] calldata tokenIds) external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        _requireStored(collectionId);
        uint256[] storage pool = _pool[collectionId];
        for (uint256 i = 0; i < tokenIds.length; i++) {
            pool.push(tokenIds[i]);
        }
        emit SourcePoolExtended(collectionId, tokenIds.length);
    }

    /// @notice Commit one STORED-collection token's flattened tonal payload to the
    ///         shared art store, keyed by (sourceContract, tokenId). The genesis cube
    ///         minted from it reads this blob directly, so the mint writes no art.
    function setSourcePayload(uint8 collectionId, uint256 tokenId, bytes calldata payload)
        public
        onlyOwner
    {
        _requireStored(collectionId);
        artStore.recordSourcePayload(_collections[collectionId].contractAddr, tokenId, payload);
    }

    /// @notice Batched commit for a STORED collection — one SSTORE2 blob for the batch.
    function setSourcePayloadBatch(
        uint8 collectionId,
        uint256[] calldata tokenIds,
        bytes[] calldata payloads
    ) external onlyOwner {
        _requireStored(collectionId);
        artStore.recordSourcePayloadBatch(_collections[collectionId].contractAddr, tokenIds, payloads);
    }

    // ---- Views --------------------------------------------------------------

    function collectionCount() external view returns (uint256) {
        return _collections.length;
    }

    function collectionAt(uint8 collectionId)
        external
        view
        returns (uint8 model, address contractAddr, uint32 cap, uint32 minted)
    {
        Collection storage col = _collections[collectionId];
        return (col.model, col.contractAddr, col.cap, col.minted);
    }

    function collectionMinted(uint8 collectionId) external view returns (uint32) {
        return _collections[collectionId].minted;
    }

    function poolRemaining(uint8 collectionId) external view returns (uint256) {
        return _collections[collectionId].model == MODEL_LIVE
            ? _publicPoolLength()
            : _pool[collectionId].length;
    }

    /// @notice Total cubes still mintable in the public phase across every collection
    ///         (each collection's remaining allocation, clamped by its pool).
    function totalPublicRemaining() external view returns (uint256) {
        return _publicAvailable();
    }

    function payloadLength(uint8 collectionId, uint256 tokenId) external view returns (uint256) {
        return artStore.sourcePayloadLength(_collections[collectionId].contractAddr, tokenId);
    }

    /// @notice Ops safety check to run (off-chain) BEFORE finalize for every STORED
    ///         collection: the first pool token with NO committed payload — which would
    ///         cause a MissingSourcePayload revert if drawn at mint — or (false, 0) if
    ///         all committed. `_beforeFinalize` only checks pool length == cap, so use
    ///         this to prove the pool is fully art-backed before opening the drop.
    function firstUncommittedPoolToken(uint8 collectionId)
        external
        view
        returns (bool found, uint256 tokenId)
    {
        _requireStored(collectionId);
        uint256[] storage pool = _pool[collectionId];
        address contractAddr = _collections[collectionId].contractAddr;
        for (uint256 i = 0; i < pool.length; i++) {
            if (!artStore.hasSourcePayload(contractAddr, pool[i])) return (true, pool[i]);
        }
        return (false, 0);
    }

    // ---- Engine hooks -------------------------------------------------------

    /// @dev Weighted draw across the combined remaining allocation: one random value
    ///      over `total`, walked through each collection's remaining band, selects the
    ///      collection AND the token position in a single roll. For collection 0 the
    ///      token is left in the inherited pool (the base removes it on consume); for a
    ///      STORED collection it is swap-popped here.
    function _selectPublicSource(address minter, uint256 mintedNow)
        internal
        override
        returns (uint256 sourceId, uint8 collectionId, bool ok)
    {
        uint256 total = _publicAvailable();
        if (total == 0) return (0, 0, false);

        uint256 r = uint256(keccak256(abi.encode(publicSeed, minter, mintedCount, mintedNow, total))) % total;
        uint8 n = uint8(_collections.length);
        for (uint8 c = 0; c < n; c++) {
            uint256 rem = _effectiveRemaining(c);
            if (r < rem) {
                if (_collections[c].model == MODEL_LIVE) {
                    // Collection 0 is the first band, so `r` is already its local index
                    // into the inherited `_publicNormies` pool.
                    return (publicNormieAt(r), c, true);
                }
                uint256[] storage pool = _pool[c];
                uint256 id = pool[r];
                uint256 last = pool.length - 1;
                if (r != last) pool[r] = pool[last];
                pool.pop();
                return (id, c, true);
            }
            r -= rem;
        }
        return (0, 0, false); // unreachable: r < total == sum of bands
    }

    function _publicAvailable() internal view override returns (uint256 total) {
        uint8 n = uint8(_collections.length);
        for (uint8 c = 0; c < n; c++) {
            total += _effectiveRemaining(c);
        }
    }

    /// @dev Count a mint against its collection and enforce the per-collection cap.
    ///      Public draws never over-fill (a capped collection drops out of the draw);
    ///      this also stops the Normie allowlist once collection 0 hits its allocation.
    function _checkAndCountMint(uint8 collectionId, Phase /*mintPhase*/ ) internal override {
        Collection storage col = _collections[collectionId];
        col.minted += 1;
        if (col.minted > col.cap) revert CollectionCapReached(collectionId);
    }

    function _beforeFinalize() internal view override {
        uint8 n = uint8(_collections.length);
        for (uint8 c = 0; c < n; c++) {
            if (_collections[c].model == MODEL_STORED && _pool[c].length != _collections[c].cap) {
                revert PoolSizeMismatch(c, _pool[c].length, _collections[c].cap);
            }
        }
    }

    function _mintSourceCube(
        address minter,
        uint8 collectionId,
        uint256 sourceId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) internal override returns (uint256 cubeId) {
        Collection storage col = _collections[collectionId];
        if (col.model == MODEL_LIVE) {
            return agentId == 0
                ? cubes.mintSnapshotNormieCubeFor(minter, sourceId, slot, seed)
                : cubes.mintSnapshotNormieCubeForWithAgent(minter, sourceId, slot, seed, agentId);
        }

        // Art is already committed to the store (source-keyed) before finalize — the
        // cube references it by its source facts, so the mint writes NO art (no
        // per-cube duplicate). Guard against a placeholder: the pool token must have a
        // committed payload.
        if (!artStore.hasSourcePayload(col.contractAddr, sourceId)) revert MissingSourcePayload(sourceId);

        cubeId = cubes.mintSnapshotExternalCubeFor(
            minter, col.contractAddr, sourceId, slot, seed, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT
        );
    }

    // ---- Internal helpers ---------------------------------------------------

    /// @dev A collection's mintable count right now: remaining allocation, clamped by
    ///      what its pool actually holds (Normie snapshot may exceed its cap; a STORED
    ///      pool equals its cap after finalize).
    function _effectiveRemaining(uint8 collectionId) internal view returns (uint256) {
        Collection storage col = _collections[collectionId];
        uint256 capRem = col.cap > col.minted ? col.cap - col.minted : 0;
        uint256 poolLen =
            col.model == MODEL_LIVE ? _publicPoolLength() : _pool[collectionId].length;
        return capRem < poolLen ? capRem : poolLen;
    }

    function _requireStored(uint8 collectionId) internal view {
        if (collectionId == 0 || collectionId >= _collections.length
                || _collections[collectionId].model != MODEL_STORED) {
            revert NotStoredCollection(collectionId);
        }
    }
}
