// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";
import { FlatteningAttestation } from "../src/FlatteningAttestation.sol";
import { CubeMintController } from "../src/CubeMintController.sol";

contract VerifyMockERC721 is ERC721 {
    constructor(string memory n, string memory s) ERC721(n, s) { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

/// @notice Verification suite for the post-mint world mechanics — move, merge, and
///         customize — focused on the documented cross-cutting invariants and the
///         full lifecycle (mint -> customize -> move -> merge), which the per-mechanic
///         unit tests in CubeNFT.t.sol / CubeMintController.t.sol don't chain:
///           * a cube's SEED (edge-point identity) is permanent; its SLOT (location,
///             which the renderer derives colour/geometry/street from) is mutable;
///           * a move truly RELEASES the old slot back to the world for reuse;
///           * a re-based (customized) source survives a later move;
///           * merge population reflects only the plots still occupying the street.
contract PostMintMechanicsVerificationTest is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant ADMIN = address(0xADA);
    address private constant ALICE = address(0xA11CA);
    address private constant BOB = address(0xB0B);

    VerifyMockERC721 private normies;
    VerifyMockERC721 private externalNft;
    CubeNFT private cubes;
    NonNormieArtStore private artStore;
    FlatteningAttestation private attest;
    CubeMintController private controller;
    address private signer;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        normies = new VerifyMockERC721("Normies", "NORM");
        externalNft = new VerifyMockERC721("External", "EXT");

        // ADMIN owns the token so it can mint genesis cubes at known slots and toggle
        // moves; the controller is only the customizer (not the token owner).
        vm.startPrank(ADMIN);
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 64, ADMIN);
        attest = new FlatteningAttestation(ADMIN, signer);
        vm.stopPrank();

        artStore = new NonNormieArtStore(address(cubes), address(this));
        controller = new CubeMintController(cubes, artStore, attest);

        vm.startPrank(ADMIN);
        cubes.setCustomizer(address(controller));
        cubes.setMovesEnabled(true);
        cubes.setMergesEnabled(true);
        cubes.setCustomizesEnabled(true);
        cubes.setBaseFee(0); // fee-free so these mechanic tests need no ETH (fees: CubeFeesTest)
        cubes.setPremiumPerPoint(0);
        attest.setAuthorizedConsumer(address(controller));
        vm.stopPrank();

        artStore.transferOwnership(address(controller)); // customize records via the store
        vm.warp(1_000);
    }

    // ---- Move --------------------------------------------------------------

    function testMoveReleasesOldSlotBackToTheWorld() public {
        uint256 a = _mintNormieAt(ALICE, 501, 5);

        vm.prank(ALICE);
        cubes.moveCube(a, 40);
        assertEq(cubes.cubeForSlot(5), 0); // old slot vacated
        assertEq(cubes.cubeForSlot(40), a);

        // The freed slot is genuinely back in the world: a brand-new cube can take it.
        uint256 b = _mintNormieAt(BOB, 502, 5);
        assertEq(cubes.cubeForSlot(5), b);
        assertEq(cubes.cubeData(b).slot, 5);
    }

    function testMovePreservesSeedIdentityAcrossMultipleHops() public {
        uint256 a = _mintNormieAt(ALICE, 501, 5);
        bytes32 seed = cubes.cubeData(a).seed;
        uint256 normieBefore = cubes.cubeData(a).sourceTokenId;

        vm.startPrank(ALICE);
        cubes.moveCube(a, 40);
        cubes.moveCube(a, 41);
        cubes.moveCube(a, 7);
        vm.stopPrank();

        CubeNFT.CubeData memory d = cubes.cubeData(a);
        assertEq(d.slot, 7); // location follows the last hop
        assertEq(d.seed, seed); // identity is permanent across every hop
        assertEq(d.sourceTokenId, normieBefore); // source unchanged by a move
        // Every intermediate slot was released.
        assertEq(cubes.cubeForSlot(5), 0);
        assertEq(cubes.cubeForSlot(40), 0);
        assertEq(cubes.cubeForSlot(41), 0);
        assertEq(cubes.cubeForSlot(7), a);
    }

    // ---- Merge -------------------------------------------------------------

    function testMergePopulationExcludesAPlotMovedOutOfTheStreet() public {
        // Street 0 = slots 0..7. Fill 0..5 (all ALICE-owned).
        uint256 c0 = _mintNormieAt(ALICE, 601, 0);
        uint256 c1 = _mintNormieAt(ALICE, 602, 1);
        uint256 c2 = _mintNormieAt(ALICE, 603, 2);
        _mintNormieAt(ALICE, 604, 3);
        _mintNormieAt(ALICE, 605, 4);
        _mintNormieAt(ALICE, 606, 5);

        // Move the slot-2 cube out to street 5 (slot 40) before merging -> 5 remain on street 0.
        vm.prank(ALICE);
        cubes.moveCube(c2, 40);

        vm.prank(ALICE);
        uint256 streetId = cubes.mergeStreet(0);

        // Only the cubes still on street 0 are merged into it.
        (, uint8 occ, uint256[8] memory plots) = cubes.streetPlots(streetId);
        assertEq(occ, 5);
        assertEq(plots[0], c0);
        assertEq(plots[1], c1);
        assertEq(plots[2], 0); // the moved-away plot is vacant

        // The moved cube is untouched and independent on street 5.
        assertEq(cubes.ownerOf(c2), ALICE);
        assertEq(cubes.cubeData(c2).slot, 40);
        assertEq(cubes.cubeForSlot(40), c2);

        // Merged street locks all 8 of street 0's slots and can't be re-merged.
        for (uint32 k = 0; k < 8; k++) {
            assertEq(cubes.cubeForSlot(k), streetId);
        }
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.StreetAlreadyMerged.selector, uint32(0)));
        cubes.mergeStreet(0);
    }

    // ---- Customize ---------------------------------------------------------

    function testCustomizePreservesIdentityAndMakesCubeStoreRenderable() public {
        uint256 a = _mintNormieAt(ALICE, 701, 9);
        bytes32 seed = cubes.cubeData(a).seed;

        bytes memory payload = _payload(0xE4);
        _customize(a, ALICE, address(externalNft), 1, payload, 1);

        CubeNFT.CubeData memory d = cubes.cubeData(a);
        assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721()); // re-based source
        assertEq(d.sourceContract, address(externalNft));
        assertEq(d.sourceTokenId, 1);
        assertEq(d.slot, 9); // location preserved
        assertEq(d.seed, seed); // identity preserved
        // The store now drives this cube's art: hash recorded + a 200-byte 1-bit
        // bitmap available to the renderer (never empty => not a placeholder).
        assertEq(artStore.payloadForCube(a), payload);
        assertEq(artStore.imageBytesForCube(a).length, 200);
    }

    function testCustomizedSourceSurvivesALaterMove() public {
        uint256 a = _mintNormieAt(ALICE, 701, 9);
        bytes memory payload = _payload(0x5A);
        _customize(a, ALICE, address(externalNft), 2, payload, 1);
        bytes32 seed = cubes.cubeData(a).seed;

        vm.prank(ALICE);
        cubes.moveCube(a, 33);

        CubeNFT.CubeData memory d = cubes.cubeData(a);
        assertEq(d.slot, 33); // moved
        assertEq(d.seed, seed); // identity preserved
        assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721()); // re-base persists
        assertEq(d.sourceContract, address(externalNft));
        assertEq(d.sourceTokenId, 2);
        assertEq(artStore.payloadForCube(a), payload); // art still bound to the cube
    }

    function testCustomizedCubeCanBeMergedAndRetainsItsStoreArt() public {
        _mintNormieAt(ALICE, 801, 0);
        uint256 c1 = _mintNormieAt(ALICE, 802, 1);
        _mintNormieAt(ALICE, 803, 2);
        _mintNormieAt(ALICE, 804, 3);
        _mintNormieAt(ALICE, 805, 4);

        bytes memory payload = _payload(0x77);
        _customize(c1, ALICE, address(externalNft), 3, payload, 1);

        vm.prank(ALICE);
        uint256 streetId = cubes.mergeStreet(0);

        (, uint8 occ,) = cubes.streetPlots(streetId);
        assertEq(occ, 5);
        assertEq(cubes.cubeData(streetId).sourceKind, cubes.SOURCE_KIND_MERGED_STREET());

        // The customized plot is burned but its data + store art are retained so the
        // merged street can still render it.
        CubeNFT.CubeData memory pd = cubes.cubeDataUnchecked(c1);
        assertEq(pd.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
        assertEq(pd.sourceContract, address(externalNft));
        assertEq(artStore.payloadForCube(c1), payload);
    }

    // ---- helpers -----------------------------------------------------------

    function _mintNormieAt(address who, uint256 normieId, uint32 slot)
        private
        returns (uint256 cubeId)
    {
        normies.mint(who, normieId);
        vm.prank(ADMIN);
        cubeId = cubes.mintNormieCubeFor(who, normieId, slot, keccak256(abi.encode("seed", normieId)));
    }

    function _customize(
        uint256 cubeId,
        address owner,
        address sourceContract,
        uint256 sourceTokenId,
        bytes memory payload,
        uint256 nonce
    ) private {
        FlatteningAttestation.Attestation memory a = FlatteningAttestation.Attestation({
            minter: owner,
            sourceContract: sourceContract,
            sourceTokenId: sourceTokenId,
            payloadVersion: NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT,
            agentic: false,
            agentId: 0,
            flatteningVersion: 1,
            payloadHash: NonNormieArt.hashTonalBands2Bit(payload),
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
        bytes32 digest = attest.hashAttestation(a); // external call — do before prank
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        vm.prank(owner);
        controller.customizeCube(cubeId, sourceContract, sourceTokenId, payload, a, abi.encodePacked(r, s, v));
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }
}
