// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { FlatteningAttestation } from "../src/FlatteningAttestation.sol";
import { CubeMintController } from "../src/CubeMintController.sol";

/// @notice PRODUCTION (mainnet-shaped) genesis deploy: the full contract stack wired for
///         the multi-source SeaDrop drop, against the REAL Normie contract and the REAL
///         CC0 source collections, with the locked 4096 allocation. It only DEPLOYS +
///         WIRES — it does NOT mint, populate the CC0 pools, commit the Normie snapshot,
///         or configure the SeaDrop drop. Those are owner ops after deploy (see
///         LAUNCH_RUNBOOK.md). Ownership stays with the admin (decoupled minter role).
///
///         Renderer WebGL chunks are NOT uploaded here (RendererAssetStore is deployed
///         empty) — run scripts/upload-renderer-chunks.mjs after.
///
///   Required env: BLOCKCASSONE_OWNER (admin), BLOCKCASSONE_ATTESTATION_SIGNER.
///   Optional env: BLOCKCASSONE_SEADROP (default OpenSea SeaDrop 1.0), the CC0 addresses
///                 + caps, BLOCKCASSONE_PUBLIC_SEED.
contract DeployGenesis is Script {
    // OpenSea SeaDrop 1.0 singleton (mainnet). Override via env for testnets.
    address internal constant OPENSEA_SEADROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint8 internal constant CC0_COUNT = 5;

    struct Deployment {
        CubeNFT cubes;
        RendererAssetStore assetStore;
        AgentStatusRegistry agentRegistry;
        CubeThumbnailRendererV1 thumbnailRenderer;
        CubeRendererV2 renderer;
        NonNormieArtStore artStore;
        FlatteningAttestation attestation;
        CubeMintController customizer;
        MultiSourceGenesisMinter genesis;
    }

    // Locked genesis allocation over the 4096 supply (sums to 4096). Normie is the live
    // collection (collection 0); the rest are CC0 stored-payload collections.
    uint32 internal constant NORMIE_CAP = 1679;

    function _ccContracts() private view returns (address[] memory cc) {
        cc = new address[](CC0_COUNT);
        cc[0] = vm.envOr("CC0_RUNNERS", 0x97597002980134beA46250Aa0510C9B90d87A587); // Chain Runners
        cc[1] = vm.envOr("CC0_SKULLS", 0x9251dEC8DF720C2ADF3B6f46d968107cbBADf4d4); // 1337 skulls
        cc[2] = vm.envOr("CC0_PEPES", 0x9131d8c7A411D90C6B164d296440701a0e5B3178); // Baby Pepes
        cc[3] = vm.envOr("CC0_NOUNS", 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03); // Nouns
        cc[4] = vm.envOr("CC0_KEVIN", 0x17B19C70bfcA098da3f2eFeF6e7FA3a1C42F5429); // OnChainKevin
    }

    function _ccCaps() private view returns (uint32[] memory caps) {
        caps = new uint32[](CC0_COUNT);
        caps[0] = uint32(vm.envOr("CC0_CAP_RUNNERS", uint256(901)));
        caps[1] = uint32(vm.envOr("CC0_CAP_SKULLS", uint256(655)));
        caps[2] = uint32(vm.envOr("CC0_CAP_PEPES", uint256(410)));
        caps[3] = uint32(vm.envOr("CC0_CAP_NOUNS", uint256(328)));
        caps[4] = uint32(vm.envOr("CC0_CAP_KEVIN", uint256(123)));
    }

    function run() external {
        address owner = vm.envAddress("BLOCKCASSONE_OWNER");
        address attestationSigner = vm.envAddress("BLOCKCASSONE_ATTESTATION_SIGNER");
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", OPENSEA_SEADROP);
        bytes32 publicSeed = vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-genesis"));

        uint256 gasBefore = gasleft();
        Deployment memory d = _deploy(owner, attestationSigner, publicSeed);
        _wire(d, owner, seaDrop);
        console2.log("deploy gas (contracts only; EXCLUDES RendererAssetStore chunks):", gasBefore - gasleft());
        _report(d, seaDrop);
    }

    function _deploy(address owner, address attestationSigner, bytes32 publicSeed)
        private
        returns (Deployment memory d)
    {
        vm.broadcast();
        d.cubes = new CubeNFT("TheBLOCK", "BLOCK", NormieAddresses.NORMIES, 4096, owner);

        vm.broadcast();
        d.assetStore = new RendererAssetStore(owner);

        vm.broadcast();
        d.agentRegistry = new AgentStatusRegistry(owner);

        vm.broadcast();
        address geometry = address(new CubeHilbertGeometry());
        vm.broadcast();
        address frameLayer = address(new CubeFrameLayer());
        vm.broadcast();
        address walkerLayer = address(new CubeWalkerLayer());

        vm.broadcast();
        d.artStore = new NonNormieArtStore(address(d.cubes), owner);

        vm.broadcast();
        d.thumbnailRenderer = new CubeThumbnailRendererV1(
            d.cubes, NormieAddresses.NORMIES_STORAGE, address(d.artStore), geometry, frameLayer, walkerLayer
        );

        vm.broadcast();
        d.renderer = new CubeRendererV2(
            d.cubes, d.assetStore, NormieAddresses.NORMIES_STORAGE, address(d.thumbnailRenderer), address(d.artStore)
        );

        vm.broadcast();
        d.attestation = new FlatteningAttestation(owner, attestationSigner);

        vm.broadcast();
        d.customizer = new CubeMintController(d.cubes, d.artStore, d.attestation);

        vm.broadcast();
        d.genesis = new MultiSourceGenesisMinter(
            d.cubes, publicSeed, owner, d.artStore, NORMIE_CAP, _ccContracts(), _ccCaps()
        );
    }

    function _wire(Deployment memory d, address owner, address seaDrop) private {
        owner; // wiring below runs as the broadcasting admin (== owner)
        vm.broadcast();
        d.cubes.setRenderer(address(d.renderer));

        vm.broadcast();
        d.cubes.setAgentStatusRegistry(address(d.agentRegistry));

        // Customize controller owns the art store + is the attestation consumer + the
        // token's customizer (must precede the art-store ownership transfer).
        vm.broadcast();
        d.cubes.setCustomizer(address(d.customizer));

        // Art store ref: lets the token check CC0 pool-source eligibility for the
        // attestation-free post-mint "spin the wheel" re-base (rebaseToPoolSource).
        vm.broadcast();
        d.cubes.setArtStore(address(d.artStore));

        // Genesis minter may commit CC0 pool payloads to the store (source-keyed) — auth
        // BEFORE the store ownership transfer. The mint itself writes no art.
        vm.broadcast();
        d.artStore.setAuthorizedRecorder(address(d.genesis), true);

        vm.broadcast();
        d.artStore.transferOwnership(address(d.customizer));

        vm.broadcast();
        d.attestation.setAuthorizedConsumer(address(d.customizer));

        // Decoupled SeaDrop: admin STAYS the token owner (configures the drop + flips
        // phases); the minter mints via the genesisMinter role; SeaDrop is the only
        // allowed mintSeaDrop caller (SeaDrop -> token -> minter). Phase starts Closed.
        vm.broadcast();
        d.cubes.setGenesisMinter(address(d.genesis));

        address[] memory allowed = new address[](1);
        allowed[0] = seaDrop;
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);

        vm.broadcast();
        d.genesis.setSeaDrop(address(d.cubes));

        // Move + merge + customize all stay OFF at launch (default false). The owner enables
        // each independently AFTER the mint via setMovesEnabled / setMergesEnabled /
        // setCustomizesEnabled — a move/merge/customize during the mint window could interfere
        // with the allocator or the source-claim registry, so none may be live at deploy.
    }

    function _report(Deployment memory d, address seaDrop) private {
        console2.log("== TheBLOCK genesis deploy ==");
        console2.log("CubeNFT", address(d.cubes));
        console2.log("MultiSourceGenesisMinter", address(d.genesis));
        console2.log("NonNormieArtStore", address(d.artStore));
        console2.log("CubeRendererV2", address(d.renderer));
        console2.log("CubeThumbnailRendererV1", address(d.thumbnailRenderer));
        console2.log("RendererAssetStore (upload chunks next)", address(d.assetStore));
        console2.log("AgentStatusRegistry", address(d.agentRegistry));
        console2.log("FlatteningAttestation", address(d.attestation));
        console2.log("CubeMintController", address(d.customizer));
        console2.log("Normies (source)", NormieAddresses.NORMIES);
        console2.log("SeaDrop (allowed caller)", seaDrop);
        console2.log("Allocation: Normie/Runners/Skulls/Pepes/Nouns/Kevin =");
        console2.log("  1679 / 901 / 655 / 410 / 328 / 123 (sum 4096)");
        console2.log("NEXT (owner ops): upload renderer chunks; commit CC0 pools; commit Normie snapshot+root; configure SeaDrop drop; open Allowlist phase. See LAUNCH_RUNBOOK.md");
    }
}
