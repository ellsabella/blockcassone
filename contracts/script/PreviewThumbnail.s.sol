// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";

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

/// @notice Dump a thumbnail SVG for a chosen slot, to eyeball the per-slot
/// aesthetic (the main colour comes from the slot's unique Hilbert axis:
/// x=red, y=green, z=blue).
///
/// Usage (WSL) — the file has two contracts, so pass --tc PreviewThumbnail:
///   SLOT=0 forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail
///   for s in 0 1 2 3 4 5; do
///     SLOT=$s forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail
///   done
///
/// Optional env: NORMIE_ID (label, default 1257).
/// Writes: data/preview-slot-<SLOT>.svg
contract PreviewThumbnail is Script {
    function run() external {
        uint256 slot = vm.envOr("SLOT", uint256(0));
        uint256 normieId = vm.envOr("NORMIE_ID", uint256(1257));
        address dev = address(0xBEEF);

        PreviewMockNormies normies = new PreviewMockNormies();
        CubeNFT cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, dev);
        CubeThumbnailRendererV1 thumb =
            new CubeThumbnailRendererV1(cubes, address(normies), address(0));

        normies.mint(dev, normieId, _sampleBitmap());

        vm.prank(dev);
        uint256 cubeId =
            cubes.mintNormieCube(normieId, uint32(slot), keccak256(abi.encode("preview", slot)));

        string memory svg = thumb.thumbnailSVG(cubeId);
        string memory path = string.concat("data/preview-slot-", vm.toString(slot), ".svg");
        vm.writeFile(path, svg);

        console2.log("slot", slot);
        console2.log("cubeId", cubeId);
        console2.log("wrote", path);
        console2.log("(colour: x=red, y=green, z=blue per the slot's unique Hilbert axis)");
    }

    // A simple centred filled square so the silhouette/outline/label are visible.
    function _sampleBitmap() private pure returns (bytes memory) {
        bytes memory raw = new bytes(200);
        for (uint256 row = 8; row <= 31; row++) {
            for (uint256 col = 8; col <= 31; col++) {
                uint256 idx = row * 40 + col;
                raw[idx / 8] |= bytes1(uint8(1) << uint8(7 - (idx % 8)));
            }
        }
        return raw;
    }
}
