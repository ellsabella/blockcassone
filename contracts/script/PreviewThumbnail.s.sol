// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

// Minimal Normie source used only for previews.
contract PreviewMockNormies is ERC721 {
    mapping(uint256 tokenId => bytes raw) private _raw;

    constructor() ERC721("Normies", "NORM") { }

    function mint(address to, uint256 tokenId, bytes calldata raw) external {
        _mint(to, tokenId);
        _raw[tokenId] = raw;
    }

    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory) {
        return _raw[tokenId];
    }
}

/// @notice Dump thumbnail SVGs for a range of slots in ONE run, to eyeball the
/// per-slot colour (main colour = the slot's unique Hilbert axis: x=red,
/// y=green, z=blue). For each slot it logs the colour this script computes
/// (independent copy of the renderer's formula) so the console and the SVGs
/// can be compared directly.
///
/// Usage (WSL):
///   forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail
///   COUNT=12 forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail
///
/// Writes: data/preview-slot-<N>.svg for N in [0, COUNT)
contract PreviewThumbnail is Script {
    uint256 private constant HILBERT_ORDER = 5;

    function run() external {
        uint256 count = vm.envOr("COUNT", uint256(8));
        address dev = address(0xBEEF);

        PreviewMockNormies normies = new PreviewMockNormies();
        CubeNFT cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, dev);
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes,
            address(normies),
            address(0),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );

        for (uint256 s = 0; s < count; s++) {
            uint256 normieId = 1000 + s; // a normie can only be cubed once, so vary it
            normies.mint(dev, normieId, _sampleBitmap(normieId));

            vm.prank(dev);
            uint256 cubeId =
                cubes.mintNormieCube(normieId, uint32(s), keccak256(abi.encode("preview", s)));

            // read the slot back to prove it round-trips, and render
            CubeNFT.CubeData memory data = cubes.resolvedCubeData(cubeId);
            string memory svg = thumb.thumbnailSVG(cubeId);
            vm.writeFile(string.concat("data/preview-slot-", vm.toString(s), ".svg"), svg);

            console2.log("slot", s);
            console2.log("  data.slot (round-trip):", uint256(data.slot));
            console2.log("  expected colour:", _colourName(_axis(s)));
            console2.log("  emitted in SVG:", _emittedColour(svg));
        }
    }

    // Detect the figure colour the renderer actually emitted. #ff1919 (red) and
    // #1f3bff (blue) only ever appear as the plane colour; if neither is present
    // the plane colour is green (#1fff3a).
    function _emittedColour(string memory svg) private pure returns (string memory) {
        if (_contains(svg, "#1f3bff")) return "BLUE (z)";
        if (_contains(svg, "#ff1919")) return "RED (x)";
        return "GREEN (y)";
    }

    function _contains(string memory hay, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    // Independent copy of the renderer's unique-axis formula (sanity reference).
    function _axis(uint256 motif) private pure returns (uint256) {
        uint256 levels = HILBERT_ORDER - 1;
        uint256 a = 0;
        uint256 b = 1;
        uint256 c = 2;
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (motif / (8 ** (levels - 1 - i))) % 8;
            uint256 na;
            uint256 nb;
            uint256 nc;
            if (d == 3 || d == 4) {
                (na, nb, nc) = (a, b, c);
            } else if (d == 1 || d == 2 || d == 5 || d == 6) {
                (na, nb, nc) = (c, a, b);
            } else {
                (na, nb, nc) = (b, c, a);
            }
            (a, b, c) = (na, nb, nc);
        }
        return b;
    }

    function _colourName(uint256 axis) private pure returns (string memory) {
        if (axis == 0) return "red (x) #ff1919";
        if (axis == 1) return "green (y) #1fff3a";
        return "blue (z) #1f3bff";
    }

    // A COHERENT face-ish silhouette (contiguous body + eye/mouth holes) so the
    // outline path stays small. The old ring/wave pattern was noisy (thousands
    // of scattered pixels) which produced a huge outline and a MemoryOOG. Real
    // Normies are coherent like this. Width varies slightly by id.
    function _sampleBitmap(uint256 id) private pure returns (bytes memory raw) {
        raw = new bytes(200);
        uint256 w = 12 + (id % 3); // 12..14 half-width
        for (uint256 row = 5; row <= 35; row++) {
            for (uint256 col = 6; col <= 33; col++) {
                uint256 dx = col >= 20 ? col - 20 : 20 - col;
                bool fill = dx <= w;
                // eye holes
                if (row >= 14 && row <= 17 && ((col >= 13 && col <= 16) || (col >= 23 && col <= 26))) {
                    fill = false;
                }
                // mouth hole
                if (row >= 24 && row <= 25 && col >= 14 && col <= 25) fill = false;
                if (!fill) continue;
                uint256 i = row * 40 + col;
                raw[i / 8] = bytes1(uint8(raw[i / 8]) | uint8(1 << (7 - (i % 8))));
            }
        }
    }
}
