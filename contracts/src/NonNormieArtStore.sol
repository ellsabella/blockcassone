// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {NonNormieArt} from "./NonNormieArt.sol";

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
    mapping(uint256 cubeId => bytes payload) private _payloadForCube;
    // Contracts allowed to record payloads besides the owner (e.g. the genesis
    // minter for a CC0 collection + the customize controller).
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

    /// @notice Record or overwrite a cube's payload (the post-mint re-base path);
    ///         a cube can be customized any number of times.
    function updateTonalBands2Bit(uint256 cubeId, bytes calldata payload) external onlyOwner {
        _storeTonalBands2Bit(cubeId, payload);
    }

    function _storeTonalBands2Bit(uint256 cubeId, bytes calldata payload) private {
        if (cubeId == 0) revert InvalidCubeId();

        NonNormieArt.validateTonalBands2Bit(
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            payload
        );

        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(payload);
        payloadRecordForCube[cubeId] = PayloadRecord({
            version: NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            payloadHash: payloadHash
        });
        _payloadForCube[cubeId] = payload;

        emit NonNormiePayloadRecorded(
            cubeId,
            NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            payloadHash
        );
    }

    function payloadForCube(uint256 cubeId) external view returns (bytes memory payload) {
        if (payloadRecordForCube[cubeId].payloadHash == bytes32(0)) revert MissingPayload(cubeId);
        return _payloadForCube[cubeId];
    }

    /// @notice The cube's art as the 1-bit (on/off) bitmap the renderers consume,
    ///         or empty bytes if no payload is recorded (no revert, for renderers).
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory) {
        if (payloadRecordForCube[cubeId].payloadHash == bytes32(0)) return "";
        return NonNormieArt.toBinaryBitmap(_payloadForCube[cubeId]);
    }

    function tonalBandForCube(uint256 cubeId, uint16 row, uint16 col)
        external
        view
        returns (uint8)
    {
        if (payloadRecordForCube[cubeId].payloadHash == bytes32(0)) revert MissingPayload(cubeId);
        return NonNormieArt.tonalBandAt(_payloadForCube[cubeId], row, col);
    }
}
