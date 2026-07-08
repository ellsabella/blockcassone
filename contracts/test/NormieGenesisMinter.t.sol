// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";

contract GenesisMockERC721 is ERC721 {
    constructor() ERC721("Normies", "NORM") { }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract NormieGenesisMinterTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant ALICE = address(0xA11CA);
    address private constant BOB = address(0xB0B);
    address private constant PUBLIC_MINTER = address(0xCAFE);
    address private constant SEA_DROP = address(0x5EA);

    GenesisMockERC721 private normies;
    CubeNFT private cubes;
    NormieGenesisMinter private genesis;

    function setUp() public {
        normies = new GenesisMockERC721();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 8, OWNER);
        genesis = new NormieGenesisMinter(cubes, bytes32("public-seed"), OWNER);

        vm.prank(OWNER);
        cubes.transferOwnership(address(genesis));

        _add(ALICE, _ids(101, 102, 103));
        _add(BOB, _ids(201, 202));
        uint256[] memory aliceSnapshot = _ids(101, 102, 103);
        vm.prank(OWNER);
        genesis.setSnapshotRoot(_snapshotHash(ALICE, aliceSnapshot));

        vm.prank(OWNER);
        genesis.finalizeSnapshot();
        vm.prank(OWNER);
        genesis.setSeaDrop(SEA_DROP);
    }

    function testAllowlistMintsOnlyWalletSnapshotNormies() public {
        vm.prank(ALICE);
        uint256[] memory cubeIds = genesis.mintAllowlist(2);

        assertEq(cubeIds.length, 2);
        assertEq(cubes.ownerOf(cubeIds[0]), ALICE);
        assertEq(cubes.ownerOf(cubeIds[1]), ALICE);
        assertEq(_sourceToken(cubeIds[0]), 101);
        assertEq(_sourceToken(cubeIds[1]), 102);
        assertTrue(genesis.normieClaimed(101));
        assertTrue(genesis.normieClaimed(102));
        assertEq(genesis.walletCursor(ALICE), 2);
        assertEq(genesis.publicRemaining(), 3);
    }

    function testAllowlistSkipsNormieAlreadyClaimedByPublic() public {
        vm.prank(PUBLIC_MINTER);
        uint256[] memory publicCubes = genesis.mintPublic(1);
        uint256 publicNormie = _sourceToken(publicCubes[0]);

        vm.prank(ALICE);
        uint256[] memory aliceCubes = genesis.mintAllowlist(3);

        assertEq(aliceCubes.length, publicNormie >= 101 && publicNormie <= 103 ? 2 : 3);
        for (uint256 i = 0; i < aliceCubes.length; i++) {
            uint256 normieId = _sourceToken(aliceCubes[i]);
            assertEq(cubes.ownerOf(aliceCubes[i]), ALICE);
            assertTrue(normieId >= 101 && normieId <= 103);
            assertNotEq(normieId, publicNormie);
        }
    }

    function testAllowlistRejectsQuantityAboveRemainingWalletNormies() public {
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                GenesisMinterBase.InsufficientAllowlistNormies.selector, ALICE, 4, 3
            )
        );
        genesis.mintAllowlist(4);

        assertEq(genesis.mintedCount(), 0);
        assertEq(genesis.walletCursor(ALICE), 0);
        assertFalse(genesis.normieClaimed(101));
        assertFalse(genesis.normieClaimed(102));
        assertFalse(genesis.normieClaimed(103));
    }

    function testAllowlistRejectsQuantityAboveRemainingAfterPublicClaim() public {
        vm.prank(PUBLIC_MINTER);
        uint256[] memory publicCubes = genesis.mintPublic(1);
        uint256 publicNormie = _sourceToken(publicCubes[0]);
        uint256 expectedAvailable = publicNormie >= 101 && publicNormie <= 103 ? 2 : 3;

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                GenesisMinterBase.InsufficientAllowlistNormies.selector,
                ALICE,
                expectedAvailable + 1,
                expectedAvailable
            )
        );
        genesis.mintAllowlist(expectedAvailable + 1);
    }

    function testPublicMintUsesDeterministicRandomPullFormula() public {
        uint256 expected = _expectedPublicPick(PUBLIC_MINTER, 0, 0, 5);

        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = genesis.mintPublic(1);

        assertEq(_sourceToken(cubeIds[0]), expected);
    }

    function testPublicMintDoesNotUseLowestNormieCursorOrder() public {
        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = genesis.mintPublic(3);

        assertEq(cubeIds.length, 3);
        bool sequential = _sourceToken(cubeIds[0]) == 101 && _sourceToken(cubeIds[1]) == 102
            && _sourceToken(cubeIds[2]) == 103;
        assertFalse(sequential);
    }

    function testSnapshotAgentBindingIsAppliedToAllowlistMint() public {
        vm.prank(OWNER);
        genesis.setSnapshotAgentBinding(101, 5025);

        vm.prank(ALICE);
        uint256[] memory cubeIds = genesis.mintAllowlist(1);

        CubeNFT.CubeData memory data = cubes.cubeData(cubeIds[0]);
        assertEq(data.sourceTokenId, 101);
        assertTrue(data.agentic);
        assertEq(data.agentId, 5025);
    }

    function testSnapshotAgentBindingIsAppliedToPublicMint() public {
        uint256 expected = _expectedPublicPick(PUBLIC_MINTER, 0, 0, 5);

        vm.prank(OWNER);
        genesis.setSnapshotAgentBinding(expected, 5025);

        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = genesis.mintPublic(1);

        CubeNFT.CubeData memory data = cubes.cubeData(cubeIds[0]);
        assertEq(data.sourceTokenId, expected);
        assertTrue(data.agentic);
        assertEq(data.agentId, 5025);
    }

    function testPublicMintConsumesRemainingUnclaimedNormies() public {
        vm.prank(ALICE);
        genesis.mintAllowlist(3);

        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = genesis.mintPublic(4);

        assertEq(cubeIds.length, 2);
        assertEq(cubes.ownerOf(cubeIds[0]), PUBLIC_MINTER);
        assertEq(cubes.ownerOf(cubeIds[1]), PUBLIC_MINTER);
        assertTrue(_sourceToken(cubeIds[0]) == 201 || _sourceToken(cubeIds[0]) == 202);
        assertTrue(_sourceToken(cubeIds[1]) == 201 || _sourceToken(cubeIds[1]) == 202);
        assertEq(genesis.publicRemaining(), 0);
    }

    function testCannotMintBeforeFinalized() public {
        CubeNFT localCubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 8, OWNER);
        NormieGenesisMinter localGenesis =
            new NormieGenesisMinter(localCubes, bytes32("public-seed"), OWNER);

        vm.prank(OWNER);
        localCubes.transferOwnership(address(localGenesis));

        vm.prank(ALICE);
        vm.expectRevert(GenesisMinterBase.SnapshotNotFinalized.selector);
        localGenesis.mintAllowlist(1);
    }

    function testCannotMintZeroQuantity() public {
        vm.prank(ALICE);
        vm.expectRevert(GenesisMinterBase.InvalidQuantity.selector);
        genesis.mintAllowlist(0);
    }

    function testMintClosesAtCubeSupplyCap() public {
        CubeNFT localCubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 3, OWNER);
        NormieGenesisMinter localGenesis =
            new NormieGenesisMinter(localCubes, bytes32("small-seed"), OWNER);
        vm.prank(OWNER);
        localCubes.transferOwnership(address(localGenesis));
        vm.prank(OWNER);
        localGenesis.addSnapshotNormies(ALICE, _ids(301, 302, 303, 304, 305));
        vm.prank(OWNER);
        localGenesis.finalizeSnapshot();

        vm.prank(PUBLIC_MINTER);
        uint256[] memory first = localGenesis.mintPublic(8);
        assertEq(first.length, 3);

        vm.prank(PUBLIC_MINTER);
        vm.expectRevert(GenesisMinterBase.MintClosed.selector);
        localGenesis.mintPublic(1);
    }

    function testSeaDropMintsAllowlistPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        uint256[] memory aliceSnapshot = _ids(101, 102, 103);
        uint256[] memory selected = _ids(103, 101);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(ALICE);
        genesis.selectAllowlistNormies(aliceSnapshot, selected, proof);

        vm.prank(SEA_DROP);
        uint256[] memory cubeIds = genesis.mintSeaDrop(ALICE, 2);

        assertEq(cubeIds.length, 2);
        assertEq(cubes.ownerOf(cubeIds[0]), ALICE);
        assertEq(_sourceToken(cubeIds[0]), 103);
        assertEq(_sourceToken(cubeIds[1]), 101);
        assertEq(genesis.selectedNormieCount(ALICE), 2);
        assertEq(genesis.selectionCursor(ALICE), 2);
    }

    function testSeaDropMintsPublicPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Public);

        uint256 expected = _expectedPublicPick(PUBLIC_MINTER, 0, 0, 5);

        vm.prank(SEA_DROP);
        uint256[] memory cubeIds = genesis.mintSeaDrop(PUBLIC_MINTER, 1);

        assertEq(cubeIds.length, 1);
        assertEq(cubes.ownerOf(cubeIds[0]), PUBLIC_MINTER);
        assertEq(_sourceToken(cubeIds[0]), expected);
    }

    function testSeaDropPublicRevertsOnPartialFill() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Public);

        // Pool has 5 (101,102,103,201,202); asking for 6 can't be fully filled.
        assertEq(genesis.publicRemaining(), 5);
        vm.prank(SEA_DROP);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.IncompletePublicFill.selector, 6, 5)
        );
        genesis.mintSeaDrop(PUBLIC_MINTER, 6);

        // Nothing minted — the whole call reverted (buyer would've paid for 6).
        assertEq(genesis.mintedCount(), 0);
        assertEq(genesis.publicRemaining(), 5);
    }

    function testSeaDropPublicFillsExactlyAvailable() public {
        // 16 slots = 2 streets; one wallet's 5-plot per-street cap lets it take all 5
        // here (the shared 8-slot setUp is a single street, also 5-cap).
        NormieGenesisMinter g = _freshPublicMinter(16, _ids5(401, 402, 403, 404, 405));

        vm.prank(SEA_DROP);
        uint256[] memory cubeIds = g.mintSeaDrop(PUBLIC_MINTER, 5);
        assertEq(cubeIds.length, 5);
        assertEq(g.mintedCount(), 5);
        assertEq(g.publicRemaining(), 0);
    }

    function testSeaDropPublicRevertsWhenSupplyCapCannotCover() public {
        // Fresh minter with a supply cap (2) smaller than the pool (5): available is
        // capped by remaining supply, so a 3-qty SeaDrop mint must revert.
        CubeNFT localCubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 2, OWNER);
        NormieGenesisMinter g = new NormieGenesisMinter(localCubes, bytes32("cap-seed"), OWNER);
        vm.startPrank(OWNER);
        localCubes.transferOwnership(address(g));
        g.addSnapshotNormies(ALICE, _ids(301, 302, 303));
        g.addSnapshotNormies(BOB, _ids(304, 305));
        g.finalizeSnapshot();
        g.setSeaDrop(SEA_DROP);
        g.setPhase(GenesisMinterBase.Phase.Public);
        vm.stopPrank();

        vm.prank(SEA_DROP);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.IncompletePublicFill.selector, 3, 2)
        );
        g.mintSeaDrop(PUBLIC_MINTER, 3);
    }

    function testDirectMintPublicStillAllowsPartialFill() public {
        // Contrast: the direct (unpaid) mintPublic path stays best-effort — a 6-qty
        // ask against a 5-token pool mints 5, where the SeaDrop path would revert.
        NormieGenesisMinter g = _freshPublicMinter(16, _ids5(401, 402, 403, 404, 405));

        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = g.mintPublic(6);
        assertEq(cubeIds.length, 5);
        assertEq(g.publicRemaining(), 0);
    }

    // A finalized public-phase minter with `slots` slots and the given pool, its
    // SeaDrop caller set to SEA_DROP. Used where a wallet needs more than the 3
    // plots a single street allows.
    function _freshPublicMinter(uint32 slots, uint256[] memory poolIds)
        private
        returns (NormieGenesisMinter g)
    {
        CubeNFT localCubes =
            new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), slots, OWNER);
        g = new NormieGenesisMinter(localCubes, bytes32("fresh-seed"), OWNER);
        vm.startPrank(OWNER);
        localCubes.transferOwnership(address(g));
        g.addSnapshotNormies(ALICE, poolIds);
        g.finalizeSnapshot();
        g.setSeaDrop(SEA_DROP);
        g.setPhase(GenesisMinterBase.Phase.Public);
        vm.stopPrank();
    }

    function _ids5(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e)
        private
        pure
        returns (uint256[] memory r)
    {
        r = new uint256[](5);
        r[0] = a;
        r[1] = b;
        r[2] = c;
        r[3] = d;
        r[4] = e;
    }

    function testSeaDropRejectsUnauthorizedCaller() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Allowlist);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.UnauthorizedSeaDrop.selector, ALICE)
        );
        genesis.mintSeaDrop(ALICE, 1);
    }

    function testSeaDropRejectsClosedPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Closed);

        vm.prank(SEA_DROP);
        vm.expectRevert(GenesisMinterBase.MintClosed.selector);
        genesis.mintSeaDrop(ALICE, 1);
    }

    function testSeaDropAllowlistRequiresPreselection() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Allowlist);

        vm.prank(SEA_DROP);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.NoAllowlistNormies.selector, ALICE)
        );
        genesis.mintSeaDrop(ALICE, 1);
    }

    function testSeaDropAllowlistRejectsQuantityAboveSelection() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        uint256[] memory aliceSnapshot = _ids(101, 102, 103);
        uint256[] memory selected = _ids(103, 101);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(ALICE);
        genesis.selectAllowlistNormies(aliceSnapshot, selected, proof);

        vm.prank(SEA_DROP);
        vm.expectRevert(
            abi.encodeWithSelector(
                GenesisMinterBase.InsufficientAllowlistNormies.selector, ALICE, 3, 2
            )
        );
        genesis.mintSeaDrop(ALICE, 3);

        assertEq(genesis.mintedCount(), 0);
        assertEq(genesis.selectionCursor(ALICE), 0);
        assertFalse(genesis.normieClaimed(103));
        assertFalse(genesis.normieClaimed(101));
    }

    function testSeaDropAllowlistRejectsQuantityAboveRemainingSelection() public {
        vm.prank(OWNER);
        genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        uint256[] memory aliceSnapshot = _ids(101, 102, 103);
        uint256[] memory selected = _ids(103, 101);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(ALICE);
        genesis.selectAllowlistNormies(aliceSnapshot, selected, proof);

        vm.prank(SEA_DROP);
        genesis.mintSeaDrop(ALICE, 1);

        vm.prank(SEA_DROP);
        vm.expectRevert(
            abi.encodeWithSelector(
                GenesisMinterBase.InsufficientAllowlistNormies.selector, ALICE, 2, 1
            )
        );
        genesis.mintSeaDrop(ALICE, 2);
    }

    function testCannotSelectNormieOutsideSnapshot() public {
        uint256[] memory aliceSnapshot = _ids(101, 102, 103);
        uint256[] memory selected = _ids(101, 201);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.NormieNotInSnapshot.selector, 201)
        );
        genesis.selectAllowlistNormies(aliceSnapshot, selected, proof);
    }

    function testCannotSelectWithInvalidSnapshotProof() public {
        uint256[] memory bobSnapshot = _ids(201, 202);
        uint256[] memory selected = _ids(201);
        bytes32[] memory proof = new bytes32[](0);

        vm.prank(BOB);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.InvalidSnapshotProof.selector, BOB)
        );
        genesis.selectAllowlistNormies(bobSnapshot, selected, proof);
    }

    function testOwnerCanUpdateSeaDropCaller() public {
        address newSeaDrop = address(0xBEEF);
        vm.prank(OWNER);
        genesis.setSeaDrop(newSeaDrop);
        assertEq(genesis.seaDrop(), newSeaDrop);
    }

    function testCannotSetZeroSeaDrop() public {
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(GenesisMinterBase.InvalidSeaDrop.selector, address(0))
        );
        genesis.setSeaDrop(address(0));
    }

    // ---- Plot allocation ----------------------------------------------------

    function testAllocationSpreadsNewWalletsAcrossFreshStreets() public {
        (NormieGenesisMinter g, CubeNFT c) = _world(32); // 4 streets
        address[4] memory w = [address(0xE0), address(0xE1), address(0xE2), address(0xE3)];
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(w[i]);
            uint256 cubeId = g.mintPublic(1)[0];
            assertEq(_slot(c, cubeId), uint32(i * 8)); // plot 0 of a fresh street each
        }
    }

    function testAllocationSingleWalletRunSpillsFivePerStreet() public {
        (NormieGenesisMinter g, CubeNFT c) = _world(32);
        vm.prank(BOB);
        uint256[] memory ids = g.mintPublic(8);

        uint32[8] memory expected = [uint32(0), 1, 2, 3, 4, 8, 9, 10]; // 5+3, contiguous run
        for (uint256 i = 0; i < 8; i++) {
            assertEq(_slot(c, ids[i]), expected[i]);
        }
        assertEq(g.streetFill(0), 5);
        assertEq(g.streetFill(1), 3);
        assertEq(g.walletStreetCount(BOB), 3);
    }

    function testAllocationWrapsAfterAllStreetsSeeded() public {
        (NormieGenesisMinter g, CubeNFT c) = _world(16); // 2 streets

        vm.prank(address(0xC0));
        uint256 a = g.mintPublic(1)[0];
        vm.prank(address(0xC1));
        uint256 b = g.mintPublic(1)[0];
        assertEq(_slot(c, a), 0); // street 0
        assertEq(_slot(c, b), 8); // street 1 (fresh anchor)

        // Every street now has >= 1 mint -> wrap and backfill the frontier.
        vm.prank(address(0xC2));
        uint256 d = g.mintPublic(1)[0];
        assertEq(_slot(c, d), 1); // street 0, plot 1
    }

    function testAllocationSharesStreetAcrossWallets() public {
        (NormieGenesisMinter g, CubeNFT c) = _world(8); // 1 street

        vm.prank(address(0xD0));
        uint256[] memory a = g.mintPublic(3);
        vm.prank(address(0xD1));
        uint256[] memory b = g.mintPublic(3);
        vm.prank(address(0xD2));
        uint256[] memory d = g.mintPublic(2);

        assertEq(_slot(c, a[0]), 0);
        assertEq(_slot(c, a[2]), 2);
        assertEq(_slot(c, b[0]), 3);
        assertEq(_slot(c, b[2]), 5);
        assertEq(_slot(c, d[0]), 6);
        assertEq(_slot(c, d[1]), 7);
        assertEq(g.streetFill(0), 8); // 3 + 3 + 2, shared by three wallets
    }

    function testAllocationRevertsWhenWalletCapsOnlyStreet() public {
        (NormieGenesisMinter g,) = _world(8); // 1 street
        vm.prank(BOB);
        g.mintPublic(5); // BOB caps street 0 at its 5-plot per-wallet limit

        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(GenesisMinterBase.NoVacantPlot.selector, BOB));
        g.mintPublic(1); // no street left where BOB is under its cap
    }

    function _world(uint32 slots) private returns (NormieGenesisMinter g, CubeNFT c) {
        c = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), slots, OWNER);
        g = new NormieGenesisMinter(c, bytes32("alloc-seed"), OWNER);
        vm.prank(OWNER);
        c.transferOwnership(address(g));

        uint256[] memory ids = new uint256[](slots);
        for (uint256 i = 0; i < slots; i++) {
            ids[i] = 5000 + i;
        }
        vm.prank(OWNER);
        g.addSnapshotNormies(OWNER, ids);
        vm.prank(OWNER);
        g.finalizeSnapshot();
    }

    function _slot(CubeNFT c, uint256 cubeId) private view returns (uint32) {
        return c.cubeData(cubeId).slot;
    }

    function _add(address wallet, uint256[] memory ids) private {
        vm.prank(OWNER);
        genesis.addSnapshotNormies(wallet, ids);
    }

    function _ids(uint256 a, uint256 b) private pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory ids) {
        ids = new uint256[](3);
        ids[0] = a;
        ids[1] = b;
        ids[2] = c;
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e, uint256 f)
        private
        pure
        returns (uint256[] memory ids)
    {
        ids = new uint256[](6);
        ids[0] = a;
        ids[1] = b;
        ids[2] = c;
        ids[3] = d;
        ids[4] = e;
        ids[5] = f;
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e)
        private
        pure
        returns (uint256[] memory ids)
    {
        ids = new uint256[](5);
        ids[0] = a;
        ids[1] = b;
        ids[2] = c;
        ids[3] = d;
        ids[4] = e;
    }

    function _sourceToken(uint256 cubeId) private view returns (uint256) {
        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        return data.sourceTokenId;
    }

    function _expectedPublicPick(
        address minter,
        uint256 mintedCount,
        uint256 mintedNow,
        uint256 remaining
    ) private view returns (uint256) {
        uint256 index = uint256(
            keccak256(abi.encode(genesis.publicSeed(), minter, mintedCount, mintedNow, remaining))
        ) % remaining;
        return genesis.publicNormieAt(index);
    }

    function _snapshotHash(address wallet, uint256[] memory normieIds)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(wallet, keccak256(abi.encode(normieIds))));
    }
}
