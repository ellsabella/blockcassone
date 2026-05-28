// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

contract CubeNFT is ERC721, Ownable {
    uint8 public constant SOURCE_KIND_NORMIE = 1;
    uint8 public constant SOURCE_KIND_EXTERNAL_ERC721 = 2;

    struct CubeData {
        uint32 slot;
        uint8 sourceKind;
        uint8 rendererVersion;
        uint8 payloadVersion;
        uint64 mintedAt;
        uint256 sourceChainId;
        address sourceContract;
        uint256 sourceTokenId;
        bytes32 seed;
    }

    error InvalidNormieContract();
    error InvalidSourceContract();
    error InvalidSlot(uint32 slot);
    error SlotOccupied(uint32 slot, uint256 cubeId);
    error NotSourceOwner(address sourceContract, uint256 sourceTokenId, address expectedOwner);
    error NormieAlreadyCubed(uint256 normieId, uint256 cubeId);
    error SourceAlreadyCubed(bytes32 sourceKey, uint256 cubeId);
    error ExternalSourceIsNormie();
    error NonexistentCube(uint256 cubeId);

    event CubeMinted(
        uint256 indexed cubeId,
        address indexed minter,
        uint32 indexed slot,
        uint8 sourceKind,
        address sourceContract,
        uint256 sourceTokenId,
        bytes32 seed
    );

    address public immutable normieContract;
    uint32 public immutable totalSlots;

    uint256 private _nextCubeId = 1;

    mapping(uint256 cubeId => CubeData data) private _cubeData;
    mapping(uint32 slot => uint256 cubeId) public cubeForSlot;
    mapping(uint256 normieId => uint256 cubeId) public cubeForNormieId;
    mapping(bytes32 sourceKey => uint256 cubeId) public cubeForSourceKey;

    constructor(
        string memory name_,
        string memory symbol_,
        address normieContract_,
        uint32 totalSlots_,
        address initialOwner_
    ) ERC721(name_, symbol_) Ownable(initialOwner_) {
        if (normieContract_.code.length == 0) revert InvalidNormieContract();
        normieContract = normieContract_;
        totalSlots = totalSlots_;
    }

    function mintNormieCube(uint256 normieId, uint32 slot, bytes32 seed)
        external
        returns (uint256 cubeId)
    {
        uint256 existingCubeId = cubeForNormieId[normieId];
        if (existingCubeId != 0) revert NormieAlreadyCubed(normieId, existingCubeId);

        _requireSourceOwner(normieContract, normieId, msg.sender);

        bytes32 key = sourceKey(block.chainid, normieContract, normieId);
        cubeId = _mintCube(msg.sender, slot, SOURCE_KIND_NORMIE, normieContract, normieId, key, seed);
        cubeForNormieId[normieId] = cubeId;
    }

    function mintExternalERC721Cube(
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed
    ) external returns (uint256 cubeId) {
        if (sourceContract == normieContract) revert ExternalSourceIsNormie();
        if (sourceContract.code.length == 0) revert InvalidSourceContract();

        _requireSourceOwner(sourceContract, sourceTokenId, msg.sender);

        bytes32 key = sourceKey(block.chainid, sourceContract, sourceTokenId);
        cubeId = _mintCube(
            msg.sender,
            slot,
            SOURCE_KIND_EXTERNAL_ERC721,
            sourceContract,
            sourceTokenId,
            key,
            seed
        );
    }

    function cubeData(uint256 cubeId) external view returns (CubeData memory data) {
        if (_ownerOf(cubeId) == address(0)) revert NonexistentCube(cubeId);
        return _cubeData[cubeId];
    }

    function nextCubeId() external view returns (uint256) {
        return _nextCubeId;
    }

    function sourceKey(uint256 chainId, address sourceContract, uint256 sourceTokenId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(chainId, sourceContract, sourceTokenId));
    }

    function _mintCube(
        address to,
        uint32 slot,
        uint8 sourceKind,
        address sourceContract,
        uint256 sourceTokenId,
        bytes32 key,
        bytes32 seed
    ) private returns (uint256 cubeId) {
        if (slot >= totalSlots) revert InvalidSlot(slot);

        uint256 existingSlotCubeId = cubeForSlot[slot];
        if (existingSlotCubeId != 0) revert SlotOccupied(slot, existingSlotCubeId);

        uint256 existingSourceCubeId = cubeForSourceKey[key];
        if (existingSourceCubeId != 0) revert SourceAlreadyCubed(key, existingSourceCubeId);

        cubeId = _nextCubeId++;
        cubeForSlot[slot] = cubeId;
        cubeForSourceKey[key] = cubeId;
        _cubeData[cubeId] = CubeData({
            slot: slot,
            sourceKind: sourceKind,
            rendererVersion: 1,
            payloadVersion: 0,
            mintedAt: uint64(block.timestamp),
            sourceChainId: block.chainid,
            sourceContract: sourceContract,
            sourceTokenId: sourceTokenId,
            seed: seed
        });

        _safeMint(to, cubeId);

        emit CubeMinted(cubeId, to, slot, sourceKind, sourceContract, sourceTokenId, seed);
    }

    function _requireSourceOwner(address sourceContract, uint256 sourceTokenId, address expectedOwner)
        private
        view
    {
        address actualOwner = IERC721(sourceContract).ownerOf(sourceTokenId);
        if (actualOwner != expectedOwner) {
            revert NotSourceOwner(sourceContract, sourceTokenId, expectedOwner);
        }
    }
}
