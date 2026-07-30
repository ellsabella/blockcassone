// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {AgentStatusRegistry} from "../src/AgentStatusRegistry.sol";
import {CubeNFT} from "../src/CubeNFT.sol";

contract MockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract MockCubeRenderer {
    string public uri = "data:application/json;base64,test";

    function setURI(string calldata uri_) external {
        uri = uri_;
    }

    function tokenURI(uint256) external view returns (string memory) {
        return uri;
    }
}

contract CubeNFTTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant MINTER = address(0xB0B);
    address private constant OTHER = address(0xCAFE);

    MockERC721 private normies;
    MockERC721 private externalNft;
    MockCubeRenderer private renderer;
    AgentStatusRegistry private agentRegistry;
    CubeNFT private cubes;

    function setUp() public {
        normies = new MockERC721("Normies", "NORM");
        externalNft = new MockERC721("External", "EXT");
        renderer = new MockCubeRenderer();
        agentRegistry = new AgentStatusRegistry(OWNER);
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 64, OWNER);

        normies.mint(MINTER, 101);
        normies.mint(OTHER, 202);
        externalNft.mint(MINTER, 1);
        externalNft.mint(OTHER, 2);

        // Merges are OFF by default; enable them for the merge-mechanic tests. The gate itself
        // is covered by testMergeStreetRevertsWhenDisabled (moves stay off — separate switch).
        vm.prank(OWNER);
        cubes.setMergesEnabled(true);
    }

    function testMintNormieCubeStoresImmutableFacts() public {
        bytes32 seed = keccak256("normie-seed");

        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 7, seed);

        assertEq(cubeId, 1);
        assertEq(cubes.ownerOf(cubeId), MINTER);
        assertEq(cubes.cubeForSlot(7), cubeId);
        assertEq(cubes.cubeForNormieId(101), cubeId);
        assertEq(cubes.cubeForSourceKey(cubes.sourceKey(block.chainid, address(normies), 101)), cubeId);

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.slot, 7);
        assertEq(data.sourceKind, cubes.SOURCE_KIND_NORMIE());
        assertEq(data.rendererVersion, 1);
        assertEq(data.payloadVersion, 0);
        assertFalse(data.agentic);
        assertEq(data.agentId, 0);
        assertEq(data.sourceChainId, block.chainid);
        assertEq(data.sourceContract, address(normies));
        assertEq(data.sourceTokenId, 101);
        assertEq(data.seed, seed);
    }

    function testMintExternalCubeStoresSourceKeyAndFacts() public {
        bytes32 seed = keccak256("external-seed");

        vm.prank(MINTER);
        uint256 cubeId = cubes.mintExternalERC721Cube(address(externalNft), 1, 9, seed);

        assertEq(cubeId, 1);
        assertEq(cubes.ownerOf(cubeId), MINTER);
        assertEq(cubes.cubeForSlot(9), cubeId);
        assertEq(
            cubes.cubeForSourceKey(cubes.sourceKey(block.chainid, address(externalNft), 1)),
            cubeId
        );

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.slot, 9);
        assertEq(data.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
        assertFalse(data.agentic);
        assertEq(data.agentId, 0);
        assertEq(data.sourceContract, address(externalNft));
        assertEq(data.sourceTokenId, 1);
        assertEq(data.seed, seed);
    }

    function testOwnerCanMintExternalCubeWithAgenticFlag() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintExternalERC721CubeForWithPayloadVersionAndAgentic(
            MINTER,
            address(externalNft),
            1,
            12,
            bytes32("seed"),
            1,
            true,
            32813
        );

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertTrue(data.agentic);
        assertEq(data.agentId, 32813);
        assertEq(data.payloadVersion, 1);
    }

    function testOwnerCanMintNormieCubeWithAgentId() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintNormieCubeForWithAgent(
            MINTER,
            101,
            12,
            bytes32("seed"),
            32813
        );

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertTrue(data.agentic);
        assertEq(data.agentId, 32813);
        assertEq(cubes.cubeForNormieId(101), cubeId);
    }

    function testOwnerCanMintSnapshotNormieCubeWithAgentId() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintSnapshotNormieCubeForWithAgent(
            MINTER,
            101,
            12,
            bytes32("seed"),
            32813
        );

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertTrue(data.agentic);
        assertEq(data.agentId, 32813);
        assertEq(cubes.cubeForNormieId(101), cubeId);
    }

    function testResolvedCubeDataFallsBackToMintSnapshotAgentStatus() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintSnapshotNormieCubeForWithAgent(
            MINTER,
            101,
            12,
            bytes32("seed"),
            32813
        );

        CubeNFT.CubeData memory data = cubes.resolvedCubeData(cubeId);
        assertTrue(data.agentic);
        assertEq(data.agentId, 32813);
    }

    function testResolvedCubeDataUsesCurrentAgentRegistryOverride() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintSnapshotNormieCubeFor(MINTER, 101, 12, bytes32("seed"));

        CubeNFT.CubeData memory mintData = cubes.cubeData(cubeId);
        assertFalse(mintData.agentic);
        assertEq(mintData.agentId, 0);

        vm.prank(OWNER);
        cubes.setAgentStatusRegistry(address(agentRegistry));

        vm.prank(OWNER);
        agentRegistry.setAgentBinding(address(normies), 101, true, 5025);

        CubeNFT.CubeData memory resolved = cubes.resolvedCubeData(cubeId);
        assertTrue(resolved.agentic);
        assertEq(resolved.agentId, 5025);

        CubeNFT.CubeData memory stillSnapshot = cubes.cubeData(cubeId);
        assertFalse(stillSnapshot.agentic);
        assertEq(stillSnapshot.agentId, 0);
    }

    function testResolvedCubeDataCanOverrideAgenticSnapshotToCurrentNonAgentic() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintSnapshotNormieCubeForWithAgent(
            MINTER,
            101,
            12,
            bytes32("seed"),
            32813
        );

        vm.prank(OWNER);
        cubes.setAgentStatusRegistry(address(agentRegistry));

        vm.prank(OWNER);
        agentRegistry.setAgentBinding(address(normies), 101, false, 0);

        CubeNFT.CubeData memory resolved = cubes.resolvedCubeData(cubeId);
        assertFalse(resolved.agentic);
        assertEq(resolved.agentId, 0);
    }

    function testOwnerCanSetAgentStatusRegistry() public {
        vm.expectEmit(true, true, true, true, address(cubes));
        emit CubeNFT.AgentStatusRegistryUpdated(address(0), address(agentRegistry));

        vm.prank(OWNER);
        cubes.setAgentStatusRegistry(address(agentRegistry));

        assertEq(cubes.agentStatusRegistry(), address(agentRegistry));
    }

    function testNonOwnerCannotSetAgentStatusRegistry() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        cubes.setAgentStatusRegistry(address(agentRegistry));
    }

    function testCannotMintAgenticCubeWithoutAgentId() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InvalidAgentBinding.selector, true, 0));
        cubes.mintNormieCubeForWithAgent(MINTER, 101, 12, bytes32("seed"), 0);
    }

    function testOwnerCanMintNormieCubeForMinter() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintNormieCubeFor(MINTER, 101, 11, bytes32("seed"));

        assertEq(cubes.ownerOf(cubeId), MINTER);
        assertEq(cubes.cubeForNormieId(101), cubeId);
    }

    function testOwnerCanMintExternalCubeForMinter() public {
        vm.prank(OWNER);
        uint256 cubeId = cubes.mintExternalERC721CubeFor(
            MINTER,
            address(externalNft),
            1,
            12,
            bytes32("seed")
        );

        assertEq(cubes.ownerOf(cubeId), MINTER);
        assertEq(cubes.cubeForSlot(12), cubeId);
    }

    function testNonOwnerCannotMintCubeForMinter() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        cubes.mintExternalERC721CubeFor(MINTER, address(externalNft), 1, 12, bytes32("seed"));
    }

    function testCannotMintNormieNotOwnedByMinter() public {
        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(CubeNFT.NotSourceOwner.selector, address(normies), 202, MINTER)
        );
        cubes.mintNormieCube(202, 1, bytes32("seed"));
    }

    function testCannotMintExternalNotOwnedByMinter() public {
        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(CubeNFT.NotSourceOwner.selector, address(externalNft), 2, MINTER)
        );
        cubes.mintExternalERC721Cube(address(externalNft), 2, 1, bytes32("seed"));
    }

    function testCannotReuseNormieId() public {
        vm.startPrank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 1, bytes32("seed-1"));

        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NormieAlreadyCubed.selector, 101, cubeId));
        cubes.mintNormieCube(101, 2, bytes32("seed-2"));
        vm.stopPrank();
    }

    function testCannotReuseExternalSource() public {
        vm.startPrank(MINTER);
        uint256 cubeId = cubes.mintExternalERC721Cube(address(externalNft), 1, 1, bytes32("seed-1"));

        bytes32 key = cubes.sourceKey(block.chainid, address(externalNft), 1);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.SourceAlreadyCubed.selector, key, cubeId));
        cubes.mintExternalERC721Cube(address(externalNft), 1, 2, bytes32("seed-2"));
        vm.stopPrank();
    }

    function testCannotReuseSlot() public {
        vm.prank(MINTER);
        uint256 firstCubeId = cubes.mintNormieCube(101, 1, bytes32("seed-1"));

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.SlotOccupied.selector, 1, firstCubeId));
        cubes.mintExternalERC721Cube(address(externalNft), 1, 1, bytes32("seed-2"));
    }

    function testCannotMintOutsideSlotRange() public {
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InvalidSlot.selector, 64));
        cubes.mintNormieCube(101, 64, bytes32("seed"));
    }

    function testExternalMintRejectsNormieContract() public {
        vm.prank(MINTER);
        vm.expectRevert(CubeNFT.ExternalSourceIsNormie.selector);
        cubes.mintExternalERC721Cube(address(normies), 101, 1, bytes32("seed"));
    }

    function testCubeDataRevertsForMissingCube() public {
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NonexistentCube.selector, 999));
        cubes.cubeData(999);
    }

    function testOwnerCanSetRendererAndTokenURIDelegates() public {
        vm.prank(OWNER);
        cubes.setRenderer(address(renderer));

        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 7, bytes32("seed"));

        assertEq(cubes.renderer(), address(renderer));
        assertEq(cubes.tokenURI(cubeId), "data:application/json;base64,test");
    }

    function testSetRendererEmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(cubes));
        emit CubeNFT.RendererUpdated(address(0), address(renderer));

        vm.prank(OWNER);
        cubes.setRenderer(address(renderer));
    }

    function testNonOwnerCannotSetRenderer() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        cubes.setRenderer(address(renderer));
    }

    function testTokenURIRevertsWhenRendererMissing() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 7, bytes32("seed"));

        vm.expectRevert(CubeNFT.RendererNotSet.selector);
        cubes.tokenURI(cubeId);
    }

    function testTokenURIRevertsForMissingCube() public {
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NonexistentCube.selector, 999));
        cubes.tokenURI(999);
    }

    // ---- Street merge (8 -> 1) ----------------------------------------------

    function _mintCubeAt(uint256 normieId, uint32 slot, address who) private returns (uint256 cubeId) {
        normies.mint(who, normieId);
        vm.prank(who);
        cubeId = cubes.mintNormieCube(normieId, slot, keccak256(abi.encodePacked("seed", normieId)));
    }

    function testMergeStreetBurnsPlotsAndMintsStreetToken() public {
        // Street 0 = slots 0..7. Occupy 0, 1, 2 with MINTER-owned cubes.
        uint256 c0 = _mintCubeAt(301, 0, MINTER);
        uint256 c1 = _mintCubeAt(302, 1, MINTER);
        uint256 c2 = _mintCubeAt(303, 2, MINTER);

        vm.expectEmit(true, true, true, true, address(cubes));
        emit CubeNFT.StreetMerged(4, MINTER, 0, 3);

        vm.prank(MINTER);
        uint256 streetId = cubes.mergeStreet(0);

        assertEq(streetId, 4); // next id after the 3 cubes
        assertEq(cubes.ownerOf(streetId), MINTER);

        // Plot cubes are burned.
        vm.expectRevert();
        cubes.ownerOf(c0);
        vm.expectRevert();
        cubes.ownerOf(c1);
        vm.expectRevert();
        cubes.ownerOf(c2);

        // The street token locks all 8 slots.
        for (uint32 k = 0; k < 8; k++) {
            assertEq(cubes.cubeForSlot(k), streetId);
        }

        CubeNFT.CubeData memory sd = cubes.cubeData(streetId);
        assertEq(sd.sourceKind, cubes.SOURCE_KIND_MERGED_STREET());
        assertEq(sd.slot, 0); // leader is the lowest occupied plot
        assertEq(sd.sourceTokenId, 301); // leader Normie -> street thumbnail
        assertEq(sd.seed, keccak256(abi.encodePacked("seed", uint256(301))));

        (uint32 street, uint8 occ, uint256[8] memory plots) = cubes.streetPlots(streetId);
        assertEq(street, 0);
        assertEq(occ, 3);
        assertEq(plots[0], c0);
        assertEq(plots[1], c1);
        assertEq(plots[2], c2);
        assertEq(plots[3], 0);

        // Burned plot data is retained for rendering.
        CubeNFT.CubeData memory pd = cubes.cubeDataUnchecked(c2);
        assertEq(pd.slot, 2);
        assertEq(pd.sourceTokenId, 303);
    }

    function testMergeStreetRevertsIfNotSoleOwner() public {
        _mintCubeAt(301, 0, MINTER);
        uint256 other = _mintCubeAt(302, 1, OTHER);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NotStreetOwner.selector, uint32(0), other));
        cubes.mergeStreet(0);
    }

    function testMergeStreetRevertsIfEmpty() public {
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.EmptyStreet.selector, uint32(1)));
        cubes.mergeStreet(1);
    }

    function testMergeStreetRevertsIfAlreadyMerged() public {
        _mintCubeAt(301, 0, MINTER);
        vm.prank(MINTER);
        cubes.mergeStreet(0);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.StreetAlreadyMerged.selector, uint32(0)));
        cubes.mergeStreet(0);
    }

    function testMergeStreetLeaderIsLowestOccupiedPlot() public {
        // Slot 0 vacant; occupy 1 then 3 -> leader is the slot-1 cube.
        uint256 c1 = _mintCubeAt(302, 1, MINTER);
        _mintCubeAt(304, 3, MINTER);

        vm.prank(MINTER);
        uint256 streetId = cubes.mergeStreet(0);

        CubeNFT.CubeData memory sd = cubes.cubeData(streetId);
        assertEq(sd.slot, 1);
        assertEq(sd.sourceTokenId, 302);

        (, uint8 occ, uint256[8] memory plots) = cubes.streetPlots(streetId);
        assertEq(occ, 2);
        assertEq(plots[0], 0);
        assertEq(plots[1], c1);
    }

    function testMergeStreetRevertsForOutOfRangeStreet() public {
        // totalSlots = 64 -> valid streets are 0..7.
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InvalidSlot.selector, uint32(64)));
        cubes.mergeStreet(8);
    }

    // ---- Move ----------------------------------------------------------------

    function testMoveCubeUpdatesSlotAndPreservesSeed() public {
        uint256 cubeId = _mintCubeAt(401, 5, MINTER);
        bytes32 seedBefore = cubes.cubeData(cubeId).seed;

        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.expectEmit(true, true, true, true, address(cubes));
        emit CubeNFT.CubeMoved(cubeId, 5, 40, MINTER);
        vm.prank(MINTER);
        cubes.moveCube(cubeId, 40);

        assertEq(cubes.cubeForSlot(5), 0);
        assertEq(cubes.cubeForSlot(40), cubeId);
        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.slot, 40);
        assertEq(data.seed, seedBefore); // edge-point identity is preserved across a move
    }

    function testMoveCubeRevertsWhenDisabled() public {
        uint256 cubeId = _mintCubeAt(401, 5, MINTER);
        vm.prank(MINTER);
        vm.expectRevert(CubeNFT.MovesDisabled.selector);
        cubes.moveCube(cubeId, 40);
    }

    function testMoveCubeRevertsForNonOwner() public {
        uint256 cubeId = _mintCubeAt(401, 5, MINTER);
        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.NotCubeOwner.selector, cubeId, OTHER));
        cubes.moveCube(cubeId, 40);
    }

    function testMoveCubeRevertsForOccupiedTarget() public {
        uint256 a = _mintCubeAt(401, 5, MINTER);
        uint256 b = _mintCubeAt(402, 6, MINTER);
        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.SlotOccupied.selector, uint32(6), b));
        cubes.moveCube(a, 6);
    }

    function testMoveCubeRevertsForOutOfRangeSlot() public {
        uint256 cubeId = _mintCubeAt(401, 5, MINTER);
        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InvalidSlot.selector, uint32(64)));
        cubes.moveCube(cubeId, 64); // totalSlots = 64
    }

    function testCannotMoveMergedStreet() public {
        _mintCubeAt(401, 0, MINTER); // street 0
        vm.prank(MINTER);
        uint256 streetId = cubes.mergeStreet(0);

        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.CannotMoveStreet.selector, streetId));
        cubes.moveCube(streetId, 40);
    }

    function testMoveCubeFreesOldSlotForReuse() public {
        uint256 a = _mintCubeAt(401, 5, MINTER);
        uint256 b = _mintCubeAt(402, 6, MINTER);
        vm.prank(OWNER);
        cubes.setMovesEnabled(true);

        vm.startPrank(MINTER);
        cubes.moveCube(a, 40); // frees slot 5
        cubes.moveCube(b, 5); // reuse the freed slot
        vm.stopPrank();

        assertEq(cubes.cubeForSlot(40), a);
        assertEq(cubes.cubeForSlot(5), b);
        assertEq(cubes.cubeForSlot(6), 0);
    }

    function testSetMovesEnabledOnlyOwner() public {
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        cubes.setMovesEnabled(true);
    }

    // ---- Merge off-switch (independent of moves) --------------------------------
    function testMergeStreetRevertsWhenDisabled() public {
        _mintCubeAt(301, 0, MINTER);
        vm.prank(OWNER);
        cubes.setMergesEnabled(false);

        vm.prank(MINTER);
        vm.expectRevert(CubeNFT.MergesDisabled.selector);
        cubes.mergeStreet(0);
    }

    function testMergeStreetWithLeaderRevertsWhenDisabled() public {
        uint256 c0 = _mintCubeAt(301, 0, MINTER);
        vm.prank(OWNER);
        cubes.setMergesEnabled(false);

        vm.prank(MINTER);
        vm.expectRevert(CubeNFT.MergesDisabled.selector);
        cubes.mergeStreet(0, c0); // the leader-picking overload is gated too
    }

    function testSetMergesEnabledOnlyOwner() public {
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        cubes.setMergesEnabled(true);
    }

    function testMovesAndMergesAreIndependent() public {
        // Toggling one must never affect the other (two separate switches).
        vm.startPrank(OWNER);
        cubes.setMovesEnabled(true);
        cubes.setMergesEnabled(false);
        vm.stopPrank();
        assertTrue(cubes.movesEnabled());
        assertFalse(cubes.mergesEnabled());

        vm.startPrank(OWNER);
        cubes.setMovesEnabled(false);
        cubes.setMergesEnabled(true);
        vm.stopPrank();
        assertFalse(cubes.movesEnabled());
        assertTrue(cubes.mergesEnabled());
    }
}
