// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";

/// @title CubeFrameLayer
/// @notice Stateless, swappable module that renders the cube frame: a single
/// border line tracing the unique plane's 3 sides (the open 4th side is bare),
/// plus white orb markers at the active edge points + corners.
///
/// Both use the same additive-neon construction as the figure (see
/// CubeThumbnailRendererV1): a thin bright core under a screen-composited glow,
/// with a soft-blurred white core. Filter ids come from the orchestrator <defs>:
///   #nfF / #wfF — frame line glow / soft white core
///   #pfP / #pwP — edge-orb glow / soft white core
/// Drawn in raw 1200-space, so all widths/radii/blur are in viewBox px
/// (= the lab's 40-grid units x 25).
///
/// The border (hilbert) hue is paired against the cube's plane colour, never the
/// same as that plane's normie art: green(1) -> pink, red(0)/blue(2) -> green.
/// The white core supplies the hot centre.
contract CubeFrameLayer {
    using Strings for uint256;

    function render(bytes32 seed, uint256, uint256 layout, uint256 axis)
        external
        pure
        returns (string memory)
    {
        return string.concat(_frameStrokes(layout, axis), _frameNodes(seed, layout));
    }

    // The border line: bright core under a screen glow, soft white core on top.
    function _frameStrokes(uint256 layout, uint256 axis) private pure returns (string memory) {
        string memory bp = _borderPath(layout);
        string memory hue = _borderHue(axis);
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">',
            '<path d="', bp, '" stroke="', hue, '" stroke-width="8.625" filter="url(#nfF)"/>',
            '<path d="', bp, '" stroke="', hue, '" stroke-width="7.5"/>',
            '<path d="', bp, '" stroke="#fff" stroke-width="1.875" opacity=".86" filter="url(#wfF)"/>',
            "</g>"
        );
    }

    // White edge-point orbs: an additive glow group under a soft white core group.
    function _frameNodes(bytes32 seed, uint256 layout) private pure returns (string memory) {
        return string.concat(
            '<g fill="#fff" filter="url(#pfP)">', _nodeCircles(seed, layout, 10), "</g>",
            '<g fill="#fff" opacity=".44" filter="url(#pwP)">', _nodeCircles(seed, layout, 6), "</g>"
        );
    }

    // An orb at every corner + every PLACED sub (this-plane- or neighbour-owned).
    function _nodeCircles(bytes32 seed, uint256 layout, uint256 r) private pure returns (string memory) {
        string memory s = string.concat(
            _circle(100, 85, r), _circle(1100, 85, r), _circle(1100, 1085, r), _circle(100, 1085, r)
        );
        for (uint256 edge = 0; edge < 3; edge++) {
            (uint256 orbMask,) = _sidePlan(seed, edge);
            for (uint256 bit = 0; bit < 7; bit++) {
                if (((orbMask >> bit) & 1) == 0) continue;
                (uint256 x, uint256 y) = _coord(layout, edge, bit);
                s = string.concat(s, _circle(x, y, r));
            }
        }
        return s;
    }

    function _circle(uint256 x, uint256 y, uint256 r) private pure returns (string memory) {
        return string.concat(
            '<circle cx="', x.toString(), '" cy="', y.toString(), '" r="', r.toString(), '"/>'
        );
    }

    function _borderHue(uint256 axis) private pure returns (string memory) {
        // Frame hue is never the same colour as that plane's normie art:
        // green(1) figure -> pink border; red(0)/blue(2) figure -> green border.
        return axis == 1 ? "#ff19a6" : "#1aff38";
    }

    // --- border: the front plane's 3 sides as a fixed ∪ opening at the TOP ---
    // The 2.5D depth wireframe always recedes over the top edge (the Hilbert path exits the
    // front plane there), so the front frame is normalised to bottom + left + right with the
    // top OPEN — regardless of the motif's 3D orientation. Matches the fixed FRAME_PATH in
    // tmp/line-lab.html and keeps the wireframe continuous with the depth receders. (`layout`
    // no longer steers the screen orientation; kept in the signature for interface stability.)
    function _borderPath(uint256) private pure returns (string memory) {
        return "M100 1085H1100M100 85V1085M1100 85V1085";
    }

    // --- shared edge-point plan (orbs + ownership) ----------------------------
    // Per side, pick 2..6 of the 7 sub-slots as orbs, then assign ownership.
    // Keyed on the cube seed + the edge's canonical identity (2-3 / 3-4 / 4-5) so
    // the two faces sharing an edge resolve the SAME plan. MUST stay byte-for-byte
    // identical to the orchestrator's copy and the JS viewer's selector.
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
                    strandMask |= (1 << i); // own edge, or plane-1 owns this shared sub
                }
            }
        }
    }

    // Edge-point placement on the fixed open-top ∪: canonical edge 0=bottom, 1=left, 2=right
    // (matches _borderPath + tmp/line-lab.html). The seed still selects WHICH sub-slots get an
    // orb (via _sidePlan); only the screen side is normalised. `layout` is unused now.
    function _coord(uint256, uint256 edge, uint256 bit)
        private
        pure
        returns (uint256 x, uint256 y)
    {
        uint256 d = (bit + 1) * 125;
        if (edge == 0) {
            x = 100 + d;
            y = 1085; // bottom
        } else if (edge == 1) {
            x = 100; // left
            y = 85 + d;
        } else {
            x = 1100; // right
            y = 85 + d;
        }
    }
}
