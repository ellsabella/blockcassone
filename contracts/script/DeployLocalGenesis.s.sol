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

contract LocalMockNormies {
    mapping(uint256 tokenId => address owner) public ownerOf;
    mapping(uint256 tokenId => bytes rawImageData) private _rawImageData;
    mapping(uint256 tokenId => bytes8 traits) private _traits;

    function storageContract() external view returns (address) {
        return address(this);
    }

    function rendererContract() external pure returns (address) {
        return address(0);
    }

    function name() external pure returns (string memory) {
        return "Normies";
    }

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
        _rawImageData[tokenId] = _sampleRawImageData(tokenId);
        _traits[tokenId] = bytes8(uint64(tokenId));
    }

    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory) {
        return _rawImageData[tokenId];
    }

    function getTokenTraits(uint256 tokenId) external view returns (bytes8) {
        return _traits[tokenId];
    }

    function isTokenDataSet(uint256 tokenId) external view returns (bool) {
        return _rawImageData[tokenId].length == 200;
    }

    function isRevealed() external pure returns (bool) {
        return true;
    }

    // Solid overlapping discs (low-frequency) so the mock silhouette has real solid
    // body — lots of cells with 5+ lit neighbours — which the glass-voxel layer
    // needs. tokenId varies the disc centres/radii.
    function _sampleRawImageData(uint256 tokenId) private pure returns (bytes memory data) {
        data = new bytes(200);
        uint256 h = uint256(keccak256(abi.encodePacked(tokenId)));
        for (uint256 i = 0; i < 1600; i++) {
            uint256 col = i % 40;
            uint256 row = i / 40;
            bool lit = false;
            for (uint256 k = 0; k < 3; k++) {
                uint256 cx = 9 + (h >> (k * 32)) % 22; // disc centre 9..30
                uint256 cy = 9 + (h >> (k * 32 + 8)) % 22;
                uint256 rr = 7 + (h >> (k * 32 + 16)) % 6; // radius 7..12
                uint256 ddx = col > cx ? col - cx : cx - col;
                uint256 ddy = row > cy ? row - cy : cy - row;
                if (ddx * ddx + ddy * ddy <= rr * rr) {
                    lit = true;
                    break;
                }
            }
            if (lit) {
                data[i / 8] = bytes1(uint8(data[i / 8]) | uint8(1 << (7 - (i % 8))));
            }
        }
    }
}

/// @notice Minimal stand-in for a CC0 source ERC-721. Genesis external-cube minting
///         checks only that the source has code and isn't the Normie contract (the
///         committed payload pool is the authority — no source-ownership check), and
///         the renderer reads name() for the "Source Art" trait — so this needs only a
///         name and some code. Off-chain art is committed on-chain as tonal payloads.
contract LocalMockCC0 {
    string public name;
    string public symbol;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }
}

contract DeployLocalGenesis is Script {
    // Anvil account #1 — the dev flattening-attestation signer. It's an unlocked Anvil
    // account, so the viewer can eth_signTypedData_v4 with it (no off-chain signer
    // service). Never use this outside local dev.
    address internal constant DEV_ATTESTATION_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    // Local multi-source allocation. A SMALL, balanced world so a single sample mint
    // visibly draws a MIX of collections (production uses caps 1679/901/655/410/328/123
    // summing to 4096, with real curated pools). Caps must sum to the cube supply.
    uint32 internal constant NORMIE_CAP = 8;
    uint8 internal constant CC0_COUNT = 5;

    struct Deployment {
        LocalMockNormies normies;
        CubeNFT cubes;
        RendererAssetStore assetStore;
        AgentStatusRegistry agentRegistry;
        CubeThumbnailRendererV1 thumbnailRenderer;
        CubeRendererV2 renderer;
        MultiSourceGenesisMinter genesis;
        address[CC0_COUNT] cc0; // Chain Runners, 1337 skulls, Baby Pepes, Nouns, OnChainKevin
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
        c[0] = 4; // Runners
        c[1] = 3; // Skulls
        c[2] = 2; // Pepes
        c[3] = 2; // Nouns
        c[4] = 1; // Kevin
    }

    // First source token id for each CC0 pool (distinct ranges keep them separable).
    function _ccStartIds() private pure returns (uint256[CC0_COUNT] memory s) {
        s[0] = 1000;
        s[1] = 2000;
        s[2] = 3000;
        s[3] = 4000;
        s[4] = 5000;
    }

    function run() external {
        address initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", initialOwner);
        bytes32 publicSeed = vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-local"));

        uint32 totalSlots = NORMIE_CAP;
        uint32[CC0_COUNT] memory caps = _ccCaps();
        for (uint256 i = 0; i < CC0_COUNT; i++) totalSlots += caps[i];
        // Default sample = the whole world, but clamp to what one wallet's plot budget
        // (<= 5 per street) can actually take in this street count.
        uint256 sampleMints = vm.envOr("BLOCKCASSONE_SAMPLE_MINTS", uint256(8));

        uint256 gasBefore = gasleft();
        Deployment memory d = _deploy(initialOwner, totalSlots, publicSeed, seaDrop);
        console2.log(
            "full-suite deploy gas (contracts only; EXCLUDES RendererAssetStore engine chunks):",
            gasBefore - gasleft()
        );
        _setupAndMint(d, initialOwner, sampleMints);
        _report(d, seaDrop, sampleMints);
    }

    function _deploy(address initialOwner, uint32 totalSlots, bytes32 publicSeed, address seaDrop)
        private
        returns (Deployment memory d)
    {
        vm.broadcast();
        d.normies = new LocalMockNormies();

        vm.broadcast();
        d.cubes = new CubeNFT(
            "Blockcassone Cubes", "CUBE", address(d.normies), totalSlots, initialOwner
        );

        vm.broadcast();
        d.assetStore = new RendererAssetStore(initialOwner);

        vm.broadcast();
        d.agentRegistry = new AgentStatusRegistry(initialOwner);

        vm.broadcast();
        address geometry = address(new CubeHilbertGeometry());

        vm.broadcast();
        address frameLayer = address(new CubeFrameLayer());

        vm.broadcast();
        address walkerLayer = address(new CubeWalkerLayer());

        // Shared art store, wired into BOTH renderers (immutable) so re-based AND
        // genesis CC0 cubes render their stored tonal art.
        vm.broadcast();
        d.artStore = new NonNormieArtStore(address(d.cubes), initialOwner);

        vm.broadcast();
        d.thumbnailRenderer = new CubeThumbnailRendererV1(
            d.cubes, address(d.normies), address(d.artStore), geometry, frameLayer, walkerLayer
        );

        vm.broadcast();
        d.renderer = new CubeRendererV2(
            d.cubes, d.assetStore, address(d.normies), address(d.thumbnailRenderer), address(d.artStore)
        );

        vm.broadcast();
        d.attestation = new FlatteningAttestation(initialOwner, DEV_ATTESTATION_SIGNER);

        vm.broadcast();
        d.customizer = new CubeMintController(d.cubes, d.artStore, d.attestation);

        _deployGenesis(d, initialOwner, publicSeed);

        vm.broadcast();
        d.cubes.setRenderer(address(d.renderer));

        vm.broadcast();
        d.cubes.setAgentStatusRegistry(address(d.agentRegistry));

        // Customize wiring: the controller owns the store (its record/update are
        // onlyOwner), is the attestation's authorized consumer, and is CubeNFT's
        // customizer. Must precede transferOwnership(customizer).
        vm.broadcast();
        d.cubes.setCustomizer(address(d.customizer));

        // Art store ref for the attestation-free pool-source re-base ("spin the wheel").
        vm.broadcast();
        d.cubes.setArtStore(address(d.artStore));

        // Authorize the genesis minter to commit CC0 tonal payloads to the store
        // (source-keyed, once, before the drop — the mint itself writes no art). Must
        // precede the art-store ownership transfer (setAuthorizedRecorder is onlyOwner).
        vm.broadcast();
        d.artStore.setAuthorizedRecorder(address(d.genesis), true);

        vm.broadcast();
        d.artStore.transferOwnership(address(d.customizer));

        vm.broadcast();
        d.attestation.setAuthorizedConsumer(address(d.customizer));

        // Decoupled SeaDrop wiring: the admin STAYS the token owner (to configure the
        // drop on SeaDrop + flip phases + enable moves) while the minter mints via the
        // `genesisMinter` role. The real SeaDrop singleton is the only allowed
        // mintSeaDrop caller (SeaDrop -> token -> minter).
        vm.broadcast();
        d.cubes.setGenesisMinter(address(d.genesis));

        address[] memory allowed = new address[](1);
        allowed[0] = seaDrop;
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);

        vm.broadcast();
        d.cubes.setMovesEnabled(true);
    }

    // Deploy the 5 CC0 source mocks + the multi-source genesis minter registering them
    // (collection 0 = Normie live art; 1..5 = CC0 stored-payload collections).
    function _deployGenesis(Deployment memory d, address initialOwner, bytes32 publicSeed) private {
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
            d.cubes, publicSeed, initialOwner, d.artStore, NORMIE_CAP, ccContracts, ccCaps
        );
    }

    function _setupAndMint(Deployment memory d, address initialOwner, uint256 sampleMints) private {
        // Normie snapshot pool: a few more than the Normie cap so the live pool never
        // empties before the allocation is hit.
        uint256 normiePool = NORMIE_CAP + 2;
        uint256[] memory normieIds = new uint256[](normiePool);
        for (uint256 i = 0; i < normiePool; i++) {
            vm.broadcast();
            d.normies.mint(initialOwner, i);
            normieIds[i] = i;
        }
        vm.broadcast();
        d.genesis.addSnapshotNormies(initialOwner, normieIds);

        // Commit each CC0 pool + its off-chain-flattened tonal payloads (stand-in here).
        uint32[CC0_COUNT] memory caps = _ccCaps();
        uint256[CC0_COUNT] memory starts = _ccStartIds();
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            _seedCC0(d.genesis, uint8(i + 1), starts[i], caps[i]);
        }

        vm.broadcast();
        d.genesis.finalizeSnapshot();

        vm.broadcast();
        d.genesis.setSeaDrop(address(d.cubes));

        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Public);

        // Sample public mint (one wallet): the weighted draw pulls a MIX of collections.
        vm.broadcast();
        d.genesis.mintPublicFor(initialOwner, sampleMints);

        // Dev: hand cube #1 (slot 0 -> street 0) to a second account so street 0 has
        // mixed ownership and the merge "consolidate first" flow is testable.
        if (sampleMints >= 3 && vm.envOr("BLOCKCASSONE_DEV_SPLIT_OWNER", true)) {
            vm.broadcast();
            d.cubes.transferFrom(initialOwner, DEV_ATTESTATION_SIGNER, 1);
        }
    }

    // Populate one STORED collection's draw pool + commit its sample payloads (one
    // batched SSTORE2 blob). Local caps are tiny, so a single batch always fits.
    function _seedCC0(MultiSourceGenesisMinter g, uint8 collectionId, uint256 startId, uint32 cap)
        private
    {
        uint256[] memory ids = new uint256[](cap);
        bytes[] memory payloads = new bytes[](cap);
        for (uint256 i = 0; i < cap; i++) {
            ids[i] = startId + i;
            payloads[i] = _samplePayload(startId + i);
        }
        vm.broadcast();
        g.addSourcePool(collectionId, ids);
        vm.broadcast();
        g.setSourcePayloadBatch(collectionId, ids, payloads);
    }

    // Deterministic 400-byte 2-bit tonal payload (validate checks length + version);
    // stands in for the off-chain nft-art-grid flattening for local dev.
    function _samplePayload(uint256 sourceId) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        bytes32 h = keccak256(abi.encode(sourceId));
        for (uint256 i = 0; i < p.length; i++) {
            p[i] = h[i % 32];
        }
    }

    function _report(Deployment memory d, address seaDrop, uint256 sampleMints) private {
        console2.log("LocalMockNormies", address(d.normies));
        console2.log("CubeNFT", address(d.cubes));
        console2.log("RendererAssetStore", address(d.assetStore));
        console2.log("AgentStatusRegistry", address(d.agentRegistry));
        console2.log("CubeRendererV2", address(d.renderer));
        console2.log("MultiSourceGenesisMinter", address(d.genesis));
        string[CC0_COUNT] memory names = _ccNames();
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            console2.log(names[i], d.cc0[i]);
        }
        console2.log("NonNormieArtStore", address(d.artStore));
        console2.log("FlatteningAttestation", address(d.attestation));
        console2.log("CubeMintController", address(d.customizer));
        console2.log("SeaDrop", seaDrop);
        console2.log("Sample mints", sampleMints);

        _writeViewerConfig(d);
    }

    function _writeViewerConfig(Deployment memory d) private {
        string memory outPath =
            vm.envOr("BLOCKCASSONE_CHAIN_CONFIG_OUT", string("data/chain-config.json"));
        string memory root = "chainConfig";
        vm.serializeBool(root, "enabled", true);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
        vm.serializeAddress(root, "cubeNft", address(d.cubes));
        vm.serializeAddress(root, "genesisMinter", address(d.genesis));
        vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.serializeAddress(root, "rendererAssetStore", address(d.assetStore));
        vm.serializeAddress(root, "agentStatusRegistry", address(d.agentRegistry));
        vm.serializeAddress(root, "normies", address(d.normies));
        vm.serializeAddress(root, "normieStorage", address(d.normies));
        // Customization flow (dev): the controller is the customizeCube target, the
        // attestation is the EIP-712 verifyingContract, the signer is an unlocked Anvil
        // account the viewer signs typed data with.
        vm.serializeAddress(root, "nonNormieStore", address(d.artStore));
        vm.serializeAddress(root, "cubeMintController", address(d.customizer));
        vm.serializeAddress(root, "flatteningAttestation", address(d.attestation));
        string memory json =
            vm.serializeAddress(root, "attestationSigner", DEV_ATTESTATION_SIGNER);
        vm.writeJson(json, outPath);
    }
}
