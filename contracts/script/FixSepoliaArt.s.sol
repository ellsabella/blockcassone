// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";

/// @notice Sepolia validation-world repair: the full deployment's art store holds
///         pre-DNA-fix Chain Runners payloads and source-keyed payloads can't be
///         overwritten — but the store and renderers are owner-swappable modules.
///         Deploy a fresh store seeded with CORRECTED payloads for every minted
///         external cube (data/sepolia-full/fix-art/), fresh renderers wired to it,
///         then setRenderer + setArtStore. Token ids unchanged; OCC re-renders.
///         Cubes minted AFTER this swap need their payloads recorded in the new
///         store too — this world is a validation artifact, noted in its report.
contract FixSepoliaArt is Script {
    string[5] internal KEYS = ["runner", "skull", "pepe", "noun", "kevin"];

    function run() external {
        string memory cfg = vm.readFile("data/sepolia-full/contracts.json");
        CubeNFT cubes = CubeNFT(vm.parseJsonAddress(cfg, ".cubeNft"));
        address assetStore = vm.parseJsonAddress(cfg, ".rendererAssetStore");
        address normies = vm.parseJsonAddress(cfg, ".normies");
        string memory manifest = vm.readFile("data/sepolia-full/fix-art/manifest.json");

        vm.broadcast();
        NonNormieArtStore store = new NonNormieArtStore(address(cubes), msg.sender);

        for (uint256 c = 0; c < 5; c++) {
            uint256[] memory ids =
                vm.parseJsonUintArray(manifest, string.concat(".", KEYS[c]));
            if (ids.length == 0) continue;
            address src = vm.parseJsonAddress(cfg, string.concat(".cc0_", vm.toString(c + 1)));
            bytes[] memory payloads = new bytes[](ids.length);
            for (uint256 i = 0; i < ids.length; i++) {
                payloads[i] = vm.parseBytes(
                    vm.readFile(
                        string.concat(
                            "data/sepolia-full/fix-art/", KEYS[c], "-", vm.toString(ids[i]), ".hex"
                        )
                    )
                );
                require(payloads[i].length == 400, "bad payload");
            }
            vm.broadcast();
            store.recordSourcePayloadBatch(src, ids, payloads);
            console2.log(KEYS[c], "recorded:", ids.length);
        }

        vm.broadcast();
        address geometry = address(new CubeHilbertGeometry());
        vm.broadcast();
        address frameLayer = address(new CubeFrameLayer());
        vm.broadcast();
        address walkerLayer = address(new CubeWalkerLayer());
        vm.broadcast();
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes, normies, address(store), geometry, frameLayer, walkerLayer
        );
        vm.broadcast();
        CubeRendererV2 renderer = new CubeRendererV2(
            cubes, RendererAssetStore(assetStore), normies, address(thumb), address(store)
        );

        vm.broadcast();
        cubes.setRenderer(address(renderer));
        vm.broadcast();
        cubes.setArtStore(address(store));

        console2.log("new NonNormieArtStore", address(store));
        console2.log("new CubeRendererV2", address(renderer));
    }
}
