// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";

/// @title CubeFrameLayer
/// @notice Stateless, swappable module that renders the cube frame: a single
/// border line tracing the unique plane's 3 sides (the open 4th side is bare),
/// plus white node markers at the active edge points + corners. No street
/// segments. Drawn in 5 depth tiers with the filtered tiers (#h/#p/#g) grouped so
/// a rasterizer runs each blur once; filter ids come from the orchestrator <defs>.
///
/// The border is coloured the RGB-wheel OPPOSITE of the cube's plane colour
/// (axis 0 red -> cyan, 1 green -> pink/magenta, 2 blue -> yellow), so it
/// contrasts the figure/forest which carry the plane colour.
///
/// Constant presentation attributes (stroke-linecap/linejoin, stroke-width, fill)
/// are hoisted to the enclosing <g> so they aren't repeated on every element.
contract CubeFrameLayer {
    using Strings for uint256;

    function render(bytes32 seed, uint256 srcId, uint256 layout, uint256 axis)
        external
        pure
        returns (string memory)
    {
        return string.concat(_frameStrokes(layout, axis), _frameNodes(seed, srcId, layout));
    }

    // The border line, one path per depth tier (no street accents).
    function _frameStrokes(uint256 layout, uint256 axis) private pure returns (string memory) {
        string memory bp = _borderPath(layout);
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">',
            '<g stroke-width="12" filter="url(#h)">', _path(bp, _borderColor(0, axis), ".12"), "</g>",
            '<g stroke-width="7.5" filter="url(#p)">', _path(bp, _borderColor(1, axis), ".32"), "</g>",
            '<g stroke-width="5.2" filter="url(#g)">', _path(bp, _borderColor(2, axis), ".92"), "</g>",
            '<g stroke-width="3.4">', _path(bp, _borderColor(3, axis), ".98"), "</g>",
            '<g stroke-width="1.65">', _path(bp, _borderColor(4, axis), ".55"), "</g>",
            "</g>"
        );
    }

    function _frameNodes(bytes32 seed, uint256 srcId, uint256 layout)
        private
        pure
        returns (string memory)
    {
        // fill:#fff hoisted to the outer group; tier groups carry the filter.
        return string.concat(
            '<g fill="#fff">',
            '<g filter="url(#h)">', _nodeTier(seed, srcId, layout, 0), "</g>",
            '<g filter="url(#p)">', _nodeTier(seed, srcId, layout, 1), "</g>",
            '<g filter="url(#g)">', _nodeTier(seed, srcId, layout, 2), "</g>",
            _nodeTier(seed, srcId, layout, 3),
            "</g>"
        );
    }

    function _nodeTier(bytes32 seed, uint256 srcId, uint256 layout, uint256 tier)
        private
        pure
        returns (string memory)
    {
        string memory s = string.concat(
            _nodeCircle(100, 85, 14, tier),
            _nodeCircle(1100, 85, 14, tier),
            _nodeCircle(1100, 1085, 14, tier),
            _nodeCircle(100, 1085, 14, tier)
        );
        for (uint256 edge = 0; edge < 3; edge++) {
            for (uint256 bit = 0; bit < 7; bit++) {
                if (!_active(seed, srcId, edge, bit)) continue;
                (uint256 x, uint256 y) = _coord(layout, edge, bit);
                s = string.concat(s, _nodeCircle(x, y, _horiz(layout, edge) ? 9 : 13, tier));
            }
        }
        return s;
    }

    function _nodeCircle(uint256 x, uint256 y, uint256 r, uint256 tier)
        private
        pure
        returns (string memory)
    {
        if (tier == 0) return _circle(x, y, r * 2, ".12");
        if (tier == 1) return _circle(x, y, (r * 3) / 2, ".30");
        if (tier == 2) {
            return string.concat(_circle(x, y, r, ".62"), _circle(x, y, r / 2 + 3, ".38"));
        }
        return _circle(x, y, r / 3 + 2, ".76");
    }

    // --- border: the unique plane's 3 sides as full-length segments ---
    function _borderPath(uint256 layout) private pure returns (string memory) {
        return string.concat(_sidePath(layout, 0), _sidePath(layout, 1), _sidePath(layout, 2));
    }

    function _sidePath(uint256 layout, uint256 edge) private pure returns (string memory) {
        uint256 e3 = (layout >> (edge * 3)) & 7;
        if ((e3 & 1) != 0) {
            return (e3 & 2) != 0 ? "M100 85H1100" : "M100 1085H1100";
        }
        return (e3 & 2) != 0 ? "M1100 85V1085" : "M100 85V1085";
    }

    // The complement of the plane colour: red->cyan, green->pink, blue->yellow.
    // Tiers 0-2 use the vivid complement; tier 3 a lighter tint; tier 4 white core.
    function _borderColor(uint256 tier, uint256 axis) private pure returns (string memory) {
        if (tier == 4) return "#fff";
        if (tier == 3) {
            if (axis == 0) return "#8df7ff"; // light cyan
            if (axis == 1) return "#ff8dd1"; // light pink
            return "#fff18d"; // light yellow
        }
        if (axis == 0) return "#19f0ff"; // cyan   (opp red)
        if (axis == 1) return "#ff19a6"; // pink   (opp green)
        return "#ffe619"; // yellow (opp blue)
    }

    // --- shared edge-point math (active points = node positions) ---
    function _active(bytes32 seed, uint256 srcId, uint256 edge, uint256 bit)
        private
        pure
        returns (bool)
    {
        return uint256(keccak256(abi.encodePacked(seed, srcId, edge, bit))) % 3 != 0;
    }

    function _coord(uint256 layout, uint256 edge, uint256 bit)
        private
        pure
        returns (uint256 x, uint256 y)
    {
        uint256 d = (bit + 1) * 125;
        uint256 e3 = (layout >> (edge * 3)) & 7;
        if ((e3 & 1) != 0) {
            y = (e3 & 2) != 0 ? 85 : 1085;
            x = (e3 & 4) != 0 ? 100 + d : 1100 - d;
        } else {
            x = (e3 & 2) != 0 ? 1100 : 100;
            y = (e3 & 4) != 0 ? 1085 - d : 85 + d;
        }
    }

    function _horiz(uint256 layout, uint256 edge) private pure returns (bool) {
        return ((layout >> (edge * 3)) & 1) == 1;
    }

    function _path(string memory d, string memory color, string memory opacity)
        private
        pure
        returns (string memory)
    {
        return string.concat('<path d="', d, '" stroke="', color, '" opacity="', opacity, '"/>');
    }

    function _circle(uint256 x, uint256 y, uint256 r, string memory opacity)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<circle cx="', x.toString(), '" cy="', y.toString(), '" r="', r.toString(),
            '" opacity="', opacity, '"/>'
        );
    }
}
