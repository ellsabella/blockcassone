// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { AgentStatusRegistry } from "../src/AgentStatusRegistry.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { RendererAssetStore } from "../src/RendererAssetStore.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
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

    function _sampleRawImageData(uint256 tokenId) private pure returns (bytes memory data) {
        data = new bytes(200);
        for (uint256 i = 0; i < 1600; i++) {
            uint256 col = i % 40;
            uint256 row = i / 40;
            uint256 dx = col > 19 ? col - 19 : 19 - col;
            uint256 dy = row > 19 ? row - 19 : 19 - row;
            uint256 ring = (dx * dx + dy * dy + tokenId * 7) % 53;
            uint256 wave = (col * 13 + row * 17 + tokenId * 19) % 37;
            if (ring < 28 && wave > 8) {
                data[i / 8] = bytes1(uint8(data[i / 8]) | uint8(1 << (7 - (i % 8))));
            }
        }
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
        Deployment memory d = _deploy(initialOwner, totalSlots, publicSeed);
        console2.log(
            "full-suite deploy gas (contracts only; EXCLUDES RendererAssetStore engine chunks):",
            gasBefore - gasleft()
        );
        _mintAndFinalize(d, initialOwner, seaDrop, sampleMints);
        _report(d, seaDrop, sampleMints);
    }

    function _deploy(address initialOwner, uint32 totalSlots, bytes32 publicSeed)
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

        // Customization art store, wired into BOTH renderers (immutable) so
        // re-based cubes render their stored art.
        vm.broadcast();
        d.artStore = new NonNormieArtStore(initialOwner);

        vm.broadcast();
        d.thumbnailRenderer =
            new CubeThumbnailRendererV1(d.cubes, address(d.normies), address(d.artStore), geometry, frameLayer);

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

        vm.broadcast();
        d.artStore.transferOwnership(address(d.customizer));

        vm.broadcast();
        d.attestation.setAuthorizedConsumer(address(d.customizer));

        // Dev only: enable the post-mint move game now (setMovesEnabled is onlyOwner
        // and ownership is about to move to the genesis minter, which has no
        // passthrough). Production needs a real post-mint enable path.
        vm.broadcast();
        d.cubes.setMovesEnabled(true);

        vm.broadcast();
        d.cubes.transferOwnership(address(d.genesis));
    }

    function _mintAndFinalize(
        Deployment memory d,
        address initialOwner,
        address seaDrop,
        uint256 sampleMints
    ) private {
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
            d.genesis.setSeaDrop(seaDrop);

            vm.broadcast();
            d.genesis.setPhase(NormieGenesisMinter.Phase.Public);

            vm.broadcast();
            d.genesis.mintPublicFor(initialOwner, sampleMints);
        }
    }

    function _report(Deployment memory d, address seaDrop, uint256 sampleMints) private {
        console2.log("LocalMockNormies", address(d.normies));
        console2.log("CubeNFT", address(d.cubes));
        console2.log("RendererAssetStore", address(d.assetStore));
        console2.log("AgentStatusRegistry", address(d.agentRegistry));
        console2.log("CubeRendererV2", address(d.renderer));
        console2.log("NormieGenesisMinter", address(d.genesis));
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
