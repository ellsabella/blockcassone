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

    event NonNormiePayloadRecorded(
        uint256 indexed cubeId,
        uint8 indexed version,
        bytes32 indexed payloadHash
    );

    mapping(uint256 cubeId => PayloadRecord record) public payloadRecordForCube;
    mapping(uint256 cubeId => bytes payload) private _payloadForCube;

    constructor(address initialOwner_) Ownable(initialOwner_) {}

    function recordTonalBands2Bit(uint256 cubeId, bytes calldata payload) external onlyOwner {
        if (cubeId == 0) revert InvalidCubeId();
        if (payloadRecordForCube[cubeId].payloadHash != bytes32(0)) {
            revert PayloadAlreadyRecorded(cubeId);
        }

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

    function tonalBandForCube(uint256 cubeId, uint16 row, uint16 col)
        external
        view
        returns (uint8)
    {
        if (payloadRecordForCube[cubeId].payloadHash == bytes32(0)) revert MissingPayload(cubeId);
        return NonNormieArt.tonalBandAt(_payloadForCube[cubeId], row, col);
    }
}
