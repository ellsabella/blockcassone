// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { NormieBitmap } from "../src/NormieBitmap.sol";

contract NormieBitmapHarness {
    function bitAt(bytes memory rawImageData, uint256 index) external pure returns (bool) {
        return NormieBitmap.bitAt(rawImageData, index);
    }

    function pixelAt(bytes memory rawImageData, uint256 row, uint256 col)
        external
        pure
        returns (bool)
    {
        return NormieBitmap.pixelAt(rawImageData, row, col);
    }
}

contract NormieBitmapTest is Test {
    NormieBitmapHarness private harness;

    function setUp() public {
        harness = new NormieBitmapHarness();
    }

    function testBitAtUsesRowMajorMsbFirstPackedBits() public view {
        bytes memory raw = new bytes(NormieBitmap.RAW_IMAGE_BYTES);
        raw[0] = bytes1(uint8(0x81));
        raw[1] = bytes1(uint8(0x40));
        raw[199] = bytes1(uint8(0x01));

        assertTrue(harness.bitAt(raw, 0));
        assertFalse(harness.bitAt(raw, 1));
        assertFalse(harness.bitAt(raw, 6));
        assertTrue(harness.bitAt(raw, 7));
        assertFalse(harness.bitAt(raw, 8));
        assertTrue(harness.bitAt(raw, 9));
        assertTrue(harness.bitAt(raw, 1599));
    }

    function testPixelAtUsesRowMajorCoordinates() public view {
        bytes memory raw = new bytes(NormieBitmap.RAW_IMAGE_BYTES);
        uint256 index = 17 * NormieBitmap.GRID_SIZE + 23;
        raw[index / 8] = bytes1(uint8(1) << uint8(7 - (index % 8)));

        assertTrue(harness.pixelAt(raw, 17, 23));
        assertFalse(harness.pixelAt(raw, 17, 22));
        assertFalse(harness.pixelAt(raw, 18, 23));
    }

    function testRejectsInvalidRawLength() public {
        bytes memory raw = new bytes(NormieBitmap.RAW_IMAGE_BYTES - 1);

        vm.expectRevert(
            abi.encodeWithSelector(NormieBitmap.InvalidRawImageDataLength.selector, raw.length)
        );
        harness.bitAt(raw, 0);
    }

    function testRejectsInvalidIndex() public {
        bytes memory raw = new bytes(NormieBitmap.RAW_IMAGE_BYTES);

        vm.expectRevert(
            abi.encodeWithSelector(
                NormieBitmap.InvalidPixelIndex.selector, NormieBitmap.PIXEL_COUNT
            )
        );
        harness.bitAt(raw, NormieBitmap.PIXEL_COUNT);
    }

    function testRejectsInvalidCoordinate() public {
        bytes memory raw = new bytes(NormieBitmap.RAW_IMAGE_BYTES);

        vm.expectRevert(abi.encodeWithSelector(NormieBitmap.InvalidPixelCoordinate.selector, 40, 0));
        harness.pixelAt(raw, 40, 0);
    }
}
