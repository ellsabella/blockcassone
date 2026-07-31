// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { Base64 } from "openzeppelin-contracts/contracts/utils/Base64.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";

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
    CubeThumbnailRendererV1 private thumbnailRenderer;
    CubeRendererV2 private renderer;
    NonNormieArtStore private store;

    function setUp() public {
        normies = new RendererV2MockNormies();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, OWNER);
        agentRegistry = new AgentStatusRegistry(OWNER);
        assets = new RendererAssetStore(OWNER);
        store = new NonNormieArtStore(address(cubes), address(this)); // test acts as store owner
        thumbnailRenderer = new CubeThumbnailRendererV1(
            cubes,
            address(normies),
            address(store),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );
        renderer =
            new CubeRendererV2(cubes, assets, address(normies), address(thumbnailRenderer), address(store));

        bytes memory raw = new bytes(200);
        raw[0] = hex"80";
        raw[199] = hex"01";
        normies.mint(MINTER, 6722, raw);

        vm.startPrank(OWNER);
        cubes.setRenderer(address(renderer));
        cubes.setMergesEnabled(true);      // merge tests below need the gate open
        cubes.setCustomizesEnabled(true);  // customize tests below need the gate open
        cubes.setBaseFee(0);               // fee-free merges here (fee math: CubeFeesTest)
        vm.stopPrank();
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
        // Never re-based: Origin == Current == the source collection's name() ("Normies").
        assertTrue(_contains(json, '"trait_type":"Origin Collection","value":"Normies"'));
        assertTrue(_contains(json, '"trait_type":"Current Collection","value":"Normies"'));
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

    function testThumbnailSVGUsesRawNormieBitmapRuns() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        string memory svg = renderer.thumbnailSVG(cubeId);

        assertTrue(_contains(svg, '<path id="n" d="M0 0h1v1H0zM39 39h1v1H39z"/>'));
        assertTrue(_contains(svg, '<path id="o" d='));
        // slot 1734 has Hilbert planes [z,y,z] -> unique axis y -> green. Now pure
        // #00ff00 (matches the WebGL cube + the line-lab neon tuning); the figure
        // uses the additive-screen #nfN filter, fill="none" hoisted to the group.
        assertTrue(_contains(svg, '<use href="#o" stroke="#00ff00" stroke-width=".146" filter="url(#nfN)"'));
        // Frame border traces the motif's unique-plane sides (slot 1734 -> TRB,
        // open left) as separate subpaths.
        assertTrue(_contains(svg, '<path d="M100 85H1100M1100 85V1085M100 1085H1100"'));
        assertTrue(_contains(svg, '<path id="l" d='));
        // edge-point orbs: additive white-glow group at r=10 (soft core group r=6).
        assertTrue(_contains(svg, '<circle cx="100" cy="85" r="10"'));
        assertTrue(_contains(svg, '<filter id="nfN"'));
        // forest strand layer: thin cores (per walker-rule colour) + turbulence
        // tip-clouds. The wide blurred glow pass was dropped; strands are now a
        // single thin core group (sw .7) in the #g filter, and clouds fill the
        // per-colour gradient (#cg unique / #cg2 doubled) through the #pc filter.
        assertTrue(_contains(svg, 'stroke-width=".7" opacity=".3" filter="url(#g)"'));
        assertTrue(_contains(svg, 'filter="url(#pc)"'));
        assertTrue(_contains(svg, 'fill="url(#cg') && _contains(svg, ')" filter="url(#pc)"'));
        assertTrue(_contains(svg, '<use href="#l" stroke="#00ff00"'));
        assertFalse(_contains(svg, "Normie #6722"));
        assertFalse(_contains(svg, "cube #1"));
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

    function testMergedStreetMetadataReportsPopulationAndMerged() public {
        bytes memory raw2 = new bytes(64);
        raw2[0] = hex"40";
        normies.mint(MINTER, 6723, raw2);

        // Street 0 = slots 0,1; occupy both, then merge.
        vm.startPrank(MINTER);
        cubes.mintNormieCube(6722, 0, bytes32("seed-a"));
        cubes.mintNormieCube(6723, 1, bytes32("seed-b"));
        uint256 streetId = cubes.mergeStreet(0);
        vm.stopPrank();

        string memory json = renderer.metadataJSON(streetId);
        assertTrue(_contains(json, '"trait_type":"Population","value":"2"'));
        assertTrue(_contains(json, '"trait_type":"Merged","value":"Y"'));
        assertTrue(_contains(json, '"trait_type":"Source Kind","value":"Merged Street"'));
        assertTrue(_contains(json, '"trait_type":"street","value":"0"'));
        // Leader (lowest occupied plot) drives the SVG thumbnail.
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'));
    }

    function testMergedStreetAnimationInjectsPlotsArray() public {
        bytes memory raw2 = new bytes(64);
        raw2[0] = hex"40";
        normies.mint(MINTER, 6723, raw2);

        vm.startPrank(MINTER);
        cubes.mintNormieCube(6722, 0, bytes32("seed-a"));
        cubes.mintNormieCube(6723, 1, bytes32("seed-b"));
        uint256 streetId = cubes.mergeStreet(0);
        vm.stopPrank();

        string memory html = renderer.animationHTML(streetId);
        assertTrue(_contains(html, "kind:'street'"));
        assertTrue(_contains(html, "street:0"));
        assertTrue(_contains(html, "population:2"));
        assertTrue(_contains(html, "plots:["));
        assertTrue(_contains(html, "occupied:true"));
        assertTrue(_contains(html, "occupied:false")); // slots 2..7 are vacant
        assertTrue(_contains(html, "sourceTokenId:6722"));
        assertTrue(_contains(html, "sourceTokenId:6723"));
        assertTrue(_contains(html, Base64.encode(normies.getTokenRawImageData(6722))));
        // No network references leak into the merged-street payload.
        assertFalse(_contains(html, "api.normies.art"));
    }

    function testCustomizedCubeRendersStoreArt() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        // Re-base: record a flattened payload + flip the source (test = store owner
        // + customizer; the controller/attestation flow is covered separately).
        bytes memory payload = new bytes(400);
        for (uint256 i = 0; i < 400; i++) {
            payload[i] = 0xFF; // every cell "on" -> a full 200-byte bitmap, distinct from the mock Normie raw
        }
        store.recordTonalBands2Bit(cubeId, payload);
        vm.prank(OWNER);
        cubes.setCustomizer(address(this));
        cubes.customizeCubeSource(cubeId, address(0xABCD), 42, 1);

        // Metadata adopts the new source.
        string memory json = renderer.metadataJSON(cubeId);
        assertTrue(_contains(json, '"trait_type":"Source Kind","value":"External ERC-721"'));
        assertTrue(_contains(json, '"trait_type":"Source Token ID","value":"42"'));
        // Provenance survives the re-base: Origin = the genesis Normie ("Normies"),
        // Current = the re-based codeless source (falls back to "Unknown").
        assertTrue(_contains(json, '"trait_type":"Origin Collection","value":"Normies"'));
        assertTrue(_contains(json, '"trait_type":"Current Collection","value":"Unknown"'));

        // The 3D/animation raw is the store bitmap, not the Normie raw.
        string memory html = renderer.animationHTML(cubeId);
        assertTrue(_contains(html, Base64.encode(store.imageBytesForCube(cubeId))));
        assertFalse(_contains(html, Base64.encode(normies.getTokenRawImageData(6722))));

        // Image still renders (thumbnail external path) without reverting.
        assertTrue(_contains(renderer.imageURI(cubeId), "data:image/svg+xml;base64,"));
    }

    function testPreviewThumbnailMatchesStoredCustomizedCube() public {
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(6722, 1734, bytes32("seed"));

        bytes memory payload = new bytes(400);
        for (uint256 i = 0; i < 400; i++) {
            payload[i] = 0xA5;
        }
        store.recordTonalBands2Bit(cubeId, payload);
        vm.prank(OWNER);
        cubes.setCustomizer(address(this));
        cubes.customizeCubeSource(cubeId, address(0xABCD), 42, 1);

        // The stateless preview must be byte-identical to what re-basing stores.
        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        string memory stored = thumbnailRenderer.thumbnailSVG(cubeId);
        string memory preview = thumbnailRenderer.previewThumbnailSVG(data.seed, data.slot, address(0xABCD), 42, payload);
        assertEq(stored, preview);
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
