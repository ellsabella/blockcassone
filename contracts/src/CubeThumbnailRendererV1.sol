// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { StrBuf } from "./lib/StrBuf.sol";
import { NonNormieArt } from "./NonNormieArt.sol";
import { CubeForestLib } from "./render/CubeForestLib.sol";

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

    /// @notice Render the thumbnail SVG for arbitrary art with no stored cube. The
    ///         customization UI passes the target cube's `seed` + `slot`, the new
    ///         source's `sourceTokenId`, and a 400-byte 2-bit tonal payload, and
    ///         gets back the exact SVG that re-basing onto that art would store.
    ///         Stateless and free (view) — for live previews.
    function previewThumbnailSVG(
        bytes32 seed,
        uint32 slot,
        uint256 sourceTokenId,
        bytes calldata tonalPayload
    ) external view returns (string memory) {
        CubeNFT.CubeData memory data;
        data.seed = seed;
        data.slot = slot;
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
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#020203"/>',
            _svgDefs(data, raw, grid),
            _svgForest(data),
            _svgBitmap(data, raw),
            _svgTail(data, raw, tonal)
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
    // threshold T — glass uses T=GLASS_CONV_MIN(5), the walkers use T=3. Built once
    // and shared, replacing three separate `_neigh8` scans. Fully inlined (no per-cell
    // function calls) over an unpacked 1-byte-per-cell bitmap, so the neighbour sum is
    // plain byte reads. Label cells are NOT punched (raw-inclusive) — glass applies its
    // own label skip, walkers crawl over any body, exactly as the old raw path did.
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
    function _svgTail(CubeNFT.CubeData memory data, bytes memory raw, bytes memory tonal) private view returns (string memory) {
        // Precompute the 8-neighbour body mask ONCE here and share it across the two
        // consumers that both need it: the stone walkers and the glass voxels. Before,
        // `_neigh8` (8 memory reads / call) was recomputed in the walker front-scan,
        // the walker side-scan, AND the glass loop — the single biggest shared cost.
        bytes memory bodyN = _buildBodyN(raw);
        return string.concat(
            _svgWalkers(data, bodyN),
            _glassLayer(bodyN, tonal, data.sourceTokenId, data.seed),
            _svgLabel(data),
            _svgFrame(data),
            "</svg>"
        );
    }

    function _svgDefs(CubeNFT.CubeData memory data, bytes memory raw, bytes memory grid) private view returns (string memory) {
        uint256 slot = uint256(data.slot);
        return _thumbnailDefs(
            _bitmapPath(raw),
            _figureLines(grid, data.sourceTokenId),
            _labelPath(data.sourceTokenId),
            _colour(geometry.mainAxis(slot)),
            _colour(geometry.sideAxis(slot))
        );
    }

    function _svgForest(CubeNFT.CubeData memory data) private view returns (string memory) {
        // Forest strands are Normie-only; non-Normie / customized cubes show only
        // the bare edge-point orbs (drawn by the frame layer).
        if (data.sourceKind != cubes.SOURCE_KIND_NORMIE()) return "";
        uint256 slot = uint256(data.slot);
        return CubeForestLib.render(
            data,
            _colour(geometry.mainAxis(slot)),
            _colour(geometry.sideAxis(slot)),
            geometry.motifLayout(slot)
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
        string memory labelPath,
        string memory planeColor,
        string memory sideColor
    )
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        bytes memory buf = StrBuf.alloc(
            8600 + bytes(bitmapPath).length + bytes(outlinePath).length + bytes(labelPath).length
        );
        buf.cat('<defs>');
        // shared white-ish glow tiers #g / #p / #h
        buf.cat('<filter id="g" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2.3" result="t"/><feColorMatrix in="t" type="matrix" values="5 0 0 0 0 0 5 0 0 0 0 0 5 0 0 0 0 0 1 0" result="tc"/><feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="m"/><feColorMatrix in="m" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 .62 0" result="mc"/><feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        buf.cat('<filter id="p" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="t"/><feColorMatrix in="t" type="matrix" values="6 0 0 0 0 0 6 0 0 0 0 0 6 0 0 0 0 0 .95 0" result="tc"/><feGaussianBlur in="SourceGraphic" stdDeviation="11" result="m"/><feColorMatrix in="m" type="matrix" values="4 0 0 0 0 0 4 0 0 0 0 0 4 0 0 0 0 0 .50 0" result="mc"/><feGaussianBlur in="SourceGraphic" stdDeviation="20" result="w"/><feColorMatrix in="w" type="matrix" values="2 0 0 0 0 0 2 0 0 0 0 0 2 0 0 0 0 0 .24 0" result="wc"/><feMerge><feMergeNode in="wc"/><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        buf.cat('<filter id="h" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="9" result="m"/><feColorMatrix in="m" type="matrix" values="4 0 0 0 0 0 4 0 0 0 0 0 4 0 0 0 0 0 .32 0" result="mc"/><feGaussianBlur in="SourceGraphic" stdDeviation="24" result="w"/><feColorMatrix in="w" type="matrix" values="2.4 0 0 0 0 0 2.4 0 0 0 0 0 2.4 0 0 0 0 0 .14 0" result="wc"/><feMerge><feMergeNode in="wc"/><feMergeNode in="mc"/></feMerge></filter>');
        // Figure neon (#nfN): wide soft + tight bright, screen-composited (additive)
        // and hue-preserving. Applied inside scale(25), so stdDeviation is in grid
        // units. #wfN softens the white core. (Tuned in tmp/line-lab.html.)
        buf.cat('<filter id="nfN" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation=".1" result="wb"/><feColorMatrix in="wb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .1 0" result="w"/><feGaussianBlur in="SourceGraphic" stdDeviation=".11" result="tb"/><feColorMatrix in="tb" type="matrix" values="10.5 0 0 0 0 0 10.5 0 0 0 0 0 10.5 0 0 0 0 0 2.7 0" result="t"/><feBlend in="w" in2="t" mode="screen"/></filter>');
        buf.cat('<filter id="wfN" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".015"/></filter>');
        // Frame neon (#nfF / #wfF) — drawn in raw 1200-space, so stdDeviation is in
        // viewBox px (= grid units x 25).
        buf.cat('<filter id="nfF" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="wb"/><feColorMatrix in="wb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .8 0" result="w"/><feGaussianBlur in="SourceGraphic" stdDeviation="2.75" result="tb"/><feColorMatrix in="tb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1.35 0" result="t"/><feBlend in="w" in2="t" mode="screen"/></filter>');
        buf.cat('<filter id="wfF" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".75"/></filter>');
        // Edge-orb glow (#pfP) + soft white core (#pwP), raw 1200-space.
        buf.cat('<filter id="pfP" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.75" result="b"/><feColorMatrix in="b" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 1.05 0"/></filter>');
        buf.cat('<filter id="pwP" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".875"/></filter>');
        // Glass soft-halo (#gGlass): glowG1/G2=1 -> no colour amplification, just a
        // faint blurred halo under the source. The screen blend supplies brightness.
        buf.cat('<filter id="gGlass" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="1.25" result="m"/><feColorMatrix in="m" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .62 0" result="mc"/><feGaussianBlur in="SourceGraphic" stdDeviation=".5" result="t"/><feColorMatrix in="t" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="tc"/><feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        // forest particle filter #pc + plane-colour cloud gradient #cg
        buf.cat('<filter id="pc" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.3 -1.12" result="mask"/><feComposite operator="in" in="SourceGraphic" in2="mask" result="clip"/><feGaussianBlur in="clip" stdDeviation="5" result="gr"/><feColorMatrix in="clip" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .6 0" result="dim"/><feMerge><feMergeNode in="gr"/><feMergeNode in="gr"/><feMergeNode in="dim"/></feMerge></filter>');
        buf.cat('<radialGradient id="cg"><stop offset="0" stop-color="');
        buf.cat(planeColor);
        buf.cat('" stop-opacity=".5"/><stop offset=".4" stop-color="');
        buf.cat(planeColor);
        buf.cat('" stop-opacity=".22"/><stop offset="1" stop-color="');
        buf.cat(planeColor);
        buf.cat('" stop-opacity="0"/></radialGradient>');
        // second cloud gradient (#cg2) for the doubled side-plane colour
        buf.cat('<radialGradient id="cg2"><stop offset="0" stop-color="');
        buf.cat(sideColor);
        buf.cat('" stop-opacity=".5"/><stop offset=".4" stop-color="');
        buf.cat(sideColor);
        buf.cat('" stop-opacity=".22"/><stop offset="1" stop-color="');
        buf.cat(sideColor);
        buf.cat('" stop-opacity="0"/></radialGradient>');
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

    // --- Glass voxel cells -----------------------------------------------------
    // Bright translucent "glass" cells filling the silhouette body, screen-blended
    // (mix-blend-mode) so they read as luminous glass over the dark cube, not dim
    // alpha-over fills. Colour comes from an RGB light field whose three lights sit
    // on an evenly-spaced 120deg triangle; the triangle's ROTATION is derived from
    // the cube seed, so every cube lands the rainbow differently. Tuned in
    // tmp/line-lab.html; lab grid-units x25 -> these viewBox-px constants.
    uint256 private constant GLASS_CONV_MIN = 5;   // glass where >= this many of 8 neighbours are on (body)
    uint256 private constant GLASS_COVERAGE = 38;  // % of body cells kept (seeded scatter)
    int256 private constant GLASS_CX = 600;        // light-triangle centre (viewBox px)
    int256 private constant GLASS_CY = 585;
    int256 private constant GLASS_SPREAD = 400;    // light distance from centre (16 grid x25)
    uint256 private constant GLASS_R2 = 160000;    // light falloff R^2 ((16 grid x25)^2)

    function _glassLayer(bytes memory bodyN, bytes memory tonal, uint256 normieId, bytes32 seed)
        private
        pure
        returns (string memory)
    {
        if (bodyN.length != 1600) return "";
        bool hasTonal = tonal.length == 400;

        // Per-cube rainbow orientation: pick ONE of 6 evenly-spaced rotations
        // (0,60,..,300) from the hashed seed. Six discrete, well-separated angles
        // read as clearly distinct cube-to-cube — a fine 0..359 rotation barely
        // varies for nearby/structured seeds. Precompute the rotated lights once.
        uint256 rot = (uint256(keccak256(abi.encodePacked(seed))) % 6) * 60;
        uint256[6] memory L = _lights(rot);

        bytes memory buf = StrBuf.alloc(131072);
        // screen blend = bright luminous glass over the dark cube (alpha-over would
        // only darken). glowG1/G2 = 1 in the lab -> the filter is just a faint soft
        // halo (no colour amplification).
        buf.cat('<g filter="url(#gGlass)" stroke-width="0.3" style="mix-blend-mode:screen">');
        uint256 kept = 0;
        for (uint256 i = 0; i < 1600 && kept < 760; i++) {
            // bodyN[i] >= GLASS_CONV_MIN == "lit AND neigh8 >= 5" (from the shared mask),
            // replacing the old _bitmapBit + _neigh8 recompute in one byte read.
            if (uint8(bodyN[i]) < GLASS_CONV_MIN) continue;
            uint256 col = i % 40;
            uint256 row = i / 40;
            if (_isLabelCell(normieId, row, col)) continue;
            if (uint256(keccak256(abi.encodePacked(seed, col, row))) % 100 >= GLASS_COVERAGE) continue;
            // Tonal band (1..3) shades the glass; Normie / no-tonal defaults to 1 (full).
            uint8 band = hasTonal ? NonNormieArt.tonalBandAt(tonal, uint16(row), uint16(col)) : 1;
            if (band == 0) band = 1;
            buf.cat(_glassRect(col, row, L, band));
            kept++;
        }
        buf.cat("</g>");
        return buf.str();
    }

    // Per-cell glass brightness (x1000): DENSER cells (more on-neighbours) glow
    // brighter, so the scattered glass reads the form's body and sparse edge
    // cells stay faint. A per-cell variety factor keeps it from looking
    // mechanical. No centre bias (that caused the old central bunching).
    function _glassDensity(uint256 col, uint256 row) private pure returns (uint256 v) {
        // Opacity x1000, shaped to the reference's measured distribution: mostly
        // faint (median ~.14), with a steep bright tail (top ~10% ramps to ~.64).
        // Random per cell so the bright cells scatter rather than cluster.
        uint256 r = uint256(keccak256(abi.encodePacked(col, row))) % 1000;
        if (r <= 900) {
            uint256 t = r * 1000 / 900; // 0..1000
            v = 65 + (t * t / 1000) * 255 / 1000; // .065 .. .320
        } else {
            v = 320 + (r - 900) * 320 / 100; // .320 .. ~.636
        }
    }

    function _glassRect(uint256 col, uint256 row, uint256[6] memory L, uint8 band)
        private
        pure
        returns (string memory)
    {
        uint256 d = _glassDensity(col, row);  // 65..636 (x1000)
        // Shade by tonal band: the LIGHT subject (band 1) glows full; DARKER regions
        // (band 3 = eye sockets / hollows) dim toward dark, so sockets read as hollows
        // rather than bright blocks — matching the source and the 3D cube.
        d = d * (100 - 40 * (uint256(band) - 1)) / 100; // band1=100% band2=60% band3=20%
        uint256 fo = 580 + d * 550 / 1000;    // fillBase .58 + density x fillScale .55
        if (fo > 1000) fo = 1000;             // fillCap 1
        uint256 so = fo * 16 / 10;            // rim opacity = fill x rimOp 1.6
        if (so > 1000) so = 1000;
        return string.concat(
            '<rect x="', (101 + col * 25).toString(), '" y="', (86 + row * 25).toString(),
            '" width="20" height="20" fill="rgb(', _glassFill(col, row, L), ')" fill-opacity="', _dec2(fo),
            '" stroke="#fff" stroke-opacity="', _dec2(so), '"/>'
        );
    }

    // "r,g,b" fill for a glass cell: light field -> saturate (bold hue) -> colour
    // gain (brightness) -> whiten. Matches the lab's col3().
    function _glassFill(uint256 col, uint256 row, uint256[6] memory L)
        private
        pure
        returns (string memory)
    {
        (uint256 R, uint256 G, uint256 B) = _lightColor(112 + col * 25, 97 + row * 25, L);
        (uint256 r, uint256 g, uint256 b) = _glassTone(R, G, B);
        return string.concat(r.toString(), ",", g.toString(), ",", b.toString());
    }

    function _glassTone(uint256 R, uint256 G, uint256 B)
        private
        pure
        returns (uint256, uint256, uint256)
    {
        int256 luma = (299 * int256(R) + 587 * int256(G) + 114 * int256(B)) / 1000;
        return (_glassChan(int256(R), luma), _glassChan(int256(G), luma), _glassChan(int256(B), luma));
    }

    // saturate 3, then colour gain 2.6 * (1 - whiten .1) = 2.34, then + 255*.1.
    // Signed: a saturated channel can dip below 0 before clamping.
    function _glassChan(int256 c, int256 luma) private pure returns (uint256) {
        int256 v = (luma + (c - luma) * 3) * 2340 / 1000 + 26;
        if (v < 0) return 0;
        if (v > 255) return 255;
        return uint256(v);
    }

    // RGB light field at (px,py) for the rotated triangle L = [Rx,Ry,Gx,Gy,Bx,By].
    // Each light a = R2/(R2+d^2); saturate to the dominant hue, then whiten where
    // lights overlap (scaled by whiteBloom .15).
    function _lightColor(uint256 px, uint256 py, uint256[6] memory L)
        private
        pure
        returns (uint256 R8, uint256 G8, uint256 B8)
    {
        uint256 r = _lightA(px, py, L[0], L[1]);
        uint256 g = _lightA(px, py, L[2], L[3]);
        uint256 b = _lightA(px, py, L[4], L[5]);
        uint256 mx = r;
        if (g > mx) mx = g;
        if (b > mx) mx = b;
        if (mx == 0) mx = 1;
        uint256 R = r * 10000 / mx;
        uint256 G = g * 10000 / mx;
        uint256 B = b * 10000 / mx;
        uint256 sum = r + g + b;
        uint256 white = (sum > 13000 ? (sum - 13000) / 2 : 0) * 15 / 100; // whiteBloom .15
        if (white > 10000) white = 10000;
        R = R + (10000 - R) * white / 10000;
        G = G + (10000 - G) * white / 10000;
        B = B + (10000 - B) * white / 10000;
        R8 = R * 255 / 10000;
        G8 = G * 255 / 10000;
        B8 = B * 255 / 10000;
    }

    function _lightA(uint256 px, uint256 py, uint256 lx, uint256 ly) private pure returns (uint256) {
        uint256 dx = px > lx ? px - lx : lx - px;
        uint256 dy = py > ly ? py - ly : ly - py;
        return GLASS_R2 * 10000 / (GLASS_R2 + dx * dx + dy * dy);
    }

    // Three light positions on a 120deg triangle, rotated `rot` degrees about the
    // centre. L = [Rx,Ry, Gx,Gy, Bx,By] in viewBox px.
    function _lights(uint256 rot) private pure returns (uint256[6] memory L) {
        L[0] = _lpos(GLASS_CX, _cos1e4(rot));       L[1] = _lpos(GLASS_CY, _sin1e4(rot));
        L[2] = _lpos(GLASS_CX, _cos1e4(rot + 120)); L[3] = _lpos(GLASS_CY, _sin1e4(rot + 120));
        L[4] = _lpos(GLASS_CX, _cos1e4(rot + 240)); L[5] = _lpos(GLASS_CY, _sin1e4(rot + 240));
    }

    function _lpos(int256 centre, int256 trig1e4) private pure returns (uint256) {
        return uint256(centre + GLASS_SPREAD * trig1e4 / 10000); // 200..1000, always > 0
    }

    // sin(deg) x10000 via Bhaskara I: sin x ~= 4x(180-x)/(40500 - x(180-x)).
    function _sin1e4(uint256 deg) private pure returns (int256) {
        deg = deg % 360;
        bool neg = deg >= 180;
        uint256 x = neg ? deg - 180 : deg;    // 0..179
        uint256 num = 4 * x * (180 - x);      // 0..32400
        uint256 den = 40500 - x * (180 - x);  // 32400..40500
        int256 s = int256(num * 10000 / den); // 0..10000
        return neg ? -s : s;
    }

    function _cos1e4(uint256 deg) private pure returns (int256) {
        return _sin1e4(deg + 90);
    }

    // Format an x1000 opacity fixed-point (0..1000) as an SVG decimal (".07", ".88", "1").
    function _dec2(uint256 fp) private pure returns (string memory) {
        if (fp >= 1000) return "1";
        uint256 d = fp / 10;
        return string.concat(".", d < 10 ? "0" : "", d.toString());
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

    // Forest: thin inward strands from active edge points to a hub, branching to
    // tips; each tip carries a turbulence particle-cloud (colour + white passes).
    // Two colour passes (walker rule): ~1 in 3 owned strands take the unique
    // (figure) plane colour, the rest the doubled side-plane colour, so the forest
    // reads e.g. "blue + 2x red" like the walkers. Each pass draws thin cores +
    // faint turbulence clouds (gradient #cg = unique, #cg2 = side). The wide blurred
    // glow pass was dropped (lab glowOp=0) — the thin core + soft cloud reads cleaner
    // and halves the strand element count.
    function _bitmapBit(bytes memory raw, uint256 index) private pure returns (bool) {
        uint256 byteIndex = index / 8;
        uint256 bitIndex = 7 - (index % 8);
        return (uint8(raw[byteIndex]) & (uint8(1) << uint8(bitIndex))) != 0;
    }


}

