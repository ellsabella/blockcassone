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

    // Store REAL Normie art: the Script reads data/normie-raw-<id>.hex (cheatcodes aren't
    // available in a deployed contract, so the bytes are passed in) and this just persists
    // each id's real 200-byte bitmap, so Normie cubes render exactly like mainnet.
    function mintWithDataBatch(address to, uint256[] calldata ids, bytes[] calldata raws) external {
        for (uint256 i = 0; i < ids.length; i++) {
            ownerOf[ids[i]] = to;
            _rawImageData[ids[i]] = raws[i];
            _traits[ids[i]] = bytes8(uint64(ids[i]));
        }
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
    // Cheap deterministic 200-byte (40x40 1-bit) placeholder bitmap. The old per-pixel disc
    // computation cost ~10M gas/mint (blowing the block limit on a bigger dev world). This is
    // mock Normie art anyway (real Normie art is native on mainnet), so a keccak fill is fine.
    function _sampleRawImageData(uint256 tokenId) private pure returns (bytes memory data) {
        data = new bytes(200);
        for (uint256 i = 0; i < 200; i += 32) {
            bytes32 h = keccak256(abi.encodePacked(tokenId, i));
            for (uint256 j = 0; j < 32 && i + j < 200; j++) data[i + j] = h[j];
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

interface IMintSeaDrop {
    // CubeNFT.mintSeaDrop returns NOTHING (matches OpenSea's ISeaDrop mintSeaDrop). Declaring
    // a return here would make the mock try to ABI-decode empty return data -> a bare revert
    // AFTER the mint already succeeded. So this must be void, exactly like the real token.
    function mintSeaDrop(address minter, uint256 quantity) external;
}

/// @notice Test faucet standing in for OpenSea SeaDrop. Anyone can mint (no payment/limits),
///         routed through the token's REAL mintSeaDrop -> genesis allocation path, so it
///         exercises the true mint code. The token allows this as a SeaDrop caller. For
///         local + Sepolia E2E only — never allowed on a production deploy.
contract MockSeaDrop {
    function mintPublic(address token, address to, uint256 quantity) external {
        IMintSeaDrop(token).mintSeaDrop(to, quantity);
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
    uint32 internal constant NORMIE_CAP = 19; // = the real-art Normie snapshot ids we hold
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
        address mockSeaDrop;      // faucet: anyone -> mintSeaDrop -> genesis allocation
        address attestationSigner; // signer address baked into the attestation contract
    }

    function _ccNames() private pure returns (string[CC0_COUNT] memory n) {
        n[0] = "Chain Runners";
        n[1] = "1337 skulls";
        n[2] = "Baby Pepes";
        n[3] = "Nouns";
        n[4] = "OnChainKevin";
    }

    function _ccCaps() private pure returns (uint32[CC0_COUNT] memory c) {
        // Sized to the REAL flattened payloads we hold in data/cc0/*.hex, so every pool
        // source seeds real art: runner 0-7 (8), skull 8-15 (8), noun 16-19 (4),
        // pepe 20-23 (4), kevin 24-27 (4) = 28 CC0 sources. + NORMIE_CAP = 80 slots.
        c[0] = 8; // Runners
        c[1] = 8; // Skulls
        c[2] = 4; // Pepes
        c[3] = 4; // Nouns
        c[4] = 4; // Kevin
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

        // Hand the collection's admin to the intended long-term owner AFTER all owner-only
        // setup (the deployer HAD to be owner during deploy/setup, else those calls revert).
        // CubeNFT is 1-step Ownable, so this is immediate — no accept step. The deployer keeps
        // RendererAssetStore/genesis ownership so it can still upload engine chunks + admin the
        // drop; move those later if you want the new owner to control everything.
        address finalOwner = vm.envOr("CONTRACT_OWNER", address(0));
        if (finalOwner != address(0) && finalOwner != d.cubes.owner()) {
            vm.broadcast();
            d.cubes.transferOwnership(finalOwner);
            console2.log("CubeNFT ownership -> CONTRACT_OWNER", finalOwner);
        }

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
            "TheBLOCK", "BLOCK", address(d.normies), totalSlots, initialOwner
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

        // Signer baked into the attestation: the unlocked Anvil acct in local dev, or a real
        // keypair on Sepolia (its private key runs the /api/attest signer service).
        d.attestationSigner = vm.envOr("BLOCKCASSONE_ATTESTATION_SIGNER", DEV_ATTESTATION_SIGNER);
        vm.broadcast();
        d.attestation = new FlatteningAttestation(initialOwner, d.attestationSigner);

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

        // MockSeaDrop faucet: testers mint through it (-> mintSeaDrop -> genesis allocation).
        vm.broadcast();
        d.mockSeaDrop = address(new MockSeaDrop());

        address[] memory allowed = new address[](2);
        allowed[0] = seaDrop;        // env/owner convenience caller
        allowed[1] = d.mockSeaDrop;  // the faucet
        vm.broadcast();
        d.cubes.updateAllowedSeaDrop(allowed);

        // Local/dev only: enable all post-mint mechanics so the dev viewer can exercise
        // move + merge + customize. (Production DeployGenesis leaves them OFF — owner-enabled.)
        vm.broadcast();
        d.cubes.setMovesEnabled(true);
        vm.broadcast();
        d.cubes.setMergesEnabled(true);
        vm.broadcast();
        d.cubes.setCustomizesEnabled(true);
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
        // Seed REAL Normie art: mint the real snapshot ids with their real 200-byte bitmaps
        // (data/normie-raw-<id>.hex), so Normie cubes render exactly like they will on mainnet.
        uint256[19] memory rn = _realNormieIds();
        uint256[] memory normieIds = new uint256[](rn.length);
        bytes[] memory raws = new bytes[](rn.length);
        for (uint256 i = 0; i < rn.length; i++) {
            normieIds[i] = rn[i];
            raws[i] = vm.parseBytes(vm.readFile(string.concat("data/normie-raw-", vm.toString(rn[i]), ".hex")));
            require(raws[i].length == 200, "normie raw wrong length");
        }
        vm.broadcast();
        d.normies.mintWithDataBatch(initialOwner, normieIds, raws);
        vm.broadcast();
        d.genesis.addSnapshotNormies(initialOwner, normieIds);

        // Commit each CC0 pool + its off-chain-flattened tonal payloads (stand-in here).
        uint32[CC0_COUNT] memory caps = _ccCaps();
        uint256[CC0_COUNT] memory starts = _ccStartIds();
        for (uint256 i = 0; i < CC0_COUNT; i++) {
            _seedCC0(d.genesis, uint8(i + 1), starts[i], caps[i]);
        }

        // --- Allowlist "pick art" reservation (MUST be before finalize) -------------------
        // Bake a test wallet's guaranteed chosen artwork: reserve a real snapshot Normie so the
        // allowlist mint path (reserved-first) is exercised end-to-end. Reserving pulls it out of
        // the public draw so it can't collide. CC0 sources reserve identically (STORED + payload).
        address testWallet = vm.envOr("BLOCKCASSONE_TEST_WALLET", initialOwner);
        {
            uint8[] memory rc = new uint8[](1);
            uint256[] memory rs = new uint256[](1);
            rc[0] = 0;      // collection 0 = Normie
            rs[0] = 5555;   // a real snapshot Normie (art from data/normie-raw-5555.hex)
            vm.broadcast();
            d.genesis.reserveSources(testWallet, rc, rs);
        }

        vm.broadcast();
        d.genesis.finalizeSnapshot();

        vm.broadcast();
        d.genesis.setSeaDrop(address(d.cubes));

        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Public);

        // Sample public mint (one wallet): the weighted draw pulls a MIX of collections.
        // Recipient defaults to the deployer, but can be pointed at a test wallet so a
        // real MetaMask account anchors street 0 (sole occupier -> the merge flow is
        // testable end-to-end). Everything else is unchanged.
        address sampleRecipient = vm.envOr("BLOCKCASSONE_SAMPLE_RECIPIENT", initialOwner);
        vm.broadcast();
        d.genesis.mintPublicFor(sampleRecipient, sampleMints);

        // Dev: hand cube #1 (slot 0 -> street 0) to a second account so street 0 has
        // mixed ownership and the merge "consolidate first" flow is testable. Transfers
        // from whoever received the sample batch (deployer by default, else the test
        // wallet). Turn off (BLOCKCASSONE_DEV_SPLIT_OWNER=false) to keep street 0 a
        // sole-occupier street for the merge test.
        if (sampleMints >= 3 && vm.envOr("BLOCKCASSONE_DEV_SPLIT_OWNER", true)) {
            vm.broadcast();
            d.cubes.transferFrom(sampleRecipient, DEV_ATTESTATION_SIGNER, 1);
        }

        // --- E2E: exercise BOTH mint paths to the TEST wallet via the real SeaDrop faucet ---
        // Done LAST so cube #1 stays the sample recipient's (the split-owner transfer above
        // assumes it). The test wallet's two cubes are minted after everything else.
        // (a) ALLOWLIST: the reserved wallet mints its chosen art. mintSeaDrop assigns
        //     reservations first (fromRes=1), so fromPhase=0 and it works in the Allowlist phase.
        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        vm.broadcast();
        MockSeaDrop(d.mockSeaDrop).mintPublic(address(d.cubes), testWallet, 1);
        // (b) PUBLIC: a random-pool draw to the same wallet. Ends in the Public phase (live).
        vm.broadcast();
        d.genesis.setPhase(GenesisMinterBase.Phase.Public);
        vm.broadcast();
        MockSeaDrop(d.mockSeaDrop).mintPublic(address(d.cubes), testWallet, 1);
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
            payloads[i] = _realCC0Payload(collectionId, i);
        }
        vm.broadcast();
        g.addSourcePool(collectionId, ids);
        vm.broadcast();
        g.setSourcePayloadBatch(collectionId, ids, payloads);
    }

    // Real 400-byte 2-bit tonal payload from data/cc0/*.hex (flattened off a mainnet fork by
    // dev/cc0-proof/flatten.mjs). collectionId -> hex base: Runners 0, Skulls 8, Nouns 16,
    // Pepes 20, Kevin 24 — so every seeded pool source renders REAL CC0 art from the start.
    function _realCC0Payload(uint8 collectionId, uint256 idx) private view returns (bytes memory p) {
        uint256 base = collectionId == 1 ? 0 : collectionId == 2 ? 8 : collectionId == 3 ? 20 : collectionId == 4 ? 16 : 24;
        p = vm.parseBytes(vm.readFile(string.concat("data/cc0/", vm.toString(base + idx), ".hex")));
        require(p.length == NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH, "cc0 payload wrong length");
    }

    // The real Normie token ids we hold on-chain raw art for (data/normie-raw-<id>.hex).
    function _realNormieIds() private pure returns (uint256[19] memory ids) {
        ids = [uint256(1), 42, 100, 250, 556, 777, 1250, 2222, 2810, 3333, 3470, 4014, 4444, 5555, 6722, 6726, 8437, 8888, 9921];
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
        console2.log("SeaDrop (allowed)", seaDrop);
        console2.log("MockSeaDrop (faucet)", d.mockSeaDrop);
        console2.log("Sample mints", sampleMints);

        _writeViewerConfig(d);
    }

    function _writeViewerConfig(Deployment memory d) private {
        string memory outPath =
            vm.envOr("BLOCKCASSONE_CHAIN_CONFIG_OUT", string("data/chain-config.json"));
        string memory root = "chainConfig";
        vm.serializeBool(root, "enabled", true);
        vm.serializeUint(root, "chainId", block.chainid);
        // Local default: direct to Anvil. Sepolia: set BLOCKCASSONE_RPC_URL to your endpoint
        // and BLOCKCASSONE_DIRECT_RPC=false so the site routes through the /api/chain-rpc proxy.
        // SECURITY: this config is served to the BROWSER, so only expose a direct rpcUrl when
        // it's the non-secret local node. In proxied mode (directRpc=false) the browser uses
        // /api/chain-rpc and the real endpoint — which may embed an API key — stays server-side
        // (renderer/server.js reads BLOCKCASSONE_RPC_URL from its own env), so write "" here.
        bool directRpc = vm.envOr("BLOCKCASSONE_DIRECT_RPC", true);
        vm.serializeString(
            root, "rpcUrl",
            directRpc ? vm.envOr("BLOCKCASSONE_RPC_URL", string("http://127.0.0.1:8545")) : string("")
        );
        vm.serializeBool(root, "directRpc", directRpc);
        vm.serializeAddress(root, "mockSeaDrop", d.mockSeaDrop);
        vm.serializeAddress(root, "cubeNft", address(d.cubes));
        vm.serializeAddress(root, "genesisMinter", address(d.genesis));
        vm.serializeAddress(root, "renderer", address(d.renderer));
        vm.serializeAddress(root, "thumbnailRenderer", address(d.thumbnailRenderer));
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
            vm.serializeAddress(root, "attestationSigner", d.attestationSigner);
        vm.writeJson(json, outPath);
    }
}
