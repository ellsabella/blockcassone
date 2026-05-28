// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {CubeNFT} from "../src/CubeNFT.sol";

contract MockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract CubeNFTTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant MINTER = address(0xB0B);
    address private constant OTHER = address(0xCAFE);

    MockERC721 private normies;
    MockERC721 private externalNft;
    CubeNFT private cubes;

    function setUp() public {
        normies = new MockERC721("Normies", "NORM");
        externalNft = new MockERC721("External", "EXT");
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
        assertEq(data.sourceContract, address(externalNft));
        assertEq(data.sourceTokenId, 1);
        assertEq(data.seed, seed);
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
}
