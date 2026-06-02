// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {NormieGenesisMinter} from "../src/NormieGenesisMinter.sol";

contract GenesisMockERC721 is ERC721 {
    constructor() ERC721("Normies", "NORM") {}

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

    function testPublicMintUsesDeterministicRandomPullFormula() public {
        uint256 expected = _expectedPublicPick(PUBLIC_MINTER, 0, 0, 5);

        vm.prank(PUBLIC_MINTER);
        uint256[] memory cubeIds = genesis.mintPublic(1);

        assertEq(_sourceToken(cubeIds[0]), expected);
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
        NormieGenesisMinter localGenesis = new NormieGenesisMinter(
            localCubes,
            bytes32("public-seed"),
            OWNER
        );

        vm.prank(OWNER);
        localCubes.transferOwnership(address(localGenesis));

        vm.prank(ALICE);
        vm.expectRevert(NormieGenesisMinter.SnapshotNotFinalized.selector);
        localGenesis.mintAllowlist(1);
    }

    function testCannotMintZeroQuantity() public {
        vm.prank(ALICE);
        vm.expectRevert(NormieGenesisMinter.InvalidQuantity.selector);
        genesis.mintAllowlist(0);
    }

    function testMintClosesAtCubeSupplyCap() public {
        CubeNFT localCubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 3, OWNER);
        NormieGenesisMinter localGenesis = new NormieGenesisMinter(
            localCubes,
            bytes32("small-seed"),
            OWNER
        );
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
        vm.expectRevert(NormieGenesisMinter.MintClosed.selector);
        localGenesis.mintPublic(1);
    }

    function testSeaDropMintsAllowlistPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(NormieGenesisMinter.Phase.Allowlist);

        vm.prank(SEA_DROP);
        uint256[] memory cubeIds = genesis.mintSeaDrop(ALICE, 2);

        assertEq(cubeIds.length, 2);
        assertEq(cubes.ownerOf(cubeIds[0]), ALICE);
        assertEq(_sourceToken(cubeIds[0]), 101);
        assertEq(_sourceToken(cubeIds[1]), 102);
    }

    function testSeaDropMintsPublicPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(NormieGenesisMinter.Phase.Public);

        uint256 expected = _expectedPublicPick(PUBLIC_MINTER, 0, 0, 5);

        vm.prank(SEA_DROP);
        uint256[] memory cubeIds = genesis.mintSeaDrop(PUBLIC_MINTER, 1);

        assertEq(cubeIds.length, 1);
        assertEq(cubes.ownerOf(cubeIds[0]), PUBLIC_MINTER);
        assertEq(_sourceToken(cubeIds[0]), expected);
    }

    function testSeaDropRejectsUnauthorizedCaller() public {
        vm.prank(OWNER);
        genesis.setPhase(NormieGenesisMinter.Phase.Allowlist);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(
            NormieGenesisMinter.UnauthorizedSeaDrop.selector,
            ALICE
        ));
        genesis.mintSeaDrop(ALICE, 1);
    }

    function testSeaDropRejectsClosedPhase() public {
        vm.prank(OWNER);
        genesis.setPhase(NormieGenesisMinter.Phase.Closed);

        vm.prank(SEA_DROP);
        vm.expectRevert(NormieGenesisMinter.MintClosed.selector);
        genesis.mintSeaDrop(ALICE, 1);
    }

    function testOwnerCanUpdateSeaDropCaller() public {
        address newSeaDrop = address(0xBEEF);
        vm.prank(OWNER);
        genesis.setSeaDrop(newSeaDrop);
        assertEq(genesis.seaDrop(), newSeaDrop);
    }

    function testCannotSetZeroSeaDrop() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(
            NormieGenesisMinter.InvalidSeaDrop.selector,
            address(0)
        ));
        genesis.setSeaDrop(address(0));
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
        uint256 index = uint256(keccak256(abi.encode(
            genesis.publicSeed(),
            minter,
            mintedCount,
            mintedNow,
            remaining
        ))) % remaining;
        return genesis.publicNormieAt(index);
    }
}
