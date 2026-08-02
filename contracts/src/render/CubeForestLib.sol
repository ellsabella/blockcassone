// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "../CubeNFT.sol";

/// @notice The Normie thumbnail's forest layer (owned strands + turbulence-cloud tips),
///         extracted verbatim from CubeThumbnailRendererV1 into an external library so
///         its bytecode lives here (delegatecall) instead of inflating the renderer past
///         the 24 KB EIP-170 limit. Pure geometry/SVG only — no state, immutables, or
///         cross-contract reads — so behaviour is byte-identical to the inline version.
library CubeForestLib {
    using Strings for uint256;

    /// @notice Full forest SVG for a Normie cube: two colour passes (unique/figure hue
    ///         + doubled side hue) over the plane's owned edge-point strands.
    function render(
        CubeNFT.CubeData memory data,
        string memory planeColor,
        string memory sideColor,
        uint256 layout
    ) public pure returns (string memory) {
        return string.concat(
            _forestPass(data, layout, planeColor, "url(#cg)", true),
            _forestPass(data, layout, sideColor, "url(#cg2)", false)
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

    // Render the owned strands whose colour-class matches `unique`. Strands sprout
    // only at sub-slots this plane OWNS (strandMask); the 2..6 count + ownership
    // split do the thinning, so no artificial cap.
    function _forestPass(
        CubeNFT.CubeData memory data,
        uint256 layout,
        string memory hue,
        string memory cloud,
        bool unique
    ) private pure returns (string memory) {
        string memory core = "";
        string memory tips = "";
        for (uint256 edge = 0; edge < 3; edge++) {
            (, uint256 strandMask) = _sidePlan(data.seed, edge);
            for (uint256 bit = 0; bit < 7; bit++) {
                if (((strandMask >> bit) & 1) == 0) continue;
                uint256 bi = edge * 7 + bit;
                if (_forestIsUnique(data, bi) != unique) continue;
                core = string.concat(core, _treeStrands(data, bi, layout));
                tips = string.concat(tips, _treeTips(data, bi, layout));
            }
        }
        if (bytes(core).length == 0) return "";
        return string.concat(
            '<g fill="none" stroke="', hue,
            '" stroke-width=".7" opacity=".3" filter="url(#g)">', core, "</g>",
            '<g fill="', cloud, '" filter="url(#pc)">', tips, "</g>"
        );
    }

    // ~1 in 3 owned strands are the unique (figure) colour; the rest the doubled
    // side colour (walker-rule 1:2 majority). Deterministic per cube + edge slot.
    function _forestIsUnique(CubeNFT.CubeData memory data, uint256 bi) private pure returns (bool) {
        return _rand(data, bi + 777, 3) == 0;
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
        // Tips fan OUTWARD from the cube centre so the canopy spills toward (and
        // over) the edge into the margin — the "extends beyond the cube" look.
        uint256 len = 160 + _rand(data, bi + b * 41 + 200, 300);
        tipX = _outwardCanvas(hubX, 600, data, bi + b * 59 + 260, len);
        tipY = _outwardCanvas(hubY, 585, data, bi + b * 73 + 320, len);
    }

    // A 2-fibre bundle per segment (the visible core): fibres share a base curve,
    // converge at the shared nodes and fan slightly at the tip. Trunk (root->hub)
    // + 3 branches (hub->tip) — the bundle converges at the hub then fans out.
    function _treeStrands(CubeNFT.CubeData memory data, uint256 bi, uint256 layout)
        private
        pure
        returns (string memory)
    {
        (uint256 rootX, uint256 rootY, uint256 hubX, uint256 hubY) = _treeHub(data, bi, layout);
        string memory s = _forestBunch(data, bi, rootX, rootY, hubX, hubY, 0);
        for (uint256 b = 0; b < 3; b++) {
            (uint256 tipX, uint256 tipY) = _treeTip(data, bi, hubX, hubY, b);
            s = string.concat(s, _forestBunch(data, bi, hubX, hubY, tipX, tipY, b + 1));
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
            '" rx="', (52 + _rand(data, bi + b * 80 + 360, 40)).toString(),
            '" ry="', (16 + _rand(data, bi + b * 90 + 420, 18)).toString(),
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
        uint256 ox = _offsetCanvas(x, data, bi + b * 31 + 540, 32);
        uint256 oy = _offsetCanvas(y, data, bi + b * 37 + 580, 32);
        return string.concat(
            '<ellipse cx="', ox.toString(), '" cy="', oy.toString(),
            '" rx="', (32 + _rand(data, bi + b * 41 + 620, 28)).toString(),
            '" ry="', (11 + _rand(data, bi + b * 47 + 660, 13)).toString(),
            '" transform="rotate(', _rand(data, bi + b * 53 + 700, 180).toString(),
            " ", ox.toString(), " ", oy.toString(), ')"/>'
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

    // Widened from [105,1095] to [8,1192]: strands/clouds may now spill past the
    // frame border (~105..1095) into the surrounding margin, up to the viewBox edge.
    function _clampCanvas(uint256 v) private pure returns (uint256) {
        if (v < 8) return 8;
        if (v > 1192) return 1192;
        return v;
    }

    // Push `coord` AWAY from `center` by ~len (plus jitter), clamped to canvas, so
    // branch tips / canopy clouds drift toward the perimeter and into the margin.
    function _outwardCanvas(uint256 coord, uint256 center, CubeNFT.CubeData memory data, uint256 salt, uint256 len)
        private
        pure
        returns (uint256)
    {
        uint256 push = len / 2 + _rand(data, salt, len);
        if (coord >= center) return _clampCanvas(coord + push);
        return _clampCanvas(coord > push ? coord - push : 0);
    }

    function _rand(CubeNFT.CubeData memory data, uint256 salt, uint256 max)
        private
        pure
        returns (uint256)
    {
        if (max == 0) return 0;
        return uint256(keccak256(abi.encodePacked(data.seed, data.sourceTokenId, salt))) % max;
    }
}
