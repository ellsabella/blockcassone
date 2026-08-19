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
import { PublicDrop, AllowListData } from "../src/interfaces/ISeaDrop.sol";
import { LocalMockNormies, LocalMockCC0 } from "./DeployLocalGenesis.s.sol";

/// @notice Sepolia DRESS REHEARSAL of the full drop: the same 47-slot real-art world as
///         DeployLocalGenesis (19 real Normie bitmaps + 28 real flattened CC0 payloads),
///         but driven by the REAL SeaDrop 1.0 singleton — no MockSeaDrop faucet, real
///         payment/merkle/stage enforcement. The 4-phase drop config (single allowlist
///         root covering GTD + guaranteed-random + FCFS leaves, public drop after) is
///         applied here from env; the phase walkthrough itself is scripts/
///         rehearsal-driver.mjs. Post-mint mechanics are enabled so move + merge can be
///         exercised and the merged street token inspected.
contract DeploySepoliaRehearsal is Script {
    address internal constant SEADROP_1_0 = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint32 internal constant NORMIE_CAP = 19;
    uint8 internal constant CC0_COUNT = 5;

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

    function _ccStartIds() private pure returns (uint256[CC0_COUNT] memory s) {
        s[0] = 1000;
        s[1] = 2000;
        s[2] = 3000;
        s[3] = 4000;
        s[4] = 5000;
    }

    function run() external {
        address deployer = msg.sender;
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", SEADROP_1_0);
        bytes32 publicSeed = keccak256("blockcassone-sepolia-rehearsal-seed");

        bytes32 allowlistRoot = vm.envBytes32("BLOCKCASSONE_ALLOWLIST_ROOT");
        uint64 gtdEnd = uint64(vm.envUint("BLOCKCASSONE_GTD_END"));
        uint48 publicStart = uint48(vm.envUint("BLOCKCASSONE_PUBLIC_START"));
        uint48 publicEnd = uint48(vm.envUint("BLOCKCASSONE_PUBLIC_END"));
        uint80 mintPrice = uint80(vm.envOr("BLOCKCASSONE_MINT_PRICE", uint256(0.0001 ether)));
        address feeRecipient = vm.envOr("BLOCKCASSONE_FEE_RECIPIENT", deployer);
        address gtd1 = vm.envAddress("BLOCKCASSONE_GTD1"); // reserves Normie 5555 + 1250
        address gtd2 = vm.envAddress("BLOCKCASSONE_GTD2"); // reserves Runner 1000 (the planned no-show)

        uint32 totalSlots = NORMIE_CAP;
        uint32[CC0_COUNT] memory caps = _ccCaps();
        for (uint256 i = 0; i < CC0_COUNT; i++) totalSlots += caps[i];

        Deployment memory d = _deploy(deployer, totalSlots, publicSeed);
        _seedWorld(d, deployer, gtd1, gtd2);
        _configureDrop(d, seaDrop, allowlistRoot, gtdEnd, publicStart, publicEnd, mintPrice, feeRecipient);
        _report(d, seaDrop, totalSlots);
    }

    function _deploy(address deployer, uint32 totalSlots, bytes32 publicSeed)
        private
        returns (Deployment memory d)
    {
        vm.broadcast();
        d.normies = new LocalMockNormies();

        vm.broadcast();
        d.cubes = new CubeNFT("Blockcassone Cubes", "BLOCK", address(d.normies), totalSlots, deployer);

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

        // CC0 source mocks + the multi-source minter.
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
                d.cubes, publicSeed, deployer, d.artStore, NORMIE_CAP, ccContracts, ccCaps
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

        // Post-mint mechanics ON so the walkthrough can move + merge (production
        // launches with these OFF).
        vm.broadcast();
        d.cubes.setMovesEnabled(true);
        vm.broadcast();
        d.cubes.setMergesEnabled(true);
        vm.broadcast();
        d.cubes.setCustomizesEnabled(true);
    }

    function _seedWorld(Deployment memory d, address deployer, address gtd1, address gtd2) private {
        // Real Normie art (19 ids, 200-byte bitmaps from data/normie-raw-<id>.hex).
        uint256[19] memory rn = _realNormieIds();
        uint256[] memory normieIds = new uint256[](rn.length);
        bytes[] memory raws = new bytes[](rn.length);
        for (uint256 i = 0; i < rn.length; i++) {
            normieIds[i] = rn[i];
            raws[i] = vm.parseBytes(vm.readFile(string.concat("data/normie-raw-", vm.toString(rn[i]), ".hex")));
            require(raws[i].length == 200, "normie raw wrong length");
        }
        vm.broadcast();
        d.normies.mintWithDataBatch(deployer, normieIds, raws);
        vm.broadcast();
        d.genesis.addSnapshotNormies(deployer, normieIds);

        // Real flattened CC0 payloads per pool.
        uint32[CC0_COUNT] memory caps = _ccCaps();
        uint256[CC0_COUNT] memory starts = _ccStartIds();
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            _seedCC0(d.genesis, uint8(i + 1), starts[i], caps[i]);
        }

        // GTD reservations (must precede finalize; STORED picks need committed payloads).
        // gtd1: two chosen Normies — mints them in-window (happy path).
        // gtd2: one chosen Runner — the planned NO-SHOW (strict release + rollover path).
        {
            uint8[] memory c1 = new uint8[](2);
            uint256[] memory s1 = new uint256[](2);
            c1[0] = 0; s1[0] = 5555;
            c1[1] = 0; s1[1] = 1250;
            vm.broadcast();
            d.genesis.reserveSources(gtd1, c1, s1);

            uint8[] memory c2 = new uint8[](1);
            uint256[] memory s2 = new uint256[](1);
            c2[0] = 1; s2[0] = 1000;
            vm.broadcast();
            d.genesis.reserveSources(gtd2, c2, s2);
        }

        vm.broadcast();
        d.genesis.finalizeSnapshot();
    }

    function _configureDrop(
        Deployment memory d,
        address seaDrop,
        bytes32 allowlistRoot,
        uint64 gtdEnd,
        uint48 publicStart,
        uint48 publicEnd,
        uint80 mintPrice,
        address feeRecipient
    ) private {
        // SeaDrop wiring: real singleton only — payment/limits enforced for real.
        address[] memory allowed = new address[](1);
        allowed[0] = seaDrop;
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);
        vm.broadcast();
        d.genesis.setSeaDrop(address(d.cubes));

        vm.broadcast();
        d.cubes.updateCreatorPayoutAddress(seaDrop, msg.sender);
        vm.broadcast();
        d.cubes.updateAllowedFeeRecipient(seaDrop, feeRecipient, true);

        // ONE root covers all gated stages (GTD + guaranteed-random + FCFS leaves).
        vm.broadcast();
        d.cubes.updateAllowList(
            seaDrop,
            AllowListData({ merkleRoot: allowlistRoot, publicKeyURIs: new string[](0), allowListURI: "" })
        );

        // Public stage — opens after the gated phases.
        vm.broadcast();
        d.cubes.updatePublicDrop(
            seaDrop,
            PublicDrop({
                mintPrice: mintPrice,
                startTime: publicStart,
                endTime: publicEnd,
                maxTotalMintableByWallet: 8,
                feeBps: 500,
                restrictFeeRecipients: true
            })
        );

        vm.broadcast();
        d.cubes.updateDropURI(seaDrop, "data:application/json,{\"name\":\"Blockcassone Sepolia Rehearsal\"}");

        // Drop-page metadata surface.
        vm.broadcast();
        d.cubes.setContractURI("data:application/json,{\"name\":\"Blockcassone Cubes (Sepolia Rehearsal)\"}");
        vm.broadcast();
        d.cubes.setDefaultRoyalty(msg.sender, 500);
        vm.broadcast();
        d.cubes.setProvenanceHash(keccak256("blockcassone-sepolia-rehearsal"));

        // Arm the on-chain GTD window, then open. Everything after this is driven
        // through SeaDrop by the walkthrough — no further owner txs needed.
        vm.broadcast();
        d.genesis.setGtdEndTime(gtdEnd);
        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Public);
    }

    function _seedCC0(MultiSourceGenesisMinter g, uint8 collectionId, uint256 startId, uint32 cap)
        private
    {
        uint256[] memory ids = new uint256[](cap);
        bytes[] memory payloads = new bytes[](cap);
        for (uint256 i = 0; i < cap; i++) {
            ids[i] = startId + i;
            payloads[i] = _realCC0Payload(collectionId, i);
        }
        vm.broadcast();
        g.addSourcePool(collectionId, ids);
        vm.broadcast();
        g.setSourcePayloadBatch(collectionId, ids, payloads);
    }

    function _realCC0Payload(uint8 collectionId, uint256 idx) private view returns (bytes memory p) {
        uint256 base = collectionId == 1 ? 0 : collectionId == 2 ? 8 : collectionId == 3 ? 20 : collectionId == 4 ? 16 : 24;
        p = vm.parseBytes(vm.readFile(string.concat("data/cc0/", vm.toString(base + idx), ".hex")));
        require(p.length == NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH, "cc0 payload wrong length");
    }

    function _realNormieIds() private pure returns (uint256[19] memory ids) {
        ids = [uint256(1), 42, 100, 250, 556, 777, 1250, 2222, 2810, 3333, 3470, 4014, 4444, 5555, 6722, 6726, 8437, 8888, 9921];
    }

    function _report(Deployment memory d, address seaDrop, uint32 totalSlots) private {
        console2.log("CubeNFT", address(d.cubes));
        console2.log("MultiSourceGenesisMinter", address(d.genesis));
        console2.log("RendererAssetStore", address(d.assetStore));
        console2.log("CubeRendererV2", address(d.renderer));
        console2.log("NonNormieArtStore", address(d.artStore));
        console2.log("SeaDrop", seaDrop);
        console2.log("totalSlots", totalSlots);

        string memory root = "rehearsal";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "cubeNft", address(d.cubes));
        vm.serializeAddress(root, "genesisMinter", address(d.genesis));
        vm.serializeAddress(root, "rendererAssetStore", address(d.assetStore));
        vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.serializeAddress(root, "thumbnailRenderer", address(d.thumbnailRenderer));
        vm.serializeAddress(root, "artStore", address(d.artStore));
        vm.serializeAddress(root, "normies", address(d.normies));
        vm.serializeAddress(root, "seaDrop", seaDrop);
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            vm.serializeAddress(root, string.concat("cc0_", vm.toString(i + 1)), d.cc0[i]);
        }
        string memory json = vm.serializeUint(root, "totalSlots", totalSlots);
        vm.writeJson(json, "data/rehearsal/contracts.json");
    }
}
