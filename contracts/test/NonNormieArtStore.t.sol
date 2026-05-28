// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {NonNormieArt} from "../src/NonNormieArt.sol";
import {NonNormieArtStore} from "../src/NonNormieArtStore.sol";

contract NonNormieArtStoreTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);

    event NonNormiePayloadRecorded(
        uint256 indexed cubeId,
        uint8 indexed version,
        bytes32 indexed payloadHash
    );

    NonNormieArtStore private store;

    function setUp() public {
        store = new NonNormieArtStore(OWNER);
    }

    function testOwnerCanRecordPayloadOnce() public {
        bytes memory payload = _samplePayload();
        bytes32 expectedHash = NonNormieArt.hashTonalBands2Bit(payload);

        vm.prank(OWNER);
        store.recordTonalBands2Bit(1, payload);

        (uint8 version, bytes32 payloadHash) = store.payloadRecordForCube(1);
        assertEq(version, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT);
        assertEq(payloadHash, expectedHash);
        assertEq(store.payloadForCube(1), payload);
        assertEq(store.tonalBandForCube(1, 0, 0), 0);
        assertEq(store.tonalBandForCube(1, 0, 1), 1);
        assertEq(store.tonalBandForCube(1, 0, 2), 2);
        assertEq(store.tonalBandForCube(1, 0, 3), 3);
    }

    function testRecordEmitsPayloadMetadata() public {
        bytes memory payload = _samplePayload();
        bytes32 payloadHash = NonNormieArt.hashTonalBands2Bit(payload);

        vm.expectEmit(true, true, true, true, address(store));
        emit NonNormiePayloadRecorded(9, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT, payloadHash);

        vm.prank(OWNER);
        store.recordTonalBands2Bit(9, payload);
    }

    function testNonOwnerCannotRecordPayload() public {
        bytes memory payload = _samplePayload();

        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        store.recordTonalBands2Bit(1, payload);
    }

    function testCannotRecordCubeZero() public {
        bytes memory payload = _samplePayload();

        vm.prank(OWNER);
        vm.expectRevert(NonNormieArtStore.InvalidCubeId.selector);
        store.recordTonalBands2Bit(0, payload);
    }

    function testCannotRecordInvalidLength() public {
        bytes memory payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH - 1);

        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(NonNormieArt.InvalidPayloadLength.selector, 399));
        store.recordTonalBands2Bit(1, payload);
    }

    function testCannotOverwritePayload() public {
        bytes memory payload = _samplePayload();

        vm.startPrank(OWNER);
        store.recordTonalBands2Bit(1, payload);

        vm.expectRevert(
            abi.encodeWithSelector(NonNormieArtStore.PayloadAlreadyRecorded.selector, 1)
        );
        store.recordTonalBands2Bit(1, payload);
        vm.stopPrank();
    }

    function testPayloadReadRevertsWhenMissing() public {
        vm.expectRevert(abi.encodeWithSelector(NonNormieArtStore.MissingPayload.selector, 404));
        store.payloadForCube(404);
    }

    function testBandReadRevertsWhenMissing() public {
        vm.expectRevert(abi.encodeWithSelector(NonNormieArtStore.MissingPayload.selector, 404));
        store.tonalBandForCube(404, 0, 0);
    }

    function _samplePayload() private pure returns (bytes memory payload) {
        payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        payload[0] = bytes1(uint8(0xE4)); // cell bands: 0, 1, 2, 3
        payload[399] = bytes1(uint8(0x7B));
    }
}
