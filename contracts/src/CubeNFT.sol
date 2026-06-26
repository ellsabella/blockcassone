// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {ICubeRenderer} from "./interfaces/ICubeRenderer.sol";

interface IAgentStatusRegistry {
    function currentAgentBinding(address sourceContract, uint256 sourceTokenId)
        external
        view
        returns (bool hasBinding, bool agentic, uint256 agentId, uint64 updatedAt);
}

contract CubeNFT is ERC721, Ownable {
    uint8 public constant SOURCE_KIND_NORMIE = 1;
    uint8 public constant SOURCE_KIND_EXTERNAL_ERC721 = 2;
    uint8 public constant SOURCE_KIND_MERGED_STREET = 3;

    struct CubeData {
        uint32 slot;
        uint8 sourceKind;
        uint8 rendererVersion;
        uint8 payloadVersion;
        bool agentic;
        uint256 agentId;
        uint64 mintedAt;
        uint256 sourceChainId;
        address sourceContract;
        uint256 sourceTokenId;
        bytes32 seed;
    }

    struct MintParams {
        address to;
        uint32 slot;
        uint8 sourceKind;
        address sourceContract;
        uint256 sourceTokenId;
        bytes32 sourceKey;
        bytes32 seed;
        uint8 payloadVersion;
        bool agentic;
        uint256 agentId;
    }

    error InvalidNormieContract();
    error InvalidSourceContract();
    error InvalidSlot(uint32 slot);
    error SlotOccupied(uint32 slot, uint256 cubeId);
    error NotSourceOwner(address sourceContract, uint256 sourceTokenId, address expectedOwner);
    error NormieAlreadyCubed(uint256 normieId, uint256 cubeId);
    error SourceAlreadyCubed(bytes32 sourceKey, uint256 cubeId);
    error ExternalSourceIsNormie();
    error InvalidAgentBinding(bool agentic, uint256 agentId);
    error NonexistentCube(uint256 cubeId);
    error RendererNotSet();

    event CubeMinted(
        uint256 indexed cubeId,
        address indexed minter,
        uint32 indexed slot,
        uint8 sourceKind,
        address sourceContract,
        uint256 sourceTokenId,
        bool agentic,
        uint256 agentId,
        bytes32 seed
    );
    event RendererUpdated(address indexed oldRenderer, address indexed newRenderer);
    event AgentStatusRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    address public immutable normieContract;
    uint32 public immutable totalSlots;
    address public renderer;

    uint256 private _nextCubeId = 1;
    address public agentStatusRegistry;

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
        cubeId = _mintNormieCubeFor(msg.sender, normieId, slot, seed);
    }

    function mintNormieCubeFor(address minter, uint256 normieId, uint32 slot, bytes32 seed)
        external
        onlyOwner
        returns (uint256 cubeId)
    {
        cubeId = _mintNormieCubeFor(minter, normieId, slot, seed);
    }

    function _mintNormieCubeFor(address minter, uint256 normieId, uint32 slot, bytes32 seed)
        private
        returns (uint256 cubeId)
    {
        uint256 existingCubeId = cubeForNormieId[normieId];
        if (existingCubeId != 0) revert NormieAlreadyCubed(normieId, existingCubeId);

        _requireSourceOwner(normieContract, normieId, minter);

        bytes32 key = sourceKey(block.chainid, normieContract, normieId);
        cubeId = _mintCube(_mintParams(
            minter,
            slot,
            SOURCE_KIND_NORMIE,
            normieContract,
            normieId,
            key,
            seed,
            0,
            false,
            0
        ));
        cubeForNormieId[normieId] = cubeId;
    }

    function mintNormieCubeForWithAgent(
        address minter,
        uint256 normieId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) external onlyOwner returns (uint256 cubeId) {
        uint256 existingCubeId = cubeForNormieId[normieId];
        if (existingCubeId != 0) revert NormieAlreadyCubed(normieId, existingCubeId);

        _requireSourceOwner(normieContract, normieId, minter);

        bytes32 key = sourceKey(block.chainid, normieContract, normieId);
        cubeId = _mintCube(_mintParams(
            minter,
            slot,
            SOURCE_KIND_NORMIE,
            normieContract,
            normieId,
            key,
            seed,
            0,
            true,
            agentId
        ));
        cubeForNormieId[normieId] = cubeId;
    }

    function mintSnapshotNormieCubeFor(address minter, uint256 normieId, uint32 slot, bytes32 seed)
        external
        onlyOwner
        returns (uint256 cubeId)
    {
        uint256 existingCubeId = cubeForNormieId[normieId];
        if (existingCubeId != 0) revert NormieAlreadyCubed(normieId, existingCubeId);

        bytes32 key = sourceKey(block.chainid, normieContract, normieId);
        cubeId = _mintCube(_mintParams(
            minter,
            slot,
            SOURCE_KIND_NORMIE,
            normieContract,
            normieId,
            key,
            seed,
            0,
            false,
            0
        ));
        cubeForNormieId[normieId] = cubeId;
    }

    function mintSnapshotNormieCubeForWithAgent(
        address minter,
        uint256 normieId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) external onlyOwner returns (uint256 cubeId) {
        uint256 existingCubeId = cubeForNormieId[normieId];
        if (existingCubeId != 0) revert NormieAlreadyCubed(normieId, existingCubeId);

        bytes32 key = sourceKey(block.chainid, normieContract, normieId);
        cubeId = _mintCube(_mintParams(
            minter,
            slot,
            SOURCE_KIND_NORMIE,
            normieContract,
            normieId,
            key,
            seed,
            0,
            true,
            agentId
        ));
        cubeForNormieId[normieId] = cubeId;
    }

    function mintExternalERC721Cube(
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed
    ) external returns (uint256 cubeId) {
        cubeId = _mintExternalERC721CubeFor(
            msg.sender,
            sourceContract,
            sourceTokenId,
            slot,
            seed,
            0,
            false,
            0
        );
    }

    function mintExternalERC721CubeFor(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed
    ) external onlyOwner returns (uint256 cubeId) {
        cubeId = _mintExternalERC721CubeFor(
            minter,
            sourceContract,
            sourceTokenId,
            slot,
            seed,
            0,
            false,
            0
        );
    }

    function mintExternalERC721CubeForWithPayloadVersion(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed,
        uint8 payloadVersion
    ) external onlyOwner returns (uint256 cubeId) {
        cubeId = _mintExternalERC721CubeFor(
            minter,
            sourceContract,
            sourceTokenId,
            slot,
            seed,
            payloadVersion,
            false,
            0
        );
    }

    function mintExternalERC721CubeForWithPayloadVersionAndAgentic(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed,
        uint8 payloadVersion,
        bool agentic,
        uint256 agentId
    ) external onlyOwner returns (uint256 cubeId) {
        cubeId = _mintExternalERC721CubeFor(
            minter,
            sourceContract,
            sourceTokenId,
            slot,
            seed,
            payloadVersion,
            agentic,
            agentId
        );
    }

    function _mintExternalERC721CubeFor(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed,
        uint8 payloadVersion,
        bool agentic,
        uint256 agentId
    ) private returns (uint256 cubeId) {
        if (sourceContract == normieContract) revert ExternalSourceIsNormie();
        if (sourceContract.code.length == 0) revert InvalidSourceContract();

        _requireSourceOwner(sourceContract, sourceTokenId, minter);

        bytes32 key = sourceKey(block.chainid, sourceContract, sourceTokenId);
        cubeId = _mintCube(_mintParams(
            minter,
            slot,
            SOURCE_KIND_EXTERNAL_ERC721,
            sourceContract,
            sourceTokenId,
            key,
            seed,
            payloadVersion,
            agentic,
            agentId
        ));
    }

    function cubeData(uint256 cubeId) external view returns (CubeData memory data) {
        if (_ownerOf(cubeId) == address(0)) revert NonexistentCube(cubeId);
        return _cubeData[cubeId];
    }

    function resolvedCubeData(uint256 cubeId) external view returns (CubeData memory data) {
        if (_ownerOf(cubeId) == address(0)) revert NonexistentCube(cubeId);
        data = _cubeData[cubeId];
        (bool hasBinding, bool agentic, uint256 agentId,) =
            _currentAgentBinding(data.sourceContract, data.sourceTokenId);
        if (hasBinding) {
            data.agentic = agentic;
            data.agentId = agentId;
        }
    }

    // ---- Street merge (8 -> 1) ----------------------------------------------
    // A wallet that solely owns every occupied plot of a street can merge it into
    // a single "street" token. The plot cubes are burned, but their CubeData (and
    // the source/normie mappings) are retained so the street can still be rendered
    // and so the source assets stay "used". The street token locks all 8 slots.

    struct StreetInfo {
        uint32 street; // 0 .. (totalSlots / 8 - 1)
        uint8 occupiedCount; // population: occupied plots that were merged
        uint256[8] plotCubeIds; // original cubeId per plot (0 = vacant)
    }

    mapping(uint256 streetTokenId => StreetInfo) private _streetInfo;

    error EmptyStreet(uint32 street);
    error NotStreetOwner(uint32 street, uint256 cubeId);
    error StreetAlreadyMerged(uint32 street);

    event StreetMerged(
        uint256 indexed streetTokenId,
        address indexed owner,
        uint32 indexed street,
        uint8 occupiedCount
    );

    /// @notice Merge every occupied plot of `street` (all owned by the caller)
    ///         into one street token. The occupied plot cubes are burned and all
    ///         8 slots become owned by the new street token.
    /// @dev Reverts unless the caller solely owns every occupied plot. The leader
    ///      (street SVG) is the lowest occupied plot. Irreversible in v1, but plot
    ///      CubeData is preserved so an un-merge could be added later.
    function mergeStreet(uint32 street) external returns (uint256 streetTokenId) {
        uint256 base = uint256(street) * 8;
        if (base + 8 > totalSlots) revert InvalidSlot(uint32(base));

        uint256[8] memory plots;
        uint256 occ;
        uint256 leader;
        for (uint256 k = 0; k < 8; k++) {
            uint256 cid = cubeForSlot[uint32(base + k)];
            if (cid == 0) continue;
            if (_cubeData[cid].sourceKind == SOURCE_KIND_MERGED_STREET) {
                revert StreetAlreadyMerged(street);
            }
            if (ownerOf(cid) != msg.sender) revert NotStreetOwner(street, cid);
            plots[k] = cid;
            if (leader == 0) leader = cid; // lowest occupied plot leads
            occ++;
        }
        if (occ == 0) revert EmptyStreet(street);

        streetTokenId = _nextCubeId++;
        CubeData memory ld = _cubeData[leader];
        _cubeData[streetTokenId] = CubeData({
            slot: ld.slot, // leader's slot drives the street thumbnail (colour/geometry)
            sourceKind: SOURCE_KIND_MERGED_STREET,
            rendererVersion: ld.rendererVersion,
            payloadVersion: ld.payloadVersion,
            agentic: false,
            agentId: 0,
            mintedAt: uint64(block.timestamp),
            sourceChainId: block.chainid,
            sourceContract: ld.sourceContract,
            sourceTokenId: ld.sourceTokenId, // leader Normie -> street SVG thumbnail
            seed: ld.seed
        });

        StreetInfo storage si = _streetInfo[streetTokenId];
        si.street = street;
        si.occupiedCount = uint8(occ);
        for (uint256 k = 0; k < 8; k++) {
            si.plotCubeIds[k] = plots[k];
            if (plots[k] != 0) _burn(plots[k]); // CubeData retained for rendering
            cubeForSlot[uint32(base + k)] = streetTokenId; // street locks all 8 slots
        }

        _safeMint(msg.sender, streetTokenId);
        emit StreetMerged(streetTokenId, msg.sender, street, uint8(occ));
    }

    /// @notice CubeData for a (possibly burned) cube, with no ownership check.
    /// @dev For the renderer to read merged-street plot cubes after they're burned.
    function cubeDataUnchecked(uint256 cubeId) external view returns (CubeData memory) {
        return _cubeData[cubeId];
    }

    /// @notice The street index, population, and 8 plot cube ids (0 = vacant) of a
    ///         merged-street token.
    function streetPlots(uint256 streetTokenId)
        external
        view
        returns (uint32 street, uint8 occupiedCount, uint256[8] memory plotCubeIds)
    {
        StreetInfo storage si = _streetInfo[streetTokenId];
        return (si.street, si.occupiedCount, si.plotCubeIds);
    }

    function setRenderer(address newRenderer) external onlyOwner {
        address oldRenderer = renderer;
        renderer = newRenderer;
        emit RendererUpdated(oldRenderer, newRenderer);
    }

    function setAgentStatusRegistry(address newRegistry) external onlyOwner {
        address oldRegistry = agentStatusRegistry;
        agentStatusRegistry = newRegistry;
        emit AgentStatusRegistryUpdated(oldRegistry, newRegistry);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentCube(tokenId);
        if (renderer == address(0)) revert RendererNotSet();
        return ICubeRenderer(renderer).tokenURI(tokenId);
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

    function _mintParams(
        address to,
        uint32 slot,
        uint8 sourceKind,
        address sourceContract,
        uint256 sourceTokenId,
        bytes32 key,
        bytes32 seed,
        uint8 payloadVersion,
        bool agentic,
        uint256 agentId
    ) private pure returns (MintParams memory params) {
        params = MintParams({
            to: to,
            slot: slot,
            sourceKind: sourceKind,
            sourceContract: sourceContract,
            sourceTokenId: sourceTokenId,
            sourceKey: key,
            seed: seed,
            payloadVersion: payloadVersion,
            agentic: agentic,
            agentId: agentId
        });
    }

    function _mintCube(MintParams memory params) private returns (uint256 cubeId) {
        if (params.agentic == (params.agentId == 0)) {
            revert InvalidAgentBinding(params.agentic, params.agentId);
        }
        if (params.slot >= totalSlots) revert InvalidSlot(params.slot);

        uint256 existingSlotCubeId = cubeForSlot[params.slot];
        if (existingSlotCubeId != 0) revert SlotOccupied(params.slot, existingSlotCubeId);

        uint256 existingSourceCubeId = cubeForSourceKey[params.sourceKey];
        if (existingSourceCubeId != 0) {
            revert SourceAlreadyCubed(params.sourceKey, existingSourceCubeId);
        }

        cubeId = _nextCubeId++;
        cubeForSlot[params.slot] = cubeId;
        cubeForSourceKey[params.sourceKey] = cubeId;
        _cubeData[cubeId] = CubeData({
            slot: params.slot,
            sourceKind: params.sourceKind,
            rendererVersion: 1,
            payloadVersion: params.payloadVersion,
            agentic: params.agentic,
            agentId: params.agentId,
            mintedAt: uint64(block.timestamp),
            sourceChainId: block.chainid,
            sourceContract: params.sourceContract,
            sourceTokenId: params.sourceTokenId,
            seed: params.seed
        });

        _safeMint(params.to, cubeId);

        emit CubeMinted(
            cubeId,
            params.to,
            params.slot,
            params.sourceKind,
            params.sourceContract,
            params.sourceTokenId,
            params.agentic,
            params.agentId,
            params.seed
        );
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

    function _currentAgentBinding(address sourceContract, uint256 sourceTokenId)
        private
        view
        returns (bool hasBinding, bool agentic, uint256 agentId, uint64 updatedAt)
    {
        address registry = agentStatusRegistry;
        if (registry == address(0)) return (false, false, 0, 0);
        return IAgentStatusRegistry(registry).currentAgentBinding(sourceContract, sourceTokenId);
    }
}
