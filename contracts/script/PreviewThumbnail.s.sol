// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

interface INormieRawStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

// Minimal Normie source used only for previews.
contract PreviewMockNormies is ERC721 {
    mapping(uint256 tokenId => bytes raw) private _raw;

    constructor() ERC721("Normies", "NORM") { }

    function mint(address to, uint256 tokenId, bytes calldata raw) external {
        _mint(to, tokenId);
        _raw[tokenId] = raw;
    }

    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory) {
        return _raw[tokenId];
    }
}

/// @notice Dump thumbnail SVGs to eyeball aesthetics, with NO viewer/anvil/deploy.
///
/// For each slot it writes TWO files so both render paths are tracked together:
///   data/preview-slot-<N>.svg        Normie path (full art incl. forest strands)
///   data/preview-nonnormie-<N>.svg   non-Normie path (same silhouette, no forest)
///
/// Art source, in priority order, per Normie id:
///   1. cached fixture  data/normie-raw-<id>.hex  (real on-chain bitmap, fork-free)
///   2. live chain      read from NormiesStorage IF run against a fork, then cached
///   3. placeholder     a coherent face silhouette (the amusing fallback)
///
/// So: run ONCE against your fork to bake real art into fixtures, then every run
/// after is fork-free and shows real Normies. Colour still comes from the SLOT
/// (its unique Hilbert axis: x=red, y=green, z=blue), independent of the art.
///
/// Usage (WSL):
///   # fork-free, uses cached fixtures (or placeholder if none yet)
///   forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail
///   # one-time real-art capture (reads + caches live bitmaps), needs your key
///   source ~/blockcassone/.env  # exports ETH_RPC_URL
///   forge script contracts/script/PreviewThumbnail.s.sol --tc PreviewThumbnail \
///     --rpc-url "$ETH_RPC_URL"
///   COUNT=12 REAL_IDS="1,42,1250" forge script ... --tc PreviewThumbnail
contract PreviewThumbnail is Script {
    uint256 private constant HILBERT_ORDER = 5;
    // Live Normies bitmap storage (mainnet). Has code only when forked.
    address private constant NORMIES_STORAGE = 0x1B976bAf51cF51F0e369C070d47FBc47A706e602;
    address private constant DEV = address(0xBEEF);

    // Deployed refs bundled so the loop passes ONE stack slot, not four (fixes stack-too-deep).
    struct Env {
        PreviewMockNormies normies;
        CubeNFT cubes;
        CubeThumbnailRendererV1 thumb;
        bool forked;
    }

    function run() external {
        uint256[] memory ids = _realIds();
        uint256 count = vm.envOr("COUNT", uint256(8));
        if (count > ids.length) count = ids.length; // one cube per unique source id
        uint256 nnCount = vm.envOr("NONNORMIE_COUNT", uint256(4));
        if (nnCount > count) nnCount = count;

        bool forked = NORMIES_STORAGE.code.length > 0;
        console2.log(
            forked
                ? "mode: FORKED - reading live Normie art and caching to data/normie-raw-*.hex"
                : "mode: fork-free - using cached fixtures, else placeholder silhouette"
        );

        Env memory e;
        e.forked = forked;
        e.normies = new PreviewMockNormies();
        e.cubes = new CubeNFT("TheBLOCK", "BLOCK", address(e.normies), 4096, DEV);
        e.thumb = new CubeThumbnailRendererV1(
            e.cubes,
            address(e.normies),
            address(0),
            address(new CubeHilbertGeometry()),
            address(new CubeFrameLayer()),
            address(new CubeWalkerLayer())
        );

        // Optional: render OUR exact snapshot slots + their Normie ids (SLOTS/IDS env), so
        // the viewer's per-slot thumbnails match each cube. Falls back to the 0..COUNT path.
        uint256[] memory slots = vm.envOr("SLOTS", ",", new uint256[](0));
        uint256[] memory slotIds = vm.envOr("IDS", ",", new uint256[](0));
        bool useSlots = slots.length > 0;
        uint256 iters = useSlots ? slots.length : count;

        for (uint256 s = 0; s < iters; s++) {
            uint256 slot = useSlots ? slots[s] : s;
            uint256 id = useSlots ? slotIds[s % slotIds.length] : ids[s];
            uint256 mockId = useSlots ? (100000 + slot) : id;
            // Per-slot work lives in a helper so run()'s stack stays shallow (was stack-too-deep).
            _renderSlot(e, slot, id, mockId, !useSlots && s < nnCount);
        }
    }

    function _renderSlot(Env memory e, uint256 slot, uint256 id, uint256 mockId, bool doNonNormie) private {
        (bytes memory raw, string memory artSrc) = _bitmapFor(id, e.forked);
        // Mint a UNIQUE mock Normie per slot (snapshot reuses ids), holding this art.
        e.normies.mint(DEV, mockId, raw);
        bytes32 seed = keccak256(abi.encode("preview", slot));
        vm.prank(DEV);
        uint256 cubeId = e.cubes.mintNormieCube(mockId, uint32(slot), seed);
        vm.writeFile(string.concat("data/preview-slot-", vm.toString(slot), ".svg"), e.thumb.thumbnailSVG(cubeId));

        console2.log("slot", slot);
        console2.log("  normie id / art:", id, artSrc);

        if (doNonNormie) {
            vm.writeFile(
                string.concat("data/preview-nonnormie-", vm.toString(slot), ".svg"),
                e.thumb.previewThumbnailSVG(
                    seed, uint32(slot), address(0x0123456789abcDEF0123456789abCDef01234567), id, _toPayload(raw)
                )
            );
        }
    }

    // ---- art sourcing -------------------------------------------------------

    // Real on-chain bitmap if we have it (cached or via fork), else placeholder.
    function _bitmapFor(uint256 id, bool forked) private returns (bytes memory raw, string memory src) {
        string memory path = string.concat("data/normie-raw-", vm.toString(id), ".hex");

        bytes memory cached = _readCached(path);
        if (cached.length == 200) return (cached, "real (cached)");

        if (forked) {
            try INormieRawStorage(NORMIES_STORAGE).getTokenRawImageData(id) returns (bytes memory r) {
                if (r.length == 200) {
                    vm.writeFile(path, vm.toString(r)); // 0x-prefixed hex, no newline
                    return (r, "real (chain->cached)");
                }
            } catch { }
        }
        return (_sampleBitmap(id), "placeholder");
    }

    function _readCached(string memory path) private view returns (bytes memory) {
        try vm.readFile(path) returns (string memory h) {
            try vm.parseBytes(h) returns (bytes memory r) {
                return r;
            } catch {
                return "";
            }
        } catch {
            return "";
        }
    }

    // Curated revealed Normie ids (override with REAL_IDS="a,b,c"). Any id whose
    // real bitmap can't be fetched degrades to a placeholder, so a bad id is safe.
    function _realIds() private view returns (uint256[] memory) {
        uint256[] memory d = new uint256[](12);
        d[0] = 1;    d[1] = 42;   d[2] = 100;  d[3] = 250;
        d[4] = 777;  d[5] = 1250; d[6] = 2222; d[7] = 3333;
        d[8] = 4444; d[9] = 5555; d[10] = 6722; d[11] = 8888;
        return vm.envOr("REAL_IDS", ",", d);
    }

    // Expand a 200-byte 1-bit silhouette into the 400-byte 2-bit tonal payload the
    // non-Normie route expects: every "on" pixel becomes band 3 (toBinaryBitmap
    // collapses any non-zero band back to "on", so the silhouette is preserved).
    function _toPayload(bytes memory bmp) private pure returns (bytes memory payload) {
        payload = new bytes(400);
        for (uint256 cell = 0; cell < 1600; cell++) {
            bool on = (uint8(bmp[cell >> 3]) >> uint8(7 - (cell & 7))) & 1 == 1;
            if (on) payload[cell >> 2] |= bytes1(uint8(3) << uint8((cell & 3) << 1));
        }
    }

    // ---- diagnostics --------------------------------------------------------

    // Detect the figure colour the renderer emitted (now pure axis hues). Look at
    // the figure's first <use> so walker/frame hues don't confuse it.
    function _emittedColour(string memory svg) private pure returns (string memory) {
        if (_contains(svg, '<use href="#o" stroke="#0000ff"')) return "BLUE (z)";
        if (_contains(svg, '<use href="#o" stroke="#ff0000"')) return "RED (x)";
        return "GREEN (y)";
    }

    function _contains(string memory hay, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    // Independent copy of the renderer's unique-axis formula (sanity reference).
    function _axis(uint256 motif) private pure returns (uint256) {
        uint256 levels = HILBERT_ORDER - 1;
        uint256 a = 0;
        uint256 b = 1;
        uint256 c = 2;
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (motif / (8 ** (levels - 1 - i))) % 8;
            uint256 na;
            uint256 nb;
            uint256 nc;
            if (d == 3 || d == 4) {
                (na, nb, nc) = (a, b, c);
            } else if (d == 1 || d == 2 || d == 5 || d == 6) {
                (na, nb, nc) = (c, a, b);
            } else {
                (na, nb, nc) = (b, c, a);
            }
            (a, b, c) = (na, nb, nc);
        }
        return b;
    }

    function _colourName(uint256 axis) private pure returns (string memory) {
        if (axis == 0) return "red (x) #ff0000";
        if (axis == 1) return "green (y) #00ff00";
        return "blue (z) #0000ff";
    }

    // A COHERENT face-ish silhouette (contiguous body + eye/mouth holes) so the
    // outline path stays small. Used only when no real bitmap is available. Real
    // Normies are coherent like this. Width varies slightly by id.
    function _sampleBitmap(uint256 id) private pure returns (bytes memory raw) {
        raw = new bytes(200);
        uint256 w = 12 + (id % 3); // 12..14 half-width
        for (uint256 row = 5; row <= 35; row++) {
            for (uint256 col = 6; col <= 33; col++) {
                uint256 dx = col >= 20 ? col - 20 : 20 - col;
                bool fill = dx <= w;
                // eye holes
                if (row >= 14 && row <= 17 && ((col >= 13 && col <= 16) || (col >= 23 && col <= 26))) {
                    fill = false;
                }
                // mouth hole
                if (row >= 24 && row <= 25 && col >= 14 && col <= 25) fill = false;
                if (!fill) continue;
                uint256 i = row * 40 + col;
                raw[i / 8] = bytes1(uint8(raw[i / 8]) | uint8(1 << (7 - (i % 8))));
            }
        }
    }
}
