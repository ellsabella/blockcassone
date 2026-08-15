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
import { FlatteningAttestation } from "../src/FlatteningAttestation.sol";
import { CubeMintController } from "../src/CubeMintController.sol";
import { PublicDrop, AllowListData } from "../src/interfaces/ISeaDrop.sol";
import { LocalMockNormies, LocalMockCC0 } from "./DeployLocalGenesis.s.sol";

/// @notice FULL-STRENGTH Sepolia deployment: the real 4096-slot world with the real
///         locked allocation (1679/901/655/410/328/123), every pool fully committed
///         with REAL flattened art (data/cc0-full + data/normie-pool.json produced by
///         the flatten pipeline), driven by the REAL SeaDrop 1.0 singleton. This is
///         the mainnet deploy in every contract-level respect; the only Sepolia
///         substitutions are the source-collection mocks (no Normies/CC0 contracts on
///         Sepolia) and lazy mock-Normie art baking (view-time only — the driver bakes
///         real bitmaps for minted ids; pools/caps/finalize invariants are identical).
contract DeploySepoliaFull is Script {
    address internal constant SEADROP_1_0 = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint32 internal constant NORMIE_CAP = 1679;
    uint8 internal constant CC0_COUNT = 5;
    uint256 internal constant SNAPSHOT_BATCH = 120; // addSnapshotNormies ids/tx
    uint256 internal constant POOL_BATCH = 150; // addSourcePool ids/tx
    uint256 internal constant PAYLOAD_BATCH = 50; // setSourcePayloadBatch payloads/tx (one SSTORE2 blob)

    struct Deployment {
        LocalMockNormies normies;
        CubeNFT cubes;
        RendererAssetStore assetStore;
        AgentStatusRegistry agentRegistry;
        CubeThumbnailRendererV1 thumbnailRenderer;
        CubeRendererV2 renderer;
        MultiSourceGenesisMinter genesis;
        address[CC0_COUNT] cc0;
        NonNormieArtStore artStore;
        FlatteningAttestation attestation;
        CubeMintController customizer;
    }

    function _ccKeys() private pure returns (string[CC0_COUNT] memory k) {
        k[0] = "runner";
        k[1] = "skull";
        k[2] = "pepe";
        k[3] = "noun";
        k[4] = "kevin";
    }

    function _ccNames() private pure returns (string[CC0_COUNT] memory n) {
        n[0] = "Chain Runners";
        n[1] = "1337 skulls";
        n[2] = "Baby Pepes";
        n[3] = "Nouns";
        n[4] = "OnChainKevin";
    }

    function _ccCaps() private pure returns (uint32[CC0_COUNT] memory c) {
        c[0] = 901;
        c[1] = 655;
        c[2] = 410;
        c[3] = 328;
        c[4] = 123;
    }

    struct DropConfig {
        bytes32 allowlistRoot;
        uint64 gtdEnd;
        uint48 publicStart;
        uint48 publicEnd;
        uint80 mintPrice;
        address feeRecipient;
    }

    function run() external {
        DropConfig memory cfg = DropConfig({
            allowlistRoot: vm.envBytes32("BLOCKCASSONE_ALLOWLIST_ROOT"),
            gtdEnd: uint64(vm.envUint("BLOCKCASSONE_GTD_END")),
            publicStart: uint48(vm.envUint("BLOCKCASSONE_PUBLIC_START")),
            publicEnd: uint48(vm.envUint("BLOCKCASSONE_PUBLIC_END")),
            mintPrice: uint80(vm.envOr("BLOCKCASSONE_MINT_PRICE", uint256(0.0001 ether))),
            feeRecipient: msg.sender
        });

        Deployment memory d = _deploy(msg.sender);
        (uint256 res1a, uint256 res1b, uint256 res2) =
            _seedWorld(d, vm.envAddress("BLOCKCASSONE_GTD1"), vm.envAddress("BLOCKCASSONE_GTD2"));
        _configureDrop(d, cfg);
        _report(d, res1a, res1b, res2);
    }

    function _deploy(address deployer) private returns (Deployment memory d) {
        vm.broadcast();
        d.normies = new LocalMockNormies();
        vm.broadcast();
        d.cubes = new CubeNFT("TheBLOCK", "BLOCK", address(d.normies), 4096, deployer);
        vm.broadcast();
        d.assetStore = new RendererAssetStore(deployer);
        vm.broadcast();
        d.agentRegistry = new AgentStatusRegistry(deployer);
        vm.broadcast();
        address geometry = address(new CubeHilbertGeometry());
        vm.broadcast();
        address frameLayer = address(new CubeFrameLayer());
        vm.broadcast();
        address walkerLayer = address(new CubeWalkerLayer());
        vm.broadcast();
        d.artStore = new NonNormieArtStore(address(d.cubes), deployer);
        vm.broadcast();
        d.thumbnailRenderer = new CubeThumbnailRendererV1(
            d.cubes, address(d.normies), address(d.artStore), geometry, frameLayer, walkerLayer
        );
        vm.broadcast();
        d.renderer = new CubeRendererV2(
            d.cubes, d.assetStore, address(d.normies), address(d.thumbnailRenderer), address(d.artStore)
        );
        address signer = vm.envOr("BLOCKCASSONE_ATTESTATION_SIGNER", deployer);
        vm.broadcast();
        d.attestation = new FlatteningAttestation(deployer, signer);
        vm.broadcast();
        d.customizer = new CubeMintController(d.cubes, d.artStore, d.attestation);

        {
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
                d.cubes,
                keccak256("theblock-sepolia-full-seed"),
                deployer,
                d.artStore,
                NORMIE_CAP,
                ccContracts,
                ccCaps
            );
        }

        vm.broadcast();
        d.cubes.setRenderer(address(d.renderer));
        vm.broadcast();
        d.cubes.setAgentStatusRegistry(address(d.agentRegistry));
        vm.broadcast();
        d.cubes.setCustomizer(address(d.customizer));
        vm.broadcast();
        d.cubes.setArtStore(address(d.artStore));
        vm.broadcast();
        d.artStore.setAuthorizedRecorder(address(d.genesis), true);
        vm.broadcast();
        d.artStore.transferOwnership(address(d.customizer));
        vm.broadcast();
        d.attestation.setAuthorizedConsumer(address(d.customizer));
        vm.broadcast();
        d.cubes.setGenesisMinter(address(d.genesis));

        // Post-mint mechanics ON for the validation pass (production: OFF at launch).
        vm.broadcast();
        d.cubes.setMovesEnabled(true);
        vm.broadcast();
        d.cubes.setMergesEnabled(true);
        vm.broadcast();
        d.cubes.setCustomizesEnabled(true);
    }

    /// @dev Registers the FULL pools: 1,679 Normie ids + 2,417 CC0 ids with their real
    ///      flattened payloads. Reserves GTD picks, then finalizes — after this the
    ///      world is exactly the mainnet drop, mintable through SeaDrop.
    function _seedWorld(Deployment memory d, address gtd1, address gtd2)
        private
        returns (uint256 res1a, uint256 res1b, uint256 res2)
    {
        // Normie candidate pool (ids only — mock art is baked lazily by the driver for
        // minted cubes; the renderer reads art at view time, never at mint time).
        uint256[] memory normieIds =
            vm.parseJsonUintArray(vm.readFile("data/normie-pool.json"), ".tokenIds");
        require(normieIds.length >= NORMIE_CAP, "normie pool too small");
        for (uint256 off = 0; off < normieIds.length; off += SNAPSHOT_BATCH) {
            uint256 n = _min(SNAPSHOT_BATCH, normieIds.length - off);
            uint256[] memory batch = new uint256[](n);
            for (uint256 i = 0; i < n; i++) batch[i] = normieIds[off + i];
            vm.broadcast();
            d.genesis.addSnapshotNormies(msg.sender, batch);
        }

        // CC0 pools + payloads (one SSTORE2 blob per PAYLOAD_BATCH).
        string[CC0_COUNT] memory keys = _ccKeys();
        for (uint256 c = 0; c < CC0_COUNT; c++) {
            uint256[] memory ids = vm.parseJsonUintArray(
                vm.readFile(string.concat("data/cc0/pool-", keys[c], ".json")), ".tokenIds"
            );
            uint8 collectionId = uint8(c + 1);
            for (uint256 off = 0; off < ids.length; off += POOL_BATCH) {
                uint256 n = _min(POOL_BATCH, ids.length - off);
                uint256[] memory batch = new uint256[](n);
                for (uint256 i = 0; i < n; i++) batch[i] = ids[off + i];
                vm.broadcast();
                d.genesis.addSourcePool(collectionId, batch);
            }
            for (uint256 off = 0; off < ids.length; off += PAYLOAD_BATCH) {
                uint256 n = _min(PAYLOAD_BATCH, ids.length - off);
                uint256[] memory batch = new uint256[](n);
                bytes[] memory payloads = new bytes[](n);
                for (uint256 i = 0; i < n; i++) {
                    batch[i] = ids[off + i];
                    payloads[i] = vm.parseBytes(
                        vm.readFile(
                            string.concat(
                                "data/cc0-full/", keys[c], "/", vm.toString(ids[off + i]), ".hex"
                            )
                        )
                    );
                    require(payloads[i].length == 400, "bad payload length");
                }
                vm.broadcast();
                d.genesis.setSourcePayloadBatch(collectionId, batch, payloads);
            }
        }

        // GTD reservations: gtd1 -> first two pool Normies (chosen art, mints in-window);
        // gtd2 -> first pool Runner (the planned no-show).
        res1a = normieIds[0];
        res1b = normieIds[1];
        {
            uint8[] memory c1 = new uint8[](2);
            uint256[] memory s1 = new uint256[](2);
            c1[0] = 0;
            s1[0] = res1a;
            c1[1] = 0;
            s1[1] = res1b;
            vm.broadcast();
            d.genesis.reserveSources(gtd1, c1, s1);

            uint256[] memory runnerIds = vm.parseJsonUintArray(
                vm.readFile("data/cc0/pool-runner.json"), ".tokenIds"
            );
            res2 = runnerIds[0];
            uint8[] memory c2 = new uint8[](1);
            uint256[] memory s2 = new uint256[](1);
            c2[0] = 1;
            s2[0] = res2;
            vm.broadcast();
            d.genesis.reserveSources(gtd2, c2, s2);
        }

        vm.broadcast();
        d.genesis.finalizeSnapshot();
    }

    function _configureDrop(Deployment memory d, DropConfig memory cfg) private {
        address[] memory allowed = new address[](1);
        allowed[0] = SEADROP_1_0;
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);
        vm.broadcast();
        d.genesis.setSeaDrop(address(d.cubes));
        vm.broadcast();
        d.cubes.updateCreatorPayoutAddress(SEADROP_1_0, msg.sender);
        vm.broadcast();
        d.cubes.updateAllowedFeeRecipient(SEADROP_1_0, cfg.feeRecipient, true);
        vm.broadcast();
        d.cubes.updateAllowList(
            SEADROP_1_0,
            AllowListData({
                merkleRoot: cfg.allowlistRoot,
                publicKeyURIs: new string[](0),
                allowListURI: ""
            })
        );
        vm.broadcast();
        d.cubes.updatePublicDrop(
            SEADROP_1_0,
            PublicDrop({
                mintPrice: cfg.mintPrice,
                startTime: cfg.publicStart,
                endTime: cfg.publicEnd,
                maxTotalMintableByWallet: 8,
                feeBps: 500,
                restrictFeeRecipients: true
            })
        );
        vm.broadcast();
        d.cubes.updateDropURI(SEADROP_1_0, "data:application/json,{\"name\":\"TheBLOCK (Sepolia full)\"}");
        vm.broadcast();
        d.cubes.setContractURI("data:application/json,{\"name\":\"TheBLOCK (Sepolia full)\"}");
        vm.broadcast();
        d.cubes.setDefaultRoyalty(msg.sender, 500);
        vm.broadcast();
        d.cubes.setProvenanceHash(keccak256("theblock-sepolia-full"));
        vm.broadcast();
        d.genesis.setGtdEndTime(cfg.gtdEnd);
        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Public);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _report(Deployment memory d, uint256 res1a, uint256 res1b, uint256 res2) private {
        console2.log("CubeNFT", address(d.cubes));
        console2.log("MultiSourceGenesisMinter", address(d.genesis));
        console2.log("totalPublicRemaining", d.genesis.totalPublicRemaining());

        string memory root = "full";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "cubeNft", address(d.cubes));
        vm.serializeAddress(root, "genesisMinter", address(d.genesis));
        vm.serializeAddress(root, "rendererAssetStore", address(d.assetStore));
        vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.serializeAddress(root, "thumbnailRenderer", address(d.thumbnailRenderer));
        vm.serializeAddress(root, "artStore", address(d.artStore));
        vm.serializeAddress(root, "normies", address(d.normies));
        vm.serializeAddress(root, "seaDrop", SEADROP_1_0);
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            vm.serializeAddress(root, string.concat("cc0_", vm.toString(i + 1)), d.cc0[i]);
        }
        vm.serializeUint(root, "gtd1ReservedA", res1a);
        vm.serializeUint(root, "gtd1ReservedB", res1b);
        vm.serializeUint(root, "gtd2Reserved", res2);
        string memory json = vm.serializeUint(root, "totalSlots", 4096);
        vm.writeJson(json, "data/sepolia-full/contracts.json");
    }
}
