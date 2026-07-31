// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";

contract PoolMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function getTokenRawImageData(uint256) external pure returns (bytes memory) { return ""; }
}

contract PoolMockCC0 is ERC721 {
    constructor(string memory n) ERC721(n, n) { }
}

/// @notice The attestation-free post-mint "spin the wheel" re-base: an owner locks a
///         cube onto an UNUSED pool source (any Normie, or a CC0 with committed art),
///         with one-cube-per-source uniqueness + release-on-rebase recycling.
contract PoolRebaseTest is Test {
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    CubeNFT private cubes;
    NonNormieArtStore private store;
    PoolMockNormies private normies;
    PoolMockCC0 private runner;

    uint256 private cubeA; // ALICE, genesis source runner #100
    uint256 private cubeB; // BOB, genesis source runner #200

    function setUp() public {
        normies = new PoolMockNormies();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, address(this));
        runner = new PoolMockCC0("Chain Runners");
        store = new NonNormieArtStore(address(cubes), address(this));
        cubes.setArtStore(address(store));
        cubes.setCustomizesEnabled(true); // open the customize gate for the re-base tests

        // Commit source-keyed CC0 art for two Runner tokens (the "pool" the wheel draws).
        store.recordSourcePayload(address(runner), 500, _payload(1));
        store.recordSourcePayload(address(runner), 501, _payload(2));

        // Two genesis-style external cubes (test is the token owner => can snapshot-mint).
        cubeA = cubes.mintSnapshotExternalCubeFor(ALICE, address(runner), 100, 0, bytes32("a"), 1);
        cubeB = cubes.mintSnapshotExternalCubeFor(BOB, address(runner), 200, 8, bytes32("b"), 1);
    }

    function _key(address c, uint256 id) private view returns (bytes32) {
        return cubes.sourceKey(block.chainid, c, id);
    }

    function testGenesisMintClaimsSource() public view {
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 100)), cubeA);
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 200)), cubeB);
    }

    function testRebaseToUnusedCC0ReleasesOldClaimsNew() public {
        vm.prank(ALICE);
        cubes.rebaseToPoolSource(cubeA, address(runner), 500);

        // old released, new claimed
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 100)), 0);
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 500)), cubeA);

        CubeNFT.CubeData memory d = cubes.cubeData(cubeA);
        assertEq(d.sourceContract, address(runner));
        assertEq(d.sourceTokenId, 500);
        assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());

        // provenance: origin stays the genesis runner #100
        (address oc, uint256 ot) = cubes.cubeOrigin(cubeA);
        assertEq(oc, address(runner));
        assertEq(ot, 100);
    }

    function testRebaseToUnusedNormieSetsNormieKind() public {
        vm.prank(ALICE);
        cubes.rebaseToPoolSource(cubeA, address(normies), 7);

        CubeNFT.CubeData memory d = cubes.cubeData(cubeA);
        assertEq(d.sourceKind, cubes.SOURCE_KIND_NORMIE()); // live art, not stored
        assertEq(d.sourceContract, address(normies));
        assertEq(d.sourceTokenId, 7);
        assertEq(d.payloadVersion, 0);
        assertEq(cubes.cubeForSourceKey(_key(address(normies), 7)), cubeA);
    }

    function testRebaseRejectsNonPoolSource() public {
        // A CC0 token with no committed art (and not a Normie) is not re-basable.
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NotPoolSource.selector, address(runner), 999));
        cubes.rebaseToPoolSource(cubeA, address(runner), 999);
    }

    function testRebaseRejectsNonOwner() public {
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NotCubeOwner.selector, cubeA, BOB));
        cubes.rebaseToPoolSource(cubeA, address(runner), 500);
    }

    function testRebaseRevertsWhenCustomizesDisabled() public {
        // The customize off-switch gates the pool re-base path too (test owns the token).
        cubes.setCustomizesEnabled(false);
        vm.prank(ALICE);
        vm.expectRevert(CubeNFT.CustomizesDisabled.selector);
        cubes.rebaseToPoolSource(cubeA, address(runner), 500);
    }

    function testUniquenessAndRecycle() public {
        // ALICE claims Runner #500.
        vm.prank(ALICE);
        cubes.rebaseToPoolSource(cubeA, address(runner), 500);

        // BOB can't claim the same source while ALICE holds it.
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.SourceAlreadyClaimed.selector, address(runner), 500, cubeA));
        cubes.rebaseToPoolSource(cubeB, address(runner), 500);

        // ALICE moves on → #500 is released back to the pool.
        vm.prank(ALICE);
        cubes.rebaseToPoolSource(cubeA, address(runner), 501);
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 500)), 0);

        // Now BOB can grab the released #500.
        vm.prank(BOB);
        cubes.rebaseToPoolSource(cubeB, address(runner), 500);
        assertEq(cubes.cubeForSourceKey(_key(address(runner), 500)), cubeB);
    }

    function testWalletCustomizeReleasesGenesisSource() public {
        // The existing wallet-art re-base (via the customizer) also frees the cube's
        // old genesis source back to the pool — that's the drift the design wants.
        cubes.setCustomizer(address(this));
        cubes.customizeCubeSource(cubeA, address(0xABCD), 42, 1); // 0xABCD not pooled

        assertEq(cubes.cubeForSourceKey(_key(address(runner), 100)), 0); // released
        assertEq(cubes.cubeForSourceKey(_key(address(0xABCD), 42)), 0); // arbitrary art untracked
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }
}
