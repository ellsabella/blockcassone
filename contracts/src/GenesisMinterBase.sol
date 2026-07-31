// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";
import { CubeNFT } from "./CubeNFT.sol";

// Source-agnostic genesis mint engine: Merkle-snapshot allowlist ("mint your
// tokens"), deterministic-random public pool, per-collection claim tracking, and
// one-per-street plot allocation. A subclass supplies the source collection by
// overriding `_mintSourceCube` (Normie = on-chain art; CC0 = external source
// + recorded tonal payload). Public API keeps the historical "normie" names —
// read them as "the source token" for any collection.
abstract contract GenesisMinterBase is Ownable {
    uint32 public constant DEFAULT_TOTAL_SLOTS = 4096;

    enum Phase {
        Closed,
        Allowlist,
        Public
    }

    error EmptySnapshot();
    error DuplicateNormie(uint256 normieId);
    error InvalidQuantity();
    error InvalidAgentBindingList();
    error InvalidSeaDrop(address seaDrop);
    error IncompletePublicFill(uint256 requested, uint256 available);
    error MintClosed();
    error NoPublicNormies();
    error NormieNotInSnapshot(uint256 normieId);
    error SnapshotAlreadyFinalized();
    error SnapshotNotFinalized();
    error UnauthorizedSeaDrop(address caller);

    event SnapshotNormiesAdded(address indexed wallet, uint256 count);
    event SnapshotAgentBindingUpdated(uint256 indexed normieId, uint256 agentId);
    event SnapshotFinalized(uint256 normieCount, uint32 totalSlots, bytes32 publicSeed);
    event PhaseUpdated(Phase oldPhase, Phase newPhase);
    event SeaDropUpdated(address indexed oldSeaDrop, address indexed newSeaDrop);
    event GenesisCubeMinted(
        uint256 indexed cubeId,
        address indexed minter,
        uint256 indexed normieId,
        uint32 slot,
        Phase phase
    );

    CubeNFT public immutable cubes;
    uint32 public immutable totalSlots;
    bytes32 public immutable publicSeed;

    Phase public phase;
    address public seaDrop;
    bool public finalized;
    uint256 public mintedCount;

    mapping(uint256 normieId => bool registered) public normieRegistered;
    mapping(uint256 normieId => bool claimed) public normieClaimed;
    mapping(uint256 normieId => uint256 indexPlusOne) public publicIndexPlusOne;
    mapping(uint256 normieId => uint256 agentId) public normieAgentId;
    // Per-wallet genesis mints — surfaced via CubeNFT.getMintStats for SeaDrop's
    // per-wallet limit enforcement.
    mapping(address wallet => uint256 minted) public walletGenesisMinted;

    uint256[] private _publicNormies;

    // ---- Plot allocation ----------------------------------------------------
    // Slots are no longer the global mint order. A new wallet anchors the lowest
    // street that has no mints yet (spreading wallets one-per-street across the
    // world); once every street has >= 1 mint we wrap and new wallets backfill the
    // lowest non-full street. Either way a wallet packs <= 3 plots per street and
    // spills forward to the next street, so its holdings stay a contiguous run and
    // a full street ends up shared by ~3 wallets. Maintained in O(1) via a seed
    // cursor (phase A) + a frontier (phase B / wrap) + a per-wallet pointer.
    uint32 public constant PLOTS_PER_STREET = 8;
    uint32 public constant MAX_PER_WALLET_PER_STREET = 5;

    uint32 public seedCursor; // lowest street that may still have zero mints (anchor phase)
    uint32 public frontierStreet; // lowest street not yet full (used once wrapped)
    mapping(uint32 street => uint8 filled) public streetFill;
    mapping(address wallet => uint32 streetPlusOne) public walletStreetPlusOne; // 0 = unset
    mapping(address wallet => uint8 count) public walletStreetCount; // on the wallet's current street

    constructor(CubeNFT cubes_, bytes32 publicSeed_, address initialOwner_)
        Ownable(initialOwner_)
    {
        cubes = cubes_;
        totalSlots = cubes_.totalSlots();
        publicSeed = publicSeed_;
    }

    /// @notice Add Normie token ids to the public draw pool. `wallet` is kept for the
    ///         event / call-site back-compat only — the pool is wallet-agnostic now (the
    ///         old per-wallet "mint your snapshot Normies" allowlist was replaced by GTD
    ///         reservations, see MultiSourceGenesisMinter.reserveSources).
    function addSnapshotNormies(address wallet, uint256[] calldata normieIds) external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        uint256 len = normieIds.length;
        if (len == 0) revert EmptySnapshot();

        for (uint256 i = 0; i < len; i++) {
            uint256 normieId = normieIds[i];
            if (normieRegistered[normieId]) revert DuplicateNormie(normieId);
            normieRegistered[normieId] = true;
            _publicNormies.push(normieId);
            publicIndexPlusOne[normieId] = _publicNormies.length;
        }

        emit SnapshotNormiesAdded(wallet, len);
    }

    function finalizeSnapshot() external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        if (_publicNormies.length == 0) revert EmptySnapshot();
        _beforeFinalize();
        finalized = true;
        emit SnapshotFinalized(_publicNormies.length, totalSlots, publicSeed);
    }

    function setSnapshotAgentBinding(uint256 normieId, uint256 agentId) external onlyOwner {
        if (!normieRegistered[normieId]) revert NormieNotInSnapshot(normieId);
        normieAgentId[normieId] = agentId;
        emit SnapshotAgentBindingUpdated(normieId, agentId);
    }

    function setSnapshotAgentBindings(uint256[] calldata normieIds, uint256[] calldata agentIds)
        external
        onlyOwner
    {
        if (normieIds.length != agentIds.length) revert InvalidAgentBindingList();
        for (uint256 i = 0; i < normieIds.length; i++) {
            if (!normieRegistered[normieIds[i]]) revert NormieNotInSnapshot(normieIds[i]);
            normieAgentId[normieIds[i]] = agentIds[i];
            emit SnapshotAgentBindingUpdated(normieIds[i], agentIds[i]);
        }
    }

    function setPhase(Phase newPhase) external onlyOwner {
        Phase oldPhase = phase;
        phase = newPhase;
        emit PhaseUpdated(oldPhase, newPhase);
    }

    function setSeaDrop(address newSeaDrop) external onlyOwner {
        if (newSeaDrop == address(0)) revert InvalidSeaDrop(newSeaDrop);
        address oldSeaDrop = seaDrop;
        seaDrop = newSeaDrop;
        emit SeaDropUpdated(oldSeaDrop, newSeaDrop);
    }

    function mintSeaDrop(address minter, uint256 quantity)
        external
        returns (uint256[] memory cubeIds)
    {
        if (msg.sender != seaDrop) revert UnauthorizedSeaDrop(msg.sender);

        // GTD reservations (the holder's chosen art) are assigned FIRST, in order, then
        // the rest of the quantity draws from the current phase's pool. A GTD holder's
        // SeaDrop allowance is their reserved count, so `fromPhase` is 0 for them; a
        // public buyer has no reservations, so `fromRes` is 0.
        uint256 resRem = _reservationsRemaining(minter);
        uint256 fromRes = resRem < quantity ? resRem : quantity;
        uint256 fromPhase = quantity - fromRes;

        if (fromPhase > 0) {
            if (phase == Phase.Public) {
                // All-or-nothing for the paid SeaDrop path. SeaDrop charges the buyer
                // for the FULL quantity up front, so a partial fill (pool drained, or
                // the supply cap can't cover it) must revert rather than mint fewer.
                uint256 available = _publicAvailable();
                uint256 capRemaining = mintedCount < totalSlots ? totalSlots - mintedCount : 0;
                if (capRemaining < available) available = capRemaining;
                if (available < fromPhase) revert IncompletePublicFill(fromPhase, available);
            } else {
                revert MintClosed();
            }
        }

        cubeIds = new uint256[](quantity);
        uint256 idx = 0;
        for (uint256 i = 0; i < fromRes; i++) {
            cubeIds[idx++] = _mintNextReservation(minter);
        }
        if (fromPhase > 0) {
            uint256[] memory rest = _mintPublic(minter, fromPhase);
            for (uint256 j = 0; j < rest.length; j++) cubeIds[idx++] = rest[j];
            if (idx < quantity) {
                assembly {
                    mstore(cubeIds, idx)
                } // best-effort public drain returned fewer; trim trailing zeros
            }
        }
        return cubeIds;
    }

    function mintPublic(uint256 quantity) external returns (uint256[] memory cubeIds) {
        return _mintPublic(msg.sender, quantity);
    }

    function mintPublicFor(address minter, uint256 quantity)
        external
        onlyOwner
        returns (uint256[] memory cubeIds)
    {
        return _mintPublic(minter, quantity);
    }

    function publicRemaining() external view returns (uint256) {
        return _publicNormies.length;
    }

    /// @dev Snapshot-pool size, for subclasses (avoids an external self-call).
    function _publicPoolLength() internal view returns (uint256) {
        return _publicNormies.length;
    }

    function publicNormieAt(uint256 index) public view returns (uint256) {
        return _publicNormies[index];
    }

    function _mintPublic(address minter, uint256 quantity)
        private
        returns (uint256[] memory cubeIds)
    {
        _requireMintOpen(quantity);

        cubeIds = new uint256[](quantity);
        uint256 mintedNow = 0;
        while (mintedNow < quantity && mintedCount < totalSlots) {
            (uint256 sourceId, uint8 collectionId, bool ok) = _selectPublicSource(minter, mintedNow);
            if (!ok) break;
            cubeIds[mintedNow++] = _consumeAndMint(minter, sourceId, collectionId, Phase.Public);
        }

        if (mintedNow == 0) revert NoPublicNormies();
        return _trim(cubeIds, mintedNow);
    }

    function _requireMintOpen(uint256 quantity) private view {
        if (!finalized) revert SnapshotNotFinalized();
        if (quantity == 0) revert InvalidQuantity();
        if (mintedCount >= totalSlots) revert MintClosed();
    }

    function _consumeAndMint(address minter, uint256 normieId, uint8 collectionId, Phase mintPhase)
        private
        returns (uint256 cubeId)
    {
        // Collection 0 is the allowlist / base-pool collection (Normie): its ids live
        // in `_publicNormies` and are claim-tracked here. Extra collections (the
        // multi-source engine's CC0 pools) manage their own pools inside the
        // `_selectPublicSource` override, so they skip the base-pool bookkeeping — that
        // also keeps `normieClaimed` from colliding across id-spaces.
        if (collectionId == 0) {
            normieClaimed[normieId] = true;
            _removeFromPublicPool(normieId);
        }
        return _mintAt(minter, collectionId, normieId, mintPhase);
    }

    /// @dev Count + place + mint one cube for an ALREADY-SELECTED source. Pool
    ///      bookkeeping (claim / pool removal) is the caller's job: the public draw
    ///      removes as it picks; a GTD reservation removed it at reserve time.
    function _mintAt(address minter, uint8 collectionId, uint256 sourceId, Phase mintPhase)
        private
        returns (uint256 cubeId)
    {
        _checkAndCountMint(collectionId, mintPhase);

        uint32 slot = _allocateSlot(minter);
        bytes32 seed = keccak256(abi.encode(publicSeed, minter, sourceId, slot, mintPhase));
        mintedCount++;
        walletGenesisMinted[minter]++;

        cubeId = _mintSourceCube(minter, collectionId, sourceId, slot, seed, normieAgentId[sourceId]);
        emit GenesisCubeMinted(cubeId, minter, sourceId, slot, mintPhase);
    }

    /// @dev Mint one GTD-reserved source (a holder's chosen art). The source was pulled
    ///      from its draw pool at reserve time, so this just marks a reserved Normie
    ///      claimed and places the cube. Reserved mints carry the Allowlist phase tag.
    function _mintReservedSource(address minter, uint8 collectionId, uint256 sourceId)
        internal
        returns (uint256 cubeId)
    {
        _requireMintOpen(1);
        if (collectionId == 0) normieClaimed[sourceId] = true;
        return _mintAt(minter, collectionId, sourceId, Phase.Allowlist);
    }

    /// @dev Exclude a reserved Normie from the public snapshot draw (no-op if unpooled).
    function _removeNormieFromPool(uint256 normieId) internal {
        _removeFromPublicPool(normieId);
    }

    /// @dev Return a released reservation's Normie to the public snapshot draw
    ///      (idempotent — no-op if already pooled). Mirrors addSnapshotNormies' push.
    function _addToPublicPool(uint256 normieId) internal {
        if (publicIndexPlusOne[normieId] != 0) return;
        _publicNormies.push(normieId);
        publicIndexPlusOne[normieId] = _publicNormies.length;
    }

    /// @dev GTD reservation seams. Default: no reservations (single-collection base).
    ///      The multi-source engine overrides these with its wallet→chosen-source map.
    function _reservationsRemaining(address) internal view virtual returns (uint256) {
        return 0;
    }

    function _mintNextReservation(address) internal virtual returns (uint256) {
        revert InvalidQuantity(); // unreachable: base exposes no reservations
    }

    /// @dev Mint one genesis cube for `minter` from `collectionId`'s source token
    ///      `sourceId` at `slot`/`seed`. Subclass supplies the collection: a Normie
    ///      collection mints on-chain art (agentId carries the awakening); a stored
    ///      collection reads + records its committed tonal payload.
    function _mintSourceCube(
        address minter,
        uint8 collectionId,
        uint256 sourceId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) internal virtual returns (uint256 cubeId);

    /// @dev Hooks for the multi-source engine (no-ops in the single-collection base):
    ///      per-collection cap accounting/enforcement, and a pre-finalize validation
    ///      point. Default behaviour is unchanged for Normie/single-source minters.
    function _checkAndCountMint(uint8 collectionId, Phase mintPhase) internal virtual { }

    function _beforeFinalize() internal virtual { }

    /// @dev One public-phase source pick. Default = the historical uniform pull from
    ///      the Normie snapshot pool (`_publicNormies`); the multi-source engine
    ///      overrides this to draw across several collections. Returns the source
    ///      token, its collection id, and whether a source was available.
    function _selectPublicSource(address minter, uint256 mintedNow)
        internal
        virtual
        returns (uint256 sourceId, uint8 collectionId, bool ok)
    {
        uint256 len = _publicNormies.length;
        if (len == 0) return (0, 0, false);
        uint256 index =
            uint256(keccak256(abi.encode(publicSeed, minter, mintedCount, mintedNow, len))) % len;
        return (_publicNormies[index], 0, true);
    }

    /// @dev Total public-phase sources still mintable. Default = the Normie pool size;
    ///      the multi-source engine sums each collection's remaining allocation.
    function _publicAvailable() internal view virtual returns (uint256) {
        return _publicNormies.length;
    }

    error NoVacantPlot(address wallet);

    /// @dev Places one plot for `wallet`. A new wallet anchors a fresh street (or
    ///      wraps to the frontier); an existing wallet continues its run, spilling
    ///      to the next street when it hits MAX_PER_WALLET_PER_STREET. Pointers only
    ///      move forward, so it stays O(1) amortized.
    function _allocateSlot(address wallet) private returns (uint32 slot) {
        uint32 totalStreets = (totalSlots + PLOTS_PER_STREET - 1) / PLOTS_PER_STREET; // ceil

        uint32 s;
        uint8 cnt;
        if (walletStreetPlusOne[wallet] == 0) {
            s = _newWalletHome(totalStreets); // fresh anchor, or wrapped frontier
        } else {
            s = walletStreetPlusOne[wallet] - 1;
            cnt = walletStreetCount[wallet];
            if (cnt >= MAX_PER_WALLET_PER_STREET) {
                s += 1; // wallet hit its per-street cap -> advance its run
                cnt = 0;
            }
        }
        // Skip any full streets in the run (filled by others while the wallet was away).
        while (s < totalStreets && streetFill[s] >= _streetCapacity(s)) {
            s += 1;
            cnt = 0;
        }
        if (s >= totalStreets) revert NoVacantPlot(wallet); // wallet capped on every remaining street

        uint8 fill = streetFill[s];
        slot = s * PLOTS_PER_STREET + fill;
        streetFill[s] = fill + 1;
        walletStreetPlusOne[wallet] = s + 1;
        walletStreetCount[wallet] = cnt + 1;

        // Keep the frontier (the wrap target) at the lowest non-full street.
        while (frontierStreet < totalStreets && streetFill[frontierStreet] >= _streetCapacity(frontierStreet)) {
            frontierStreet += 1;
        }
    }

    /// @dev Plots a street can hold: PLOTS_PER_STREET, except a final partial
    ///      street when totalSlots isn't a multiple of PLOTS_PER_STREET.
    function _streetCapacity(uint32 street) private view returns (uint8) {
        uint256 used = uint256(street) * PLOTS_PER_STREET;
        if (used >= totalSlots) return 0;
        uint256 remaining = totalSlots - used;
        return remaining >= PLOTS_PER_STREET ? uint8(PLOTS_PER_STREET) : uint8(remaining);
    }

    /// @dev Home street for a brand-new wallet: while any street has no mints,
    ///      anchor the lowest such street (spread); once all are seeded, wrap and
    ///      backfill from the lowest non-full street.
    function _newWalletHome(uint32 totalStreets) private returns (uint32) {
        while (seedCursor < totalStreets && streetFill[seedCursor] > 0) {
            seedCursor += 1;
        }
        if (seedCursor < totalStreets) return seedCursor; // a still-empty street to anchor
        return frontierStreet; // wrapped: every street has >= 1 mint
    }

    function _removeFromPublicPool(uint256 normieId) private {
        uint256 indexPlusOne = publicIndexPlusOne[normieId];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _publicNormies.length - 1;
        if (index != lastIndex) {
            uint256 lastNormieId = _publicNormies[lastIndex];
            _publicNormies[index] = lastNormieId;
            publicIndexPlusOne[lastNormieId] = indexPlusOne;
        }
        _publicNormies.pop();
        publicIndexPlusOne[normieId] = 0;
    }

    function _trim(uint256[] memory values, uint256 len)
        private
        pure
        returns (uint256[] memory trimmed)
    {
        if (values.length == len) return values;
        trimmed = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            trimmed[i] = values[i];
        }
    }
}
