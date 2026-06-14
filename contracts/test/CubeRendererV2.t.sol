// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { Base64 } from "openzeppelin-contracts/contracts/utils/Base64.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";

contract RendererV2MockNormies is ERC721 {
    mapping(uint256 tokenId => bytes rawImageData) private _rawImageData;

    constructor() ERC721("Normies", "NORM") { }

    function mint(address to, uint256 tokenId, bytes calldata rawImageData) external {
        _mint(to, tokenId);
        _rawImageData[tokenId] = rawImageData;
    }

    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory) {
        return _rawImageData[tokenId];
    }
}

contract CubeRendererV2Test is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant MINTER = address(0xB0B);

    RendererV2MockNormies private normies;
    CubeNFT private cubes;
    AgentStatusRegistry private agentRegistry;
    RendererAssetStore private assets;
    CubeRendererV2 private renderer;

    function setUp() public {
        normies = new RendererV2MockNormies();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, OWNER);
        agentRegistry = new AgentStatusRegistry(OWNER);
        assets = new RendererAssetStore(OWNER);
        renderer = new CubeRendererV2(cubes, assets, address(normies));

        bytes memory raw = new bytes(200);
        raw[0] = hex"80";
        raw[199] = hex"01";
        normies.mint(MINTER, 6722, raw);

        vm.prank(OWNER);
        cubes.setRenderer(address(renderer));
    }

    function testMetadataUsesRendererV2DataUrisAndTraits() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        string memory json = renderer.metadataJSON(cubeId);
        assertTrue(_contains(json, '"name":"Blockcassone Cube #1"'));
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'));
        assertTrue(_contains(json, '"animation_url":"data:text/html;base64,'));
        assertTrue(_contains(json, '"trait_type":"plot","value":"1734"'));
        assertTrue(_contains(json, '"trait_type":"region","value":"3"'));
        assertTrue(_contains(json, '"trait_type":"neighbourhood","value":"27"'));
        assertTrue(_contains(json, '"trait_type":"street","value":"216"'));
        assertTrue(_contains(json, '"trait_type":"Source Kind","value":"Normie"'));
        assertTrue(_contains(json, '"trait_type":"Source Token ID","value":"6722"'));
        assertTrue(_contains(json, '"trait_type":"Renderer Version","value":"2"'));
    }

    function testAnimationHTMLInjectsCubeConfigAndRawNormieBytes() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        bytes memory raw = normies.getTokenRawImageData(6722);
        string memory html = renderer.animationHTML(cubeId);

        assertTrue(_contains(html, "window.BLOCKCASSONE_TOKEN"));
        assertTrue(_contains(html, "tokenId:1"));
        assertTrue(_contains(html, "slot:1734"));
        assertTrue(_contains(html, "sourceTokenId:6722"));
        assertTrue(_contains(html, "raw:'"));
        assertTrue(_contains(html, Base64.encode(raw)));
        assertFalse(_contains(html, "api.normies.art"));
        assertFalse(_contains(html, "/api/normies"));
    }

    function testRendererUsesCurrentAgentRegistryState() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        vm.startPrank(OWNER);
        cubes.setAgentStatusRegistry(address(agentRegistry));
        agentRegistry.setAgentBinding(address(normies), 6722, true, 5025);
        vm.stopPrank();

        string memory json = renderer.metadataJSON(cubeId);
        string memory html = renderer.animationHTML(cubeId);

        assertTrue(_contains(json, '"trait_type":"Agentic","value":"Y"'));
        assertTrue(_contains(json, '"trait_type":"Agent ID","value":"5025"'));
        assertTrue(_contains(html, "agentic:true"));
        assertTrue(_contains(html, "agentId:5025"));
    }

    function testCubeNFTTokenURIDelegatesToRendererV2() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 8, bytes32("seed"));

        string memory uri = cubes.tokenURI(cubeId);
        assertTrue(_startsWith(uri, "data:application/json;utf8,"));
    }

    function testAssetStoreChunksOverrideDefaultHTMLShell() public {
        vm.startPrank(OWNER);
        assets.setChunk(renderer.HTML_HEAD_CHUNK(), "<html><body>custom-head");
        assets.setChunk(
            renderer.HTML_SCRIPT_CHUNK(), "<script>custom-script</script></body></html>"
        );
        vm.stopPrank();

        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 64, bytes32("seed"));

        string memory html = renderer.animationHTML(cubeId);
        assertTrue(_contains(html, "custom-head"));
        assertTrue(_contains(html, "custom-script"));
        assertTrue(_contains(html, "window.BLOCKCASSONE_TOKEN"));
    }

    function testAssetStoreAssemblesMultipleScriptChunks() public {
        vm.startPrank(OWNER);
        assets.setChunk(renderer.HTML_HEAD_CHUNK(), "<html><body>custom-head");
        assets.setChunk(renderer.HTML_SCRIPT_START_CHUNK(), "<script>");
        assets.setChunk(renderer.HTML_SCRIPT_START_CHUNK() + 1, "partA();");
        assets.setChunk(renderer.HTML_SCRIPT_START_CHUNK() + 2, "partB();</script></body></html>");
        vm.stopPrank();

        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 64, bytes32("seed"));

        string memory html = renderer.animationHTML(cubeId);
        assertTrue(_contains(html, "custom-head"));
        assertTrue(_contains(html, "window.BLOCKCASSONE_TOKEN"));
        assertTrue(_contains(html, "<script>partA();partB();</script></body></html>"));
    }

    function testOwnerCanTrimAssetChunkCount() public {
        vm.startPrank(OWNER);
        assets.setChunk(7, "later");
        assertEq(assets.chunkCount(), 8);
        assets.setChunkCount(2);
        assertEq(assets.chunkCount(), 2);
        vm.stopPrank();
    }

    function testNonOwnerCannotSetAssetChunk() public {
        vm.prank(MINTER);
        vm.expectRevert();
        assets.setChunk(0, "nope");
    }

    function testNonOwnerCannotSetAssetChunkCount() public {
        vm.prank(MINTER);
        vm.expectRevert();
        assets.setChunkCount(0);
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
