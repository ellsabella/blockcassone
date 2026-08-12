// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

/// @notice Redeploy ONLY the 2D-thumbnail render stack (geometry + frame + walker + the
///         orchestrator renderer) and wire it to the EXISTING Sepolia CubeNFT + art stores.
///         forge script auto-deploys + links the NormieHexGlyphs library, so there is no
///         manual --libraries step. Nothing stateful (CubeNFT / minters / the test world) is
///         touched. After it runs, set data/chain-config.json "thumbnailRenderer" to the printed
///         address; the viewer's /api/thumbnail then serves the new art.
///
/// Usage (WSL, from repo root):
///   source .env
///   forge script contracts/script/DeployThumbnailStack.s.sol --tc DeployThumbnailStack \
///     --broadcast --rpc-url "$BLOCKCASSONE_RPC_URL" --private-key "$DEV_THROWAWAY_PRIVATE"
///
/// The existing on-chain addresses come from data/chain-config.json (Sepolia, chainId 11155111).
/// Override any of them with env vars if you redeploy against a different set.
contract DeployThumbnailStack is Script {
    function run() external {
        address cubes = vm.envOr("CUBE_NFT", 0x629417E8E5478246c8979bA44c7CaD1fD4E83699);
        address normieStorage = vm.envOr("NORMIE_STORAGE", 0x25A6f37b46f597fA0a9B9D491c63B681fcDC02Ac);
        address nonNormieStore = vm.envOr("NONNORMIE_STORE", 0x4cFC5f9daae775A138D77e2E6F7385E78DfeFfAa);

        vm.startBroadcast();

        CubeHilbertGeometry geometry = new CubeHilbertGeometry();
        CubeFrameLayer frame = new CubeFrameLayer();
        CubeWalkerLayer walker = new CubeWalkerLayer();
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            CubeNFT(cubes), normieStorage, nonNormieStore, address(geometry), address(frame), address(walker)
        );

        vm.stopBroadcast();

        console2.log("== thumbnail render stack (Sepolia) ==");
        console2.log("geometry        ", address(geometry));
        console2.log("frame           ", address(frame));
        console2.log("walker          ", address(walker));
        console2.log("thumbnailRenderer", address(thumb));
        console2.log("");
        console2.log("-> set data/chain-config.json \"thumbnailRenderer\" to the address above");
    }
}
