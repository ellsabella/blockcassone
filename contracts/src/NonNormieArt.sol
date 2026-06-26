// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library NonNormieArt {
    uint8 public constant PAYLOAD_VERSION_TONAL_BANDS_2BIT = 1;
    uint16 public constant GRID_SIZE = 40;
    uint16 public constant CELL_COUNT = GRID_SIZE * GRID_SIZE;
    uint16 public constant TONAL_BANDS_2BIT_BYTE_LENGTH = CELL_COUNT / 4;

    bytes32 public constant TONAL_BANDS_2BIT_HASH_DOMAIN =
        keccak256("BLOCKCASSONE_NON_NORMIE_TONAL_BANDS_2BIT_V1");

    error InvalidPayloadVersion(uint8 version);
    error InvalidPayloadLength(uint256 length);
    error InvalidCellIndex(uint256 cellIndex);

    function validateTonalBands2Bit(uint8 version, bytes memory payload) internal pure {
        if (version != PAYLOAD_VERSION_TONAL_BANDS_2BIT) revert InvalidPayloadVersion(version);
        if (payload.length != TONAL_BANDS_2BIT_BYTE_LENGTH) {
            revert InvalidPayloadLength(payload.length);
        }
    }

    function hashTonalBands2Bit(bytes memory payload) internal pure returns (bytes32) {
        if (payload.length != TONAL_BANDS_2BIT_BYTE_LENGTH) {
            revert InvalidPayloadLength(payload.length);
        }
        return keccak256(abi.encode(TONAL_BANDS_2BIT_HASH_DOMAIN, payload));
    }

    function tonalBandAt(bytes memory payload, uint256 cellIndex) internal pure returns (uint8) {
        if (payload.length != TONAL_BANDS_2BIT_BYTE_LENGTH) {
            revert InvalidPayloadLength(payload.length);
        }
        if (cellIndex >= CELL_COUNT) revert InvalidCellIndex(cellIndex);

        uint256 byteIndex = cellIndex >> 2;
        uint256 shift = (cellIndex & 3) << 1;
        return uint8(uint8(payload[byteIndex]) >> shift) & 3;
    }

    function tonalBandAt(bytes memory payload, uint16 row, uint16 col) internal pure returns (uint8) {
        if (row >= GRID_SIZE) revert InvalidCellIndex(row);
        if (col >= GRID_SIZE) revert InvalidCellIndex(col);
        return tonalBandAt(payload, uint256(row) * GRID_SIZE + col);
    }

    /// @notice Collapse the 2-bit tonal payload to the 1-bit (on/off) 200-byte
    ///         bitmap the renderers consume (same format as a Normie raw image):
    ///         any non-zero tonal band is "on". Returns empty on bad length.
    function toBinaryBitmap(bytes memory payload) internal pure returns (bytes memory) {
        if (payload.length != TONAL_BANDS_2BIT_BYTE_LENGTH) return "";
        bytes memory out = new bytes(CELL_COUNT / 8); // 1600 cells / 8 = 200 bytes
        for (uint256 cell = 0; cell < CELL_COUNT; cell++) {
            uint8 band = uint8(uint8(payload[cell >> 2]) >> ((cell & 3) << 1)) & 3;
            if (band > 0) {
                out[cell >> 3] |= bytes1(uint8(1) << uint8(7 - (cell & 7)));
            }
        }
        return out;
    }
}
