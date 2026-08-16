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
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";
import { FlatteningAttestation } from "../src/FlatteningAttestation.sol";
import { CubeMintController } from "../src/CubeMintController.sol";
import { LocalMockNormies, LocalMockCC0 } from "./DeployLocalGenesis.s.sol";

/// @notice Sepolia ART CHECK for the audit-fixed contracts — one forge run, no phase
///         windows, no SeaDrop, no waiting. Deploys the fixed stack with REAL art
///         (19 Normie raws + 28 real CC0 payloads), then owner-mints a curated review
///         set to the deployer INCLUDING the exact M-2 scenario (a street whose merge
///         LEADER is a CC0 cube) and an M-3-path pool re-base. Thumbnails render
///         chunk-free, so no RendererAssetStore upload is needed for the art check.
contract DeploySepoliaArtCheck is Script {
    uint32 internal constant NORMIE_CAP = 19;
    uint8 internal constant CC0_COUNT = 5;

    struct D {
        LocalMockNormies normies;
        CubeNFT cubes;
        NonNormieArtStore artStore;
        MultiSourceGenesisMinter genesis;
        CubeRendererV2 renderer;
        CubeThumbnailRendererV1 thumb;
        address[CC0_COUNT] cc0;
    }

    function _ccNames() private pure returns (string[CC0_COUNT] memory n) {
        n[0] = "Chain Runners";
        n[1] = "1337 skulls";
        n[2] = "Baby Pepes";
        n[3] = "Nouns";
        n[4] = "OnChainKevin";
    }

    function _ccCaps() private pure returns (uint32[CC0_COUNT] memory c) {
        c[0] = 8;
        c[1] = 8;
        c[2] = 4;
        c[3] = 4;
        c[4] = 4;
    }

    function run() external {
        address me = msg.sender;
        D memory d = _deploy(me);
        _seed(d, me);
        _mintReviewSet(d, me);
        _report(d);
    }

    function _deploy(address me) private returns (D memory d) {
        vm.broadcast();
        d.normies = new LocalMockNormies();
        vm.broadcast();
        d.cubes = new CubeNFT("TheBLOCK", "BLOCK", address(d.normies), 47, me);
        vm.broadcast();
        RendererAssetStore assets = new RendererAssetStore(me);
        vm.broadcast();
        AgentStatusRegistry reg = new AgentStatusRegistry(me);
        vm.broadcast();
        address geometry = address(new CubeHilbertGeometry());
        vm.broadcast();
        address frameLayer = address(new CubeFrameLayer());
        vm.broadcast();
        address walkerLayer = address(new CubeWalkerLayer());
        vm.broadcast();
        d.artStore = new NonNormieArtStore(address(d.cubes), me);
        vm.broadcast();
        d.thumb = new CubeThumbnailRendererV1(
            d.cubes, address(d.normies), address(d.artStore), geometry, frameLayer, walkerLayer
        );
        vm.broadcast();
        d.renderer = new CubeRendererV2(
            d.cubes, assets, address(d.normies), address(d.thumb), address(d.artStore)
        );
        vm.broadcast();
        FlatteningAttestation att = new FlatteningAttestation(me, me);
        vm.broadcast();
        CubeMintController customizer = new CubeMintController(d.cubes, d.artStore, att);

        string[CC0_COUNT] memory names = _ccNames();
        uint32[CC0_COUNT] memory caps = _ccCaps();
        address[] memory ccContracts = new address[](CC0_COUNT);
        uint32[] memory ccCaps = new uint32[](CC0_COUNT);
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            vm.broadcast();
            LocalMockCC0 src = new LocalMockCC0(names[i], names[i]);
            d.cc0[i] = address(src);
            ccContracts[i] = address(src);
            ccCaps[i] = caps[i];
        }
        vm.broadcast();
        d.genesis = new MultiSourceGenesisMinter(
            d.cubes, keccak256("artcheck"), me, d.artStore, NORMIE_CAP, ccContracts, ccCaps
        );

        vm.broadcast();
        d.cubes.setRenderer(address(d.renderer));
        vm.broadcast();
        d.cubes.setAgentStatusRegistry(address(reg));
        vm.broadcast();
        d.cubes.setCustomizer(address(customizer));
        vm.broadcast();
        d.cubes.setArtStore(address(d.artStore));
        vm.broadcast();
        d.artStore.setAuthorizedRecorder(address(d.genesis), true);
        vm.broadcast();
        d.artStore.transferOwnership(address(customizer));
        vm.broadcast();
        d.cubes.setGenesisMinter(address(d.genesis));
        vm.broadcast();
        d.cubes.setMergesEnabled(true);
        vm.broadcast();
        d.cubes.setCustomizesEnabled(true);
        vm.broadcast();
        d.cubes.setBaseFee(0); // art check: fee-free merge
    }

    function _seed(D memory d, address me) private {
        // Real Normie art for the ids we mint below.
        uint256[6] memory nids = [uint256(5555), 1, 42, 100, 250, 1250];
        uint256[] memory ids = new uint256[](nids.length);
        bytes[] memory raws = new bytes[](nids.length);
        for (uint256 i = 0; i < nids.length; i++) {
            ids[i] = nids[i];
            raws[i] = vm.parseBytes(
                vm.readFile(string.concat("data/normie-raw-", vm.toString(nids[i]), ".hex"))
            );
        }
        vm.broadcast();
        d.normies.mintWithDataBatch(me, ids, raws);

        // Real CC0 payloads (July sample files — Runner entries are DNA-corrected).
        uint32[CC0_COUNT] memory caps = _ccCaps();
        uint256[CC0_COUNT] memory starts = [uint256(1000), 2000, 3000, 4000, 5000];
        for (uint256 c = 0; c < CC0_COUNT; c++) {
            uint256 base = c == 0 ? 0 : c == 1 ? 8 : c == 2 ? 20 : c == 3 ? 16 : 24;
            uint256[] memory pids = new uint256[](caps[c]);
            bytes[] memory ps = new bytes[](caps[c]);
            for (uint256 i = 0; i < caps[c]; i++) {
                pids[i] = starts[c] + i;
                ps[i] = vm.parseBytes(
                    vm.readFile(string.concat("data/cc0/", vm.toString(base + i), ".hex"))
                );
            }
            vm.broadcast();
            d.genesis.addSourcePool(uint8(c + 1), pids);
            vm.broadcast();
            d.genesis.setSourcePayloadBatch(uint8(c + 1), pids, ps);
        }
    }

    function _mintReviewSet(D memory d, address me) private {
        uint8 PV = NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT;

        // Street 0 with a CC0 LEADER (the M-2 scenario): Runner #1000 at slot 0,
        // four real-art Normies at slots 1-4, then merge -> street token.
        vm.broadcast();
        d.cubes.mintSnapshotExternalCubeFor(me, d.cc0[0], 1000, 0, keccak256("s0"), PV);
        uint256[4] memory streetNormies = [uint256(1), 42, 100, 250];
        for (uint256 i = 0; i < 4; i++) {
            vm.broadcast();
            d.cubes.mintSnapshotNormieCubeFor(me, streetNormies[i], uint32(i + 1), keccak256(abi.encode("sn", i)));
        }
        vm.broadcast();
        uint256 streetToken = d.cubes.mergeStreet(0);

        // Singles, one per street: real-art Normie + one of each CC0 flavor.
        vm.broadcast();
        d.cubes.mintSnapshotNormieCubeFor(me, 5555, 8, keccak256("n5555"));
        uint32[5] memory slots = [uint32(16), 24, 32, 40, 41];
        uint256[5] memory srcIds = [uint256(1001), 2001, 3001, 4001, 5001];
        for (uint256 c = 0; c < 5; c++) {
            vm.broadcast();
            d.cubes.mintSnapshotExternalCubeFor(me, d.cc0[c], srcIds[c], slots[c], keccak256(abi.encode("cc", c)), PV);
        }

        // Pool re-base visual (M-3 path): a real-art Normie cube re-based onto an
        // unused pool Runner — its thumbnail must show the RUNNER afterwards.
        vm.broadcast();
        uint256 rebaser = d.cubes.mintSnapshotNormieCubeFor(me, 1250, 42, keccak256("reb"));
        vm.broadcast();
        d.cubes.rebaseToPoolSource(rebaser, d.cc0[0], 1002);

        console2.log("street token (CC0 leader)", streetToken);
        console2.log("rebased cube", rebaser);
    }

    function _report(D memory d) private {
        string memory root = "artcheck";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "cubeNft", address(d.cubes));
        vm.serializeAddress(root, "genesisMinter", address(d.genesis));
        vm.serializeAddress(root, "artStore", address(d.artStore));
        vm.serializeAddress(root, "normies", address(d.normies));
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            vm.serializeAddress(root, string.concat("cc0_", vm.toString(i + 1)), d.cc0[i]);
        }
        string memory json = vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.writeJson(json, "data/sepolia-artcheck/contracts.json");
        console2.log("CubeNFT", address(d.cubes));
    }
}
