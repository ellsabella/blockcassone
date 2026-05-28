// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {NonNormieArt} from "../src/NonNormieArt.sol";

contract NonNormieArtHarness {
    function validate(uint8 version, bytes memory payload) external pure {
        NonNormieArt.validateTonalBands2Bit(version, payload);
    }

    function payloadHash(bytes memory payload) external pure returns (bytes32) {
        return NonNormieArt.hashTonalBands2Bit(payload);
    }

    function bandAt(bytes memory payload, uint256 cellIndex) external pure returns (uint8) {
        return NonNormieArt.tonalBandAt(payload, cellIndex);
    }

    function bandAtRowCol(bytes memory payload, uint16 row, uint16 col)
        external
        pure
        returns (uint8)
    {
        return NonNormieArt.tonalBandAt(payload, row, col);
    }
}

contract NonNormieArtTest is Test {
    NonNormieArtHarness private harness;

    function setUp() public {
        harness = new NonNormieArtHarness();
    }

    function testValidateAcceptsCanonicalV1Payload() public view {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);

        harness.validate(NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payload);
    }

    function testValidateRejectsUnknownVersion() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidPayloadVersion.selector, 2));
        harness.validate(2, payload);
    }

    function testValidateRejectsShortPayload() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH - 1);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidPayloadLength.selector, 399));
        harness.validate(NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payload);
    }

    function testValidateRejectsLongPayload() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH + 1);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidPayloadLength.selector, 401));
        harness.validate(NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payload);
    }

    function testTonalBandAtDecodesFourCellsPerByte() public view {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        payload[0] = bytes1(uint8(0xE4)); // cell bands: 0, 1, 2, 3
        payload[1] = bytes1(uint8(0x1B)); // cell bands: 3, 2, 1, 0

        assertEq(harness.bandAt(payload, 0), 0);
        assertEq(harness.bandAt(payload, 1), 1);
        assertEq(harness.bandAt(payload, 2), 2);
        assertEq(harness.bandAt(payload, 3), 3);
        assertEq(harness.bandAt(payload, 4), 3);
        assertEq(harness.bandAt(payload, 5), 2);
        assertEq(harness.bandAt(payload, 6), 1);
        assertEq(harness.bandAt(payload, 7), 0);
    }

    function testTonalBandAtRowColUsesRowMajorIndexing() public view {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        uint256 cellIndex = 3 * NonNormieArt.GRID_SIZE + 9;
        uint256 byteIndex = cellIndex / 4;
        uint256 shift = (cellIndex % 4) * 2;
        payload[byteIndex] = bytes1(uint8(2 << shift));

        assertEq(harness.bandAtRowCol(payload, 3, 9), 2);
    }

    function testTonalBandAtRejectsOutOfRangeIndex() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidCellIndex.selector, 1600));
        harness.bandAt(payload, 1600);
    }

    function testTonalBandAtRejectsOutOfRangeRow() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidCellIndex.selector, 40));
        harness.bandAtRowCol(payload, 40, 0);
    }

    function testTonalBandAtRejectsOutOfRangeCol() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);

        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidCellIndex.selector, 40));
        harness.bandAtRowCol(payload, 0, 40);
    }

    function testPayloadHashIsDomainSeparated() public view {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        payload[0] = bytes1(uint8(0xE4));

        assertEq(
            harness.payloadHash(payload),
            keccak256(abi.encode(NonNormieArt.TONAL_BANDS_2BIT_HASH_DOMAIN, payload))
        );
    }

    function testPayloadHashChangesWithPayload() public view {
        bytes memory first = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        bytes memory second = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        second[399] = bytes1(uint8(1));

        assertTrue(harness.payloadHash(first) != harness.payloadHash(second));
    }
}
