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
/// The border (hilbert) hue is paired against the cube's plane colour:
/// axis 0 red -> green, 1 green -> cyan, 2 blue -> pink. Tiers stay coloured to
/// the core (no pure white) so the glow reads as colour, not white haze.
///
/// Constant presentation attributes (stroke-linecap/linejoin, stroke-width, fill)
/// are hoisted to the enclosing <g> so they aren't repeated on every element.
contract CubeFrameLayer {
    using Strings for uint256;

    function render(bytes32 seed, uint256, uint256 layout, uint256 axis)
        external
        pure
        returns (string memory)
    {
        return string.concat(_frameStrokes(layout, axis), _frameNodes(seed, layout));
    }

    // The border line, one path per depth tier (no street accents).
    function _frameStrokes(uint256 layout, uint256 axis) private pure returns (string memory) {
        string memory bp = _borderPath(layout);
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">',
            '<g stroke-width="14.4" filter="url(#h)">', _path(bp, _borderColor(0, axis), ".12"), "</g>",
            '<g stroke-width="9" filter="url(#p)">', _path(bp, _borderColor(1, axis), ".32"), "</g>",
            '<g stroke-width="6.24" filter="url(#g)">', _path(bp, _borderColor(2, axis), ".92"), "</g>",
            '<g stroke-width="4.08">', _path(bp, _borderColor(3, axis), ".98"), "</g>",
            '<g stroke-width="1.98">', _path(bp, _borderColor(4, axis), ".55"), "</g>",
            "</g>"
        );
    }

    function _frameNodes(bytes32 seed, uint256 layout)
        private
        pure
        returns (string memory)
    {
        // fill:#fff hoisted to the outer group; tier groups carry the filter.
        return string.concat(
            '<g fill="#fff">',
            '<g filter="url(#h)">', _nodeTier(seed, layout, 0), "</g>",
            '<g filter="url(#p)">', _nodeTier(seed, layout, 1), "</g>",
            '<g filter="url(#g)">', _nodeTier(seed, layout, 2), "</g>",
            _nodeTier(seed, layout, 3),
            "</g>"
        );
    }

    function _nodeTier(bytes32 seed, uint256 layout, uint256 tier)
        private
        pure
        returns (string memory)
    {
        // An orb at every PLACED sub (this-plane- or neighbour-owned). The forest
        // layer grows strands only on the subset this plane owns; the rest stay
        // bare orbs (the visual tell that the point belongs to the adjacent face).
        string memory s = string.concat(
            _nodeCircle(100, 85, 14, tier),
            _nodeCircle(1100, 85, 14, tier),
            _nodeCircle(1100, 1085, 14, tier),
            _nodeCircle(100, 1085, 14, tier)
        );
        for (uint256 edge = 0; edge < 3; edge++) {
            (uint256 orbMask,) = _sidePlan(seed, edge);
            for (uint256 bit = 0; bit < 7; bit++) {
                if (((orbMask >> bit) & 1) == 0) continue;
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

    // Hilbert/frame hue paired against the figure colour:
    //   axis 0 (red figure)   -> green
    //   axis 1 (green figure) -> pink
    //   axis 2 (blue figure)  -> pink
    // Tiers stay coloured all the way to the core (no pure white) so the glow
    // reads as colour, not white haze.
    function _borderColor(uint256 tier, uint256 axis) private pure returns (string memory) {
        // tier 4 is the thin hot core: brighter/lighter but still clearly the hue.
        // tiers 0-3 (the blurred glow AND the crisp dominant line) stay fully
        // saturated, so the border reads as vivid colour rather than a pale tint
        // (the reference keeps its crisp line vivid, only a thin core near-white).
        if (tier == 4) {
            if (axis == 0) return "#7dffaa"; // bright green core
            return "#ff7ac4"; // bright pink core
        }
        if (axis == 0) return "#1fff66"; // green
        return "#ff19a6"; // pink
    }

    // --- shared edge-point plan (orbs + ownership) ----------------------------
    // Per side, pick 2..6 of the 7 sub-slots as orbs, then assign ownership.
    // h = keccak(seed, canonical-edge-id): keyed on the cube seed (per-cube
    // variation) and the edge's canonical identity (2-3 / 3-4 / 4-5) so the two
    // faces sharing an edge resolve the SAME plan -> a sub is owned by exactly one
    // plane, never both. strandMask is the subset this (the unique) plane owns:
    // the own edge (3-4) sprouts every orb; shared edges sprout only owner-bit-1.
    // MUST stay byte-for-byte identical to the orchestrator's copy and the JS
    // viewer's selector, or 2D/3D diverge.
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
            // exact sequential selection: include slot i with prob needed/remaining
            if ((((h >> (8 + i * 8)) & 0xff) % (7 - i)) < needed) {
                orbMask |= (1 << i);
                placed++;
                if (edge == 1 || ((h >> (72 + i)) & 1) == 1) {
                    strandMask |= (1 << i); // own edge, or plane-1 owns this shared sub
                }
            }
        }
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
