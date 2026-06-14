// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MerkleProof } from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";
import { CubeNFT } from "./CubeNFT.sol";

contract NormieGenesisMinter is Ownable {
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
    error InvalidSlot(uint32 slot);
    error InsufficientAllowlistNormies(address minter, uint256 requested, uint256 available);
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

    uint256[] private _publicNormies;

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
        if (phase == Phase.Public) return _mintPublic(minter, quantity);
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

        uint32 slot = uint32(mintedCount);
        if (slot >= totalSlots) revert InvalidSlot(slot);
        bytes32 seed = keccak256(abi.encode(publicSeed, minter, normieId, slot, mintPhase));
        mintedCount++;

        uint256 agentId = normieAgentId[normieId];
        cubeId = agentId == 0
            ? cubes.mintSnapshotNormieCubeFor(minter, normieId, slot, seed)
            : cubes.mintSnapshotNormieCubeForWithAgent(minter, normieId, slot, seed, agentId);
        emit GenesisCubeMinted(cubeId, minter, normieId, slot, mintPhase);
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
