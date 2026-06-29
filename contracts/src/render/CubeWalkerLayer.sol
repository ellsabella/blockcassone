// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { StrBuf } from "../lib/StrBuf.sol";

/// @title CubeWalkerLayer
/// @notice Stateless module that renders the Normie "stone walker" lines. Front
/// (unique-plane) walks emerge mid-body in `figCol`; side walks (the doubled-axis
/// `sideCol`) enter straight from opposite edges then tour. Seeded 2D approximation
/// of the 3D voxel walk. Split out of CubeThumbnailRendererV1 to stay under the
/// 24KB contract-size limit; the orchestrator passes the resolved axis colours.
/// Built with StrBuf (one cat per piece) so the optimizer can't merge concats into
/// an over-deep frame (no via-IR). Tuned in tmp/line-lab.html.
contract CubeWalkerLayer {
    using Strings for uint256;
    using StrBuf for bytes;

    uint256 private constant WK_FRONT = 11;    // mid-body walks (figure colour)
    uint256 private constant WK_SIDE = 23;     // edge-entry walks (side colour)
    uint256 private constant WK_STRAIGHT = 16; // max straight steps before touring
    uint256 private constant WK_STEPS = 10;    // tour steps
    uint256 private constant WK_TURN = 40;     // % chance to turn each tour step

    function render(bytes memory raw, bytes32 seed, string memory figCol, string memory sideCol)
        external
        pure
        returns (string memory)
    {
        if (raw.length != 200) return "";
        string memory frontD = _walkFront(raw, seed);
        string memory sideD = _walkSides(raw, seed);
        if (bytes(frontD).length == 0 && bytes(sideD).length == 0) return "";
        bytes memory buf = StrBuf.alloc(bytes(frontD).length + bytes(sideD).length + 2048);
        buf.cat('<defs><filter id="wk" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".02" result="b"/><feColorMatrix in="b" type="matrix" values="4.5 0 0 0 0 0 4.5 0 0 0 0 0 4.5 0 0 0 0 0 1 0"/></filter><path id="ws" d="');
        buf.cat(sideD);
        buf.cat('"/><path id="wf" d="');
        buf.cat(frontD);
        buf.cat('"/></defs><g transform="translate(100 85) scale(25)" fill="none" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:screen">');
        _walkStrokes(buf, "ws", sideCol);
        _walkStrokes(buf, "wf", figCol);
        buf.cat("</g>");
        return buf.str();
    }

    // The 3 stroke passes (glow / bobble / core) for one walk path, one cat each.
    function _walkStrokes(bytes memory buf, string memory ref, string memory col) private pure {
        buf.cat('<use href="#'); buf.cat(ref); buf.cat('" stroke="'); buf.cat(col); buf.cat('" stroke-width=".11" opacity=".54" filter="url(#wk)"/>');
        buf.cat('<use href="#'); buf.cat(ref); buf.cat('" stroke="'); buf.cat(col); buf.cat('" stroke-width=".09" stroke-dasharray="0 .8" opacity=".82" filter="url(#wk)"/>');
        buf.cat('<use href="#'); buf.cat(ref); buf.cat('" stroke="'); buf.cat(col); buf.cat('" stroke-width=".03" opacity=".44"/>');
    }

    function _catXY(bytes memory buf, string memory cmd, uint256 x, uint256 y) private pure {
        buf.cat(cmd);
        buf.cat(x.toString());
        buf.cat(" ");
        buf.cat(y.toString());
    }

    function _walkHitsBody(bytes memory raw, uint256 col, uint256 row) private pure returns (bool) {
        return _bitmapBit(raw, row * 40 + col) && _neigh8(raw, col, row) >= 3;
    }

    function _walkFront(bytes memory raw, bytes32 seed) private pure returns (string memory) {
        bytes memory buf = StrBuf.alloc(8192);
        uint256[] memory cells = new uint256[](1600);
        uint256 n;
        for (uint256 i = 0; i < 1600; i++) {
            if (_walkHitsBody(raw, i % 40, i / 40)) cells[n++] = i;
        }
        if (n == 0) return "";
        for (uint256 w = 0; w < WK_FRONT; w++) {
            uint256 h = uint256(keccak256(abi.encodePacked(seed, uint256(0), w)));
            _frontWalk(buf, cells[h % n], h);
        }
        return buf.str();
    }

    function _frontWalk(bytes memory buf, uint256 ci, uint256 h) private pure {
        _catXY(buf, "M", ci % 40, ci / 40);
        _tourSteps(buf, ci % 40, ci / 40, h >> 8, (h >> 4) & 3);
    }

    function _walkSides(bytes memory raw, bytes32 seed) private pure returns (string memory) {
        bytes memory buf = StrBuf.alloc(16384);
        uint256[] memory rows = new uint256[](40);
        uint256 nr;
        for (uint256 r = 0; r < 40; r++) {
            for (uint256 c = 0; c < 40; c++) {
                if (_walkHitsBody(raw, c, r)) { rows[nr++] = r; break; }
            }
        }
        if (nr == 0) return "";
        for (uint256 w = 0; w < WK_SIDE; w++) {
            uint256 h = uint256(keccak256(abi.encodePacked(seed, uint256(1), w)));
            _sideWalk(buf, raw, h, rows[(h >> 1) % nr]);
        }
        return buf.str();
    }

    function _sideWalk(bytes memory buf, bytes memory raw, uint256 h, uint256 y) private pure {
        bool fromLeft = (h & 1) == 0;
        uint256 x = fromLeft ? 0 : 40;
        _catXY(buf, "M", x, y);
        for (uint256 s2 = 0; s2 < WK_STRAIGHT; s2++) {
            x = fromLeft ? x + 1 : x - 1;
            _catXY(buf, "L", x, y);
            if (_walkHitsBody(raw, x > 39 ? 39 : x, y)) break; // reached body
            if (fromLeft ? x >= 40 : x == 0) break;
        }
        _tourSteps(buf, x, y, h >> 8, fromLeft ? 0 : 2);
    }

    function _tourSteps(bytes memory buf, uint256 x, uint256 y, uint256 s, uint256 dir) private pure {
        for (uint256 step = 0; step < WK_STEPS; step++) {
            s = uint256(keccak256(abi.encodePacked(s)));
            if (s % 100 < WK_TURN) dir = (dir + (((s >> 8) & 1) == 0 ? 1 : 3)) & 3;
            if (dir == 0) { if (x < 40) x++; else { dir = 2; continue; } }
            else if (dir == 1) { if (y < 40) y++; else { dir = 3; continue; } }
            else if (dir == 2) { if (x > 0) x--; else { dir = 0; continue; } }
            else { if (y > 0) y--; else { dir = 1; continue; } }
            _catXY(buf, "L", x, y);
        }
    }

    // --- bitmap helpers (own copies; the renderer keeps its own) ---
    function _bitmapBit(bytes memory raw, uint256 index) private pure returns (bool) {
        uint256 byteIndex = index / 8;
        uint256 bitIndex = 7 - (index % 8);
        return (uint8(raw[byteIndex]) & (uint8(1) << uint8(bitIndex))) != 0;
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
}
