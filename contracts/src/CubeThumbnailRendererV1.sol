// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { StrBuf } from "./lib/StrBuf.sol";
import { NonNormieArt } from "./NonNormieArt.sol";

interface IThumbnailNormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

interface IThumbnailNonNormieArtStore {
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory);
}

// Swappable render modules (see contracts/src/render/). The orchestrator holds
// their addresses immutably; swapping a layer = deploy the new module + redeploy
// this thin orchestrator pointing at it + cubes.setRenderer(...).
interface ICubeHilbertGeometry {
    function motifLayout(uint256 slot) external pure returns (uint256);
    function mainAxis(uint256 slot) external pure returns (uint256);
}

interface ICubeFrameLayer {
    function render(bytes32 seed, uint256 srcId, uint256 layout, uint256 axis)
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

    constructor(
        CubeNFT cubes_,
        address normieStorage_,
        address nonNormieStore_,
        address geometry_,
        address frame_
    ) {
        cubes = cubes_;
        normieStorage = normieStorage_;
        nonNormieStore = nonNormieStore_;
        geometry = ICubeHilbertGeometry(geometry_);
        frame = ICubeFrameLayer(frame_);
    }

    function thumbnailSVG(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        return _renderSVG(data, _rawImageBytes(data, tokenId));
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
        return _renderSVG(data, NonNormieArt.toBinaryBitmap(tonalPayload));
    }

    function _renderSVG(CubeNFT.CubeData memory data, bytes memory raw)
        private
        view
        returns (string memory)
    {
        // This assembler keeps only data + raw live; each piece recomputes its own
        // (cheap) intermediates in its own frame. Holding the six path/colour
        // locals here overflows the legacy stack (no via-IR). View-only, so the
        // recomputation is free.
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            _svgDefs(data, raw),
            _svgForest(data),
            _svgBitmap(data, raw),
            _glassLayer(raw, data.sourceTokenId, data.seed),
            _svgLabel(data),
            _svgFrame(data),
            "</svg>"
        );
    }

    function _svgDefs(CubeNFT.CubeData memory data, bytes memory raw) private view returns (string memory) {
        uint256 axis = geometry.mainAxis(uint256(data.slot));
        return _thumbnailDefs(
            _bitmapPath(raw),
            _outlinePath(raw, data.sourceTokenId),
            _labelPath(data.sourceTokenId),
            _colour(axis)
        );
    }

    function _svgForest(CubeNFT.CubeData memory data) private view returns (string memory) {
        // Forest strands are Normie-only; non-Normie / customized cubes show only
        // the bare edge-point orbs (drawn by the frame layer).
        if (data.sourceKind != cubes.SOURCE_KIND_NORMIE()) return "";
        return _forestLayer(
            data,
            _colour(geometry.mainAxis(uint256(data.slot))),
            geometry.motifLayout(uint256(data.slot))
        );
    }

    function _svgBitmap(CubeNFT.CubeData memory data, bytes memory raw) private view returns (string memory) {
        return _thumbnailBitmap(
            _bitmapPath(raw),
            _outlinePath(raw, data.sourceTokenId),
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
        string memory planeColor
    )
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        bytes memory buf = StrBuf.alloc(
            8192 + bytes(bitmapPath).length + bytes(outlinePath).length + bytes(labelPath).length
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
        buf.cat('" stop-opacity=".82"/><stop offset=".4" stop-color="');
        buf.cat(planeColor);
        buf.cat('" stop-opacity=".36"/><stop offset="1" stop-color="');
        buf.cat(planeColor);
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

    function _thumbnailBitmap(
        string memory bitmapPath,
        string memory outlinePath,
        string memory planeColor
    )
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) {
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



    function _edgePointCoord(uint256 layout, uint256 edge, uint256 bit)
        private
        pure
        returns (uint256 x, uint256 y)
    {
        uint256 d = (bit + 1) * 125;
        uint256 e3 = (layout >> (edge * 3)) & 7;
        if ((e3 & 1) != 0) {
            // horizontal side: const y (top/bottom), x varies
            y = (e3 & 2) != 0 ? 85 : 1085;
            x = (e3 & 4) != 0 ? 100 + d : 1100 - d;
        } else {
            // vertical side: const x (left/right), y varies
            x = (e3 & 2) != 0 ? 1100 : 100;
            y = (e3 & 4) != 0 ? 1085 - d : 85 + d;
        }
    }

    // Per-side edge-point plan: orbs (2..6 of 7) + which subset THIS plane owns.
    // Keyed on the cube seed (per-cube variation) + the edge's canonical id so the
    // two faces of a shared edge agree (never-both). MUST stay byte-for-byte
    // identical to CubeFrameLayer._sidePlan and the JS viewer's selector.
    function _sidePlan(bytes32 seed, uint256 edge)
        private
        pure
        returns (uint256 orbMask, uint256 strandMask)
    {
        uint256 canon = edge == 0 ? 23 : (edge == 1 ? 34 : 45);
        uint256 h = uint256(keccak256(abi.encodePacked(seed, canon)));
        uint256 count = 2 + (h & 0xff) % 5; // 2..6 orbs on this side
        uint256 placed;
        for (uint256 i = 0; i < 7; i++) {
            uint256 needed = count - placed;
            if ((((h >> (8 + i * 8)) & 0xff) % (7 - i)) < needed) {
                orbMask |= (1 << i);
                placed++;
                if (edge == 1 || ((h >> (72 + i)) & 1) == 1) {
                    strandMask |= (1 << i);
                }
            }
        }
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

    function _outlinePath(bytes memory raw, uint256 normieId) private pure returns (string memory) {
        if (raw.length != 200) return "";

        // <= 1600 cells * 4 edges * 8 bytes = 51200; 64KB leaves ample slack.
        bytes memory buf = StrBuf.alloc(65536);
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
                if (_isLabelCell(normieId, row, col)) continue;
                if (!_bitmapBitAt(raw, row, col, 0, -1)) {
                    buf.cat(string.concat("M", col.toString(), " ", row.toString(), "v1"));
                }
                if (!_bitmapBitAt(raw, row, col, 0, 1)) {
                    buf.cat(string.concat("M", (col + 1).toString(), " ", row.toString(), "v1"));
                }
                if (!_bitmapBitAt(raw, row, col, -1, 0)) {
                    buf.cat(string.concat("M", col.toString(), " ", row.toString(), "h1"));
                }
                if (!_bitmapBitAt(raw, row, col, 1, 0)) {
                    buf.cat(string.concat("M", col.toString(), " ", (row + 1).toString(), "h1"));
                }
            }
        }
        return buf.str();
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

    function _glassLayer(bytes memory raw, uint256 normieId, bytes32 seed)
        private
        pure
        returns (string memory)
    {
        if (raw.length != 200) return "";

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
            if (!_bitmapBit(raw, i)) continue;
            uint256 col = i % 40;
            uint256 row = i / 40;
            if (_isLabelCell(normieId, row, col)) continue;
            if (_neigh8(raw, col, row) < GLASS_CONV_MIN) continue; // body cell
            if (uint256(keccak256(abi.encodePacked(seed, col, row))) % 100 >= GLASS_COVERAGE) continue;
            buf.cat(_glassRect(col, row, L));
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

    function _glassRect(uint256 col, uint256 row, uint256[6] memory L)
        private
        pure
        returns (string memory)
    {
        uint256 d = _glassDensity(col, row);  // 65..636 (x1000)
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

    function _neigh8(bytes memory raw, uint256 col, uint256 row) private pure returns (uint256 nb) {
        for (int256 dr = -1; dr <= 1; dr++) {
            for (int256 dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) continue;
                nb += _cellOn(raw, int256(col) + dc, int256(row) + dr);
            }
        }
    }

    function _cellOn(bytes memory raw, int256 c, int256 r) private pure returns (uint256) {
        if (c < 0 || c >= 40 || r < 0 || r >= 40) return 0;
        return _bitmapBit(raw, uint256(r) * 40 + uint256(c)) ? 1 : 0;
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
    function _forestLayer(CubeNFT.CubeData memory data, string memory planeColor, uint256 layout)
        private
        pure
        returns (string memory)
    {
        string memory glow = "";
        string memory core = "";
        string memory tips = "";
        // Strands sprout only at sub-slots this plane OWNS (strandMask). Bare orbs
        // (neighbour-owned, and empty slots) grow nothing — the frame layer draws
        // those nodes. The 2..6 count + ownership split now do all the thinning,
        // so no artificial cap.
        for (uint256 edge = 0; edge < 3; edge++) {
            (, uint256 strandMask) = _sidePlan(data.seed, edge);
            for (uint256 bit = 0; bit < 7; bit++) {
                if (((strandMask >> bit) & 1) == 0) continue;
                uint256 bi = edge * 7 + bit;
                glow = string.concat(glow, _treeStrands(data, bi, false, layout));
                core = string.concat(core, _treeStrands(data, bi, true, layout));
                tips = string.concat(tips, _treeTips(data, bi, layout));
            }
        }
        if (bytes(core).length == 0) return "";

        // No white sparkle pass — the single coloured cloud reads cleaner.
        return string.concat(
            '<g fill="none" stroke="', planeColor,
            '" stroke-width="1.4" opacity=".16" filter="url(#p)">', glow, "</g>",
            '<g fill="none" stroke="', planeColor,
            '" stroke-width=".5" opacity=".5" filter="url(#g)">', core, "</g>",
            '<g fill="url(#cg)" filter="url(#pc)">', tips, "</g>"
        );
    }

    function _treeHub(CubeNFT.CubeData memory data, uint256 bi, uint256 layout)
        private
        pure
        returns (uint256 rootX, uint256 rootY, uint256 hubX, uint256 hubY)
    {
        uint256 edge = bi / 7;
        (rootX, rootY) = _edgePointCoord(layout, edge, bi - edge * 7);
        uint256 trunkLen = 220 + _rand(data, bi + 80, 360);
        hubX = _inwardX(rootX, trunkLen, data, bi + 120);
        hubY = _inwardY(rootY, trunkLen, data, bi + 160);
    }

    function _treeTip(CubeNFT.CubeData memory data, uint256 bi, uint256 hubX, uint256 hubY, uint256 b)
        private
        pure
        returns (uint256 tipX, uint256 tipY)
    {
        uint256 len = 120 + _rand(data, bi + b * 41 + 200, 220);
        tipX = _offsetCanvas(hubX, data, bi + b * 59 + 260, len);
        tipY = _offsetCanvas(hubY, data, bi + b * 73 + 320, len);
    }

    // bunch=false -> one curve per segment (used by the blurred glow layer).
    // bunch=true  -> a 3-fibre bundle per segment (the visible core): fibres
    // share a base curve, converge at the root and fan slightly at the tip.
    function _treeStrands(CubeNFT.CubeData memory data, uint256 bi, bool bunch, uint256 layout)
        private
        pure
        returns (string memory)
    {
        (uint256 rootX, uint256 rootY, uint256 hubX, uint256 hubY) = _treeHub(data, bi, layout);
        string memory s = bunch
            ? _forestBunch(data, bi, rootX, rootY, hubX, hubY, 0)
            : _forestCurve(data, bi, rootX, rootY, hubX, hubY, 0);
        for (uint256 b = 0; b < 3; b++) {
            (uint256 tipX, uint256 tipY) = _treeTip(data, bi, hubX, hubY, b);
            s = string.concat(
                s,
                bunch
                    ? _forestBunch(data, bi, hubX, hubY, tipX, tipY, b + 1)
                    : _forestCurve(data, bi, hubX, hubY, tipX, tipY, b + 1)
            );
        }
        return s;
    }

    // A bundle of 2 fibres between the same endpoints. Each fibre shares the base
    // control points (same salt) and deviates by a small per-fibre jitter, so the
    // bundle is tight (a "rope") rather than a wide fan.
    function _forestBunch(
        CubeNFT.CubeData memory data,
        uint256 bi,
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2,
        uint256 salt
    )
        private
        pure
        returns (string memory s)
    {
        for (uint256 f = 0; f < 2; f++) {
            s = string.concat(s, _fibre(data, bi, x1, y1, x2, y2, salt, f));
        }
    }

    function _fibre(
        CubeNFT.CubeData memory data,
        uint256 bi,
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2,
        uint256 salt,
        uint256 f
    )
        private
        pure
        returns (string memory p)
    {
        // Build the path progressively with block-scoped locals so no more than a
        // couple of coordinates are live at once (avoids stack-too-deep without
        // via-IR). inner _offsetCanvas = shared base control point (same for all
        // fibres); outer = small per-fibre deviation (depends on f) -> tight bundle.
        p = string.concat('<path d="M', x1.toString(), " ", y1.toString(), "C");
        {
            uint256 cx1 = _offsetCanvas(_offsetCanvas(_mix(x1, x2, 34), data, bi + salt * 29 + 170, 80), data, bi + salt * 7 + f * 97 + 500, 11);
            uint256 cy1 = _offsetCanvas(_offsetCanvas(_mix(y1, y2, 34), data, bi + salt * 31 + 210, 80), data, bi + salt * 7 + f * 101 + 540, 11);
            p = string.concat(p, cx1.toString(), " ", cy1.toString(), " ");
        }
        {
            uint256 cx2 = _offsetCanvas(_offsetCanvas(_mix(x1, x2, 68), data, bi + salt * 37 + 250, 105), data, bi + salt * 7 + f * 103 + 580, 14);
            uint256 cy2 = _offsetCanvas(_offsetCanvas(_mix(y1, y2, 68), data, bi + salt * 41 + 290, 105), data, bi + salt * 7 + f * 107 + 620, 14);
            p = string.concat(p, cx2.toString(), " ", cy2.toString(), " ");
        }
        {
            // first fibre hits the exact tip; the others fan a little around it.
            uint256 ex = _offsetCanvas(x2, data, bi + f * 109 + 660, f == 0 ? 0 : 14);
            uint256 ey = _offsetCanvas(y2, data, bi + f * 113 + 700, f == 0 ? 0 : 14);
            p = string.concat(p, ex.toString(), " ", ey.toString(), '"/>');
        }
    }

    function _treeTips(CubeNFT.CubeData memory data, uint256 bi, uint256 layout)
        private
        pure
        returns (string memory)
    {
        (,, uint256 hubX, uint256 hubY) = _treeHub(data, bi, layout);
        string memory t = "";
        for (uint256 b = 0; b < 3; b++) {
            (uint256 tipX, uint256 tipY) = _treeTip(data, bi, hubX, hubY, b);
            t = string.concat(t, _tipEllipse(data, bi, b, tipX, tipY));
        }
        return t;
    }

    // Two elongated, rotated lumps (a main + a smaller offset one) per tip, so the
    // turbulence cloud reads as an irregular organic cluster, not a uniform oval.
    // The white sparkle pass was dropped, so this is net-neutral on element count.
    function _tipEllipse(CubeNFT.CubeData memory data, uint256 bi, uint256 b, uint256 x, uint256 y)
        private
        pure
        returns (string memory)
    {
        return string.concat(_lumpA(data, bi, b, x, y), _lumpB(data, bi, b, x, y));
    }

    // main lump at the tip (sizes computed inline to keep the stack shallow)
    function _lumpA(CubeNFT.CubeData memory data, uint256 bi, uint256 b, uint256 x, uint256 y)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<ellipse cx="', x.toString(), '" cy="', y.toString(),
            '" rx="', (38 + _rand(data, bi + b * 80 + 360, 30)).toString(),
            '" ry="', (11 + _rand(data, bi + b * 90 + 420, 13)).toString(),
            '" transform="rotate(', _rand(data, bi + b * 100 + 480, 180).toString(),
            " ", x.toString(), " ", y.toString(), ')"/>'
        );
    }

    // smaller offset lump -> irregular cluster
    function _lumpB(CubeNFT.CubeData memory data, uint256 bi, uint256 b, uint256 x, uint256 y)
        private
        pure
        returns (string memory)
    {
        uint256 ox = _offsetCanvas(x, data, bi + b * 31 + 540, 25);
        uint256 oy = _offsetCanvas(y, data, bi + b * 37 + 580, 25);
        return string.concat(
            '<ellipse cx="', ox.toString(), '" cy="', oy.toString(),
            '" rx="', (22 + _rand(data, bi + b * 41 + 620, 22)).toString(),
            '" ry="', (7 + _rand(data, bi + b * 47 + 660, 10)).toString(),
            '" transform="rotate(', _rand(data, bi + b * 53 + 700, 180).toString(),
            " ", ox.toString(), " ", oy.toString(), ')"/>'
        );
    }

    function _forestCurve(
        CubeNFT.CubeData memory data,
        uint256 bi,
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2,
        uint256 salt
    )
        private
        pure
        returns (string memory)
    {
        uint256 cx1 = _offsetCanvas(_mix(x1, x2, 34), data, bi + salt * 29 + 170, 90);
        uint256 cy1 = _offsetCanvas(_mix(y1, y2, 34), data, bi + salt * 31 + 210, 90);
        uint256 cx2 = _offsetCanvas(_mix(x1, x2, 68), data, bi + salt * 37 + 250, 115);
        uint256 cy2 = _offsetCanvas(_mix(y1, y2, 68), data, bi + salt * 41 + 290, 115);
        return string.concat(
            '<path d="M',
            x1.toString(),
            " ",
            y1.toString(),
            "C",
            cx1.toString(),
            " ",
            cy1.toString(),
            " ",
            cx2.toString(),
            " ",
            cy2.toString(),
            " ",
            x2.toString(),
            " ",
            y2.toString(),
            '"/>'
        );
    }

    function _inwardX(uint256 x, uint256 len, CubeNFT.CubeData memory data, uint256 salt)
        private
        pure
        returns (uint256)
    {
        uint256 target = _mix(x, 600, 55);
        return _offsetCanvas(target, data, salt, len / 3);
    }

    function _inwardY(uint256 y, uint256 len, CubeNFT.CubeData memory data, uint256 salt)
        private
        pure
        returns (uint256)
    {
        uint256 target = _mix(y, 585, 55);
        return _offsetCanvas(target, data, salt, len / 3);
    }

    function _mix(uint256 a, uint256 b, uint256 pct) private pure returns (uint256) {
        return (a * (100 - pct) + b * pct) / 100;
    }

    function _offsetCanvas(uint256 base, CubeNFT.CubeData memory data, uint256 salt, uint256 magnitude)
        private
        pure
        returns (uint256)
    {
        uint256 spread = magnitude * 2 + 1;
        uint256 v = _rand(data, salt, spread);
        if (v >= magnitude) return _clampCanvas(base + (v - magnitude));
        uint256 delta = magnitude - v;
        return _clampCanvas(base > delta ? base - delta : 0);
    }

    function _clampCanvas(uint256 v) private pure returns (uint256) {
        if (v < 105) return 105;
        if (v > 1095) return 1095;
        return v;
    }

    function _rand(CubeNFT.CubeData memory data, uint256 salt, uint256 max)
        private
        pure
        returns (uint256)
    {
        if (max == 0) return 0;
        return uint256(keccak256(abi.encodePacked(data.seed, data.sourceTokenId, salt))) % max;
    }

    function _bitmapBit(bytes memory raw, uint256 index) private pure returns (bool) {
        uint256 byteIndex = index / 8;
        uint256 bitIndex = 7 - (index % 8);
        return (uint8(raw[byteIndex]) & (uint8(1) << uint8(bitIndex))) != 0;
    }

    function _bitmapBitAt(bytes memory raw, uint256 row, uint256 col, int256 rowDelta, int256 colDelta)
        private
        pure
        returns (bool)
    {
        int256 nextRow = int256(row) + rowDelta;
        int256 nextCol = int256(col) + colDelta;
        if (nextRow < 0 || nextRow >= 40 || nextCol < 0 || nextCol >= 40) return false;
        return _bitmapBit(raw, uint256(nextRow) * 40 + uint256(nextCol));
    }

}

