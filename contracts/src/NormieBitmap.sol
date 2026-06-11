// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library NormieBitmap {
    uint256 public constant GRID_SIZE = 40;
    uint256 public constant PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
    uint256 public constant RAW_IMAGE_BYTES = PIXEL_COUNT / 8;

    error InvalidRawImageDataLength(uint256 length);
    error InvalidPixelIndex(uint256 index);
    error InvalidPixelCoordinate(uint256 row, uint256 col);

    function pixelAt(bytes memory rawImageData, uint256 row, uint256 col)
        internal
        pure
        returns (bool)
    {
        if (row >= GRID_SIZE || col >= GRID_SIZE) {
            revert InvalidPixelCoordinate(row, col);
        }
        return bitAt(rawImageData, row * GRID_SIZE + col);
    }

    function bitAt(bytes memory rawImageData, uint256 index) internal pure returns (bool) {
        _requireCanonicalLength(rawImageData);
        if (index >= PIXEL_COUNT) revert InvalidPixelIndex(index);

        uint256 byteIndex = index / 8;
        uint8 bitIndex = uint8(7 - (index % 8));
        return (uint8(rawImageData[byteIndex]) & (uint8(1) << bitIndex)) != 0;
    }

    function _requireCanonicalLength(bytes memory rawImageData) private pure {
        if (rawImageData.length != RAW_IMAGE_BYTES) {
            revert InvalidRawImageDataLength(rawImageData.length);
        }
    }
}
