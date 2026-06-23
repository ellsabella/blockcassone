// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";

/// @notice Dump thumbnail SVGs for cubes that ALREADY EXIST on the running
/// (mainnet-fork) anvil — the same cubes the dev viewer shows — but rendered
/// through the *current source* of CubeThumbnailRendererV1, so I can eyeball
/// the latest renderer against real Normie data without redeploying anything.
///
/// It reads the deployed CubeNFT + real NormiesStorage straight out of the
/// viewer's data/chain-config.json (no new mint, no mock bitmap), deploys a
/// throwaway copy of the renderer pointed at them, and renders each cube id.
///
/// Usage (against the viewer's anvil):
///   CUBE_IDS=1,2,3 forge script contracts/script/PreviewLiveNormie.s.sol \
///     --tc PreviewLiveNormie --rpc-url http://127.0.0.1:8545
///
/// Addresses default to data/chain-config.json; override with CUBE_NFT /
/// NORMIE_STORAGE env vars if needed. Writes data/live-cube-<id>.svg.
contract PreviewLiveNormie is Script {
    function run() external {
        string memory json = vm.readFile("data/chain-config.json");
        address cubeNft = vm.envOr("CUBE_NFT", vm.parseJsonAddress(json, ".cubeNft"));
        address storageAddr = vm.envOr("NORMIE_STORAGE", vm.parseJsonAddress(json, ".normieStorage"));

        // Throwaway renderer (current source) pointed at the live deployment.
        CubeThumbnailRendererV1 thumb =
            new CubeThumbnailRendererV1(CubeNFT(cubeNft), storageAddr, address(0));

        console2.log("cubeNft       ", cubeNft);
        console2.log("normieStorage ", storageAddr);

        uint256[] memory ids = _cubeIds();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 cubeId = ids[i];
            string memory svg = thumb.thumbnailSVG(cubeId);
            vm.writeFile(string.concat("data/live-cube-", vm.toString(cubeId), ".svg"), svg);
            console2.log("cube", cubeId);
            console2.log("  bytes", bytes(svg).length);
        }
    }

    function _cubeIds() private view returns (uint256[] memory) {
        uint256[] memory fallbackIds = new uint256[](3);
        fallbackIds[0] = 1;
        fallbackIds[1] = 2;
        fallbackIds[2] = 3;
        return vm.envOr("CUBE_IDS", ",", fallbackIds);
    }
}
