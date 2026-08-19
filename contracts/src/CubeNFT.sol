// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ICubeRenderer} from "./interfaces/ICubeRenderer.sol";
import {CubeWorldLib} from "./lib/CubeWorldLib.sol";
import {
    INonFungibleSeaDropToken,
    ISeaDrop,
    PublicDrop,
    AllowListData,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "./interfaces/ISeaDrop.sol";

interface IAgentStatusRegistry {
    function currentAgentBinding(address sourceContract, uint256 sourceTokenId)
        external
        view
        returns (bool hasBinding, bool agentic, uint256 agentId, uint64 updatedAt);
}

// The genesis source-assignment controller (NormieGenesisMinter) the token routes
// SeaDrop mints to. Kept as an interface so the token has no compile dependency
// on the minter implementation.
interface INormieGenesisMinter {
    function mintSeaDrop(address minter, uint256 quantity) external returns (uint256[] memory);
    function mintedCount() external view returns (uint256);
    function walletGenesisMinted(address wallet) external view returns (uint256);
}

// The art store, for the pool-source re-base: a CC0 token is re-basable iff its
// flattened payload is committed source-keyed (genesis pool + reserve + released).
interface ICubeArtStore {
    function hasSourcePayload(address sourceContract, uint256 sourceTokenId) external view returns (bool);
    function clearCubePayload(uint256 cubeId) external;
}

contract CubeNFT is ERC721, Ownable, ReentrancyGuard, INonFungibleSeaDropToken {
    uint8 public constant SOURCE_KIND_NORMIE = 1;
    uint8 public constant SOURCE_KIND_EXTERNAL_ERC721 = 2;
    uint8 public constant SOURCE_KIND_MERGED_STREET = 3;
    uint8 internal constant PAYLOAD_VERSION_TONAL = 1; // CC0 2-bit tonal (matches NonNormieArt)

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
    error MovesDisabled();
    error NotCubeOwner(uint256 cubeId, address caller);
    error CannotMoveStreet(uint256 cubeId);
    error CannotDisplaceStreet(uint256 cubeId);
    error NotStreetMajority(uint32 slot, uint256 owned);
    error CustomizesDisabled();
    error OnlyCustomizer(address caller);
    error CannotCustomizeStreet(uint256 cubeId);
    error NotPoolSource(address sourceContract, uint256 sourceTokenId);
    error SourceAlreadyClaimed(address sourceContract, uint256 sourceTokenId, uint256 claimedByCubeId);
    error RendererNotSet();
    error OnlyOwnerOrGenesisMinter(address caller);
    error OnlyAllowedSeaDrop(address caller);
    error GenesisMinterNotSet();

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
    event CubeMoved(uint256 indexed cubeId, uint32 indexed fromSlot, uint32 indexed toSlot, address owner);
    event MovesEnabledUpdated(bool enabled);
    event CustomizesEnabledUpdated(bool enabled);
    event CustomizerUpdated(address indexed oldCustomizer, address indexed newCustomizer);
    event ArtStoreUpdated(address indexed oldArtStore, address indexed newArtStore);
    event CubeCustomized(
        uint256 indexed cubeId,
        address indexed sourceContract,
        uint256 sourceTokenId,
        uint8 payloadVersion
    );
    event GenesisMinterUpdated(address indexed oldMinter, address indexed newMinter);
    event AllowedSeaDropUpdated(address[] allowedSeaDrop);

    address public immutable normieContract;
    uint32 public immutable totalSlots;
    address public renderer;

    uint256 private _nextCubeId = 1;
    address public agentStatusRegistry;

    // Post-mint customize game (re-base a cube's source art). Independent of move/merge —
    // off at deploy, gates BOTH update paths (customizeCubeSource + rebaseToPoolSource).
    bool public customizesEnabled;

    // A move can target a VACANT slot, or an occupied slot in a street where the mover owns
    // at least this many of the 8 plots — a majority — which force-swaps the occupant out.
    uint256 public constant STREET_MOVE_MAJORITY = 5;

    // A street needs at least this many FILLED plots (all the caller's) to merge. You merge
    // WITH any vacant plots — you don't fill them — but you can't mint a street token from a
    // near-empty street. Rivals must be displaced out first (sole occupier required).
    uint256 public constant MERGE_MIN_FILLED = 5;

    // ---- World mechanics state (see FEES_AND_DISPLACEMENT_SPEC.md) -----------
    // Move/merge switches + fee/displacement economics, grouped so CubeWorldLib
    // (the external move/merge library) takes ONE storage pointer. The fields were
    // public variables before the extraction; the explicit getters below preserve
    // that ABI exactly.
    CubeWorldLib.WorldState private _world;

    function movesEnabled() external view returns (bool) { return _world.movesEnabled; }
    function mergesEnabled() external view returns (bool) { return _world.mergesEnabled; }
    function baseFee() external view returns (uint256) { return _world.baseFee; }
    function premiumPerPoint() external view returns (uint256) { return _world.premiumPerPoint; }
    function biomeWeight(uint256 biomeId) external view returns (uint256) { return _world.biomeWeight[biomeId]; }
    function displaceHouseCutBps() external view returns (uint16) { return _world.displaceHouseCutBps; }
    function displaceCooldown() external view returns (uint256) { return _world.displaceCooldown; }
    function houseBalance() external view returns (uint256) { return _world.houseBalance; }
    function owed(address account) external view returns (uint256) { return _world.owed[account]; }
    function lastDisplacedAt(address victim) external view returns (uint256) { return _world.lastDisplacedAt[victim]; }

    event MoveFeePaid(uint256 indexed cubeId, uint256 fee);
    event DisplacementPaid(uint256 indexed cubeId, address indexed victim, uint256 victimShare, uint256 houseShare);
    event MergeFeePaid(uint32 indexed street, uint256 emptyPlots, uint256 fee);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event OwedWithdrawn(address indexed to, uint256 amount);
    event FeeKnobUpdated(bytes32 indexed knob, uint256 value);

    error InsufficientFee(uint256 required, uint256 sent);
    error DisplaceCooldownActive(address victim, uint256 readyAt);
    error NothingOwed();
    error BadBiomeId(uint8 biomeId);
    error CutTooHigh(uint16 bps);
    error WithdrawFailed();

    // ERC-4906 metadata-update signals so marketplaces re-fetch after a slot/source change.
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    // Authorized to re-base a cube's displayed source (post-mint customization).
    // Set to the customization controller, which verifies cube ownership and a
    // flattening attestation before calling.
    address public customizer;
    address public artStore; // for pool-source re-base eligibility (hasSourcePayload)

    // ---- SeaDrop (OpenSea) genesis-mint integration -------------------------
    // This token is the SeaDrop-facing ERC-721: OpenSea's SeaDrop singleton calls
    // mintSeaDrop / getMintStats here, and mintSeaDrop routes the bespoke Normie
    // source assignment to `genesisMinter`. Minting authorization is decoupled from
    // Ownable so a human/admin can stay owner (to configure the drop on SeaDrop)
    // while the minter contract does the actual minting.
    address public genesisMinter;
    mapping(address seaDrop => bool allowed) public allowedSeaDrop;
    address[] private _allowedSeaDropList;

    mapping(uint256 cubeId => CubeData data) private _cubeData;
    mapping(uint32 slot => uint256 cubeId) public cubeForSlot;
    mapping(uint256 normieId => uint256 cubeId) public cubeForNormieId;
    // Genesis (origin) source, written once on a cube's first re-base (address(0) =
    // never re-based, origin == current). See cubeOrigin().
    mapping(uint256 cubeId => address originContract) private _cubeOriginContract;
    mapping(uint256 cubeId => uint256 originTokenId) private _cubeOriginTokenId;
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

        // Fee defaults (owner-tunable). Weights by biome id: desert 3, water 1, grass 1,
        // forest 1, mountain 8, ice 12. See FEES_AND_DISPLACEMENT_SPEC.md.
        _world.baseFee = 0.001 ether;
        _world.premiumPerPoint = 0.01 ether;
        _world.biomeWeight = [uint256(3), 1, 1, 1, 8, 12];
        _world.displaceHouseCutBps = 3333; // ~1/3
        _world.displaceCooldown = 15 minutes;
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

    // Genesis mints come from the source-assignment controller (`genesisMinter`),
    // or the owner in dev/tests; other mint variants stay owner-only.
    modifier onlyOwnerOrGenesisMinter() {
        if (msg.sender != owner() && msg.sender != genesisMinter) {
            revert OnlyOwnerOrGenesisMinter(msg.sender);
        }
        _;
    }

    function mintSnapshotNormieCubeFor(address minter, uint256 normieId, uint32 slot, bytes32 seed)
        external
        onlyOwnerOrGenesisMinter
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
    ) external onlyOwnerOrGenesisMinter returns (uint256 cubeId) {
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

    /// @notice Genesis mint of an external-source cube (e.g. a CC0 source). NO
    ///         source-ownership check — the committed genesis pool is the authority,
    ///         exactly like snapshot Normies. Callable by the genesis minter (or
    ///         owner). The tonal art payload is recorded separately by the minter
    ///         into the non-Normie art store. sourceKey dedup prevents double-cubing.
    function mintSnapshotExternalCubeFor(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed,
        uint8 payloadVersion
    ) external onlyOwnerOrGenesisMinter returns (uint256 cubeId) {
        if (sourceContract == normieContract) revert ExternalSourceIsNormie();
        if (sourceContract.code.length == 0) revert InvalidSourceContract();
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
            false,
            0
        ));
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
    error NotEnoughFilled(uint32 street, uint256 occupied);
    error NotStreetOwner(uint32 street, uint256 cubeId);
    error StreetAlreadyMerged(uint32 street);
    error InvalidLeader(uint32 street, uint256 cubeId);
    error MergesDisabled();

    event StreetMerged(
        uint256 indexed streetTokenId,
        address indexed owner,
        uint32 indexed street,
        uint8 occupiedCount
    );
    event MergesEnabledUpdated(bool enabled);

    /// @notice Owner switch that opens the merge game (off at deploy). Independent of moves.
    function setMergesEnabled(bool enabled) external onlyOwner {
        _world.mergesEnabled = enabled;
        emit MergesEnabledUpdated(enabled);
    }

    /// @notice Merge every occupied plot of `street` (all owned by the caller)
    ///         into one street token. The occupied plot cubes are burned and all
    ///         8 slots become owned by the new street token.
    /// @dev Reverts unless the caller solely owns every occupied plot. The leader
    ///      (street SVG) defaults to the lowest occupied plot. Irreversible in v1,
    ///      but plot CubeData is preserved so an un-merge could be added later.
    function mergeStreet(uint32 street) external payable nonReentrant returns (uint256 streetTokenId) {
        return _mergeStreet(street, 0);
    }

    /// @notice Merge `street`, using `leaderCubeId` (which must be an occupied plot
    ///         of the street, owned by the caller) as the leader whose art drives
    ///         the street token's SVG. The viewer lets the owner pick the lead.
    function mergeStreet(uint32 street, uint256 leaderCubeId)
        external
        payable
        nonReentrant
        returns (uint256 streetTokenId)
    {
        return _mergeStreet(street, leaderCubeId);
    }

    /// @dev Validation, fee, and world-state writes live in CubeWorldLib; the token
    ///      lifecycle (burn the plots, mint the street token) must stay here — OZ's
    ///      _burn/_safeMint aren't reachable from a library. Event order matches the
    ///      pre-extraction code: plot-burn Transfers, street-mint Transfer, then the
    ///      merge events, refund last.
    function _mergeStreet(uint32 street, uint256 requestedLeader)
        internal
        returns (uint256 streetTokenId)
    {
        streetTokenId = _nextCubeId++;
        (uint256[8] memory plots, uint8 occ, uint256 fee) = CubeWorldLib.mergeStreet(
            _world, _cubeData, _streetInfo, cubeForSlot, street, requestedLeader, streetTokenId, totalSlots
        );

        for (uint256 k = 0; k < 8; k++) {
            if (plots[k] != 0) _burn(plots[k]); // CubeData retained for rendering
        }

        _safeMint(msg.sender, streetTokenId);
        emit StreetMerged(streetTokenId, msg.sender, street, occ);
        emit MergeFeePaid(street, 8 - occ, fee);
        emit MetadataUpdate(streetTokenId);
        CubeWorldLib.refundExcess(_world, fee);
    }

    /// @notice CubeData for a (possibly burned) cube, with no ownership check.
    /// @dev For the renderer to read merged-street plot cubes after they're burned.
    function cubeDataUnchecked(uint256 cubeId) external view returns (CubeData memory) {
        return _cubeData[cubeId];
    }

    /// @notice A cube's source facts (contract + token id) — the minimal pair the art
    ///         store needs to resolve source-keyed genesis art. Revert-safe (returns
    ///         zeros for a nonexistent/burned cube).
    function cubeSource(uint256 cubeId) external view returns (address sourceContract, uint256 sourceTokenId) {
        CubeData storage d = _cubeData[cubeId];
        return (d.sourceContract, d.sourceTokenId);
    }

    /// @notice A cube's ORIGIN (genesis) source facts — permanent provenance. Set once,
    ///         lazily, on the cube's first re-base; before any re-base it equals the
    ///         current source, so this returns the genesis source for every cube.
    function cubeOrigin(uint256 cubeId) external view returns (address originContract, uint256 originTokenId) {
        address oc = _cubeOriginContract[cubeId];
        if (oc != address(0)) return (oc, _cubeOriginTokenId[cubeId]);
        CubeData storage d = _cubeData[cubeId];
        return (d.sourceContract, d.sourceTokenId);
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

    // ---- Move ----------------------------------------------------------------
    // The cube keeps its seed (its edge-point identity) but takes a new slot, so
    // its colour, geometry, street, and environment follow the destination.

    function setMovesEnabled(bool enabled) external onlyOwner {
        _world.movesEnabled = enabled;
        emit MovesEnabledUpdated(enabled);
    }

    /// @notice Move a cube you own to a VACANT slot (flat baseFee to the house), or
    ///         force-swap into an occupied slot in a street you dominate (you own
    ///         >= STREET_MOVE_MAJORITY of its 8 plots), paying the displaced owner. The
    ///         displaced cube takes the mover's old slot. Merged-street tokens are anchored —
    ///         they can neither be moved nor displaced. See FEES_AND_DISPLACEMENT_SPEC.md.
    /// @dev All logic in CubeWorldLib; `_ownerOf` is resolved here because the
    ///      library can't reach OZ internals (and public ownerOf reverts with the
    ///      wrong error for a nonexistent cube).
    function moveCube(uint256 cubeId, uint32 newSlot) external payable nonReentrant {
        CubeWorldLib.moveCube(_world, _cubeData, cubeForSlot, cubeId, newSlot, totalSlots, _ownerOf(cubeId));
    }

    // ---- Fee quotes, admin knobs, treasury -----------------------------------

    /// @notice What a moveCube(cubeId, newSlot) would cost right now, and how it splits.
    ///         victim == address(0) for a vacant move or a free self-swap.
    function quoteMove(uint256 cubeId, uint32 newSlot)
        external
        view
        returns (uint256 fee, address victim, uint256 victimShare, uint256 houseShare)
    {
        return CubeWorldLib.quoteMove(_world, _cubeData, cubeForSlot, cubeId, newSlot, _ownerOf(cubeId));
    }

    /// @notice What a mergeStreet(street) would cost right now, plus the vacant-plot count.
    function quoteMerge(uint32 street) external view returns (uint256 fee, uint256 emptyPlots) {
        return CubeWorldLib.quoteMerge(_world, cubeForSlot, street);
    }

    function setBaseFee(uint256 v) external onlyOwner {
        _world.baseFee = v;
        emit FeeKnobUpdated("baseFee", v);
    }

    function setPremiumPerPoint(uint256 v) external onlyOwner {
        _world.premiumPerPoint = v;
        emit FeeKnobUpdated("premiumPerPoint", v);
    }

    function setBiomeWeight(uint8 biomeId, uint256 weight) external onlyOwner {
        if (biomeId > 5) revert BadBiomeId(biomeId);
        _world.biomeWeight[biomeId] = weight;
        emit FeeKnobUpdated(bytes32(uint256(biomeId)), weight);
    }

    function setDisplaceHouseCutBps(uint16 bps) external onlyOwner {
        if (bps > 10000) revert CutTooHigh(bps);
        _world.displaceHouseCutBps = bps;
        emit FeeKnobUpdated("displaceHouseCutBps", bps);
    }

    function setDisplaceCooldown(uint256 secs) external onlyOwner {
        _world.displaceCooldown = secs;
        emit FeeKnobUpdated("displaceCooldown", secs);
    }

    /// @notice Sweep accrued house fees. Does NOT touch victim `owed` balances.
    function withdrawHouse(address to) external onlyOwner {
        uint256 amt = _world.houseBalance;
        _world.houseBalance = 0;
        (bool ok,) = payable(to).call{value: amt}("");
        if (!ok) revert WithdrawFailed();
        emit HouseWithdrawn(to, amt);
    }

    /// @notice Pull compensation credited when a direct displacement payout failed.
    function withdrawOwed() external nonReentrant {
        uint256 amt = _world.owed[msg.sender];
        if (amt == 0) revert NothingOwed();
        _world.owed[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amt}("");
        if (!ok) revert WithdrawFailed();
        emit OwedWithdrawn(msg.sender, amt);
    }

    // ---- Customization (post-mint re-base) -----------------------------------
    // The cube keeps its seed (identity) and slot (location/colour/geometry) but
    // adopts a new displayed source. Art payload + ownership/attestation checks
    // live in the customization controller; this only re-bases the source facts.

    function setCustomizer(address newCustomizer) external onlyOwner {
        emit CustomizerUpdated(customizer, newCustomizer);
        customizer = newCustomizer;
    }

    /// @notice Owner switch that opens the customize game (off at deploy). Independent of
    ///         move/merge; gates BOTH update paths (customizeCubeSource + rebaseToPoolSource).
    function setCustomizesEnabled(bool enabled) external onlyOwner {
        customizesEnabled = enabled;
        emit CustomizesEnabledUpdated(enabled);
    }

    // ---- Marketplace / drop-page metadata -------------------------------------
    // The read surface OpenSea's drop page + indexers expect from a SeaDrop token
    // (the ISeaDropTokenContractMetadata subset that applies to us): maxSupply,
    // contractURI (ERC-7572), and ERC-2981 royalties. SeaDrop itself never calls
    // these — payment/limit enforcement reads getMintStats — but without them the
    // hosted drop page can't show supply or royalties.

    string private _contractURIValue;
    address private _royaltyReceiver;
    uint96 private _royaltyBps; // basis points out of 10_000
    uint256 private _totalSupplyCount; // live token count (mints - burns)
    bytes32 private _provenanceHashValue;

    event ContractURIUpdated(string newContractURI); // ERC-7572
    event RoyaltyInfoUpdated(address receiver, uint256 bps);
    event ProvenanceHashUpdated(bytes32 previousHash, bytes32 newHash);

    error InvalidRoyaltyBps(uint256 bps);
    error ProvenanceHashFrozen();

    /// @notice Tokens currently in existence (mints minus burns — merge burns its
    ///         street's plot tokens). Indexers probe this on every ERC721A-style
    ///         drop token, so expose it even though OZ ERC721 doesn't.
    function totalSupply() external view returns (uint256) {
        return _totalSupplyCount;
    }

    /// @dev Maintain the live count on every mint/burn (OZ v5 transfer hook).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (from == address(0)) _totalSupplyCount++;
        if (to == address(0)) _totalSupplyCount--;
    }

    /// @notice Token art is fully on-chain (tokenURI builds data: URIs) — there is
    ///         no base URI. Exposed because SeaDrop tooling reads it.
    function baseURI() external pure returns (string memory) {
        return "";
    }

    function provenanceHash() external view returns (bytes32) {
        return _provenanceHashValue;
    }

    /// @notice SeaDrop convention: the provenance hash commits to the art/pool
    ///         ordering pre-drop and freezes once the first token exists.
    function setProvenanceHash(bytes32 newProvenanceHash) external onlyOwner {
        if (_nextCubeId != 1) revert ProvenanceHashFrozen();
        emit ProvenanceHashUpdated(_provenanceHashValue, newProvenanceHash);
        _provenanceHashValue = newProvenanceHash;
    }

    function royaltyAddress() external view returns (address) {
        return _royaltyReceiver;
    }

    function royaltyBasisPoints() external view returns (uint256) {
        return _royaltyBps;
    }

    /// @notice Genesis drop cap (the SeaDrop maxSupply). Post-mint external cubes
    ///         also live on this contract, so `totalSupply`-style counts can exceed
    ///         this; the DROP is bounded by it (see getMintStats).
    function maxSupply() external view returns (uint256) {
        return totalSlots;
    }

    function contractURI() external view returns (string memory) {
        return _contractURIValue;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURIValue = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    /// @notice ERC-2981 default royalty for every token.
    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidRoyaltyBps(bps);
        _royaltyReceiver = receiver;
        _royaltyBps = bps;
        emit RoyaltyInfoUpdated(receiver, bps);
    }

    /// @notice ERC-2981: royalty for a sale of any token at `salePrice`.
    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        return (_royaltyReceiver, (salePrice * _royaltyBps) / 10_000);
    }

    // ---- SeaDrop (OpenSea) genesis-mint integration --------------------------
    // The token is the SeaDrop-facing ERC-721. Deploy wiring: owner (admin) sets
    // `genesisMinter` + `updateAllowedSeaDrop([seaDrop])`, points the minter's
    // caller at this token, and configures the drop on SeaDrop via the forwarders
    // below. SeaDrop then drives mints through `mintSeaDrop` / `getMintStats`.

    function setGenesisMinter(address newMinter) external onlyOwner {
        emit GenesisMinterUpdated(genesisMinter, newMinter);
        genesisMinter = newMinter;
    }

    /// @inheritdoc INonFungibleSeaDropToken
    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop_) external onlyOwner {
        for (uint256 i = 0; i < _allowedSeaDropList.length; i++) {
            allowedSeaDrop[_allowedSeaDropList[i]] = false;
        }
        delete _allowedSeaDropList;
        for (uint256 i = 0; i < allowedSeaDrop_.length; i++) {
            allowedSeaDrop[allowedSeaDrop_[i]] = true;
            _allowedSeaDropList.push(allowedSeaDrop_[i]);
        }
        emit AllowedSeaDropUpdated(allowedSeaDrop_);
    }

    /// @inheritdoc INonFungibleSeaDropToken
    /// @dev SeaDrop handles payment / phase / limit validation, then calls this to
    ///      mint. Source assignment (which Normie each cube gets) is delegated to
    ///      the genesis minter, which mints back into this token as `genesisMinter`.
    function mintSeaDrop(address minter, uint256 quantity) external {
        if (!allowedSeaDrop[msg.sender]) revert OnlyAllowedSeaDrop(msg.sender);
        if (genesisMinter == address(0)) revert GenesisMinterNotSet();
        INormieGenesisMinter(genesisMinter).mintSeaDrop(minter, quantity);
    }

    /// @inheritdoc INonFungibleSeaDropToken
    /// @dev Stats describe the GENESIS drop (cap = totalSlots), not this token's
    ///      full supply (which also includes post-mint external cubes).
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply)
    {
        maxSupply = totalSlots;
        if (genesisMinter != address(0)) {
            INormieGenesisMinter gm = INormieGenesisMinter(genesisMinter);
            minterNumMinted = gm.walletGenesisMinted(minter);
            currentTotalSupply = gm.mintedCount();
        }
    }

    // ---- creator drop config: forward to the given (allowed) SeaDrop impl ----
    function _requireAllowedSeaDrop(address seaDropImpl) private view {
        if (!allowedSeaDrop[seaDropImpl]) revert OnlyAllowedSeaDrop(seaDropImpl);
    }

    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop)
        external
        onlyOwner
    {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updatePublicDrop(publicDrop);
    }

    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData)
        external
        onlyOwner
    {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateAllowList(allowListData);
    }

    function updateTokenGatedDrop(
        address seaDropImpl,
        address allowedNftToken,
        TokenGatedDropStage calldata dropStage
    ) external onlyOwner {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateTokenGatedDrop(allowedNftToken, dropStage);
    }

    function updateDropURI(address seaDropImpl, string calldata dropURI) external onlyOwner {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateDropURI(dropURI);
    }

    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress)
        external
        onlyOwner
    {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateCreatorPayoutAddress(payoutAddress);
    }

    function updateAllowedFeeRecipient(address seaDropImpl, address feeRecipient, bool allowed)
        external
        onlyOwner
    {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateAllowedFeeRecipient(feeRecipient, allowed);
    }

    function updateSignedMintValidationParams(
        address seaDropImpl,
        address signer,
        SignedMintValidationParams calldata signedMintValidationParams
    ) external onlyOwner {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateSignedMintValidationParams(signer, signedMintValidationParams);
    }

    function updatePayer(address seaDropImpl, address payer, bool allowed) external onlyOwner {
        _requireAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updatePayer(payer, allowed);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return interfaceId == type(INonFungibleSeaDropToken).interfaceId
            || interfaceId == bytes4(0x49064906) // ERC-4906 (MetadataUpdate)
            || interfaceId == bytes4(0x2a55205a) // ERC-2981 (royaltyInfo)
            || super.supportsInterface(interfaceId);
    }

    /// @notice Re-base a cube's displayed source. Sets it to an external source
    ///         with a recorded art payload (`payloadVersion`), preserving seed and
    ///         slot. Callable only by the customizer.
    function customizeCubeSource(
        uint256 cubeId,
        address sourceContract,
        uint256 sourceTokenId,
        uint8 payloadVersion
    ) external {
        if (!customizesEnabled) revert CustomizesDisabled();
        if (msg.sender != customizer) revert OnlyCustomizer(msg.sender);
        if (_ownerOf(cubeId) == address(0)) revert NonexistentCube(cubeId);

        CubeData storage data = _cubeData[cubeId];
        if (data.sourceKind == SOURCE_KIND_MERGED_STREET) revert CannotCustomizeStreet(cubeId);

        _captureOrigin(cubeId, data);
        _reassignSource(cubeId, data, sourceContract, sourceTokenId); // release old + claim new if pooled

        data.sourceKind = SOURCE_KIND_EXTERNAL_ERC721;
        data.sourceContract = sourceContract;
        data.sourceTokenId = sourceTokenId;
        data.payloadVersion = payloadVersion;

        emit CubeCustomized(cubeId, sourceContract, sourceTokenId, payloadVersion);
        emit MetadataUpdate(cubeId); // source art changed
    }

    /// @notice Attestation-free re-base to an UNUSED "pool" source — any Normie (live
    ///         art) or any CC0 token whose flattened payload is committed source-keyed
    ///         to the art store (genesis pool + reserve + released). Owner-gated;
    ///         enforces one-cube-per-pool-source via `cubeForSourceKey`. This is the
    ///         "spin the wheel" LOCK-IN: the client previews random unused sources
    ///         off-chain, then commits the chosen one here. No off-chain flatten /
    ///         attestation needed — the art already exists on-chain.
    function rebaseToPoolSource(uint256 cubeId, address sourceContract, uint256 sourceTokenId) external {
        if (!customizesEnabled) revert CustomizesDisabled();
        address owner = _ownerOf(cubeId);
        if (owner == address(0)) revert NonexistentCube(cubeId);
        if (owner != msg.sender) revert NotCubeOwner(cubeId, msg.sender);

        CubeData storage data = _cubeData[cubeId];
        if (data.sourceKind == SOURCE_KIND_MERGED_STREET) revert CannotCustomizeStreet(cubeId);
        if (!_isPooledSource(sourceContract, sourceTokenId)) {
            revert NotPoolSource(sourceContract, sourceTokenId);
        }

        _captureOrigin(cubeId, data);
        _reassignSource(cubeId, data, sourceContract, sourceTokenId); // claim requires unclaimed

        // A per-cube payload override (from an earlier attested customize) would shadow
        // the pool's source-keyed art forever — the cube would render its OLD art while
        // traits and the claim registry report the new source (audit M-3). Clear it so
        // the pool art shows through. (artStore is non-zero whenever a CC0 pool source
        // passed _isPooledSource; guarded for the Normie-rebase-with-unset-store edge.)
        if (artStore != address(0)) ICubeArtStore(artStore).clearCubePayload(cubeId);

        bool isNormie = sourceContract == normieContract;
        data.sourceKind = isNormie ? SOURCE_KIND_NORMIE : SOURCE_KIND_EXTERNAL_ERC721;
        data.sourceContract = sourceContract;
        data.sourceTokenId = sourceTokenId;
        data.payloadVersion = isNormie ? 0 : PAYLOAD_VERSION_TONAL; // Normie = live art

        emit CubeCustomized(cubeId, sourceContract, sourceTokenId, data.payloadVersion);
        emit MetadataUpdate(cubeId); // source art changed
    }

    // Capture the genesis origin once, on a cube's first re-base (see cubeOrigin()).
    function _captureOrigin(uint256 cubeId, CubeData storage data) private {
        if (_cubeOriginContract[cubeId] == address(0)) {
            _cubeOriginContract[cubeId] = data.sourceContract;
            _cubeOriginTokenId[cubeId] = data.sourceTokenId;
        }
    }

    // Maintain the source-claim registry across a re-base: RELEASE the cube's current
    // source, then (if the NEW source is a pool source) CLAIM it, requiring it be
    // unclaimed — the on-chain uniqueness guard behind "spin the wheel" (concurrent
    // lock-ins race; first wins, others revert). Non-pool wallet-art sources are left
    // untracked (dupes there are the owner's own choice).
    function _reassignSource(uint256 cubeId, CubeData storage data, address newContract, uint256 newTokenId)
        private
    {
        bytes32 oldKey = sourceKey(data.sourceChainId, data.sourceContract, data.sourceTokenId);
        if (cubeForSourceKey[oldKey] == cubeId) cubeForSourceKey[oldKey] = 0;
        if (_isPooledSource(newContract, newTokenId)) {
            bytes32 newKey = sourceKey(block.chainid, newContract, newTokenId);
            uint256 claimer = cubeForSourceKey[newKey];
            if (claimer != 0 && claimer != cubeId) {
                revert SourceAlreadyClaimed(newContract, newTokenId, claimer);
            }
            cubeForSourceKey[newKey] = cubeId;
        }
    }

    // A "pool" source has reusable on-chain art with no per-cube record: any Normie
    // (renderer reads its bitmap live) or a CC0 token with a committed source-keyed
    // payload in the art store.
    function _isPooledSource(address sourceContract, uint256 sourceTokenId) private view returns (bool) {
        if (sourceContract == normieContract) return true;
        if (artStore == address(0)) return false;
        return ICubeArtStore(artStore).hasSourcePayload(sourceContract, sourceTokenId);
    }

    function setArtStore(address newArtStore) external onlyOwner {
        address old = artStore;
        artStore = newArtStore;
        emit ArtStoreUpdated(old, newArtStore);
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
