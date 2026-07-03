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

contract BrainrotMock is ERC721 {
    constructor() ERC721("m", "m") { }
    function getTokenRawImageData(uint256) external pure returns (bytes memory) { return ""; }
}

/// @notice Render cubes from BRAINROT-derived tonal payloads (non-Normie path) to
/// prove the silhouette. Reads data/brainrot-payload-<id>.hex (written by
/// c:/tmp/brainrot_grid.py), calls the stateless previewThumbnailSVG, writes
/// data/brainrot-cube-<id>.svg. NO anvil/fork.
///   IDS="1,42,1250" forge script contracts/script/PreviewBrainrot.s.sol --tc PreviewBrainrot
contract PreviewBrainrot is Script {
    function run() external {
        uint256[] memory ids = _ids();
        BrainrotMock m = new BrainrotMock();
        CubeNFT cubes = new CubeNFT("Cubes", "CUBE", address(m), 4096, address(0xBEEF));
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes,
            address(m),
            address(0),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );

        for (uint256 i = 0; i < ids.length; i++) {
            string memory path = string.concat("data/brainrot-payload-", vm.toString(ids[i]), ".hex");
            bytes memory payload = vm.parseBytes(vm.readFile(path));
            // slot i -> varied axis colour; non-Normie sourceKind (default) -> no forest.
            string memory svg =
                thumb.previewThumbnailSVG(keccak256(abi.encode("brnrt", ids[i])), uint32(i), ids[i], payload);
            vm.writeFile(string.concat("data/brainrot-cube-", vm.toString(ids[i]), ".svg"), svg);
            console2.log("brainrot", ids[i], "payload bytes", payload.length);
        }
    }

    function _ids() private view returns (uint256[] memory) {
        uint256[] memory d = new uint256[](3);
        d[0] = 1; d[1] = 42; d[2] = 1250;
        return vm.envOr("IDS", ",", d);
    }
}
