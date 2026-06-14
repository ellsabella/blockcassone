// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";

contract DeployMainnetNormiePreview is Script {
    uint32 internal constant DEFAULT_TOTAL_SLOTS = 4096;

    struct PreviewConfig {
        address initialOwner;
        address previewRecipient;
        address seaDrop;
        uint32 totalSlots;
        uint256 sampleMints;
        uint256 firstNormieId;
        uint256 agentNormieId;
        uint256 agentId;
        bytes32 publicSeed;
        string configOut;
    }

    struct Deployment {
        CubeNFT cubes;
        RendererAssetStore assetStore;
        AgentStatusRegistry agentRegistry;
        CubeRendererV2 renderer;
        NormieGenesisMinter genesis;
    }

    function run() external {
        PreviewConfig memory config = _previewConfig();
        Deployment memory deployment = _deploy(config);

        _mintSamples(config, deployment);
        _logDeployment(config, deployment);

        _writeViewerConfig(
            config.configOut,
            block.chainid,
            address(deployment.cubes),
            address(deployment.genesis),
            address(deployment.renderer),
            address(deployment.assetStore),
            address(deployment.agentRegistry)
        );
    }

    function _previewConfig() private view returns (PreviewConfig memory config) {
        config.initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        config.previewRecipient =
            vm.envOr("BLOCKCASSONE_PREVIEW_RECIPIENT", config.initialOwner);
        config.seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", config.initialOwner);
        config.totalSlots =
            uint32(vm.envOr("BLOCKCASSONE_TOTAL_SLOTS", uint256(DEFAULT_TOTAL_SLOTS)));
        config.sampleMints = vm.envOr("BLOCKCASSONE_SAMPLE_MINTS", uint256(3));
        config.firstNormieId = vm.envOr("BLOCKCASSONE_SAMPLE_NORMIE_START", uint256(1));
        config.agentNormieId = vm.envOr("BLOCKCASSONE_SAMPLE_AGENT_NORMIE_ID", uint256(0));
        config.agentId = vm.envOr("BLOCKCASSONE_SAMPLE_AGENT_ID", uint256(0));
        config.publicSeed =
            vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-mainnet-preview"));
        config.configOut =
            vm.envOr("BLOCKCASSONE_CHAIN_CONFIG_OUT", string("data/chain-config.json"));
    }

    function _deploy(PreviewConfig memory config) private returns (Deployment memory deployment) {
        vm.broadcast();
        deployment.cubes = new CubeNFT(
            "Blockcassone Cubes",
            "CUBE",
            NormieAddresses.NORMIES,
            config.totalSlots,
            config.initialOwner
        );

        vm.broadcast();
        deployment.assetStore = new RendererAssetStore(config.initialOwner);

        vm.broadcast();
        deployment.agentRegistry = new AgentStatusRegistry(config.initialOwner);

        vm.broadcast();
        deployment.renderer =
            new CubeRendererV2(deployment.cubes, deployment.assetStore, NormieAddresses.NORMIES_STORAGE);

        vm.broadcast();
        deployment.genesis =
            new NormieGenesisMinter(deployment.cubes, config.publicSeed, config.initialOwner);

        vm.broadcast();
        deployment.cubes.setRenderer(address(deployment.renderer));

        vm.broadcast();
        deployment.cubes.setAgentStatusRegistry(address(deployment.agentRegistry));

        vm.broadcast();
        deployment.cubes.transferOwnership(address(deployment.genesis));
    }

    function _mintSamples(PreviewConfig memory config, Deployment memory deployment) private {
        if (config.sampleMints == 0) return;

        uint256[] memory sampleNormies = new uint256[](config.sampleMints);
        for (uint256 i = 0; i < config.sampleMints; i++) {
            sampleNormies[i] = config.firstNormieId + i;
        }

        vm.broadcast();
        deployment.genesis.addSnapshotNormies(config.previewRecipient, sampleNormies);

        if (config.agentNormieId != 0 && config.agentId != 0) {
            vm.broadcast();
            deployment.genesis.setSnapshotAgentBinding(config.agentNormieId, config.agentId);

            vm.broadcast();
            deployment.agentRegistry.setAgentBinding(
                NormieAddresses.NORMIES,
                config.agentNormieId,
                true,
                config.agentId
            );
        }

        vm.broadcast();
        deployment.genesis.finalizeSnapshot();

        vm.broadcast();
        deployment.genesis.setSeaDrop(config.seaDrop);

        vm.broadcast();
        deployment.genesis.setPhase(NormieGenesisMinter.Phase.Public);

        vm.broadcast();
        deployment.genesis.mintPublicFor(config.previewRecipient, config.sampleMints);
    }

    function _logDeployment(PreviewConfig memory config, Deployment memory deployment) private pure {
        console2.log("Mainnet Normies", NormieAddresses.NORMIES);
        console2.log("Mainnet NormiesStorage", NormieAddresses.NORMIES_STORAGE);
        console2.log("CubeNFT", address(deployment.cubes));
        console2.log("RendererAssetStore", address(deployment.assetStore));
        console2.log("AgentStatusRegistry", address(deployment.agentRegistry));
        console2.log("CubeRendererV2", address(deployment.renderer));
        console2.log("NormieGenesisMinter", address(deployment.genesis));
        console2.log("SeaDrop", config.seaDrop);
        console2.log("Preview recipient", config.previewRecipient);
        console2.log("Sample mints", config.sampleMints);
        console2.log("First Normie ID", config.firstNormieId);
        console2.log("Sample agent Normie ID", config.agentNormieId);
        console2.log("Sample agent ID", config.agentId);
    }

    function _writeViewerConfig(
        string memory outPath,
        uint256 chainId,
        address cubes,
        address genesis,
        address renderer,
        address assetStore,
        address agentRegistry
    ) private {
        string memory root = "chainConfig";
        vm.serializeBool(root, "enabled", true);
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
        vm.serializeAddress(root, "cubeNft", cubes);
        vm.serializeAddress(root, "genesisMinter", genesis);
        vm.serializeAddress(root, "renderer", renderer);
        vm.serializeAddress(root, "rendererAssetStore", assetStore);
        vm.serializeAddress(root, "agentStatusRegistry", agentRegistry);
        vm.serializeAddress(root, "normies", NormieAddresses.NORMIES);
        string memory json =
            vm.serializeAddress(root, "normieStorage", NormieAddresses.NORMIES_STORAGE);
        vm.writeJson(json, outPath);
    }
}
