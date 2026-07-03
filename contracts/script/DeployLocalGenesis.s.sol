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
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { BrainrotGenesisMinter } from "../src/BrainrotGenesisMinter.sol";
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
    // needs. The old high-frequency ring/wave pattern was too noisy: almost no
    // "body" cells, so almost no glass. tokenId varies the disc centres/radii.
    function _sampleRawImageData(uint256 tokenId) private pure returns (bytes memory data) {
        data = new bytes(200);
        uint256 h = uint256(keccak256(abi.encodePacked(tokenId)));
        for (uint256 i = 0; i < 1600; i++) {
            uint256 col = i % 40;
            uint256 row = i / 40;
            bool lit = false;
            for (uint256 k = 0; k < 3; k++) {
                uint256 cx = 9 + (h >> (k * 32)) % 22;     // disc centre 9..30
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

/// @notice Minimal stand-in for the CC0 BRAINROT ERC-721 (the Brainrot genesis
///         source). Genesis external-cube minting checks only that the source has
///         code and isn't the Normie contract (the committed payload pool is the
///         authority — no source-ownership check), so this needs no real ERC-721
///         machinery. Off-chain art is committed on-chain as tonal payloads.
contract LocalMockBrainrot {
    string public constant name = "BRAINROT";
    string public constant symbol = "BRAINROT";
    mapping(uint256 tokenId => address owner) public ownerOf;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }
}

contract DeployLocalGenesis is Script {
    uint32 internal constant DEFAULT_TOTAL_SLOTS = 4096;
    // Anvil account #1 — the dev flattening-attestation signer. It's an unlocked
    // Anvil account, so the viewer can eth_signTypedData_v4 with it (no off-chain
    // signer service needed locally). Never use this outside local dev.
    address internal constant DEV_ATTESTATION_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    struct Deployment {
        LocalMockNormies normies;
        CubeNFT cubes;
        RendererAssetStore assetStore;
        AgentStatusRegistry agentRegistry;
        CubeThumbnailRendererV1 thumbnailRenderer;
        CubeRendererV2 renderer;
        NormieGenesisMinter genesis;
        LocalMockBrainrot brainrotSource;
        BrainrotGenesisMinter brainrot;
        NonNormieArtStore artStore;
        FlatteningAttestation attestation;
        CubeMintController customizer;
    }

    // Split into helpers (each holding few locals) to stay under the stack limit
    // without via-IR.
    function run() external {
        address initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", initialOwner);
        uint32 totalSlots =
            uint32(vm.envOr("BLOCKCASSONE_TOTAL_SLOTS", uint256(DEFAULT_TOTAL_SLOTS)));
        uint256 sampleMints = vm.envOr("BLOCKCASSONE_SAMPLE_MINTS", uint256(8));
        bytes32 publicSeed = vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-local"));

        uint256 gasBefore = gasleft();
        Deployment memory d = _deploy(initialOwner, totalSlots, publicSeed, seaDrop);
        console2.log(
            "full-suite deploy gas (contracts only; EXCLUDES RendererAssetStore engine chunks):",
            gasBefore - gasleft()
        );
        _mintAndFinalize(d, initialOwner, seaDrop, sampleMints);
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

        // Customization art store, wired into BOTH renderers (immutable) so
        // re-based cubes render their stored art.
        vm.broadcast();
        d.artStore = new NonNormieArtStore(initialOwner);

        vm.broadcast();
        d.thumbnailRenderer =
            new CubeThumbnailRendererV1(d.cubes, address(d.normies), address(d.artStore), geometry, frameLayer, walkerLayer);

        vm.broadcast();
        d.renderer = new CubeRendererV2(
            d.cubes, d.assetStore, address(d.normies), address(d.thumbnailRenderer), address(d.artStore)
        );

        vm.broadcast();
        d.attestation = new FlatteningAttestation(initialOwner, DEV_ATTESTATION_SIGNER);

        vm.broadcast();
        d.customizer = new CubeMintController(d.cubes, d.artStore, d.attestation);

        vm.broadcast();
        d.genesis = new NormieGenesisMinter(d.cubes, publicSeed, initialOwner);

        // Brainrot (CC0) genesis stack: an external source collection + a minter that
        // records the off-chain-flattened tonal payload into the shared art store at
        // mint. Wired now; activated by pointing CubeNFT.genesisMinter at it.
        vm.broadcast();
        d.brainrotSource = new LocalMockBrainrot();

        vm.broadcast();
        d.brainrot = new BrainrotGenesisMinter(
            d.cubes, keccak256(abi.encode(publicSeed, "brainrot")), initialOwner,
            address(d.brainrotSource), d.artStore
        );

        vm.broadcast();
        d.cubes.setRenderer(address(d.renderer));

        vm.broadcast();
        d.cubes.setAgentStatusRegistry(address(d.agentRegistry));

        // Customize wiring: the controller owns the store (its record/update are
        // onlyOwner), is the attestation's authorized consumer, and is CubeNFT's
        // customizer. Must precede transferOwnership(genesis) (setCustomizer is
        // onlyOwner on CubeNFT).
        vm.broadcast();
        d.cubes.setCustomizer(address(d.customizer));

        // Authorize the Brainrot minter to record tonal payloads. Must precede the
        // art-store ownership transfer (setAuthorizedRecorder is onlyOwner).
        vm.broadcast();
        d.artStore.setAuthorizedRecorder(address(d.brainrot), true);

        vm.broadcast();
        d.artStore.transferOwnership(address(d.customizer));

        vm.broadcast();
        d.attestation.setAuthorizedConsumer(address(d.customizer));

        // Decoupled SeaDrop wiring: the admin STAYS the token owner (to configure the
        // drop on SeaDrop + flip minters + enable moves), while the minter contract
        // does the actual minting via the `genesisMinter` role. The real SeaDrop
        // singleton is the only allowed mintSeaDrop caller. The Normie genesis is the
        // active genesisMinter; flip to `d.brainrot` to run the Brainrot drop.
        vm.broadcast();
        d.cubes.setGenesisMinter(address(d.genesis));

        address[] memory allowed = new address[](1);
        allowed[0] = seaDrop;
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);

        // Enable the post-mint move game (admin retains this now that ownership stays
        // with the admin rather than moving to the minter).
        vm.broadcast();
        d.cubes.setMovesEnabled(true);
    }

    function _mintAndFinalize(
        Deployment memory d,
        address initialOwner,
        address seaDrop,
        uint256 sampleMints
    ) private {
        // The active drop is driven by the real SeaDrop singleton, which calls
        // CubeNFT.mintSeaDrop; the minter's authorized caller is therefore the TOKEN
        // (not the SeaDrop address). `seaDrop` was already allowlisted on the token in
        // _deploy.
        seaDrop; // silence unused-param (SeaDrop caller is the token, wired below)

        uint256[] memory sampleNormies = new uint256[](sampleMints);
        for (uint256 i = 0; i < sampleMints; i++) {
            vm.broadcast();
            d.normies.mint(initialOwner, i);
            sampleNormies[i] = i;
        }

        if (sampleMints > 0) {
            vm.broadcast();
            d.genesis.addSnapshotNormies(initialOwner, sampleNormies);

            vm.broadcast();
            d.genesis.finalizeSnapshot();

            vm.broadcast();
            d.genesis.setSeaDrop(address(d.cubes));

            vm.broadcast();
            d.genesis.setPhase(GenesisMinterBase.Phase.Public);

            vm.broadcast();
            d.genesis.mintPublicFor(initialOwner, sampleMints);

            // Dev: hand cube #1 (slot 0 → street 0) to a second account so street 0
            // has mixed ownership and the merge "ineligible / consolidate first" flow
            // is testable. Streets 1+ stay solely owned (mergeable).
            if (sampleMints >= 3 && vm.envOr("BLOCKCASSONE_DEV_SPLIT_OWNER", true)) {
                vm.broadcast();
                d.cubes.transferFrom(initialOwner, DEV_ATTESTATION_SIGNER, 1);
            }
        }

        _finalizeBrainrot(d, initialOwner);
    }

    // Commit the off-chain-flattened tonal payloads for a small Brainrot pool and
    // finalize its snapshot so the Brainrot drop is mint-ready. It becomes active the
    // moment the admin points CubeNFT.genesisMinter at `d.brainrot` (owner = admin).
    function _finalizeBrainrot(Deployment memory d, address initialOwner) private {
        uint256 pool = vm.envOr("BLOCKCASSONE_BRAINROT_POOL", uint256(4));
        if (pool == 0) return;

        uint256[] memory ids = new uint256[](pool);
        for (uint256 i = 0; i < pool; i++) {
            uint256 sourceId = 5001 + i;
            ids[i] = sourceId;
            vm.broadcast();
            d.brainrot.setBrainrotPayload(sourceId, _sampleBrainrotPayload(sourceId));
        }

        vm.broadcast();
        d.brainrot.addSnapshotNormies(initialOwner, ids);

        vm.broadcast();
        d.brainrot.finalizeSnapshot();

        vm.broadcast();
        d.brainrot.setSeaDrop(address(d.cubes));

        vm.broadcast();
        d.brainrot.setPhase(GenesisMinterBase.Phase.Public);
    }

    // Deterministic 400-byte 2-bit tonal payload (validate only checks length +
    // version); stands in for the off-chain nft-art-grid flattening for local dev.
    function _sampleBrainrotPayload(uint256 sourceId) private pure returns (bytes memory p) {
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
        console2.log("NormieGenesisMinter", address(d.genesis));
        console2.log("BrainrotSource (mock)", address(d.brainrotSource));
        console2.log("BrainrotGenesisMinter", address(d.brainrot));
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
        vm.serializeAddress(root, "brainrotMinter", address(d.brainrot));
        vm.serializeAddress(root, "brainrotSource", address(d.brainrotSource));
        vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.serializeAddress(root, "rendererAssetStore", address(d.assetStore));
        vm.serializeAddress(root, "agentStatusRegistry", address(d.agentRegistry));
        vm.serializeAddress(root, "normies", address(d.normies));
        vm.serializeAddress(root, "normieStorage", address(d.normies));
        // Customization flow (dev): the controller is the customizeCube target, the
        // attestation is the EIP-712 verifyingContract, the signer is an unlocked
        // Anvil account the viewer signs typed data with.
        vm.serializeAddress(root, "nonNormieStore", address(d.artStore));
        vm.serializeAddress(root, "cubeMintController", address(d.customizer));
        vm.serializeAddress(root, "flatteningAttestation", address(d.attestation));
        string memory json =
            vm.serializeAddress(root, "attestationSigner", DEV_ATTESTATION_SIGNER);
        vm.writeJson(json, outPath);
    }
}
