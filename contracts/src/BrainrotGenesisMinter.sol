// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CubeNFT } from "./CubeNFT.sol";
import { GenesisMinterBase } from "./GenesisMinterBase.sol";
import { NonNormieArtStore } from "./NonNormieArtStore.sol";
import { NonNormieArt } from "./NonNormieArt.sol";
import { SSTORE2 } from "./lib/SSTORE2.sol";

/// @notice Genesis mint for cubes sourced from a CC0 external collection (e.g.
///         BRAINROT). Unlike Normies, the source art is OFF-CHAIN, so — to honour
///         "no paid mint yields a placeholder" — the flattened 2-bit tonal payload
///         for every pool token must be committed on-chain (via `setBrainrotPayload`,
///         generated off-chain by `nft-art-grid`) BEFORE the snapshot is finalized.
///         At mint the payload is recorded into the shared non-Normie art store so
///         the cube renders immediately. All snapshot/allowlist/public/pool logic is
///         inherited from GenesisMinterBase; the "normie*" API names refer to the
///         source (BRAINROT) token ids here.
contract BrainrotGenesisMinter is GenesisMinterBase {
    address public immutable sourceCollection; // the CC0 ERC-721 (BRAINROT)
    NonNormieArtStore public immutable artStore;

    // EIP-170 caps contract runtime code at 24576 bytes; SSTORE2 blobs carry a
    // 1-byte STOP prefix, so a blob's data must be <= 24575. At 400 bytes/payload
    // that's ~61 payloads/blob; we cap a batch at 24000 (60 payloads) for headroom.
    uint256 public constant MAX_BATCH_BLOB_BYTES = 24_000;

    // A payload's on-chain location: which SSTORE2 blob holds it, and the byte
    // [offset, offset+length) slice within that blob. A single-payload commit gets
    // its own blob at offset 0; a batched commit packs up to ~60 payloads into ONE
    // blob (each token pointing at its slice), amortizing the ~32k per-contract
    // create cost across the whole batch. blob == address(0) => uncommitted.
    struct PayloadLoc {
        address blob;
        uint32 offset;
        uint32 length;
    }

    mapping(uint256 sourceId => PayloadLoc loc) public payloadLoc;

    error EmptyPayload(uint256 sourceId);
    error EmptyBatch();
    error MissingSourcePayload(uint256 sourceId);
    error PayloadListLengthMismatch();
    error BatchBlobTooLarge(uint256 totalBytes, uint256 maxBytes);

    event SourcePayloadCommitted(uint256 indexed sourceId, bytes32 payloadHash);
    event BatchPayloadsCommitted(address indexed blob, uint256 count, uint256 totalBytes);

    constructor(
        CubeNFT cubes_,
        bytes32 publicSeed_,
        address initialOwner_,
        address sourceCollection_,
        NonNormieArtStore artStore_
    ) GenesisMinterBase(cubes_, publicSeed_, initialOwner_) {
        sourceCollection = sourceCollection_;
        artStore = artStore_;
    }

    /// @notice Commit the flattened tonal payload for one source token as its own
    ///         SSTORE2 blob. Validated to the canonical 400-byte 2-bit format.
    function setBrainrotPayload(uint256 sourceId, bytes calldata payload) public onlyOwner {
        if (payload.length == 0) revert EmptyPayload(sourceId);
        NonNormieArt.validateTonalBands2Bit(NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payload);
        address blob = SSTORE2.write(payload);
        payloadLoc[sourceId] = PayloadLoc({ blob: blob, offset: 0, length: uint32(payload.length) });
        emit SourcePayloadCommitted(sourceId, NonNormieArt.hashTonalBands2Bit(payload));
    }

    /// @notice Commit many payloads, each in its OWN blob (one create per token).
    ///         Prefer `setBrainrotPayloadBatch` for large drops.
    function setBrainrotPayloads(uint256[] calldata sourceIds, bytes[] calldata payloads)
        external
        onlyOwner
    {
        if (sourceIds.length != payloads.length) revert PayloadListLengthMismatch();
        for (uint256 i = 0; i < sourceIds.length; i++) {
            setBrainrotPayload(sourceIds[i], payloads[i]);
        }
    }

    /// @notice Batched commit: pack every payload into a SINGLE SSTORE2 blob (up to
    ///         MAX_BATCH_BLOB_BYTES, ~60 payloads) and point each source token at its
    ///         slice. One `create` for the whole batch instead of one per token, so
    ///         committing an N-token pool costs O(N * 400 bytes) + one create rather
    ///         than N creates. Split a pool larger than one blob across several calls.
    function setBrainrotPayloadBatch(uint256[] calldata sourceIds, bytes[] calldata payloads)
        external
        onlyOwner
    {
        uint256 n = sourceIds.length;
        if (n != payloads.length) revert PayloadListLengthMismatch();
        if (n == 0) revert EmptyBatch();

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            if (payloads[i].length == 0) revert EmptyPayload(sourceIds[i]);
            NonNormieArt.validateTonalBands2Bit(
                NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payloads[i]
            );
            total += payloads[i].length;
        }
        if (total > MAX_BATCH_BLOB_BYTES) revert BatchBlobTooLarge(total, MAX_BATCH_BLOB_BYTES);

        // Concatenate all payloads into one buffer, capturing each token's offset.
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
            payloadLoc[sourceIds[i]] =
                PayloadLoc({ blob: blob, offset: offsets[i], length: uint32(payloads[i].length) });
            emit SourcePayloadCommitted(sourceIds[i], NonNormieArt.hashTonalBands2Bit(payloads[i]));
        }
        emit BatchPayloadsCommitted(blob, n, total);
    }

    function brainrotPayloadLength(uint256 sourceId) external view returns (uint256) {
        return payloadLoc[sourceId].length;
    }

    function _mintSourceCube(
        address minter,
        uint256 sourceId,
        uint32 slot,
        bytes32 seed,
        uint256 /*agentId*/
    ) internal override returns (uint256 cubeId) {
        PayloadLoc memory loc = payloadLoc[sourceId];
        if (loc.blob == address(0)) revert MissingSourcePayload(sourceId);
        bytes memory payload = SSTORE2.read(loc.blob, loc.offset, loc.length);

        cubeId = cubes.mintSnapshotExternalCubeFor(
            minter,
            sourceCollection,
            sourceId,
            slot,
            seed,
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT
        );
        artStore.recordTonalBands2Bit(cubeId, payload);
    }
}
