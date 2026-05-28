// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {CubeRendererV1} from "../src/CubeRendererV1.sol";

contract RendererMockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract CubeRendererV1Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant MINTER = address(0xB0B);

    RendererMockERC721 private normies;
    RendererMockERC721 private externalNft;
    CubeNFT private cubes;
    CubeRendererV1 private renderer;

    function setUp() public {
        normies = new RendererMockERC721("Normies", "NORM");
        externalNft = new RendererMockERC721("External", "EXT");
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, OWNER);
        renderer = new CubeRendererV1(cubes);

        normies.mint(MINTER, 101);
        externalNft.mint(MINTER, 1);

        vm.prank(OWNER);
        cubes.setRenderer(address(renderer));
    }

    function testMetadataJSONIncludesCoreTraitsForNormie() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 1734, bytes32("seed"));

        string memory json = renderer.metadataJSON(cubeId);
        assertTrue(_contains(json, '"name":"Blockcassone Cube #1"'));
        assertTrue(_contains(json, '"trait_type":"plot","value":"1734"'));
        assertTrue(_contains(json, '"trait_type":"region","value":"216"'));
        assertTrue(_contains(json, '"trait_type":"neighbourhood","value":"27"'));
        assertTrue(_contains(json, '"trait_type":"Source Kind","value":"Normie"'));
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'));
        assertTrue(_contains(json, '"animation_url":"data:text/html;base64,'));
    }

    function testMetadataJSONIncludesExternalSourceTraits() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintExternalERC721Cube(address(externalNft), 1, 64, bytes32("seed"));

        string memory json = renderer.metadataJSON(cubeId);
        assertTrue(_contains(json, '"trait_type":"plot","value":"64"'));
        assertTrue(_contains(json, '"trait_type":"region","value":"8"'));
        assertTrue(_contains(json, '"trait_type":"neighbourhood","value":"1"'));
        assertTrue(_contains(json, '"trait_type":"Source Kind","value":"External ERC-721"'));
        assertTrue(_contains(json, '"trait_type":"Payload Version","value":"0"'));
    }

    function testCubeNFTTokenURIDelegatesToRenderer() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 7, bytes32("seed"));

        string memory uri = cubes.tokenURI(cubeId);
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
    }

    function testImageAndAnimationAreDataURIs() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(101, 7, bytes32("seed"));

        assertTrue(_startsWith(renderer.imageURI(cubeId), "data:image/svg+xml;base64,"));
        assertTrue(_startsWith(renderer.animationURI(cubeId), "data:text/html;base64,"));
    }

    function testRegionAndNeighbourhoodHelpers() public view {
        assertEq(renderer.regionForSlot(0), 0);
        assertEq(renderer.regionForSlot(7), 0);
        assertEq(renderer.regionForSlot(8), 1);
        assertEq(renderer.neighbourhoodForSlot(63), 0);
        assertEq(renderer.neighbourhoodForSlot(64), 1);
    }

    function _startsWith(string memory value, string memory prefix) private pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory prefixBytes = bytes(prefix);
        if (valueBytes.length < prefixBytes.length) return false;
        for (uint256 i = 0; i < prefixBytes.length; i++) {
            if (valueBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }

    function _contains(string memory value, string memory needle) private pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory needleBytes = bytes(needle);
        if (needleBytes.length == 0) return true;
        if (valueBytes.length < needleBytes.length) return false;

        for (uint256 i = 0; i <= valueBytes.length - needleBytes.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needleBytes.length; j++) {
                if (valueBytes[i + j] != needleBytes[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
    }
}
