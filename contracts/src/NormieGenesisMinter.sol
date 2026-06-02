// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {CubeNFT} from "./CubeNFT.sol";

contract NormieGenesisMinter is Ownable {
    uint32 public constant DEFAULT_TOTAL_SLOTS = 4096;

    enum Phase {
        Allowlist,
        Public
    }

    error EmptySnapshot();
    error DuplicateNormie(uint256 normieId);
    error InvalidQuantity();
    error InvalidSlot(uint32 slot);
    error MintClosed();
    error NoAllowlistNormies(address minter);
    error NoPublicNormies();
    error SnapshotAlreadyFinalized();
    error SnapshotNotFinalized();

    event SnapshotNormiesAdded(address indexed wallet, uint256 count);
    event SnapshotFinalized(uint256 normieCount, uint32 totalSlots, bytes32 publicSeed);
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

    bool public finalized;
    uint256 public mintedCount;

    mapping(address wallet => uint256[] normieIds) private _walletNormies;
    mapping(address wallet => uint256 cursor) public walletCursor;
    mapping(uint256 normieId => bool registered) public normieRegistered;
    mapping(uint256 normieId => bool claimed) public normieClaimed;
    mapping(uint256 normieId => uint256 indexPlusOne) public publicIndexPlusOne;

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

    function publicRemaining() external view returns (uint256) {
        return _publicNormies.length;
    }

    function publicNormieAt(uint256 index) external view returns (uint256) {
        return _publicNormies[index];
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

        while (mintedNow < quantity && cursor < rows.length) {
            uint256 normieId = rows[cursor++];
            if (normieClaimed[normieId]) continue;
            cubeIds[mintedNow++] = _consumeAndMint(minter, normieId, Phase.Allowlist);
        }

        walletCursor[minter] = cursor;
        if (mintedNow == 0) revert NoAllowlistNormies(minter);
        return _trim(cubeIds, mintedNow);
    }

    function _mintPublic(address minter, uint256 quantity)
        private
        returns (uint256[] memory cubeIds)
    {
        _requireMintOpen(quantity);

        cubeIds = new uint256[](quantity);
        uint256 mintedNow = 0;
        while (mintedNow < quantity && _publicNormies.length > 0 && mintedCount < totalSlots) {
            uint256 index = uint256(keccak256(abi.encode(
                publicSeed,
                minter,
                mintedCount,
                mintedNow,
                _publicNormies.length
            ))) % _publicNormies.length;
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

    function _consumeAndMint(address minter, uint256 normieId, Phase phase)
        private
        returns (uint256 cubeId)
    {
        normieClaimed[normieId] = true;
        _removeFromPublicPool(normieId);

        uint32 slot = uint32(mintedCount);
        if (slot >= totalSlots) revert InvalidSlot(slot);
        bytes32 seed = keccak256(abi.encode(publicSeed, minter, normieId, slot, phase));
        mintedCount++;

        cubeId = cubes.mintSnapshotNormieCubeFor(minter, normieId, slot, seed);
        emit GenesisCubeMinted(cubeId, minter, normieId, slot, phase);
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
        for (uint256 i = 0; i < len; i++) trimmed[i] = values[i];
    }
}
