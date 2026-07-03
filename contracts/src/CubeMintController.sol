// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CubeNFT} from "./CubeNFT.sol";
import {FlatteningAttestation} from "./FlatteningAttestation.sol";
import {NonNormieArt} from "./NonNormieArt.sol";
import {NonNormieArtStore} from "./NonNormieArtStore.sol";

contract CubeMintController {
    error AttestationSourceMismatch();
    error AttestationMinterMismatch();
    error AttestationPayloadVersionMismatch(uint8 version);
    error PayloadHashMismatch(bytes32 expected, bytes32 actual);
    error CubeOwnerMismatch(uint256 cubeId, address caller);

    event NonNormieCubeMintedWithPayload(
        uint256 indexed cubeId,
        address indexed minter,
        address indexed sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bool agentic,
        uint256 agentId,
        bytes32 payloadHash
    );

    event CubeCustomizedWithPayload(
        uint256 indexed cubeId,
        address indexed owner,
        address indexed sourceContract,
        uint256 sourceTokenId,
        bytes32 payloadHash
    );

    CubeNFT public immutable cubes;
    NonNormieArtStore public immutable artStore;
    FlatteningAttestation public immutable attestationVerifier;

    constructor(
        CubeNFT cubes_,
        NonNormieArtStore artStore_,
        FlatteningAttestation attestationVerifier_
    ) {
        cubes = cubes_;
        artStore = artStore_;
        attestationVerifier = attestationVerifier_;
    }

    function mintExternalERC721CubeWithPayload(
        address sourceContract,
        uint256 sourceTokenId,
        uint32 slot,
        bytes32 seed,
        bytes calldata tonalBands2Bit,
        FlatteningAttestation.Attestation calldata attestation,
        bytes calldata signature
    ) external returns (uint256 cubeId) {
        if (attestation.minter != msg.sender) revert AttestationMinterMismatch();
        if (
            attestation.sourceContract != sourceContract
                || attestation.sourceTokenId != sourceTokenId
        ) {
            revert AttestationSourceMismatch();
        }
        if (attestation.payloadVersion != NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT) {
            revert AttestationPayloadVersionMismatch(attestation.payloadVersion);
        }

        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(tonalBands2Bit);
        if (attestation.payloadHash != payloadHash) {
            revert PayloadHashMismatch(attestation.payloadHash, payloadHash);
        }

        attestationVerifier.consumeAttestation(attestation, signature);
        cubeId = cubes.mintExternalERC721CubeForWithPayloadVersionAndAgentic(
            msg.sender,
            sourceContract,
            sourceTokenId,
            slot,
            seed,
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            attestation.agentic,
            attestation.agentId
        );
        artStore.recordTonalBands2Bit(cubeId, tonalBands2Bit);

        emit NonNormieCubeMintedWithPayload(
            cubeId,
            msg.sender,
            sourceContract,
            sourceTokenId,
            slot,
            attestation.agentic,
            attestation.agentId,
            payloadHash
        );
    }

    /// @notice Re-base a cube you own onto a new flattened artwork. The cube keeps
    ///         its seed and slot but adopts the new source (Normie number label,
    ///         frame, and glass detailing follow). Re-basable any number of times.
    function customizeCube(
        uint256 cubeId,
        address sourceContract,
        uint256 sourceTokenId,
        bytes calldata tonalBands2Bit,
        FlatteningAttestation.Attestation calldata attestation,
        bytes calldata signature
    ) external {
        if (cubes.ownerOf(cubeId) != msg.sender) revert CubeOwnerMismatch(cubeId, msg.sender);
        if (attestation.minter != msg.sender) revert AttestationMinterMismatch();
        if (
            attestation.sourceContract != sourceContract
                || attestation.sourceTokenId != sourceTokenId
        ) {
            revert AttestationSourceMismatch();
        }
        if (attestation.payloadVersion != NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT) {
            revert AttestationPayloadVersionMismatch(attestation.payloadVersion);
        }

        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(tonalBands2Bit);
        if (attestation.payloadHash != payloadHash) {
            revert PayloadHashMismatch(attestation.payloadHash, payloadHash);
        }

        attestationVerifier.consumeAttestation(attestation, signature);
        artStore.updateTonalBands2Bit(cubeId, tonalBands2Bit);
        cubes.customizeCubeSource(
            cubeId,
            sourceContract,
            sourceTokenId,
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT
        );

        emit CubeCustomizedWithPayload(cubeId, msg.sender, sourceContract, sourceTokenId, payloadHash);
    }
}
