// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";

contract DeployMainnetNormiePreview is Script {
    uint32 internal constant DEFAULT_TOTAL_SLOTS = 4096;

    function run() external {
        address initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        address previewRecipient = vm.envOr("BLOCKCASSONE_PREVIEW_RECIPIENT", initialOwner);
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", initialOwner);
        uint32 totalSlots =
            uint32(vm.envOr("BLOCKCASSONE_TOTAL_SLOTS", uint256(DEFAULT_TOTAL_SLOTS)));
        uint256 sampleMints = vm.envOr("BLOCKCASSONE_SAMPLE_MINTS", uint256(3));
        uint256 firstNormieId = vm.envOr("BLOCKCASSONE_SAMPLE_NORMIE_START", uint256(1));
        bytes32 publicSeed =
            vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-mainnet-preview"));
        string memory configOut =
            vm.envOr("BLOCKCASSONE_CHAIN_CONFIG_OUT", string("data/chain-config.json"));

        vm.broadcast();
        CubeNFT cubes = new CubeNFT(
            "Blockcassone Cubes",
            "CUBE",
            NormieAddresses.NORMIES,
            totalSlots,
            initialOwner
        );

        vm.broadcast();
        RendererAssetStore assetStore = new RendererAssetStore(initialOwner);

        vm.broadcast();
        CubeRendererV2 renderer =
            new CubeRendererV2(cubes, assetStore, NormieAddresses.NORMIES_STORAGE);

        vm.broadcast();
        NormieGenesisMinter genesis = new NormieGenesisMinter(cubes, publicSeed, initialOwner);

        vm.broadcast();
        cubes.setRenderer(address(renderer));

        vm.broadcast();
        cubes.transferOwnership(address(genesis));

        uint256[] memory sampleNormies = new uint256[](sampleMints);
        for (uint256 i = 0; i < sampleMints; i++) {
            sampleNormies[i] = firstNormieId + i;
        }

        if (sampleMints > 0) {
            vm.broadcast();
            genesis.addSnapshotNormies(previewRecipient, sampleNormies);

            vm.broadcast();
            genesis.finalizeSnapshot();

            vm.broadcast();
            genesis.setSeaDrop(seaDrop);

            vm.broadcast();
            genesis.setPhase(NormieGenesisMinter.Phase.Public);

            vm.broadcast();
            genesis.mintPublicFor(previewRecipient, sampleMints);
        }

        console2.log("Mainnet Normies", NormieAddresses.NORMIES);
        console2.log("Mainnet NormiesStorage", NormieAddresses.NORMIES_STORAGE);
        console2.log("CubeNFT", address(cubes));
        console2.log("RendererAssetStore", address(assetStore));
        console2.log("CubeRendererV2", address(renderer));
        console2.log("NormieGenesisMinter", address(genesis));
        console2.log("SeaDrop", seaDrop);
        console2.log("Preview recipient", previewRecipient);
        console2.log("Sample mints", sampleMints);
        console2.log("First Normie ID", firstNormieId);

        _writeViewerConfig(
            configOut,
            block.chainid,
            address(cubes),
            address(genesis),
            address(renderer),
            address(assetStore)
        );
    }

    function _writeViewerConfig(
        string memory outPath,
        uint256 chainId,
        address cubes,
        address genesis,
        address renderer,
        address assetStore
    ) private {
        string memory root = "chainConfig";
        vm.serializeBool(root, "enabled", true);
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
        vm.serializeAddress(root, "cubeNft", cubes);
        vm.serializeAddress(root, "genesisMinter", genesis);
        vm.serializeAddress(root, "renderer", renderer);
        vm.serializeAddress(root, "rendererAssetStore", assetStore);
        vm.serializeAddress(root, "normies", NormieAddresses.NORMIES);
        string memory json =
            vm.serializeAddress(root, "normieStorage", NormieAddresses.NORMIES_STORAGE);
        vm.writeJson(json, outPath);
    }
}
