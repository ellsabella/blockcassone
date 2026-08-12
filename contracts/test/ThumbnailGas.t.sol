// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

contract GasMockNormies is ERC721 {
    mapping(uint256 => bytes) private _raw;
    constructor() ERC721("N", "N") { }
    function mint(address to, uint256 id, bytes calldata raw) external { _mint(to, id); _raw[id] = raw; }
    function getTokenRawImageData(uint256 id) external view returns (bytes memory) { return _raw[id]; }
}

// Measures a single thumbnailSVG render (a VIEW path — the only cost is the eth_call gas
// cap ~50M, not blockspace). Confirms the line-only design stays well under budget.
contract ThumbnailGasTest is Test {
    function test_renderGasAndSize() external {
        address dev = address(0xBEEF);
        GasMockNormies normies = new GasMockNormies();
        CubeNFT cubes = new CubeNFT("C", "C", address(normies), 4096, dev);
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes, address(normies), address(0),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );

        // Dense-ish face silhouette so the figure/side-plane/walker paths are non-trivial.
        bytes memory raw = new bytes(200);
        for (uint256 row = 4; row <= 35; row++) {
            for (uint256 col = 6; col <= 33; col++) {
                uint256 dx = col >= 20 ? col - 20 : 20 - col;
                if (dx > 13) continue;
                if (row >= 14 && row <= 17 && ((col >= 13 && col <= 16) || (col >= 23 && col <= 26))) continue;
                if (row >= 24 && row <= 25 && col >= 14 && col <= 25) continue;
                uint256 i = row * 40 + col;
                raw[i / 8] = bytes1(uint8(raw[i / 8]) | uint8(1 << (7 - (i % 8))));
            }
        }
        // Prefer the real cached Normie bitmap (heavier, more boundary segments) if present.
        try vm.readFile("data/normie-raw-1250.hex") returns (string memory h) {
            try vm.parseBytes(h) returns (bytes memory r) {
                if (r.length == 200) raw = r;
            } catch { }
        } catch { }

        normies.mint(dev, 1250, raw);
        vm.prank(dev);
        uint256 cubeId = cubes.mintNormieCube(1250, uint32(1250), keccak256("gas"));

        uint256 g0 = gasleft();
        string memory svg = thumb.thumbnailSVG(cubeId);
        uint256 used = g0 - gasleft();
        console2.log("thumbnailSVG gas:", used);
        console2.log("svg bytes:", bytes(svg).length);
        // Sanity: well under the ~50M eth_call cap.
        assertLt(used, 50_000_000);
    }
}
