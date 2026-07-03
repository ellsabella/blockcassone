// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MerkleProof } from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";
import { CubeNFT } from "./CubeNFT.sol";

// Source-agnostic genesis mint engine: Merkle-snapshot allowlist ("mint your
// tokens"), deterministic-random public pool, per-collection claim tracking, and
// one-per-street plot allocation. A subclass supplies the source collection by
// overriding `_mintSourceCube` (Normie = on-chain art; Brainrot = external source
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
    error InvalidSnapshotProof(address wallet);
    error InsufficientAllowlistNormies(address minter, uint256 requested, uint256 available);
    error IncompletePublicFill(uint256 requested, uint256 available);
    error MintClosed();
    error NoAllowlistNormies(address minter);
    error NoPublicNormies();
    error NormieAlreadyClaimed(uint256 normieId);
    error NormieNotInSnapshot(uint256 normieId);
    error SnapshotAlreadyFinalized();
    error SnapshotNotFinalized();
    error UnauthorizedSeaDrop(address caller);

    event SnapshotNormiesAdded(address indexed wallet, uint256 count);
    event SnapshotAgentBindingUpdated(uint256 indexed normieId, uint256 agentId);
    event SnapshotFinalized(uint256 normieCount, uint32 totalSlots, bytes32 publicSeed);
    event SnapshotRootUpdated(bytes32 oldRoot, bytes32 newRoot);
    event AllowlistSelectionUpdated(address indexed wallet, uint256 count);
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
    bytes32 public snapshotRoot;
    bool public finalized;
    uint256 public mintedCount;

    mapping(address wallet => uint256[] normieIds) private _walletNormies;
    mapping(address wallet => uint256 cursor) public walletCursor;
    mapping(address wallet => uint256[] normieIds) private _selectedNormies;
    mapping(address wallet => uint256 cursor) public selectionCursor;
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
    uint32 public constant MAX_PER_WALLET_PER_STREET = 3;

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

    function addSnapshotNormies(address wallet, uint256[] calldata normieIds) external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        uint256 len = normieIds.length;
        if (len == 0) revert EmptySnapshot();

        uint256[] storage walletRows = _walletNormies[wallet];
        for (uint256 i = 0; i < len; i++) {
            uint256 normieId = normieIds[i];
            if (normieRegistered[normieId]) revert DuplicateNormie(normieId);
            normieRegistered[normieId] = true;
            walletRows.push(normieId);
            _publicNormies.push(normieId);
            publicIndexPlusOne[normieId] = _publicNormies.length;
        }

        emit SnapshotNormiesAdded(wallet, len);
    }

    function finalizeSnapshot() external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        if (_publicNormies.length == 0) revert EmptySnapshot();
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

    function setSnapshotRoot(bytes32 newRoot) external onlyOwner {
        if (finalized) revert SnapshotAlreadyFinalized();
        bytes32 oldRoot = snapshotRoot;
        snapshotRoot = newRoot;
        emit SnapshotRootUpdated(oldRoot, newRoot);
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
        if (phase == Phase.Allowlist) return _mintSelectedAllowlist(minter, quantity);
        if (phase == Phase.Public) {
            // All-or-nothing for the paid SeaDrop path. SeaDrop charges the buyer for
            // the FULL quantity up front, so a partial fill (pool drained, or the
            // supply cap can't cover it) must revert rather than silently mint fewer
            // than paid for. Direct mintPublic keeps its best-effort drain behavior.
            uint256 available = _publicNormies.length;
            uint256 capRemaining = mintedCount < totalSlots ? totalSlots - mintedCount : 0;
            if (capRemaining < available) available = capRemaining;
            if (available < quantity) revert IncompletePublicFill(quantity, available);
            return _mintPublic(minter, quantity);
        }
        revert MintClosed();
    }

    function selectAllowlistNormies(
        uint256[] calldata snapshotNormies,
        uint256[] calldata selectedNormies,
        bytes32[] calldata proof
    ) external {
        if (selectedNormies.length == 0) revert EmptySnapshot();
        if (!_validSnapshotProof(msg.sender, snapshotNormies, proof)) {
            revert InvalidSnapshotProof(msg.sender);
        }

        delete _selectedNormies[msg.sender];
        selectionCursor[msg.sender] = 0;

        for (uint256 i = 0; i < selectedNormies.length; i++) {
            uint256 normieId = selectedNormies[i];
            if (normieClaimed[normieId]) revert NormieAlreadyClaimed(normieId);
            if (!_contains(snapshotNormies, normieId)) revert NormieNotInSnapshot(normieId);
            _selectedNormies[msg.sender].push(normieId);
        }

        emit AllowlistSelectionUpdated(msg.sender, selectedNormies.length);
    }

    function mintAllowlist(uint256 quantity) external returns (uint256[] memory cubeIds) {
        return _mintAllowlist(msg.sender, quantity);
    }

    function mintAllowlistFor(address minter, uint256 quantity)
        external
        onlyOwner
        returns (uint256[] memory cubeIds)
    {
        return _mintAllowlist(minter, quantity);
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

    function walletNormieCount(address wallet) external view returns (uint256) {
        return _walletNormies[wallet].length;
    }

    function walletNormieAt(address wallet, uint256 index) external view returns (uint256) {
        return _walletNormies[wallet][index];
    }

    function selectedNormieCount(address wallet) external view returns (uint256) {
        return _selectedNormies[wallet].length;
    }

    function selectedNormieAt(address wallet, uint256 index) external view returns (uint256) {
        return _selectedNormies[wallet][index];
    }

    function publicRemaining() external view returns (uint256) {
        return _publicNormies.length;
    }

    function publicNormieAt(uint256 index) external view returns (uint256) {
        return _publicNormies[index];
    }

    function hashSnapshot(address wallet, uint256[] calldata normieIds)
        external
        pure
        returns (bytes32)
    {
        return _hashSnapshot(wallet, normieIds);
    }

    function _mintAllowlist(address minter, uint256 quantity)
        private
        returns (uint256[] memory cubeIds)
    {
        _requireMintOpen(quantity);

        cubeIds = new uint256[](quantity);
        uint256 mintedNow = 0;
        uint256[] storage rows = _walletNormies[minter];
        uint256 cursor = walletCursor[minter];
        uint256 available = _remainingUnclaimed(rows, cursor);
        if (available == 0) revert NoAllowlistNormies(minter);
        if (available < quantity) revert InsufficientAllowlistNormies(minter, quantity, available);

        while (mintedNow < quantity && cursor < rows.length) {
            uint256 normieId = rows[cursor++];
            if (normieClaimed[normieId]) continue;
            cubeIds[mintedNow++] = _consumeAndMint(minter, normieId, Phase.Allowlist);
        }

        walletCursor[minter] = cursor;
        return cubeIds;
    }

    function _mintSelectedAllowlist(address minter, uint256 quantity)
        private
        returns (uint256[] memory cubeIds)
    {
        _requireMintOpen(quantity);

        cubeIds = new uint256[](quantity);
        uint256 mintedNow = 0;
        uint256[] storage rows = _selectedNormies[minter];
        uint256 cursor = selectionCursor[minter];
        uint256 available = _remainingUnclaimed(rows, cursor);
        if (available == 0) revert NoAllowlistNormies(minter);
        if (available < quantity) revert InsufficientAllowlistNormies(minter, quantity, available);

        while (mintedNow < quantity && cursor < rows.length) {
            uint256 normieId = rows[cursor++];
            if (normieClaimed[normieId]) continue;
            cubeIds[mintedNow++] = _consumeAndMint(minter, normieId, Phase.Allowlist);
        }

        selectionCursor[minter] = cursor;
    }

    function _mintPublic(address minter, uint256 quantity)
        private
        returns (uint256[] memory cubeIds)
    {
        _requireMintOpen(quantity);

        cubeIds = new uint256[](quantity);
        uint256 mintedNow = 0;
        while (mintedNow < quantity && _publicNormies.length > 0 && mintedCount < totalSlots) {
            uint256 index = uint256(
                keccak256(
                    abi.encode(publicSeed, minter, mintedCount, mintedNow, _publicNormies.length)
                )
            ) % _publicNormies.length;
            uint256 normieId = _publicNormies[index];
            cubeIds[mintedNow++] = _consumeAndMint(minter, normieId, Phase.Public);
        }

        if (mintedNow == 0) revert NoPublicNormies();
        return _trim(cubeIds, mintedNow);
    }

    function _requireMintOpen(uint256 quantity) private view {
        if (!finalized) revert SnapshotNotFinalized();
        if (quantity == 0) revert InvalidQuantity();
        if (mintedCount >= totalSlots) revert MintClosed();
    }

    function _consumeAndMint(address minter, uint256 normieId, Phase mintPhase)
        private
        returns (uint256 cubeId)
    {
        normieClaimed[normieId] = true;
        _removeFromPublicPool(normieId);

        uint32 slot = _allocateSlot(minter);
        bytes32 seed = keccak256(abi.encode(publicSeed, minter, normieId, slot, mintPhase));
        mintedCount++;
        walletGenesisMinted[minter]++;

        cubeId = _mintSourceCube(minter, normieId, slot, seed, normieAgentId[normieId]);
        emit GenesisCubeMinted(cubeId, minter, normieId, slot, mintPhase);
    }

    /// @dev Mint one genesis cube for `minter` from source token `sourceId` at
    ///      `slot`/`seed`. Subclass supplies the collection: Normie art is on-chain
    ///      (agentId carries the awakening), Brainrot records a tonal payload.
    function _mintSourceCube(
        address minter,
        uint256 sourceId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) internal virtual returns (uint256 cubeId);

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

    function _validSnapshotProof(
        address wallet,
        uint256[] calldata normieIds,
        bytes32[] calldata proof
    ) private view returns (bool) {
        if (snapshotRoot == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, snapshotRoot, _hashSnapshot(wallet, normieIds));
    }

    function _hashSnapshot(address wallet, uint256[] calldata normieIds)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(wallet, keccak256(abi.encode(normieIds))));
    }

    function _contains(uint256[] calldata values, uint256 needle) private pure returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == needle) return true;
        }
        return false;
    }

    function _remainingUnclaimed(uint256[] storage values, uint256 cursor)
        private
        view
        returns (uint256 remaining)
    {
        for (uint256 i = cursor; i < values.length; i++) {
            if (!normieClaimed[values[i]]) remaining++;
        }
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
