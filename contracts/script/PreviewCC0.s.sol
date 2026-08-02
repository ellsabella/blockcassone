// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

contract MockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function getTokenRawImageData(uint256) external pure returns (bytes memory) { return ""; }
}

/// @notice Render the on-chain non-Normie thumbnail SVG for each flattened CC0
///         payload written by dev/cc0-proof/flatten.mjs (data/cc0/<i>.hex), so we
///         can eyeball how real Chain Runners / 1337 Skulls read as cube art.
///         Stateless (previewThumbnailSVG), no anvil/fork/deploy needed.
///
///   CC0_COUNT=8 forge script contracts/script/PreviewCC0.s.sol --tc PreviewCC0
contract PreviewCC0 is Script {
    function run() external {
        uint256 count = vm.envOr("CC0_COUNT", uint256(8));
        MockNormies normies = new MockNormies();
        CubeNFT cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, address(0xBEEF));
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes,
            address(normies),
            address(0),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );

        for (uint256 i = 0; i < count; i++) {
            bytes memory payload =
                vm.parseBytes(vm.readFile(string.concat("data/cc0/", vm.toString(i), ".hex")));
            // Spread slots across the world so figures get varied axis colours.
            uint32 slot = uint32((i * 691) % 4096);
            bytes32 seed = keccak256(abi.encode("cc0", i));
            uint256 srcId = vm.parseUint(vm.readFile(string.concat("data/cc0/", vm.toString(i), ".id")));
            // sample source contract that cycles every hex glyph 0-F, so the banner shows the full font
            string memory svg = thumb.previewThumbnailSVG(seed, slot, address(0x0123456789abcDEF0123456789abCDef01234567), srcId, payload);
            vm.writeFile(string.concat("data/cc0/thumb-", vm.toString(i), ".svg"), svg);
            console2Log(i, slot);
        }
    }

    function console2Log(uint256 i, uint32 slot) private pure {
        // lightweight, avoids an extra import; no-op body keeps output clean
        i;
        slot;
    }
}
