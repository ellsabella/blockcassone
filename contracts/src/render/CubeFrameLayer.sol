// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";

/// @title CubeFrameLayer
/// @notice Stateless, swappable module that renders the cube frame: the green
/// border, pink street segments, and white node markers, on the 3 sides given by
/// the unique-plane `layout` (the open 4th side is bare). Drawn in 5 depth tiers
/// with the filtered tiers (#h/#p/#g) grouped so a rasterizer runs each blur once.
/// Filter ids are defined by the orchestrator's <defs>.
contract CubeFrameLayer {
    using Strings for uint256;

    function render(bytes32 seed, uint256 srcId, uint256 layout)
        external
        pure
        returns (string memory)
    {
        return string.concat(_frameStrokes(seed, srcId, layout), _frameNodes(seed, srcId, layout));
    }

    function _frameStrokes(bytes32 seed, uint256 srcId, uint256 layout)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">',
            '<g filter="url(#h)">', _strokeTier(seed, srcId, layout, 0), "</g>",
            '<g filter="url(#p)">', _strokeTier(seed, srcId, layout, 1), "</g>",
            '<g filter="url(#g)">', _strokeTier(seed, srcId, layout, 2), "</g>",
            _strokeTier(seed, srcId, layout, 3),
            _strokeTier(seed, srcId, layout, 4),
            "</g>"
        );
    }

    function _strokeTier(bytes32 seed, uint256 srcId, uint256 layout, uint256 tier)
        private
        pure
        returns (string memory)
    {
        string memory s =
            _svgPath(_borderPath(layout), _borderColor(tier), _tierWidth(tier), _borderOpacity(tier), "");
        for (uint256 edge = 0; edge < 3; edge++) {
            for (uint256 bit = 0; bit < 7; bit++) {
                if (!_active(seed, srcId, edge, bit)) continue;
                (uint256 x, uint256 y) = _coord(layout, edge, bit);
                s = string.concat(s, _accentStroke(_horiz(layout, edge), x, y, tier));
            }
        }
        return s;
    }

    function _accentStroke(bool horiz, uint256 x, uint256 y, uint256 tier)
        private
        pure
        returns (string memory)
    {
        string memory path;
        if (horiz) {
            uint256 x0 = x > 96 ? x - 96 : x;
            path = string.concat("M", x0.toString(), " ", y.toString(), "H", (x + 96).toString());
        } else {
            uint256 y0 = y > 96 ? y - 96 : y;
            path = string.concat("M", x.toString(), " ", y0.toString(), "V", (y + 96).toString());
        }
        return _svgPath(path, _accentColor(tier), _tierWidth(tier), _accentOpacity(tier), "");
    }

    function _frameNodes(bytes32 seed, uint256 srcId, uint256 layout)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            "<g>",
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
        if (tier == 0) return _circle(x, y, (r * 2).toString(), "#fff", ".12", "");
        if (tier == 1) return _circle(x, y, ((r * 3) / 2).toString(), "#fff", ".30", "");
        if (tier == 2) {
            return string.concat(
                _circle(x, y, r.toString(), "#fff", ".62", ""),
                _circle(x, y, (r / 2 + 3).toString(), "#fff", ".38", "")
            );
        }
        return _circle(x, y, (r / 3 + 2).toString(), "#fff", ".76", "");
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

    // --- shared edge-point math (also used by the forest layer) ---
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

    function _svgPath(
        string memory d,
        string memory color,
        string memory width,
        string memory opacity,
        string memory filter
    )
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<path d="',
            d,
            '" stroke="',
            color,
            '" stroke-width="',
            width,
            '" opacity="',
            opacity,
            '" stroke-linecap="round" stroke-linejoin="round"',
            bytes(filter).length == 0 ? "" : string.concat(' filter="', filter, '"'),
            "/>"
        );
    }

    function _circle(
        uint256 x,
        uint256 y,
        string memory radius,
        string memory color,
        string memory opacity,
        string memory filter
    )
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<circle cx="',
            x.toString(),
            '" cy="',
            y.toString(),
            '" r="',
            radius,
            '" fill="',
            color,
            '" opacity="',
            opacity,
            '"',
            bytes(filter).length == 0 ? "" : string.concat(' filter="', filter, '"'),
            "/>"
        );
    }

    function _tierWidth(uint256 tier) private pure returns (string memory) {
        if (tier == 0) return "12";
        if (tier == 1) return "7.5";
        if (tier == 2) return "5.2";
        if (tier == 3) return "3.4";
        return "1.65";
    }

    function _borderColor(uint256 tier) private pure returns (string memory) {
        if (tier == 3) return "#8dff98";
        if (tier == 4) return "#fff";
        return "#38ff4d";
    }

    function _borderOpacity(uint256 tier) private pure returns (string memory) {
        if (tier == 0) return ".12";
        if (tier == 1) return ".32";
        if (tier == 2) return ".92";
        if (tier == 3) return ".98";
        return ".55";
    }

    function _accentColor(uint256 tier) private pure returns (string memory) {
        if (tier == 0 || tier == 1) return "#ff1ba6";
        if (tier == 2) return "#ff3ab8";
        if (tier == 3) return "#ff2aa8";
        return "#ffc0ea";
    }

    function _accentOpacity(uint256 tier) private pure returns (string memory) {
        if (tier == 0) return ".18";
        if (tier == 1) return ".46";
        if (tier == 2) return ".98";
        if (tier == 3) return ".98";
        return ".46";
    }
}
