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
}
