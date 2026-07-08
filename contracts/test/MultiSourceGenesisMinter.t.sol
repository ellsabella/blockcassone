// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";

contract MsMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract MsCC0 is ERC721 {
    constructor(string memory n) ERC721(n, n) { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract MultiSourceGenesisMinterTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xA11CA);
    address private constant PUB = address(0xCAFE);

    MsMockNormies private normies;
    MsCC0 private runners; // collection 1
    MsCC0 private skulls; // collection 2

    // Default world: 16 slots, allocation Normie 8 / Runners 5 / Skulls 3.
    function _deploy(uint32 slots, uint32 normieCap, uint32 capA, uint32 capB)
        private
        returns (MultiSourceGenesisMinter g, CubeNFT cubes, NonNormieArtStore store)
    {
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), slots, OWNER);
        store = new NonNormieArtStore(address(cubes), address(this));
        address[] memory cc = new address[](2);
        cc[0] = address(runners);
        cc[1] = address(skulls);
        uint32[] memory caps = new uint32[](2);
        caps[0] = capA;
        caps[1] = capB;
        g = new MultiSourceGenesisMinter(cubes, bytes32("seed"), OWNER, store, normieCap, cc, caps);

        vm.prank(OWNER);
        cubes.setGenesisMinter(address(g));
        store.setAuthorizedRecorder(address(g), true);
    }

    function setUp() public {
        normies = new MsMockNormies();
        runners = new MsCC0("Runners");
        skulls = new MsCC0("Skulls");
    }

    // Fully configure the default 16-slot world: Normie snapshot (10 ids >= cap 8),
    // Runners pool (5) + Skulls pool (3) with committed payloads, finalized.
    function _fullWorld()
        private
        returns (MultiSourceGenesisMinter g, CubeNFT cubes, NonNormieArtStore store)
    {
        (g, cubes, store) = _deploy(16, 8, 5, 3);

        uint256[] memory nrm = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) nrm[i] = 100 + i;
        uint256[] memory rp = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) rp[i] = 200 + i;
        uint256[] memory sp = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) sp[i] = 300 + i;

        vm.startPrank(OWNER);
        g.addSnapshotNormies(ALICE, nrm);
        g.addSourcePool(1, rp);
        g.addSourcePool(2, sp);
        for (uint256 i = 0; i < 5; i++) g.setSourcePayload(1, 200 + i, _payload(uint8(i + 1)));
        for (uint256 i = 0; i < 3; i++) g.setSourcePayload(2, 300 + i, _payload(uint8(i + 20)));
        g.finalizeSnapshot();
        vm.stopPrank();
    }

    // ---- Allocation / weighted draw -----------------------------------------

    function testSelloutLandsExactlyOnAllocation() public {
        (MultiSourceGenesisMinter g,,) = _fullWorld();

        // 16 fresh wallets each mint 1, so plot caps never bind and the draw fills the
        // whole supply.
        for (uint256 i = 0; i < 16; i++) {
            vm.prank(OWNER);
            g.mintPublicFor(address(uint160(1000 + i)), 1);
        }

        assertEq(g.mintedCount(), 16);
        assertEq(g.collectionMinted(0), 8); // Normie
        assertEq(g.collectionMinted(1), 5); // Runners
        assertEq(g.collectionMinted(2), 3); // Skulls
        assertEq(g.totalPublicRemaining(), 0);
    }

    function testPublicDrawMixesCollections() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _fullWorld();

        // Mint 8 across fresh wallets; with Runners+Skulls = half the pool the draw
        // must produce cubes from more than one source collection.
        uint256 normieCount;
        uint256 ccCount;
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(OWNER);
            uint256 cubeId = g.mintPublicFor(address(uint160(2000 + i)), 1)[0];
            address src = cubes.cubeData(cubeId).sourceContract;
            if (src == address(normies)) normieCount++;
            else ccCount++;
        }
        assertGt(normieCount, 0);
        assertGt(ccCount, 0);
    }

    function testStoredCubesGetArtAndCorrectSource() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes, NonNormieArtStore store) = _fullWorld();

        // Drain enough that at least one Runner and one Skull are minted; verify each
        // external cube carries its source contract AND a 400-byte recorded payload.
        bool sawRunner;
        bool sawSkull;
        for (uint256 i = 0; i < 16; i++) {
            vm.prank(OWNER);
            uint256 cubeId = g.mintPublicFor(address(uint160(3000 + i)), 1)[0];
            CubeNFT.CubeData memory d = cubes.cubeData(cubeId);
            if (d.sourceContract == address(runners) || d.sourceContract == address(skulls)) {
                assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
                assertEq(store.payloadForCube(cubeId).length, 400);
                if (d.sourceContract == address(runners)) sawRunner = true;
                if (d.sourceContract == address(skulls)) sawSkull = true;
            } else {
                assertEq(d.sourceContract, address(normies)); // Normie: live art, no payload
            }
        }
        assertTrue(sawRunner);
        assertTrue(sawSkull);
    }

    // ---- Per-collection caps ------------------------------------------------

    function testNormieAllowlistStopsAtNormieCap() public {
        // Normie cap 2, Runners cap 2, total 4. Alice holds 3 snapshot Normies but the
        // Normie allocation is only 2, so a 3-qty allowlist mint must revert.
        (MultiSourceGenesisMinter g, CubeNFT cubes, NonNormieArtStore store) = _deploy(4, 2, 2, 0);
        store; cubes;

        uint256[] memory nrm = new uint256[](3);
        nrm[0] = 101; nrm[1] = 102; nrm[2] = 103;
        uint256[] memory rp = new uint256[](2);
        rp[0] = 201; rp[1] = 202;

        vm.startPrank(OWNER);
        g.addSnapshotNormies(ALICE, nrm);
        g.addSourcePool(1, rp);
        g.setSourcePayload(1, 201, _payload(1));
        g.setSourcePayload(1, 202, _payload(2));
        g.finalizeSnapshot();
        vm.stopPrank();

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(MultiSourceGenesisMinter.CollectionCapReached.selector, uint8(0))
        );
        g.mintAllowlist(3);

        // The 2 within-cap allowlist mints still work.
        vm.prank(ALICE);
        uint256[] memory ids = g.mintAllowlist(2);
        assertEq(ids.length, 2);
        assertEq(g.collectionMinted(0), 2);
    }

    // ---- Payload / config guards --------------------------------------------

    function testMintRevertsWhenStoredPayloadMissing() public {
        // Normie cap 0 (so it's never drawn — one snapshot id only satisfies the
        // non-empty-snapshot rule), Runners cap 3. Drawing all 3 Runners forces the
        // uncommitted 202 to be picked, which must revert.
        (MultiSourceGenesisMinter g,,) = _deploy(3, 0, 3, 0);
        uint256[] memory nrm = new uint256[](1);
        nrm[0] = 101;
        uint256[] memory rp = new uint256[](3);
        rp[0] = 201; rp[1] = 202; rp[2] = 203;

        vm.startPrank(OWNER);
        g.addSnapshotNormies(ALICE, nrm);
        g.addSourcePool(1, rp);
        g.setSourcePayload(1, 201, _payload(1)); // 202 deliberately uncommitted
        g.setSourcePayload(1, 203, _payload(3));
        g.finalizeSnapshot();
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(MultiSourceGenesisMinter.MissingSourcePayload.selector, uint256(202))
        );
        vm.prank(OWNER);
        g.mintPublicFor(PUB, 3);
    }

    function testConstructorRejectsCapSumMismatch() public {
        CubeNFT cubes = new CubeNFT("C", "C", address(normies), 16, OWNER);
        NonNormieArtStore store = new NonNormieArtStore(address(cubes), address(this));
        address[] memory cc = new address[](1);
        cc[0] = address(runners);
        uint32[] memory caps = new uint32[](1);
        caps[0] = 5; // 8 + 5 = 13 != 16
        vm.expectRevert(
            abi.encodeWithSelector(MultiSourceGenesisMinter.CapSumMismatch.selector, uint256(13), uint32(16))
        );
        new MultiSourceGenesisMinter(cubes, bytes32("s"), OWNER, store, 8, cc, caps);
    }

    function testFinalizeRejectsUnderfilledStoredPool() public {
        (MultiSourceGenesisMinter g,,) = _deploy(16, 8, 5, 3);
        uint256[] memory nrm = new uint256[](8);
        for (uint256 i = 0; i < 8; i++) nrm[i] = 100 + i;
        uint256[] memory rp = new uint256[](4); // one short of cap 5
        for (uint256 i = 0; i < 4; i++) rp[i] = 200 + i;

        vm.startPrank(OWNER);
        g.addSnapshotNormies(ALICE, nrm);
        g.addSourcePool(1, rp);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSourceGenesisMinter.PoolSizeMismatch.selector, uint8(1), uint256(4), uint32(5)
            )
        );
        g.finalizeSnapshot();
        vm.stopPrank();
    }

    function testAddSourcePoolRejectsCollectionZero() public {
        (MultiSourceGenesisMinter g,,) = _deploy(16, 8, 5, 3);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(MultiSourceGenesisMinter.NotStoredCollection.selector, uint8(0))
        );
        g.addSourcePool(0, ids);
    }

    function testBatchCommitStoresToArtStore() public {
        // The minter delegates payload commits to the shared art store (source-keyed);
        // the blob-packing itself is covered in NonNormieArtStore.t.sol.
        (MultiSourceGenesisMinter g, CubeNFT cubes, NonNormieArtStore store) = _deploy(16, 8, 5, 3);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 200; ids[1] = 201; ids[2] = 202;
        bytes[] memory ps = new bytes[](3);
        ps[0] = _payload(1); ps[1] = _payload(2); ps[2] = _payload(3);

        vm.prank(OWNER);
        g.setSourcePayloadBatch(1, ids, ps);

        assertEq(g.payloadLength(1, 200), 400);
        assertEq(g.payloadLength(1, 202), 400);
        assertTrue(store.hasSourcePayload(address(runners), 201));
        cubes; // committed source-keyed; a cube minted from 201 would resolve this blob
    }

    function testFirstUncommittedPoolTokenFlagsMissing() public {
        (MultiSourceGenesisMinter g,,) = _deploy(16, 8, 5, 3);
        uint256[] memory rp = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) rp[i] = 200 + i;
        vm.startPrank(OWNER);
        g.addSourcePool(1, rp);
        g.setSourcePayload(1, 200, _payload(1));
        g.setSourcePayload(1, 201, _payload(2));
        g.setSourcePayload(1, 203, _payload(3)); // 202 deliberately skipped
        g.setSourcePayload(1, 204, _payload(4));
        vm.stopPrank();

        (bool found, uint256 tokenId) = g.firstUncommittedPoolToken(1);
        assertTrue(found);
        assertEq(tokenId, 202);

        vm.prank(OWNER);
        g.setSourcePayload(1, 202, _payload(5));
        (found,) = g.firstUncommittedPoolToken(1);
        assertFalse(found); // now fully art-backed
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH); // 400
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }
}
