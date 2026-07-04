// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {NonNormieArt} from "./NonNormieArt.sol";
import {SSTORE2} from "./lib/SSTORE2.sol";

/// @notice Per-cube flattened non-Normie (external / CC0) art. Each 400-byte 2-bit
///         tonal payload is stored as an SSTORE2 blob (contract runtime code, read
///         back via EXTCODECOPY) rather than in contract storage — ~200 gas/byte to
///         write vs ~20k/word for SSTORE, so ~2.5-3x cheaper to record and less
///         state bloat. Populated only via post-mint customize / external-mint-with-
///         payload; a re-base deploys a fresh blob and repoints (the old blob is
///         orphaned, since SSTORE2 code is immutable).
contract NonNormieArtStore is Ownable {
    struct PayloadRecord {
        uint8 version;
        bytes32 payloadHash;
    }

    error InvalidCubeId();
    error PayloadAlreadyRecorded(uint256 cubeId);
    error MissingPayload(uint256 cubeId);
    error NotAuthorizedRecorder(address caller);

    event NonNormiePayloadRecorded(
        uint256 indexed cubeId,
        uint8 indexed version,
        bytes32 indexed payloadHash
    );
    event AuthorizedRecorderUpdated(address indexed recorder, bool allowed);

    mapping(uint256 cubeId => PayloadRecord record) public payloadRecordForCube;
    // SSTORE2 blob holding the cube's raw tonal payload (address(0) = none yet).
    mapping(uint256 cubeId => address pointer) private _payloadPointer;
    // Contracts allowed to record payloads besides the owner (e.g. the customize
    // controller for post-mint re-bases).
    mapping(address recorder => bool allowed) public authorizedRecorder;

    constructor(address initialOwner_) Ownable(initialOwner_) {}

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

    /// @notice Record a payload for a cube that has none yet (the mint path).
    function recordTonalBands2Bit(uint256 cubeId, bytes calldata payload) external onlyRecorder {
        if (payloadRecordForCube[cubeId].payloadHash != bytes32(0)) {
            revert PayloadAlreadyRecorded(cubeId);
        }
        _storeTonalBands2Bit(cubeId, payload);
    }

    /// @notice Record or overwrite a cube's payload (the post-mint re-base path); a
    ///         cube can be customized any number of times. Each write deploys a fresh
    ///         SSTORE2 blob and repoints; the previous blob is orphaned.
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

    function payloadForCube(uint256 cubeId) external view returns (bytes memory payload) {
        address pointer = _payloadPointer[cubeId];
        if (pointer == address(0)) revert MissingPayload(cubeId);
        return SSTORE2.read(pointer);
    }

    /// @notice The cube's art as the 1-bit (on/off) bitmap the renderers consume,
    ///         or empty bytes if no payload is recorded (no revert, for renderers).
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory) {
        address pointer = _payloadPointer[cubeId];
        if (pointer == address(0)) return "";
        return NonNormieArt.toBinaryBitmap(SSTORE2.read(pointer));
    }

    function tonalBandForCube(uint256 cubeId, uint16 row, uint16 col)
        external
        view
        returns (uint8)
    {
        address pointer = _payloadPointer[cubeId];
        if (pointer == address(0)) revert MissingPayload(cubeId);
        return NonNormieArt.tonalBandAt(SSTORE2.read(pointer), row, col);
    }
}
