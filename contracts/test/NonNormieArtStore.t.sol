// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {NonNormieArt} from "../src/NonNormieArt.sol";
import {NonNormieArtStore} from "../src/NonNormieArtStore.sol";

// Minimal ICubeSource: maps a cube id to its (source contract, token id) so the store
// can resolve source-keyed art without a full CubeNFT.
contract MockCubeSource {
    mapping(uint256 => address) private _contract;
    mapping(uint256 => uint256) private _tokenId;

    function setSource(uint256 cubeId, address sourceContract, uint256 sourceTokenId) external {
        _contract[cubeId] = sourceContract;
        _tokenId[cubeId] = sourceTokenId;
    }

    function cubeSource(uint256 cubeId) external view returns (address, uint256) {
        return (_contract[cubeId], _tokenId[cubeId]);
    }
}

contract NonNormieArtStoreTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);

    event NonNormiePayloadRecorded(
        uint256 indexed cubeId,
        uint8 indexed version,
        bytes32 indexed payloadHash
    );

    NonNormieArtStore private store;
    MockCubeSource private cubes;

    function setUp() public {
        cubes = new MockCubeSource();
        store = new NonNormieArtStore(address(cubes), OWNER);
    }

    // A cube with no per-cube override falls back to the source-keyed pool committed
    // once per source token — no per-cube copy (the genesis dedup).
    function testSourceKeyedPoolResolvesForCubeBySource() public {
        address src = address(0xCC0);
        bytes memory payload = _samplePayload();
        cubes.setSource(7, src, 42);

        vm.prank(OWNER);
        store.recordSourcePayload(src, 42, payload);

        assertTrue(store.hasSourcePayload(src, 42));
        assertEq(store.payloadForCube(7).length, 400);
        assertEq(keccak256(store.payloadForCube(7)), keccak256(payload));
        assertEq(store.sourcePayloadHash(store.sourceKey(src, 42)), NonNormieArt.hashTonalBands2Bit(payload));
    }

    function testSourcePayloadReadsCommittedBytesBySource() public {
        address src = address(0xCC0);
        bytes memory payload = _samplePayload();
        vm.prank(OWNER);
        store.recordSourcePayload(src, 42, payload);
        // By-source reader (previews an unminted pool source for the "spin the wheel" re-base).
        assertEq(store.sourcePayload(src, 42).length, 400);
        assertEq(keccak256(store.sourcePayload(src, 42)), keccak256(payload));
        assertEq(store.sourcePayload(src, 999).length, 0); // uncommitted -> empty
    }

    function testPerCubeOverrideWinsOverSourcePool() public {
        address src = address(0xCC0);
        cubes.setSource(9, src, 1);
        bytes memory poolArt = _samplePayload();
        bytes memory cubeArt = new bytes(400);
        cubeArt[0] = 0x5A;

        vm.startPrank(OWNER);
        store.recordSourcePayload(src, 1, poolArt);
        store.recordTonalBands2Bit(9, cubeArt); // per-cube override
        vm.stopPrank();

        // The per-cube override wins; the shared pool blob is untouched.
        assertEq(keccak256(store.payloadForCube(9)), keccak256(cubeArt));
    }

    function testBatchSourcePayloadPacksOneBlob() public {
        address src = address(0xCC0);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 100; ids[1] = 101; ids[2] = 102;
        bytes[] memory ps = new bytes[](3);
        ps[0] = _filled(0x11); ps[1] = _filled(0x22); ps[2] = _filled(0x33);

        vm.prank(OWNER);
        store.recordSourcePayloadBatch(src, ids, ps);

        cubes.setSource(200, src, 101);
        assertEq(keccak256(store.payloadForCube(200)), keccak256(ps[1])); // correct slice
        assertEq(store.sourcePayloadLength(src, 102), 400);
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

        // recordTonalBands2Bit is now gated to owner OR an authorized recorder.
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(NonNormieArtStore.NotAuthorizedRecorder.selector, OTHER)
        );
        store.recordTonalBands2Bit(1, payload);
    }

    function testAuthorizedRecorderCanRecord() public {
        bytes memory payload = _samplePayload();

        vm.prank(OWNER);
        store.setAuthorizedRecorder(OTHER, true);

        vm.prank(OTHER);
        store.recordTonalBands2Bit(1, payload);
        assertEq(store.payloadForCube(1).length, payload.length);
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

    function _filled(uint8 v) private pure returns (bytes memory payload) {
        payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        for (uint256 i = 0; i < payload.length; i++) payload[i] = bytes1(v);
    }
}
