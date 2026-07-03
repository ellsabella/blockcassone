// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { BrainrotGenesisMinter } from "../src/BrainrotGenesisMinter.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";

contract BrainrotMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract BrainrotMock is ERC721 {
    constructor() ERC721("BRAINROT", "BRAINROT") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract BrainrotGenesisTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xA11CA);
    address private constant BOB = address(0xB0B);
    address private constant PUB = address(0xCAFE);

    BrainrotMockNormies private normies;
    BrainrotMock private brainrot;
    CubeNFT private cubes;
    NonNormieArtStore private artStore;
    BrainrotGenesisMinter private genesis;

    function setUp() public {
        normies = new BrainrotMockNormies();
        brainrot = new BrainrotMock();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 16, OWNER);
        artStore = new NonNormieArtStore(address(this));
        genesis = new BrainrotGenesisMinter(
            cubes, bytes32("public-seed"), OWNER, address(brainrot), artStore
        );

        // Wiring: OWNER admin sets the genesis mint role on the token; the art store
        // authorizes the minter to record payloads.
        vm.prank(OWNER);
        cubes.setGenesisMinter(address(genesis));
        artStore.setAuthorizedRecorder(address(genesis), true);

        // Commit the off-chain-flattened payloads for every pool token, then snapshot.
        vm.startPrank(OWNER);
        genesis.setBrainrotPayload(5001, _payload(0x11));
        genesis.setBrainrotPayload(5002, _payload(0x22));
        genesis.setBrainrotPayload(5003, _payload(0x33));
        genesis.setBrainrotPayload(6001, _payload(0x44));
        genesis.addSnapshotNormies(ALICE, _ids3(5001, 5002, 5003));
        genesis.addSnapshotNormies(BOB, _ids1(6001));
        genesis.finalizeSnapshot();
        vm.stopPrank();
    }

    function testAllowlistMintsWalletBrainrotsWithArt() public {
        vm.prank(ALICE);
        uint256[] memory ids = genesis.mintAllowlist(2);

        assertEq(ids.length, 2);
        for (uint256 i = 0; i < 2; i++) {
            CubeNFT.CubeData memory d = cubes.cubeData(ids[i]);
            assertEq(cubes.ownerOf(ids[i]), ALICE);
            assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
            assertEq(d.sourceContract, address(brainrot));
            assertEq(d.payloadVersion, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT);
            // art recorded => cube renders (non-Normie path reads imageBytesForCube).
            assertEq(artStore.payloadForCube(ids[i]).length, 400);
        }
        assertEq(cubes.cubeData(ids[0]).sourceTokenId, 5001);
        assertEq(cubes.cubeData(ids[1]).sourceTokenId, 5002);
    }

    function testPublicMintPullsBrainrotWithArt() public {
        vm.prank(PUB);
        uint256[] memory ids = genesis.mintPublic(3);

        assertEq(ids.length, 3);
        for (uint256 i = 0; i < ids.length; i++) {
            CubeNFT.CubeData memory d = cubes.cubeData(ids[i]);
            assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
            assertEq(d.sourceContract, address(brainrot));
            assertEq(artStore.payloadForCube(ids[i]).length, 400); // never a placeholder
        }
        assertEq(genesis.mintedCount(), 3);
    }

    function testMintRevertsWhenPayloadMissing() public {
        // Fresh minter whose only pool token has NO committed payload.
        BrainrotGenesisMinter g2 = new BrainrotGenesisMinter(
            cubes, bytes32("seed2"), OWNER, address(brainrot), artStore
        );
        vm.prank(OWNER);
        cubes.setGenesisMinter(address(g2));
        artStore.setAuthorizedRecorder(address(g2), true);

        vm.startPrank(OWNER);
        g2.addSnapshotNormies(BOB, _ids1(7001)); // no payload committed for 7001
        g2.finalizeSnapshot();
        vm.stopPrank();

        vm.prank(BOB);
        vm.expectRevert(
            abi.encodeWithSelector(BrainrotGenesisMinter.MissingSourcePayload.selector, 7001)
        );
        g2.mintAllowlist(1);
    }

    function testSetPayloadRejectsBadLength() public {
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(NonNormieArt.InvalidPayloadLength.selector, uint256(10))
        );
        genesis.setBrainrotPayload(9999, new bytes(10));
    }

    // ---- Batched-SSTORE2 commit path ----------------------------------------

    function testBatchCommitPacksIntoOneBlobWithOffsets() public {
        uint256[] memory ids = _ids3(7001, 7002, 7003);
        bytes[] memory ps = new bytes[](3);
        ps[0] = _payload(0xA1);
        ps[1] = _payload(0xB2);
        ps[2] = _payload(0xC3);

        vm.prank(OWNER);
        genesis.setBrainrotPayloadBatch(ids, ps);

        (address blob0, uint32 off0, uint32 len0) = genesis.payloadLoc(7001);
        (address blob1, uint32 off1, uint32 len1) = genesis.payloadLoc(7002);
        (address blob2, uint32 off2, uint32 len2) = genesis.payloadLoc(7003);

        // One shared blob; each token slices its 400-byte window in order.
        assertTrue(blob0 != address(0));
        assertEq(blob1, blob0);
        assertEq(blob2, blob0);
        assertEq(off0, 0);
        assertEq(off1, 400);
        assertEq(off2, 800);
        assertEq(len0, 400);
        assertEq(len1, 400);
        assertEq(len2, 400);
        assertEq(genesis.brainrotPayloadLength(7002), 400);
    }

    function testBatchMintRecordsCorrectSlicedArt() public {
        // Fresh minter so we control the whole pool + can finalize after batching.
        BrainrotGenesisMinter g = new BrainrotGenesisMinter(
            cubes, bytes32("batch-seed"), OWNER, address(brainrot), artStore
        );
        vm.prank(OWNER);
        cubes.setGenesisMinter(address(g));
        artStore.setAuthorizedRecorder(address(g), true);

        // Distinct, fully-filled payloads so a wrong slice would be detectable.
        uint256[] memory ids = _ids3(8001, 8002, 8003);
        bytes[] memory ps = new bytes[](3);
        ps[0] = _filled(0x11);
        ps[1] = _filled(0x22);
        ps[2] = _filled(0x33);

        vm.startPrank(OWNER);
        g.setBrainrotPayloadBatch(ids, ps);
        g.addSnapshotNormies(ALICE, ids);
        g.finalizeSnapshot();
        vm.stopPrank();

        vm.prank(ALICE);
        uint256[] memory cubeIds = g.mintAllowlist(3);

        // Each cube's recorded art must byte-match the payload committed for its
        // source token — proving the offset/length slicing pulls the right window.
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                keccak256(artStore.payloadForCube(cubeIds[i])),
                keccak256(ps[i])
            );
        }
    }

    function testBatchRejectsLengthMismatch() public {
        uint256[] memory ids = _ids3(7001, 7002, 7003);
        bytes[] memory ps = new bytes[](2);
        ps[0] = _payload(0x01);
        ps[1] = _payload(0x02);
        vm.prank(OWNER);
        vm.expectRevert(BrainrotGenesisMinter.PayloadListLengthMismatch.selector);
        genesis.setBrainrotPayloadBatch(ids, ps);
    }

    function testBatchRejectsEmpty() public {
        uint256[] memory ids = new uint256[](0);
        bytes[] memory ps = new bytes[](0);
        vm.prank(OWNER);
        vm.expectRevert(BrainrotGenesisMinter.EmptyBatch.selector);
        genesis.setBrainrotPayloadBatch(ids, ps);
    }

    function testBatchRejectsBlobTooLarge() public {
        // 61 * 400 = 24400 > MAX_BATCH_BLOB_BYTES (24000).
        uint256 n = 61;
        uint256[] memory ids = new uint256[](n);
        bytes[] memory ps = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = 9000 + i;
            ps[i] = _payload(uint8(i));
        }
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(
                BrainrotGenesisMinter.BatchBlobTooLarge.selector, n * 400, uint256(24_000)
            )
        );
        genesis.setBrainrotPayloadBatch(ids, ps);
    }

    function testBatchAtBlobCapacitySucceeds() public {
        // 60 * 400 = 24000 == MAX_BATCH_BLOB_BYTES: the largest allowed single blob.
        uint256 n = 60;
        uint256[] memory ids = new uint256[](n);
        bytes[] memory ps = new bytes[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = 9000 + i;
            ps[i] = _payload(uint8(i));
        }
        vm.prank(OWNER);
        genesis.setBrainrotPayloadBatch(ids, ps);

        (address blobFirst,, uint32 lenFirst) = genesis.payloadLoc(9000);
        (address blobLast, uint32 offLast,) = genesis.payloadLoc(9000 + n - 1);
        assertEq(blobLast, blobFirst); // all 60 in one blob
        assertEq(lenFirst, 400);
        assertEq(offLast, uint32((n - 1) * 400));
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH); // 400
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }

    function _filled(uint8 v) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH); // 400
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = bytes1(v);
        }
    }

    function _ids3(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _ids1(uint256 a) private pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }
}
