// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { StrBuf } from "./lib/StrBuf.sol";
import { NonNormieArt } from "./NonNormieArt.sol";
import { NormieHexGlyphs } from "./render/NormieHexGlyphs.sol";

interface IThumbnailNormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

interface IThumbnailNonNormieArtStore {
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory);
    function payloadForCube(uint256 cubeId) external view returns (bytes memory);
}

// Swappable render modules (see contracts/src/render/). The orchestrator holds
// their addresses immutably; swapping a layer = deploy the new module + redeploy
// this thin orchestrator pointing at it + cubes.setRenderer(...).
interface ICubeHilbertGeometry {
    function motifLayout(uint256 slot) external pure returns (uint256);
    function mainAxis(uint256 slot) external pure returns (uint256);
    function sideAxis(uint256 slot) external pure returns (uint256);
}

interface ICubeFrameLayer {
    function render(bytes32 seed, uint256 srcId, uint256 layout, uint256 axis)
        external
        pure
        returns (string memory);
}

interface ICubeWalkerLayer {
    function render(bytes memory raw, bytes32 seed, string memory figCol, string memory sideCol)
        external
        pure
        returns (string memory);
}

contract CubeThumbnailRendererV1 {
    using Strings for uint256;
    using StrBuf for bytes;

    CubeNFT public immutable cubes;
    address public immutable normieStorage;
    address public immutable nonNormieStore;
    ICubeHilbertGeometry public immutable geometry;
    ICubeFrameLayer public immutable frame;
    ICubeWalkerLayer public immutable walker;

    constructor(
        CubeNFT cubes_,
        address normieStorage_,
        address nonNormieStore_,
        address geometry_,
        address frame_,
        address walker_
    ) {
        cubes = cubes_;
        normieStorage = normieStorage_;
        nonNormieStore = nonNormieStore_;
        geometry = ICubeHilbertGeometry(geometry_);
        frame = ICubeFrameLayer(frame_);
        walker = ICubeWalkerLayer(walker_);
    }

    function thumbnailSVG(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        return _renderSVG(data, _rawImageBytes(data, tokenId), _tonalBytes(data, tokenId));
    }

    /// @notice The SAME cube (its real seed/source/art) rendered as if it sat at `slot` — a
    ///         stateless MOVE preview. Only the slot-derived geometry changes (mainAxis/sideAxis
    ///         hues, motif layout); the art is the cube's actual on-chain art (live Normie bitmap
    ///         included), so it works for every source kind. View — free, no state change.
    function thumbnailSVGAtSlot(uint256 tokenId, uint32 slot) external view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        data.slot = slot;
        return _renderSVG(data, _rawImageBytes(data, tokenId), _tonalBytes(data, tokenId));
    }

    /// @notice Render the thumbnail SVG for arbitrary art with no stored cube. The
    ///         customization UI passes the target cube's `seed` + `slot`, the new
    ///         source's `sourceTokenId`, and a 400-byte 2-bit tonal payload, and
    ///         gets back the exact SVG that re-basing onto that art would store.
    ///         Stateless and free (view) — for live previews.
    function previewThumbnailSVG(
        bytes32 seed,
        uint32 slot,
        address sourceContract,
        uint256 sourceTokenId,
        bytes calldata tonalPayload
    ) external view returns (string memory) {
        CubeNFT.CubeData memory data;
        data.seed = seed;
        data.slot = slot;
        data.sourceContract = sourceContract; // drives the hex banner — must match the re-base target
        data.sourceTokenId = sourceTokenId;
        return _renderSVG(data, NonNormieArt.toBinaryBitmap(tonalPayload), tonalPayload);
    }

    function _renderSVG(CubeNFT.CubeData memory data, bytes memory raw, bytes memory tonal)
        private
        view
        returns (string memory)
    {
        // Precompute the 40x40 figure grid ONCE (one band 0..3 per cell). The figure
        // layer (in _svgDefs) reads it instead of re-deriving each cell's band 5x, and
        // it's no longer rebuilt in _svgBitmap (which only needed to know if art
        // exists). `tonal` (400-byte 2-bit, or empty for Normie) still feeds glass
        // directly — its body test needs the un-punched bitmap.
        bytes memory grid = _buildGrid(data, raw, tonal);
        uint256 slot = uint256(data.slot);
        uint256 sideAx = geometry.sideAxis(slot);
        // 2.5D depth-behind order (matches tmp/line-lab.html): receding SIDE PLANES +
        // the depth WIREFRAME sit BEHIND the flat front figure, so the cube reads with
        // depth. Glass + forest are removed from the 2D thumbnail (gas + cleaner line art).
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#020203"/>',
            _svgDefs(data, raw, grid),
            _sidePlanes(grid, data.sourceTokenId, _colour(sideAx)),
            _depthFrame(sideAx),
            _svgBitmap(data, raw),
            _svgTail(data, raw)
        );
    }

    // The 40x40 figure grid: one band (0..3) per cell, built once per render. CC0 /
    // preview (2-bit tonal present) -> the tonal bands with label cells punched to 0
    // (so the figure outlines around the source number, matching the old
    // _bandOutlinePath). Normie / merged (1-bit) -> lit cells = band 1, label cells
    // kept as their raw bit (the figure skips label CENTRES but treats label
    // NEIGHBOURS as their bitmap value, matching the old _outlinePath). Empty (all 0)
    // when there is no art.
    function _buildGrid(CubeNFT.CubeData memory data, bytes memory raw, bytes memory tonal)
        private
        pure
        returns (bytes memory grid)
    {
        grid = new bytes(1600);
        if (tonal.length == 400) {
            for (uint256 i = 0; i < 1600; i++) {
                uint256 row = i / 40;
                uint256 col = i % 40;
                if (_isLabelCell(data.sourceTokenId, row, col)) continue; // punched -> band 0
                grid[i] = bytes1(NonNormieArt.tonalBandAt(tonal, uint16(row), uint16(col)));
            }
        } else if (raw.length == 200) {
            for (uint256 i = 0; i < 1600; i++) {
                if (_bitmapBit(raw, i)) grid[i] = 0x01;
            }
        }
    }

    // Body/neighbour mask: bodyN[i] = the 8-neighbour lit count (0..8) for a LIT cell,
    // 0 for a non-lit cell. So `bodyN[i] >= T` == "lit AND neigh8 >= T" for any
    // threshold T — the stone walkers use T=3. Fully inlined (no per-cell function
    // calls) over an unpacked 1-byte-per-cell bitmap, so the neighbour sum is plain byte
    // reads. Label cells are NOT punched (raw-inclusive) — walkers crawl over any body.
    function _buildBodyN(bytes memory raw) private pure returns (bytes memory bodyN) {
        bodyN = new bytes(1600);
        if (raw.length != 200) return bodyN;
        bytes memory lit = new bytes(1600);
        for (uint256 i = 0; i < 1600; i++) {
            if ((uint8(raw[i >> 3]) & (uint8(1) << uint8(7 - (i & 7)))) != 0) lit[i] = 0x01;
        }
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                uint256 i = row * 40 + col;
                if (lit[i] == 0) continue;
                bool up = row > 0;
                bool down = row < 39;
                bool left = col > 0;
                bool right = col < 39;
                uint256 n = 0;
                if (up) {
                    if (left && lit[i - 41] != 0) n++;
                    if (lit[i - 40] != 0) n++;
                    if (right && lit[i - 39] != 0) n++;
                }
                if (left && lit[i - 1] != 0) n++;
                if (right && lit[i + 1] != 0) n++;
                if (down) {
                    if (left && lit[i + 39] != 0) n++;
                    if (lit[i + 40] != 0) n++;
                    if (right && lit[i + 41] != 0) n++;
                }
                bodyN[i] = bytes1(uint8(n));
            }
        }
    }

    // Tail layers split out so neither concat holds too many inlined frames.
    function _svgTail(CubeNFT.CubeData memory data, bytes memory raw) private view returns (string memory) {
        // 8-neighbour body mask for the stone walkers (glass, the other consumer, is gone).
        bytes memory bodyN = _buildBodyN(raw);
        uint256 slot = uint256(data.slot);
        return string.concat(
            _svgWalkers(data, bodyN),
            _svgLabel(data),
            _svgFrame(data),
            // HOT SECTIONS ride ON TOP of the frame ∪ + the depth edges (user: hot must be
            // over the green line, not behind). Seed-derived so the flare pattern is permanent.
            _hotSections(data.seed),
            _hexBanner(data),
            "</svg>"
        );
    }

    // Source-contract address as a NormiesFont hex spine: its 40 uppercase nibbles fill an
    // edge end-to-edge (25px cells across the ~1000px art grid). TWO banners are drawn — one
    // VERTICAL (up/down) + one HORIZONTAL (left/right) — matching how the 3D cube reads
    // face-on (2 of the 3 per-plane banners are visible; the third recedes to the vanishing
    // point and is NOT drawn). Each banner's edge-band position is seed-derived so they sit
    // differently per cube and never cross the centre art. White, opacity .74, soft glow
    // (feGaussianBlur .2 grid = 5px). Tuned in tmp/line-lab.html; glyphs from NormieHexGlyphs.
    function _hexBanner(CubeNFT.CubeData memory data) private pure returns (string memory) {
        uint256 h = uint256(keccak256(abi.encodePacked(data.seed, "banner")));
        // vertical banner column x-band: near-left (200..400) or near-right (800..1000)
        uint256 xband = ((h >> 1) & 1) == 1 ? (800 + (h >> 2) % 200) : (200 + (h >> 2) % 200);
        // horizontal banner row y-band: near-top (185..360) or near-bottom (810..985)
        uint256 yband = ((h >> 20) & 1) == 1 ? (810 + (h >> 21) % 175) : (185 + (h >> 21) % 175);
        bytes20 a = bytes20(data.sourceContract);
        bytes memory buf = StrBuf.alloc(24576);
        buf.cat(
            '<defs><filter id="bnrG" x="-40%" y="-40%" width="180%" height="180%">'
            '<feGaussianBlur stdDeviation="5" result="b"/>'
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
            '<g fill="#fff" fill-opacity="0.74" filter="url(#bnrG)">'
        );
        for (uint256 i = 0; i < 20; i++) {
            uint8 bb = uint8(a[i]);
            for (uint256 k = 0; k < 2; k++) {
                string memory glyph = NormieHexGlyphs.path(k == 0 ? (bb >> 4) : (bb & 0x0f));
                uint256 idx = i * 2 + k; // 0..39 along the edge
                // vertical banner: fixed x-band, stepping down in y
                buf.cat(
                    string.concat(
                        '<path transform="translate(', xband.toString(), " ", (86 + idx * 25).toString(),
                        ') scale(0.025)" d="', glyph, '"/>'
                    )
                );
                // horizontal banner: stepping across in x, fixed y-band
                buf.cat(
                    string.concat(
                        '<path transform="translate(', (101 + idx * 25).toString(), " ", yband.toString(),
                        ') scale(0.025)" d="', glyph, '"/>'
                    )
                );
            }
        }
        buf.cat("</g>");
        return buf.str();
    }

    function _svgDefs(CubeNFT.CubeData memory data, bytes memory raw, bytes memory grid) private pure returns (string memory) {
        return _thumbnailDefs(
            _bitmapPath(raw),
            _figureLines(grid, data.sourceTokenId),
            _labelPath(data.sourceTokenId)
        );
    }

    function _svgBitmap(CubeNFT.CubeData memory data, bytes memory raw) private view returns (string memory) {
        // The figure/bitmap paths are already built (once) in _svgDefs and referenced
        // here via <use href="#o"/#n">. This layer only needs to know whether there is
        // any art (else it draws the fallback glyph) — so pass a cheap bool instead of
        // rebuilding the ~1000-segment outline just to length-check it.
        return _thumbnailBitmap(
            _hasArt(raw),
            _colour(geometry.mainAxis(uint256(data.slot)))
        );
    }

    function _svgLabel(CubeNFT.CubeData memory data) private view returns (string memory) {
        return _labelLayer(_labelPath(data.sourceTokenId), _colour(geometry.mainAxis(uint256(data.slot))));
    }

    function _svgFrame(CubeNFT.CubeData memory data) private view returns (string memory) {
        uint256 axis = geometry.mainAxis(uint256(data.slot));
        uint256 layout = geometry.motifLayout(uint256(data.slot));
        return frame.render(data.seed, data.sourceTokenId, layout, axis);
    }

    function _colour(uint256 axis) private pure returns (string memory) {
        // Pure axis hues (match the WebGL cube + the line-lab tuning). The neon
        // filter is hue-preserving, so the glow stays the source hue.
        if (axis == 0) return "#ff0000"; // x -> red
        if (axis == 1) return "#00ff00"; // y -> green
        return "#0000ff"; // z -> blue
    }

    // Returns a 200-byte (40x40, 1 bit/cell) binary silhouette for either source
    // kind. Normie art is already binary; non-Normie art is a 400-byte 2-bit
    // tonal-band payload (NonNormieArtStore) thresholded to a silhouette.
    function _rawImageBytes(CubeNFT.CubeData memory data, uint256 cubeId) private view returns (bytes memory) {
        // A merged-street token carries its leader cube's source facts, so its
        // thumbnail renders the leader exactly. Genesis leaders are Normies, so
        // street tokens fetch from the Normie store (v1 assumes Normie leaders).
        if (
            data.sourceKind == cubes.SOURCE_KIND_NORMIE()
                || data.sourceKind == cubes.SOURCE_KIND_MERGED_STREET()
        ) {
            if (normieStorage == address(0)) return "";
            try IThumbnailNormieRawImageStorage(normieStorage).getTokenRawImageData(data.sourceTokenId) returns (
                bytes memory raw
            ) {
                return raw;
            } catch {
                return "";
            }
        }
        if (data.sourceKind == cubes.SOURCE_KIND_EXTERNAL_ERC721() && nonNormieStore != address(0)) {
            // External / customized cubes render the store's recorded art (the
            // 2-bit tonal payload collapsed to the 1-bit bitmap). Empty if none.
            try IThumbnailNonNormieArtStore(nonNormieStore).imageBytesForCube(cubeId) returns (
                bytes memory bitmap
            ) {
                return bitmap;
            } catch {
                return "";
            }
        }
        return "";
    }

    // Builds the whole <defs> block. Uses the shared O(n) StrBuf (each buf.cat is
    // a shallow call) rather than one giant string.concat, which overflowed the
    // legacy stack limit. All neon filters are hue-preserving (the source stroke
    // supplies the colour), so they're shared across axes.
    function _thumbnailDefs(
        string memory bitmapPath,
        string memory outlinePath,
        string memory labelPath
    )
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        bytes memory buf = StrBuf.alloc(
            4096 + bytes(bitmapPath).length + bytes(outlinePath).length + bytes(labelPath).length
        );
        buf.cat('<defs>');
        // Figure neon (#nfN): wide soft + tight bright, screen-composited (additive)
        // and hue-preserving. Applied inside scale(25), so stdDeviation is in grid
        // units. #wfN softens the white core. Also reused by the receding SIDE PLANES.
        // (Tuned in tmp/line-lab.html.)
        buf.cat('<filter id="nfN" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation=".1" result="wb"/><feColorMatrix in="wb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .1 0" result="w"/><feGaussianBlur in="SourceGraphic" stdDeviation=".11" result="tb"/><feColorMatrix in="tb" type="matrix" values="10.5 0 0 0 0 0 10.5 0 0 0 0 0 10.5 0 0 0 0 0 2.7 0" result="t"/><feBlend in="w" in2="t" mode="screen"/></filter>');
        buf.cat('<filter id="wfN" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".015"/></filter>');
        // Frame neon (#nfF / #wfF) — drawn in raw 1200-space, so stdDeviation is in
        // viewBox px (= grid units x 25). Reused by the depth wireframe + hot sections.
        buf.cat('<filter id="nfF" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="wb"/><feColorMatrix in="wb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .8 0" result="w"/><feGaussianBlur in="SourceGraphic" stdDeviation="2.75" result="tb"/><feColorMatrix in="tb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1.35 0" result="t"/><feBlend in="w" in2="t" mode="screen"/></filter>');
        buf.cat('<filter id="wfF" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".75"/></filter>');
        // Edge-orb glow (#pfP) + soft white core (#pwP), raw 1200-space. #pfP also softens
        // the depth wireframe's back-corner orbs.
        buf.cat('<filter id="pfP" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.75" result="b"/><feColorMatrix in="b" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 1.05 0"/></filter>');
        buf.cat('<filter id="pwP" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".875"/></filter>');
        // path data referenced by <use>
        buf.cat('<path id="n" d="');
        buf.cat(bitmapPath);
        buf.cat('"/><path id="o" d="');
        buf.cat(outlinePath);
        buf.cat('"/><path id="l" d="');
        buf.cat(labelPath);
        buf.cat('"/></defs>');
        return buf.str();
    }

    // True iff there is renderable art. Equivalent to the old
    // "_bitmapPath && _outlineFor both non-empty" guard: a valid 200-byte bitmap with
    // at least one lit cell yields a non-empty fill AND a non-empty outline (a lit
    // cell always has a boundary), and CC0 raw is the same store payload the tonal
    // outline comes from — so any lit bit means both paths are non-empty.
    function _hasArt(bytes memory raw) private pure returns (bool) {
        if (raw.length != 200) return false;
        for (uint256 i = 0; i < 200; i++) {
            if (raw[i] != 0) return true;
        }
        return false;
    }

    function _thumbnailBitmap(bool hasArt, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        if (!hasArt) {
            return string.concat(
                '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
                '<path d="M290 290h260v280h260v-170h-114v-198h-286v-122" stroke="#ff1919" stroke-width="22" opacity=".95"/>',
                '<path d="M290 290h260v280h260v-170h-114v-198h-286v-122" stroke="#ffffff" stroke-width="5" opacity=".72"/>',
                "</g>"
            );
        }

        // Figure neon stack (tuned in tmp/line-lab.html). Inside scale(25), so
        // widths/dash are in grid units. fill="none" on the group keeps the open
        // outline subpaths from filling; the faint #n fill is set explicitly.
        // Layers: screen glow · glow beads (a dot per cell-vertex) · bright core ·
        // soft white core · white beads.
        return string.concat(
            '<g transform="translate(100 85) scale(25)" fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<use href="#n" fill="', planeColor, '" opacity=".003"/>',
            '<use href="#o" stroke="', planeColor, '" stroke-width=".146" filter="url(#nfN)"/>',
            '<use href="#o" stroke="', planeColor, '" stroke-width=".245" stroke-dasharray="0 1" opacity=".88" filter="url(#nfN)"/>',
            '<use href="#o" stroke="', planeColor, '" stroke-width=".105" opacity=".95"/>',
            '<use href="#o" stroke="#fff" stroke-width=".04" opacity=".9" filter="url(#wfN)"/>',
            '<use href="#o" stroke="#fff" stroke-width=".1" stroke-dasharray="0 1" opacity=".89" filter="url(#wfN)"/>',
            "</g>"
        );
    }

    // The Normie number (#l), drawn as its own layer ON TOP of the glass so it
    // stays legible. Same neon treatment as the figure lines.
    function _labelLayer(string memory labelPath, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        if (bytes(labelPath).length == 0) return "";
        return string.concat(
            '<g transform="translate(100 85) scale(25)" fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<use href="#l" stroke="', planeColor, '" stroke-width=".146" filter="url(#nfN)"/>',
            '<use href="#l" stroke="', planeColor, '" stroke-width=".245" stroke-dasharray="0 1" opacity=".88" filter="url(#nfN)"/>',
            '<use href="#l" stroke="', planeColor, '" stroke-width=".105" opacity=".95"/>',
            '<use href="#l" stroke="#fff" stroke-width=".04" opacity=".9" filter="url(#wfN)"/>',
            '<use href="#l" stroke="#fff" stroke-width=".1" stroke-dasharray="0 1" opacity=".89" filter="url(#wfN)"/>',
            "</g>"
        );
    }



    function _bitmapPath(bytes memory raw) private pure returns (string memory) {
        if (raw.length != 200) return "";

        // <= 40 rows * 20 runs * ~15 bytes/run; 24KB leaves ample slack.
        bytes memory buf = StrBuf.alloc(24576);
        for (uint256 row = 0; row < 40; row++) {
            uint256 col = 0;
            while (col < 40) {
                while (col < 40 && !_bitmapBit(raw, row * 40 + col)) {
                    col++;
                }
                if (col >= 40) break;

                uint256 start = col;
                while (col < 40 && _bitmapBit(raw, row * 40 + col)) {
                    col++;
                }

                buf.cat(
                    string.concat(
                        "M",
                        start.toString(),
                        " ",
                        row.toString(),
                        "h",
                        (col - start).toString(),
                        "v1H",
                        start.toString(),
                        "z"
                    )
                );
            }
        }
        return buf.str();
    }

    // Band 0..3 at (row,col); 0 outside the grid. The grid already has CC0 label
    // cells punched to 0; Normie label cells keep their bit (the figure skips label
    // CENTRES but reads label NEIGHBOURS as their bitmap value — same as the old
    // _outlinePath / _bandOutlinePath split, now unified).
    function _gridAt(bytes memory grid, int256 row, int256 col) private pure returns (uint8) {
        if (row < 0 || row >= 40 || col < 0 || col >= 40) return 0;
        return uint8(grid[uint256(row) * 40 + uint256(col)]);
    }

    // Figure lines at band boundaries — a unit segment wherever a neighbour has a
    // LOWER band, drawn once from the higher side, so internal features (sockets,
    // teeth, folds) become line-work. Reduces exactly to the 1-bit silhouette for
    // Normie (grid is 0/1). Label cells are skipped as CENTRES so the source number
    // stays legible. Unifies the old _outlinePath (bit) + _bandOutlinePath (band) into
    // one path over the precomputed grid (no per-cell band re-derivation).
    function _figureLines(bytes memory grid, uint256 sourceId) private pure returns (string memory) {
        if (grid.length != 1600) return "";
        bytes memory buf = StrBuf.alloc(98304);
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                uint8 b = uint8(grid[row * 40 + col]);
                if (b == 0) continue;
                if (_isLabelCell(sourceId, row, col)) continue;
                int256 r = int256(row);
                int256 c = int256(col);
                if (_gridAt(grid, r, c - 1) < b) {
                    buf.cat(string.concat("M", col.toString(), " ", row.toString(), "v1"));
                }
                if (_gridAt(grid, r, c + 1) < b) {
                    buf.cat(string.concat("M", (col + 1).toString(), " ", row.toString(), "v1"));
                }
                if (_gridAt(grid, r - 1, c) < b) {
                    buf.cat(string.concat("M", col.toString(), " ", row.toString(), "h1"));
                }
                if (_gridAt(grid, r + 1, c) < b) {
                    buf.cat(string.concat("M", col.toString(), " ", (row + 1).toString(), "h1"));
                }
            }
        }
        return buf.str();
    }

    // The cube's 2-bit tonal payload for band contours: the store's raw payload for
    // external/customized cubes, empty for Normie (intrinsically 1-bit) or if none.
    function _tonalBytes(CubeNFT.CubeData memory data, uint256 cubeId)
        private
        view
        returns (bytes memory)
    {
        if (data.sourceKind == cubes.SOURCE_KIND_EXTERNAL_ERC721() && nonNormieStore != address(0)) {
            try IThumbnailNonNormieArtStore(nonNormieStore).payloadForCube(cubeId) returns (
                bytes memory p
            ) {
                return p;
            } catch {
                return "";
            }
        }
        return "";
    }

    // --- 2.5D depth geometry (side planes, wireframe, hot sections) -------------
    // Ported from tmp/line-lab.html: the cube reads as 3D by projecting the figure
    // onto two receding SIDE faces + drawing the receding Hilbert wireframe BEHIND the
    // flat front figure. Central vanishing point at grid (20,20) == raw (600,585); the
    // back face is the front scaled about the VP by backScale 0.72. Grid-space layers are
    // wrapped in translate(100 85) scale(25) (the figure space); raw layers use viewBox px
    // directly. All view-only (no blockspace). Glass + forest were removed from the 2D.

    // Frame (Hilbert) hue paired against a plane's ART axis, never the same colour as that
    // plane's normie lines: green(1) -> pink, red(0)/blue(2) -> green.
    function _frameHue(uint256 axis) private pure returns (string memory) {
        return axis == 1 ? "#ff19a6" : "#1aff38";
    }

    // Bilinear corners of a projected side quad, grid units x100 (a=Q00,b=Q10,c=Q11,d=Q01).
    struct Quad {
        int256 ax; int256 ay; int256 bx; int256 by; int256 cx; int256 cy; int256 dx; int256 dy;
    }

    // Bilinear map of grid vertex (U,V) in 0..40 onto the quad:
    // P = (1-u)(1-v)a + u(1-v)b + uv c + (1-u)v d, u=U/40 v=V/40. Corners are x100, so the
    // result is a grid coord x100. All corners land inside 0..40 -> P is always non-negative.
    function _bl(Quad memory q, uint256 U, uint256 V) private pure returns (uint256, uint256) {
        int256 w00 = int256((40 - U) * (40 - V));
        int256 w10 = int256(U * (40 - V));
        int256 w11 = int256(U * V);
        int256 w01 = int256((40 - U) * V);
        int256 x = (w00 * q.ax + w10 * q.bx + w11 * q.cx + w01 * q.dx) / 1600;
        int256 y = (w00 * q.ay + w10 * q.by + w11 * q.cy + w01 * q.dy) / 1600;
        return (uint256(x), uint256(y));
    }

    // Grid coord x100 -> "d.d" (1 decimal = 0.1 grid = 2.5px in the scale(25) group; still 10x
    // finer than the integer front figure, imperceptible on the small receding side planes),
    // appended straight into `buf` with no intermediate string alloc.
    function _catFixed(bytes memory buf, uint256 v) private pure {
        buf.cat((v / 100).toString());
        buf.cat(".");
        buf.cat(((v / 10) % 10).toString());
    }

    // One boundary segment "M<a>L<b>" where <a>/<b> are cached projected-vertex strings.
    function _edge(bytes memory buf, string[] memory vtx, Quad memory q, uint256 u0, uint256 v0, uint256 u1, uint256 v1)
        private
        pure
    {
        buf.cat("M");
        buf.cat(_vtx(vtx, q, u0, v0));
        buf.cat("L");
        buf.cat(_vtx(vtx, q, u1, v1));
    }

    // Lattice vertex (U,V) in 0..40, projected + formatted as "x y" — computed ONCE and cached
    // (a boundary vertex is shared by up to 4 segments, and each formatting is the hot cost).
    function _vtx(string[] memory vtx, Quad memory q, uint256 U, uint256 V) private pure returns (string memory) {
        uint256 i = V * 41 + U;
        string memory s = vtx[i];
        if (bytes(s).length != 0) return s;
        (uint256 x, uint256 y) = _bl(q, U, V);
        bytes memory b = StrBuf.alloc(24);
        _catFixed(b, x);
        b.cat(" ");
        _catFixed(b, y);
        s = b.str();
        vtx[i] = s;
        return s;
    }

    // The figure silhouette (band-boundary rule of _figureLines) bilinearly projected onto a side
    // quad at FULL 40-grid fidelity. Each lattice vertex is projected + decimal-formatted a SINGLE
    // time (cached in `vtx`, shared by its up-to-4 segments) so the string work — the dominant
    // render cost — is minimised without coarsening the contour. Label cells are dropped so the
    // #NNNN never smears onto the sides.
    function _projFig(bytes memory grid, uint256 sourceId, Quad memory q) private pure returns (string memory) {
        if (grid.length != 1600) return "";
        bytes memory buf = StrBuf.alloc(65536);
        string[] memory vtx = new string[](41 * 41); // (V*41+U) projected+formatted, lazy
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                uint8 b = uint8(grid[row * 40 + col]);
                if (b == 0) continue;
                if (_isLabelCell(sourceId, row, col)) continue;
                int256 r = int256(row);
                int256 c = int256(col);
                if (_gridAt(grid, r, c - 1) < b) _edge(buf, vtx, q, col, row, col, row + 1);
                if (_gridAt(grid, r, c + 1) < b) _edge(buf, vtx, q, col + 1, row, col + 1, row + 1);
                if (_gridAt(grid, r - 1, c) < b) _edge(buf, vtx, q, col, row, col + 1, row);
                if (_gridAt(grid, r + 1, c) < b) _edge(buf, vtx, q, col, row + 1, col + 1, row + 1);
            }
        }
        return buf.str();
    }

    // Two receding side planes: the figure contour projected onto the LEFT + RIGHT cube faces
    // in the doubled-axis (sideColor) hue, upside-down vs the hero (the shared edge flips
    // orientation). Reuses the figure glow #nfN, thinner (sideW .45, sideGlow .5), group
    // opacity sideOp .76. Drawn in the figure grid space (translate(100 85) scale(25)).
    function _sidePlanes(bytes memory grid, uint256 sourceId, string memory sideColor)
        private
        pure
        returns (string memory)
    {
        // corners x100; VP (20,20), backScale .72 -> back corners 5.60 / 34.40.
        // LEFT  {0,1,2,3}=[bBL,BL,TL,bTL]: Q00=bBL Q10=BL  Q11=TL  Q01=bTL
        Quad memory qL = Quad(560, 3440, 0, 4000, 0, 0, 560, 560);
        // RIGHT {4,5,6,7}=[BR,bBR,bTR,TR]: Q00=BR  Q10=bBR Q11=bTR Q01=TR
        Quad memory qR = Quad(4000, 4000, 3440, 3440, 3440, 560, 4000, 0);
        string memory dL = _projFig(grid, sourceId, qL);
        string memory dR = _projFig(grid, sourceId, qR);
        if (bytes(dL).length == 0 && bytes(dR).length == 0) return "";
        return string.concat(
            '<g transform="translate(100 85) scale(25)" opacity="0.76" fill="none" stroke-linecap="round" stroke-linejoin="round">',
            _sidePath2(dL, sideColor),
            _sidePath2(dR, sideColor),
            "</g>"
        );
    }

    // The 3 neon passes (glow #nfN / colour core / white core) for one side-plane path.
    // Widths = the NORMIE stack x sideW .45 (glow also x sideGlow .5): .146*.45*.5=.033,
    // .105*.45=.047, .04*.45=.018 (tuned in tmp/line-lab.html; white core has no blur).
    function _sidePath2(string memory d, string memory hue) private pure returns (string memory) {
        if (bytes(d).length == 0) return "";
        return string.concat(
            '<path d="', d, '" stroke="', hue, '" stroke-width="0.033" filter="url(#nfN)"/>',
            '<path d="', d, '" stroke="', hue, '" stroke-width="0.047" opacity="0.95"/>',
            '<path d="', d, '" stroke="#fff" stroke-width="0.018" opacity="0.9"/>'
        );
    }

    // The receding Hilbert wireframe: 2 top receders (TL->bTL, TR->bTR) + 2 back sides
    // (bTL->bBL, bTR->bBR), plus soft orbs on the 4 back corners. Raw 1200-space:
    // F=(100,85)(1100,85)(1100,1085)(100,1085); VP (600,585), back = front*.72 about VP ->
    // bTL(240,225) bTR(960,225) bBR(960,945) bBL(240,945). Side-frame hue, fuzzy #nfF.
    // boxW .11 -> raw x25: glow 6.6 (x2.4), core 2.75, white 0.825 (x0.3); orb r 4.675.
    function _depthFrame(uint256 sideAxis) private pure returns (string memory) {
        string memory fh = _frameHue(sideAxis);
        string memory d = "M100 85L240 225M1100 85L960 225M240 225L240 945M960 225L960 945";
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.8">',
            '<path d="', d, '" stroke="', fh, '" stroke-width="6.6" filter="url(#nfF)"/>',
            '<path d="', d, '" stroke="', fh, '" stroke-width="2.75" opacity="0.95"/>',
            '<path d="', d, '" stroke="#fff" stroke-width="0.825" opacity="0.85"/>',
            "</g>",
            '<g fill="#fff" opacity="0.88" filter="url(#pfP)">'
            '<circle cx="240" cy="225" r="4.675"/><circle cx="960" cy="225" r="4.675"/>'
            '<circle cx="960" cy="945" r="4.675"/><circle cx="240" cy="945" r="4.675"/>'
            "</g>"
        );
    }

    // HOT SECTIONS: bright yellow-white flares patched along the whole Hilbert outline
    // (front border + receding depth edges) via an irregular dash + dash-offset, glowing
    // (#nfF) over a white core. Drawn ON TOP of the frame. A 2D-only flourish (the 3D Hilbert
    // line is uniform), so it has no 3D counterpart to mirror — but the offset is derived from
    // the permanent `seed` (like the edge points + banner), NOT the mutable slot, so the flare
    // pattern is a stable part of the cube's identity and does not shift when a cube moves.
    // Dash "5 6 9 7 4 5 11 8" and hotW .3 x25 -> raw; hotOp .66. (Tuned in tmp/line-lab.html.)
    function _hotSections(bytes32 seed) private pure returns (string memory) {
        string memory front = _frontBorderRaw();
        string memory d = "M100 85L240 225M1100 85L960 225M240 225L240 945M960 225L960 945";
        // Offset within the dash period (sum of the dash array = 1375) -> full flare variation.
        uint256 off = uint256(keccak256(abi.encodePacked(seed, "hot"))) % 1375;
        return string.concat(
            '<g fill="none" stroke-linecap="round" opacity="0.66" stroke-dasharray="125 150 225 175 100 125 275 200" stroke-dashoffset="', off.toString(), '">',
            '<g stroke="#fff2a0" filter="url(#nfF)"><path d="', front, '" stroke-width="7.5"/><path d="', d, '" stroke-width="7.5"/></g>',
            '<g stroke="#fffbe6"><path d="', front, '" stroke-width="3"/><path d="', d, '" stroke-width="3"/></g>',
            "</g>"
        );
    }

    // The front frame ∪ (fixed open-top: bottom + left + right) in raw 1200-space — byte-identical
    // to CubeFrameLayer._borderPath, so the hot flares trace the drawn frame exactly.
    function _frontBorderRaw() private pure returns (string memory) {
        return "M100 1085H1100M100 85V1085M1100 85V1085";
    }

    // --- Stone walkers --------------------------------------------------------
    // Delegated to CubeWalkerLayer (split out to stay under the 24KB code limit).
    // Front (unique-plane) walks emerge mid-body in the figure axis colour; side
    // walks (the doubled sideAxis colour) enter from opposite edges then tour.
    // Applies to ANY art on the planes (Normie or customized) — not Normie-only
    // like the forest; walker.render returns "" when there's no body to crawl.
    function _svgWalkers(CubeNFT.CubeData memory data, bytes memory bodyN) private view returns (string memory) {
        return walker.render(
            bodyN,
            data.seed,
            _colour(geometry.mainAxis(uint256(data.slot))),
            _colour(geometry.sideAxis(uint256(data.slot)))
        );
    }

    function _labelPath(uint256 normieId) private pure returns (string memory) {
        bytes memory text = bytes(string.concat("#", _paddedFour(normieId)));
        uint256 startCol = 20;
        uint256 startRow = 34;
        string memory path = "";

        for (uint256 ci = 0; ci < text.length; ci++) {
            for (uint256 row = 0; row < 5; row++) {
                for (uint256 col = 0; col < 3; col++) {
                    if (!_glyphBit(text[ci], row, col)) continue;
                    uint256 x = startCol + ci * 4 + col;
                    uint256 y = startRow + row;
                    if (!_glyphBitAt(text[ci], row, col, 0, -1)) {
                        path = string.concat(path, "M", x.toString(), " ", y.toString(), "v1");
                    }
                    if (!_glyphBitAt(text[ci], row, col, 0, 1)) {
                        path = string.concat(path, "M", (x + 1).toString(), " ", y.toString(), "v1");
                    }
                    if (!_glyphBitAt(text[ci], row, col, -1, 0)) {
                        path = string.concat(path, "M", x.toString(), " ", y.toString(), "h1");
                    }
                    if (!_glyphBitAt(text[ci], row, col, 1, 0)) {
                        path = string.concat(path, "M", x.toString(), " ", (y + 1).toString(), "h1");
                    }
                }
            }
        }
        return path;
    }

    function _paddedFour(uint256 value) private pure returns (string memory) {
        uint256 wrapped = value % 10000;
        if (wrapped < 10) return string.concat("000", wrapped.toString());
        if (wrapped < 100) return string.concat("00", wrapped.toString());
        if (wrapped < 1000) return string.concat("0", wrapped.toString());
        return wrapped.toString();
    }

    function _isLabelCell(uint256 normieId, uint256 row, uint256 col) private pure returns (bool) {
        if (row < 34 || row > 38 || col < 20 || col > 38) return false;
        uint256 localCol = col - 20;
        if (localCol % 4 == 3) return false;
        uint256 charIndex = localCol / 4;
        if (charIndex > 4) return false;
        bytes memory text = bytes(string.concat("#", _paddedFour(normieId)));
        return _glyphBit(text[charIndex], row - 34, localCol % 4);
    }

    function _glyphBitAt(bytes1 glyph, uint256 row, uint256 col, int256 rowDelta, int256 colDelta)
        private
        pure
        returns (bool)
    {
        int256 nextRow = int256(row) + rowDelta;
        int256 nextCol = int256(col) + colDelta;
        if (nextRow < 0 || nextRow >= 5 || nextCol < 0 || nextCol >= 3) return false;
        return _glyphBit(glyph, uint256(nextRow), uint256(nextCol));
    }

    function _glyphBit(bytes1 glyph, uint256 row, uint256 col) private pure returns (bool) {
        uint16 bits = _glyphBits(glyph);
        uint256 idx = row * 3 + col;
        return ((bits >> (14 - idx)) & 1) == 1;
    }

    function _glyphBits(bytes1 glyph) private pure returns (uint16) {
        if (glyph == "0") return 0x7B6F;
        if (glyph == "1") return 0x2C97;
        if (glyph == "2") return 0x73E7;
        if (glyph == "3") return 0x72CF;
        if (glyph == "4") return 0x5BC9;
        if (glyph == "5") return 0x79CF;
        if (glyph == "6") return 0x79EF;
        if (glyph == "7") return 0x7249;
        if (glyph == "8") return 0x7BEF;
        if (glyph == "9") return 0x7BCF;
        return 0x2EBA; // '#' (centre bar + two crossbars, matches viewer label.js 3x5 font)
    }

    // Read bit `index` from the packed 40x40 (1 bit/cell) silhouette.
    function _bitmapBit(bytes memory raw, uint256 index) private pure returns (bool) {
        uint256 byteIndex = index / 8;
        uint256 bitIndex = 7 - (index % 8);
        return (uint8(raw[byteIndex]) & (uint8(1) << uint8(bitIndex))) != 0;
    }


}

