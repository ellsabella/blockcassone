// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {NonNormieArt} from "./NonNormieArt.sol";
import {SSTORE2} from "./lib/SSTORE2.sol";

/// @dev Just the cube source facts the store needs to resolve source-keyed art.
interface ICubeSource {
    function cubeSource(uint256 cubeId) external view returns (address sourceContract, uint256 sourceTokenId);
}

/// @notice Flattened non-Normie (external / CC0) art. Each 400-byte 2-bit tonal payload
///         is stored as an SSTORE2 blob (contract runtime code, read via EXTCODECOPY) —
///         ~200 gas/byte to write vs ~20k/word for SSTORE.
///
///         Two storage tiers, resolved per cube in this order:
///           1. PER-CUBE override (`recordTonalBands2Bit`/`updateTonalBands2Bit`) — the
///              post-mint customize / re-base path; art specific to one cube.
///           2. SOURCE-KEYED pool (`recordSourcePayload`) — committed ONCE per source
///              token before a genesis drop; every genesis cube minted from that source
///              references the SAME blob, so the mint writes NO art (no per-cube copy).
contract NonNormieArtStore is Ownable {
    struct PayloadRecord {
        uint8 version;
        bytes32 payloadHash;
    }

    // A source-pool payload's location: which SSTORE2 blob and the [offset,+length)
    // slice within it (a batch packs ~60 payloads into one blob).
    struct SourceLoc {
        address blob;
        uint32 offset;
        uint32 length;
    }

    // EIP-170 caps runtime code at 24576 bytes; SSTORE2 blobs carry a 1-byte STOP
    // prefix, so a blob's data must be <= 24575. Cap a batch at 24000 (60 payloads).
    uint256 public constant MAX_BATCH_BLOB_BYTES = 24_000;

    error InvalidCubeId();
    error PayloadAlreadyRecorded(uint256 cubeId);
    error MissingPayload(uint256 cubeId);
    error NotAuthorizedRecorder(address caller);
    error EmptyPayload();
    error EmptyBatch();
    error PayloadListLengthMismatch();
    error BatchBlobTooLarge(uint256 totalBytes, uint256 maxBytes);
    error SourcePayloadAlreadyRecorded(address sourceContract, uint256 sourceTokenId);
    error OnlyCubesToken(address caller);

    event NonNormiePayloadRecorded(
        uint256 indexed cubeId,
        uint8 indexed version,
        bytes32 indexed payloadHash
    );
    event SourcePayloadRecorded(
        address indexed sourceContract,
        uint256 indexed sourceTokenId,
        bytes32 payloadHash
    );
    event AuthorizedRecorderUpdated(address indexed recorder, bool allowed);

    // Resolves a cube's source facts (contract + token id) for source-keyed lookups.
    ICubeSource public immutable cubes;

    mapping(uint256 cubeId => PayloadRecord record) public payloadRecordForCube;
    // Per-cube override blob (address(0) = none). Wins over the source-keyed pool.
    mapping(uint256 cubeId => address pointer) private _payloadPointer;
    // Source-keyed genesis pool: sourceKey(contract, tokenId) -> committed slice.
    mapping(bytes32 sourceKey => SourceLoc loc) private _sourceLoc;
    mapping(bytes32 sourceKey => bytes32 payloadHash) public sourcePayloadHash;
    // Contracts allowed to record besides the owner (customize controller, genesis minter).
    mapping(address recorder => bool allowed) public authorizedRecorder;

    constructor(address cubes_, address initialOwner_) Ownable(initialOwner_) {
        cubes = ICubeSource(cubes_);
    }

    modifier onlyRecorder() {
        if (msg.sender != owner() && !authorizedRecorder[msg.sender]) {
            revert NotAuthorizedRecorder(msg.sender);
        }
        _;
    }

    function setAuthorizedRecorder(address recorder, bool allowed) external onlyOwner {
        authorizedRecorder[recorder] = allowed;
        emit AuthorizedRecorderUpdated(recorder, allowed);
    }

    // ---- Per-cube payloads (post-mint customize / re-base) -------------------

    /// @notice Record a per-cube payload for a cube that has none yet.
    function recordTonalBands2Bit(uint256 cubeId, bytes calldata payload) external onlyRecorder {
        if (payloadRecordForCube[cubeId].payloadHash != bytes32(0)) {
            revert PayloadAlreadyRecorded(cubeId);
        }
        _storeTonalBands2Bit(cubeId, payload);
    }

    /// @notice Record or overwrite a cube's per-cube payload (re-base). Each write
    ///         deploys a fresh SSTORE2 blob and repoints; the previous blob is orphaned.
    function updateTonalBands2Bit(uint256 cubeId, bytes calldata payload) external onlyOwner {
        _storeTonalBands2Bit(cubeId, payload);
    }

    function _storeTonalBands2Bit(uint256 cubeId, bytes calldata payload) private {
        if (cubeId == 0) revert InvalidCubeId();

        bytes memory data = payload; // one calldata->memory copy for the lib + SSTORE2
        NonNormieArt.validateTonalBands2Bit(
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            data
        );

        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(data);
        payloadRecordForCube[cubeId] = PayloadRecord({
            version: NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            payloadHash: payloadHash
        });
        _payloadPointer[cubeId] = SSTORE2.write(data);

        emit NonNormiePayloadRecorded(
            cubeId,
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            payloadHash
        );
    }

    // ---- Source-keyed pool payloads (genesis, committed once, shared) --------

    function sourceKey(address sourceContract, uint256 sourceTokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(sourceContract, sourceTokenId));
    }

    /// @notice Commit one source token's tonal payload as its own SSTORE2 blob. Every
    ///         genesis cube later minted from (sourceContract, sourceTokenId) reads this
    ///         blob directly — the mint stores no art of its own.
    function recordSourcePayload(address sourceContract, uint256 sourceTokenId, bytes calldata payload)
        public
        onlyRecorder
    {
        if (payload.length == 0) revert EmptyPayload();
        bytes32 key = sourceKey(sourceContract, sourceTokenId);
        // Write-once: a genesis cube's art provenance must not be owner-mutable after
        // mint (audit M-1). A wrong payload is fixed by deploying a fresh store and
        // module-swapping it in — never by silently repointing a committed source.
        if (_sourceLoc[key].blob != address(0)) {
            revert SourcePayloadAlreadyRecorded(sourceContract, sourceTokenId);
        }
        bytes memory data = payload;
        NonNormieArt.validateTonalBands2Bit(NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, data);
        address blob = SSTORE2.write(data);
        _sourceLoc[key] = SourceLoc({blob: blob, offset: 0, length: uint32(payload.length)});
        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(data);
        sourcePayloadHash[key] = payloadHash;
        emit SourcePayloadRecorded(sourceContract, sourceTokenId, payloadHash);
    }

    /// @notice Batched commit: pack every payload into ONE SSTORE2 blob (up to
    ///         MAX_BATCH_BLOB_BYTES, ~60 payloads) and point each source token at its
    ///         slice — one `create` for the whole batch instead of one per token.
    function recordSourcePayloadBatch(
        address sourceContract,
        uint256[] calldata sourceTokenIds,
        bytes[] calldata payloads
    ) external onlyRecorder {
        uint256 n = sourceTokenIds.length;
        if (n != payloads.length) revert PayloadListLengthMismatch();
        if (n == 0) revert EmptyBatch();

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            if (payloads[i].length == 0) revert EmptyPayload();
            NonNormieArt.validateTonalBands2Bit(
                NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payloads[i]
            );
            total += payloads[i].length;
        }
        if (total > MAX_BATCH_BLOB_BYTES) revert BatchBlobTooLarge(total, MAX_BATCH_BLOB_BYTES);

        bytes memory blobData = new bytes(total);
        uint32[] memory offsets = new uint32[](n);
        uint256 cursor;
        for (uint256 i = 0; i < n; i++) {
            offsets[i] = uint32(cursor);
            bytes calldata p = payloads[i];
            uint256 len = p.length;
            assembly {
                calldatacopy(add(add(blobData, 0x20), cursor), p.offset, len)
            }
            cursor += len;
        }

        address blob = SSTORE2.write(blobData);
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = sourceKey(sourceContract, sourceTokenIds[i]);
            // Write-once (audit M-1) — checked in the write loop so an intra-batch
            // duplicate id reverts too.
            if (_sourceLoc[key].blob != address(0)) {
                revert SourcePayloadAlreadyRecorded(sourceContract, sourceTokenIds[i]);
            }
            _sourceLoc[key] =
                SourceLoc({blob: blob, offset: offsets[i], length: uint32(payloads[i].length)});
            bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(payloads[i]);
            sourcePayloadHash[key] = payloadHash;
            emit SourcePayloadRecorded(sourceContract, sourceTokenIds[i], payloadHash);
        }
    }

    /// @notice Clear a cube's per-cube payload override so the source-keyed pool art
    ///         shows through. Called by the TOKEN on a pool re-base (audit M-3: without
    ///         this, a previously-customized cube keeps rendering its old art while its
    ///         traits and the claim registry report the new pool source).
    function clearCubePayload(uint256 cubeId) external {
        if (msg.sender != address(cubes)) revert OnlyCubesToken(msg.sender);
        delete _payloadPointer[cubeId];
    }

    function hasSourcePayload(address sourceContract, uint256 sourceTokenId) external view returns (bool) {
        return _sourceLoc[sourceKey(sourceContract, sourceTokenId)].blob != address(0);
    }

    function sourcePayloadLength(address sourceContract, uint256 sourceTokenId) external view returns (uint256) {
        return _sourceLoc[sourceKey(sourceContract, sourceTokenId)].length;
    }

    /// @notice The committed pool payload for a source (contract, tokenId) — lets the client
    ///         preview an as-yet-unminted pool source (the "spin the wheel" re-base). Empty
    ///         bytes if the source has no committed payload.
    function sourcePayload(address sourceContract, uint256 sourceTokenId) external view returns (bytes memory) {
        SourceLoc memory loc = _sourceLoc[sourceKey(sourceContract, sourceTokenId)];
        if (loc.blob == address(0)) return "";
        return SSTORE2.read(loc.blob, loc.offset, loc.length);
    }

    // ---- Reads (per-cube override first, then the source-keyed pool) ---------

    function _resolveBytes(uint256 cubeId) private view returns (bytes memory data, bool found) {
        address cubePtr = _payloadPointer[cubeId];
        if (cubePtr != address(0)) return (SSTORE2.read(cubePtr), true);
        (address sourceContract, uint256 sourceTokenId) = cubes.cubeSource(cubeId);
        SourceLoc memory loc = _sourceLoc[sourceKey(sourceContract, sourceTokenId)];
        if (loc.blob != address(0)) return (SSTORE2.read(loc.blob, loc.offset, loc.length), true);
        return ("", false);
    }

    function payloadForCube(uint256 cubeId) external view returns (bytes memory) {
        (bytes memory data, bool found) = _resolveBytes(cubeId);
        if (!found) revert MissingPayload(cubeId);
        return data;
    }

    /// @notice The cube's art as the 1-bit (on/off) bitmap the renderers consume, or
    ///         empty bytes if no payload is resolvable (no revert, for renderers).
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory) {
        (bytes memory data, bool found) = _resolveBytes(cubeId);
        if (!found) return "";
        return NonNormieArt.toBinaryBitmap(data);
    }

    function tonalBandForCube(uint256 cubeId, uint16 row, uint16 col) external view returns (uint8) {
        (bytes memory data, bool found) = _resolveBytes(cubeId);
        if (!found) revert MissingPayload(cubeId);
        return NonNormieArt.tonalBandAt(data, row, col);
    }
}
