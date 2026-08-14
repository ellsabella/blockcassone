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
        cubes = new CubeNFT("TheBLOCK", "BLOCK", address(normies), slots, OWNER);
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

    // ---- GTD reservations (holder's chosen art via SeaDrop) -----------------

    address private constant SEADROP = address(0x5EAD);

    // A finalized 16-slot world where ALICE has reserved Runner #200 (collection 1)
    // as guaranteed chosen art. Runners pool is therefore cap-1 (4) + 1 reserved;
    // SeaDrop wired, Public phase open.
    function _reservedWorld()
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

        uint8[] memory cs = new uint8[](1);
        cs[0] = 1;
        uint256[] memory ss = new uint256[](1);
        ss[0] = 200;
        g.reserveSources(ALICE, cs, ss);

        g.finalizeSnapshot();
        g.setSeaDrop(SEADROP);
        g.setPhase(GenesisMinterBase.Phase.Public);
        vm.stopPrank();
    }

    function testFinalizeCountsReservationsAgainstCap() public {
        // Reserving pulled Runner #200 out of the pool; finalize must still pass
        // because pool(4) + reserved(1) == cap(5). (No revert in _reservedWorld = pass.)
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        assertEq(g.reservedCount(1), 1);
        assertEq(g.poolRemaining(1), 4); // 5 cap - 1 reserved
        assertEq(g.reservationRemaining(ALICE), 1);
    }

    function testReservationAssignsChosenArt() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _reservedWorld();
        vm.prank(SEADROP);
        uint256[] memory ids = g.mintSeaDrop(ALICE, 1);
        assertEq(ids.length, 1);
        CubeNFT.CubeData memory d = cubes.cubeData(ids[0]);
        assertEq(d.sourceContract, address(runners));
        assertEq(d.sourceTokenId, 200); // exactly the reserved token
        assertEq(g.reservationRemaining(ALICE), 0);
    }

    function testReservedSourceExcludedFromPublicDraw() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _reservedWorld();
        // Drain the whole public pool (15 = 16 cap - 1 reserved) across fresh wallets;
        // reserved Runner #200 must never be drawn.
        bool sawReserved;
        for (uint256 i = 0; i < 15; i++) {
            vm.prank(SEADROP);
            uint256[] memory ids = g.mintSeaDrop(address(uint160(4000 + i)), 1);
            CubeNFT.CubeData memory d = cubes.cubeData(ids[0]);
            if (d.sourceContract == address(runners) && d.sourceTokenId == 200) sawReserved = true;
        }
        assertFalse(sawReserved);
        // ALICE still gets her reserved 200 (the last mintable cube).
        vm.prank(SEADROP);
        uint256[] memory a = g.mintSeaDrop(ALICE, 1);
        assertEq(cubes.cubeData(a[0]).sourceTokenId, 200);
        assertEq(g.mintedCount(), 16); // exact sellout including the reservation
    }

    function testReservationThenPublicRemainder() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _reservedWorld();
        // ALICE mints 3 via SeaDrop: her 1 reservation FIRST (Runner 200) + 2 random.
        vm.prank(SEADROP);
        uint256[] memory ids = g.mintSeaDrop(ALICE, 3);
        assertEq(ids.length, 3);
        assertEq(cubes.cubeData(ids[0]).sourceContract, address(runners));
        assertEq(cubes.cubeData(ids[0]).sourceTokenId, 200); // reservation is index 0
        assertEq(g.reservationRemaining(ALICE), 0);
    }

    function testReleaseReturnsUnmintedToPool() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _reservedWorld();
        // ALICE never minted her reserved Runner 200 — release it back to the pool.
        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(OWNER);
        g.releaseReservations(w);
        assertEq(g.reservedCount(1), 0, "reserved count cleared");
        assertEq(g.poolRemaining(1), 5, "runner pool fully restored");
        assertEq(g.reservationRemaining(ALICE), 0, "no reservations left");

        // 200 is now drawable: drain the whole supply and confirm it appears + full sellout.
        bool saw200;
        for (uint256 i = 0; i < 16; i++) {
            vm.prank(SEADROP);
            uint256[] memory ids = g.mintSeaDrop(address(uint160(5000 + i)), 1);
            CubeNFT.CubeData memory d = cubes.cubeData(ids[0]);
            if (d.sourceContract == address(runners) && d.sourceTokenId == 200) saw200 = true;
        }
        assertTrue(saw200, "released source is drawable");
        assertEq(g.mintedCount(), 16, "full sellout, nothing stranded");
    }

    function testReleaseSkipsAlreadyMinted() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        vm.prank(SEADROP);
        g.mintSeaDrop(ALICE, 1); // ALICE mints her reservation
        assertEq(g.reservationRemaining(ALICE), 0);
        uint256 poolBefore = g.poolRemaining(1);
        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(OWNER);
        g.releaseReservations(w); // no-op: nothing unminted
        assertEq(g.poolRemaining(1), poolBefore, "no double-return of a minted reservation");
    }

    function testReleaseRevertsDuringAllowlistPhase() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        vm.prank(OWNER);
        g.setPhase(GenesisMinterBase.Phase.Allowlist);
        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(OWNER);
        vm.expectRevert(MultiSourceGenesisMinter.CannotReleaseDuringAllowlist.selector);
        g.releaseReservations(w);
    }

    // ---- On-chain GTD window (gtdEndTime) ------------------------------------
    // The chosen-art promise, enforced by the contract: while the window is open,
    // ONLY reservations mint — no merkle mis-cap or stage mis-window can leak a
    // random draw — and nobody (owner included) can release reservations.

    function testGtdWindowBlocksRandomDrawEvenInPublicPhase() public {
        (MultiSourceGenesisMinter g, CubeNFT cubes,) = _reservedWorld();
        uint64 gtdEnd = uint64(block.timestamp + 1000);
        vm.prank(OWNER);
        g.setGtdEndTime(gtdEnd);

        // A wallet with no reservations gets nothing during the window, even though
        // the on-chain phase is already Public.
        vm.prank(SEADROP);
        vm.expectRevert(abi.encodeWithSelector(GenesisMinterBase.GtdWindowActive.selector, gtdEnd));
        g.mintSeaDrop(PUB, 1);

        // A GTD winner asking for MORE than their reservations (a mis-capped merkle
        // leaf) reverts too — the surplus cannot become a random draw.
        vm.prank(SEADROP);
        vm.expectRevert(abi.encodeWithSelector(GenesisMinterBase.GtdWindowActive.selector, gtdEnd));
        g.mintSeaDrop(ALICE, 2);

        // Exactly the reservation mints fine, and it is the chosen art.
        vm.prank(SEADROP);
        uint256[] memory ids = g.mintSeaDrop(ALICE, 1);
        assertEq(cubes.cubeData(ids[0]).sourceTokenId, 200);
    }

    function testGtdWindowClosesItselfNoOwnerTx() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        uint64 gtdEnd = uint64(block.timestamp + 1000);
        vm.prank(OWNER);
        g.setGtdEndTime(gtdEnd);

        // No owner interaction: once chain time passes the window, draws just work.
        vm.warp(gtdEnd + 1);
        vm.prank(SEADROP);
        uint256[] memory ids = g.mintSeaDrop(PUB, 1);
        assertEq(ids.length, 1);
    }

    function testReleaseRevertsWhileGtdWindowOpenEvenForOwner() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        uint64 gtdEnd = uint64(block.timestamp + 1000);
        vm.prank(OWNER);
        g.setGtdEndTime(gtdEnd);

        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(GenesisMinterBase.GtdWindowActive.selector, gtdEnd));
        g.releaseReservations(w);
    }

    function testReleaseIsPermissionlessAfterGtdWindow() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        uint64 gtdEnd = uint64(block.timestamp + 1000);
        vm.prank(OWNER);
        g.setGtdEndTime(gtdEnd);
        vm.warp(gtdEnd + 1);

        // Any keeper can return the no-show's reservation to the pool.
        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(address(0xBEEF));
        g.releaseReservations(w);
        assertEq(g.reservedCount(1), 0);
        assertEq(g.poolRemaining(1), 5);
    }

    function testReleaseStaysOwnerOnlyWithoutGtdWindow() public {
        (MultiSourceGenesisMinter g,,) = _reservedWorld();
        // gtdEndTime unset (0): the legacy phase-driven mode keeps release owner-only.
        address[] memory w = new address[](1); w[0] = ALICE;
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        g.releaseReservations(w);
    }

    function testReserveRejectsUncommittedStoredSource() public {
        (MultiSourceGenesisMinter g,,) = _deploy(16, 8, 5, 3);
        uint256[] memory rp = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) rp[i] = 200 + i;
        vm.startPrank(OWNER);
        g.addSourcePool(1, rp);
        g.setSourcePayload(1, 201, _payload(1)); // 200 deliberately uncommitted
        uint8[] memory cs = new uint8[](1);
        cs[0] = 1;
        uint256[] memory ss = new uint256[](1);
        ss[0] = 200;
        vm.expectRevert(
            abi.encodeWithSelector(MultiSourceGenesisMinter.MissingSourcePayload.selector, uint256(200))
        );
        g.reserveSources(ALICE, cs, ss);
        vm.stopPrank();
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH); // 400
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }
}
