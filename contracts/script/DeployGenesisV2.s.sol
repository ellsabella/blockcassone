// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { FlatteningAttestation } from "../src/FlatteningAttestation.sol";
import { CubeMintController } from "../src/CubeMintController.sol";

/// @notice PARTIAL mainnet redeploy after the 2026-08-16 audit response: redeploys
///         only the contracts whose code changed (CubeNFT+CubeWorldLib, art store,
///         minter, both renderers) plus CubeMintController (unchanged code, but its
///         constructor pins CubeNFT). REUSES the already-deployed, already-configured
///         infrastructure from the superseded deployment:
///           - RendererAssetStore (9 renderer chunks already uploaded + verified)
///           - AgentStatusRegistry
///           - FlatteningAttestation (attestation signer already baked)
///           - CubeHilbertGeometry / CubeFrameLayer / CubeWalkerLayer (stateless)
///         Reads those addresses from data/mainnet/contracts.json (env-overridable).
///         Env: BLOCKCASSONE_OWNER. Broadcast as the owner (it owns the reused
///         attestation + registry, so the re-wiring calls succeed).
contract DeployGenesisV2 is Script {
    address internal constant OPENSEA_SEADROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    uint8 internal constant CC0_COUNT = 5;
    uint32 internal constant NORMIE_CAP = 1679;

    function _ccContracts() private view returns (address[] memory cc) {
        cc = new address[](CC0_COUNT);
        cc[0] = vm.envOr("CC0_RUNNERS", 0x97597002980134beA46250Aa0510C9B90d87A587);
        cc[1] = vm.envOr("CC0_SKULLS", 0x9251dEC8DF720C2ADF3B6f46d968107cbBADf4d4);
        cc[2] = vm.envOr("CC0_PEPES", 0x9131d8c7A411D90C6B164d296440701a0e5B3178);
        cc[3] = vm.envOr("CC0_NOUNS", 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03);
        cc[4] = vm.envOr("CC0_KEVIN", 0x17B19C70bfcA098da3f2eFeF6e7FA3a1C42F5429);
    }

    function _ccCaps() private pure returns (uint32[] memory caps) {
        caps = new uint32[](CC0_COUNT);
        caps[0] = 901;
        caps[1] = 655;
        caps[2] = 410;
        caps[3] = 328;
        caps[4] = 123;
    }

    struct Reused {
        address assetStore;
        address agentRegistry;
        address attestation;
        address geometry;
        address frameLayer;
        address walkerLayer;
    }

    function _reused() private view returns (Reused memory r) {
        string memory prev = vm.readFile("data/mainnet/contracts.json");
        r.assetStore = vm.envOr("BLOCKCASSONE_ASSET_STORE", vm.parseJsonAddress(prev, ".RendererAssetStore"));
        r.agentRegistry = vm.envOr("BLOCKCASSONE_AGENT_REGISTRY", vm.parseJsonAddress(prev, ".AgentStatusRegistry"));
        r.attestation = vm.envOr("BLOCKCASSONE_ATTESTATION", vm.parseJsonAddress(prev, ".FlatteningAttestation"));
        r.geometry = vm.envOr("BLOCKCASSONE_GEOMETRY", vm.parseJsonAddress(prev, ".CubeHilbertGeometry"));
        r.frameLayer = vm.envOr("BLOCKCASSONE_FRAME", vm.parseJsonAddress(prev, ".CubeFrameLayer"));
        r.walkerLayer = vm.envOr("BLOCKCASSONE_WALKER", vm.parseJsonAddress(prev, ".CubeWalkerLayer"));
    }

    function run() external {
        address owner = vm.envAddress("BLOCKCASSONE_OWNER");
        Reused memory r = _reused();
        bytes32 publicSeed = vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("theblock-genesis"));

        // Sanity: reused infrastructure must be live + owner-controlled where wiring
        // needs it (attestation.setAuthorizedConsumer below runs as the owner).
        require(r.assetStore.code.length > 0 && r.agentRegistry.code.length > 0, "reused infra missing");
        require(RendererAssetStore(r.assetStore).chunkCount() > 0, "asset store has no chunks");
        require(FlatteningAttestation(r.attestation).owner() == owner, "attestation not owner-controlled");
        require(AgentStatusRegistry(r.agentRegistry).owner() == owner, "registry not owner-controlled");

        vm.broadcast();
        CubeNFT cubes = new CubeNFT("TheBLOCK", "BLOCK", NormieAddresses.NORMIES, 4096, owner);

        vm.broadcast();
        NonNormieArtStore artStore = new NonNormieArtStore(address(cubes), owner);

        vm.broadcast();
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes, NormieAddresses.NORMIES_STORAGE, address(artStore), r.geometry, r.frameLayer, r.walkerLayer
        );

        vm.broadcast();
        CubeRendererV2 renderer = new CubeRendererV2(
            cubes,
            RendererAssetStore(r.assetStore),
            NormieAddresses.NORMIES_STORAGE,
            address(thumb),
            address(artStore)
        );

        vm.broadcast();
        CubeMintController customizer =
            new CubeMintController(cubes, artStore, FlatteningAttestation(r.attestation));

        vm.broadcast();
        MultiSourceGenesisMinter genesis = new MultiSourceGenesisMinter(
            cubes, publicSeed, owner, artStore, NORMIE_CAP, _ccContracts(), _ccCaps()
        );

        // Wiring — identical to DeployGenesis, with the reused pieces slotted in.
        vm.broadcast();
        cubes.setRenderer(address(renderer));
        vm.broadcast();
        cubes.setAgentStatusRegistry(r.agentRegistry);
        vm.broadcast();
        cubes.setCustomizer(address(customizer));
        vm.broadcast();
        cubes.setArtStore(address(artStore));
        vm.broadcast();
        artStore.setAuthorizedRecorder(address(genesis), true);
        vm.broadcast();
        artStore.transferOwnership(address(customizer));
        vm.broadcast();
        FlatteningAttestation(r.attestation).setAuthorizedConsumer(address(customizer));
        vm.broadcast();
        cubes.setGenesisMinter(address(genesis));
        address[] memory allowed = new address[](1);
        allowed[0] = vm.envOr("BLOCKCASSONE_SEADROP", OPENSEA_SEADROP);
        vm.broadcast();
        cubes.updateAllowedSeaDrop(allowed);
        vm.broadcast();
        genesis.setSeaDrop(address(cubes));
        // Post-mint mechanics stay OFF; phase stays Closed (as DeployGenesis).

        console2.log("== TheBLOCK genesis V2 (audit-fixed partial redeploy) ==");
        console2.log("CubeNFT", address(cubes));
        console2.log("MultiSourceGenesisMinter", address(genesis));
        console2.log("NonNormieArtStore", address(artStore));
        console2.log("CubeRendererV2", address(renderer));
        console2.log("CubeThumbnailRendererV1", address(thumb));
        console2.log("CubeMintController", address(customizer));
        console2.log("REUSED assetStore/agentRegistry/attestation:", r.assetStore, r.agentRegistry, r.attestation);
        console2.log("NEXT: CommitPools with the NEW minter. NO chunk upload needed.");
    }
}
