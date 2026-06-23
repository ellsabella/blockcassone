// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";

interface IThumbnailNormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

interface IThumbnailNonNormieArtStore {
    function payloadForCube(uint256 cubeId) external view returns (bytes memory);
}

contract CubeThumbnailRendererV1 {
    using Strings for uint256;

    CubeNFT public immutable cubes;
    address public immutable normieStorage;
    address public immutable nonNormieStore;

    constructor(CubeNFT cubes_, address normieStorage_, address nonNormieStore_) {
        cubes = cubes_;
        normieStorage = normieStorage_;
        nonNormieStore = nonNormieStore_;
    }

    function thumbnailSVG(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        bytes memory raw = _rawImageBytes(data, tokenId);
        string memory labelPath = _labelPath(data.sourceTokenId);
        string memory bitmapPath = _bitmapPath(raw);
        string memory outlinePath = _outlinePath(raw, data.sourceTokenId);
        string memory planeColor = _planeColor(data);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            _thumbnailDefs(bitmapPath, outlinePath, labelPath),
            _forestLayer(data, planeColor),
            _walkerLayer(data, planeColor),
            _thumbnailBitmap(bitmapPath, outlinePath, labelPath, planeColor),
            _thumbnailPlaneFrame(data, planeColor),
            "</svg>"
        );
    }

    // Returns a 200-byte (40x40, 1 bit/cell) binary silhouette for either source
    // kind. Normie art is already binary; non-Normie art is a 400-byte 2-bit
    // tonal-band payload (NonNormieArtStore) thresholded to a silhouette.
    function _rawImageBytes(CubeNFT.CubeData memory data, uint256 cubeId) private view returns (bytes memory) {
        if (data.sourceKind == cubes.SOURCE_KIND_NORMIE()) {
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
            try IThumbnailNonNormieArtStore(nonNormieStore).payloadForCube(cubeId) returns (
                bytes memory payload
            ) {
                return _tonalToBinary(payload);
            } catch {
                return "";
            }
        }
        return "";
    }

    // Threshold a 400-byte 2-bit tonal-band payload (4 luminance bands, 40x40,
    // row-major) into the 200-byte 1-bit silhouette the bitmap/outline path
    // expects: any non-zero band is foreground. Bit layout matches _bitmapBit
    // (index = row*40+col; byte index/8; bit 7-(index%8)).
    function _tonalToBinary(bytes memory payload) private pure returns (bytes memory) {
        if (payload.length != 400) return "";
        bytes memory out = new bytes(200);
        for (uint256 cell = 0; cell < 1600; cell++) {
            uint8 band = uint8(uint8(payload[cell >> 2]) >> ((cell & 3) << 1)) & 3;
            if (band > 0) {
                out[cell >> 3] |= bytes1(uint8(1) << uint8(7 - (cell & 7)));
            }
        }
        return out;
    }
    function _thumbnailDefs(string memory bitmapPath, string memory outlinePath, string memory labelPath)
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        return string.concat(
            '<defs>',
            '<filter id="g" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="2.3" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="5 0 0 0 0 0 5 0 0 0 0 0 5 0 0 0 0 0 1 0" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 .62 0" result="mc"/>',
            '<feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="p" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="6 0 0 0 0 0 6 0 0 0 0 0 6 0 0 0 0 0 .95 0" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="11" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="4 0 0 0 0 0 4 0 0 0 0 0 4 0 0 0 0 0 .50 0" result="mc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="20" result="w"/>',
            '<feColorMatrix in="w" type="matrix" values="2 0 0 0 0 0 2 0 0 0 0 0 2 0 0 0 0 0 .24 0" result="wc"/>',
            '<feMerge><feMergeNode in="wc"/><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="h" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="9" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="4 0 0 0 0 0 4 0 0 0 0 0 4 0 0 0 0 0 .32 0" result="mc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="24" result="w"/>',
            '<feColorMatrix in="w" type="matrix" values="2.4 0 0 0 0 0 2.4 0 0 0 0 0 2.4 0 0 0 0 0 .14 0" result="wc"/>',
            '<feMerge><feMergeNode in="wc"/><feMergeNode in="mc"/></feMerge>',
            "</filter>",
            '<filter id="nt" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".26" result="r"/>',
            '<feColorMatrix in="r" type="matrix" values="10 0 0 0 0 0 3.2 0 0 0 0 0 3.2 0 0 0 0 0 .92 0" result="rc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".52" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="8 0 0 0 0 0 2.4 0 0 0 0 0 2.4 0 0 0 0 0 .38 0" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".74" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="5 0 0 0 0 0 1.4 0 0 0 0 0 1.4 0 0 0 0 0 .025 0" result="mc"/>',
            '<feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="rc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="t" filterUnits="userSpaceOnUse" x="-120" y="-120" width="1440" height="1440" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".8" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="7 0 0 0 0 0 7 0 0 0 0 0 7 0 0 0 0 0 1 0" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="5 0 0 0 0 0 5 0 0 0 0 0 5 0 0 0 0 0 .85 0" result="mc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="8" result="w"/>',
            '<feColorMatrix in="w" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 .45 0" result="wc"/>',
            '<feMerge><feMergeNode in="wc"/><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="gf" filterUnits="userSpaceOnUse" x="-16" y="-16" width="72" height="72" color-interpolation-filters="sRGB">',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="2.3" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="5 0 0 0 0 0 5 0 0 0 0 0 5 0 0 0 0 0 1 0" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 .62 0" result="mc"/>',
            '<feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<path id="n" d="',
            bitmapPath,
            '"/>',
            '<path id="o" d="',
            outlinePath,
            '"/>',
            '<path id="l" d="',
            labelPath,
            '"/>',
            "</defs>"
        );
    }

    function _thumbnailBitmap(
        string memory bitmapPath,
        string memory outlinePath,
        string memory labelPath,
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

        return string.concat(
            '<g transform="translate(100 85) scale(25)" stroke-linecap="round" stroke-linejoin="round">',
            '<use href="#n" fill="',
            planeColor,
            '" opacity=".003"/>',
            '<use href="#o" fill="none" stroke="',
            planeColor,
            '" stroke-width=".38" opacity=".90" filter="url(#nt)"/>',
            '<use href="#o" fill="none" stroke="',
            planeColor,
            '" stroke-width=".27" opacity=".95" filter="url(#gf)"/>',
            '<use href="#o" fill="none" stroke="',
            planeColor,
            '" stroke-width=".20" opacity="1"/>',
            '<use href="#o" fill="none" stroke="#fff" stroke-width=".026" opacity=".92"/>',
            bytes(labelPath).length == 0
                ? ""
                : string.concat(
                    '<use href="#l" fill="none" stroke="',
                    planeColor,
                    '" stroke-width=".32" opacity=".88" filter="url(#nt)"/><use href="#l" fill="none" stroke="',
                    planeColor,
                    '" stroke-width=".26" opacity=".95" filter="url(#gf)"/><use href="#l" fill="none" stroke="#fff" stroke-width=".028" opacity=".84"/>'
                ),
            "</g>"
        );
    }

    function _thumbnailPlaneFrame(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        return string.concat(_planeEdges(data, planeColor), _edgePoints(data));
    }

    function _planeEdges(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">',
            _svgPath("M100 85H1100V1085H100", "#38ff4d", "12", ".12", "url(#h)"),
            _svgPath("M100 85H1100V1085H100", "#38ff4d", "7.5", ".32", "url(#p)"),
            _svgPath("M100 85H1100V1085H100", "#38ff4d", "5.2", ".92", "url(#g)"),
            _svgPath("M100 85H1100V1085H100", "#8dff98", "3.4", ".98", ""),
            _svgPath("M100 85H1100V1085H100", "#fff", "1.65", ".55", ""),
            _edgeAccents(data, planeColor),
            "</g>"
        );
    }

    function _edgePoints(CubeNFT.CubeData memory data)
        private
        pure
        returns (string memory)
    {
        string memory out = "";
        for (uint256 edge = 0; edge < 3; edge++) {
            for (uint256 bit = 0; bit < 7; bit++) {
                if (!_edgePointActive(data, edge, bit)) continue;
                (uint256 x, uint256 y) = _edgePointCoord(edge, bit);
                out = string.concat(out, _edgePoint(x, y, "#fff", edge == 1 ? "13" : "9"));
            }
        }
        return string.concat(
            '<g>',
            _edgePoint(100, 85, "#fff", "14"),
            _edgePoint(1100, 85, "#fff", "14"),
            _edgePoint(1100, 1085, "#fff", "14"),
            _edgePoint(100, 1085, "#fff", "14"),
            out,
            "</g>"
        );
    }

    function _edgeAccents(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        string memory out = "";
        for (uint256 edge = 0; edge < 3; edge++) {
            for (uint256 bit = 0; bit < 7; bit++) {
                if (!_edgePointActive(data, edge, bit)) continue;
                (uint256 x, uint256 y) = _edgePointCoord(edge, bit);
                out = string.concat(out, _edgeAccent(edge, x, y, planeColor));
            }
        }
        return out;
    }

    function _edgeAccent(uint256 edge, uint256 x, uint256 y, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        planeColor;
        if (edge == 1) return _edgeAccentV(x, y);
        return _edgeAccentH(x, y);
    }

    function _edgeAccentH(uint256 x, uint256 y) private pure returns (string memory) {
        uint256 d = 96;
        uint256 x0 = x > d ? x - d : x;
        uint256 x1 = x + d;
        string memory path = string.concat("M", x0.toString(), " ", y.toString(), "H", x1.toString());
        return string.concat(
            _svgPath(path, "#ff1ba6", "12", ".18", "url(#h)"),
            _svgPath(path, "#ff1ba6", "7.5", ".46", "url(#p)"),
            _svgPath(path, "#ff3ab8", "5.2", ".98", "url(#g)"),
            _svgPath(path, "#ff2aa8", "3.4", ".98", ""),
            _svgPath(path, "#ffc0ea", "1.65", ".46", "")
        );
    }

    function _edgeAccentV(uint256 x, uint256 y) private pure returns (string memory) {
        uint256 d = 96;
        uint256 y0 = y > d ? y - d : y;
        uint256 y1 = y + d;
        string memory path = string.concat("M", x.toString(), " ", y0.toString(), "V", y1.toString());
        return string.concat(
            _svgPath(path, "#ff1ba6", "12", ".18", "url(#h)"),
            _svgPath(path, "#ff1ba6", "7.5", ".46", "url(#p)"),
            _svgPath(path, "#ff3ab8", "5.2", ".98", "url(#g)"),
            _svgPath(path, "#ff2aa8", "3.4", ".98", ""),
            _svgPath(path, "#ffc0ea", "1.65", ".46", "")
        );
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

    function _edgePoint(uint256 x, uint256 y, string memory color, string memory radius)
        private
        pure
        returns (string memory)
    {
        uint256 r = _parseSmallUint(radius);
        return string.concat(
            _circle(x, y, (r * 2).toString(), color, ".12", "url(#h)"),
            _circle(x, y, ((r * 3) / 2).toString(), color, ".30", "url(#p)"),
            _circle(x, y, radius, color, ".62", "url(#g)"),
            _circle(x, y, (r / 2 + 3).toString(), "#fff", ".38", "url(#g)"),
            _circle(x, y, (r / 3 + 2).toString(), "#fff", ".76", "")
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

    function _parseSmallUint(string memory value) private pure returns (uint256) {
        bytes memory b = bytes(value);
        uint256 out = 0;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) continue;
            out = out * 10 + (c - 48);
        }
        return out == 0 ? 1 : out;
    }

    function _edgePointCoord(uint256 edge, uint256 bit) private pure returns (uint256 x, uint256 y) {
        uint256 t = (bit + 1) * 125;
        if (edge == 0) return (100 + t, 85);
        if (edge == 1) return (1100, 85 + t);
        return (1100 - t, 1085);
    }

    function _edgePointActive(CubeNFT.CubeData memory data, uint256 edge, uint256 bit)
        private
        pure
        returns (bool)
    {
        return uint256(keccak256(abi.encodePacked(data.seed, data.sourceTokenId, edge, bit))) % 3 != 0;
    }

    function _bitmapPath(bytes memory raw) private pure returns (string memory) {
        if (raw.length != 200) return "";

        string memory path = "";
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

                path = string.concat(
                    path,
                    "M",
                    start.toString(),
                    " ",
                    row.toString(),
                    "h",
                    (col - start).toString(),
                    "v1H",
                    start.toString(),
                    "z"
                );
            }
        }
        return path;
    }

    function _outlinePath(bytes memory raw, uint256 normieId) private pure returns (string memory) {
        if (raw.length != 200) return "";

        string memory path = "";
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
                if (_isLabelCell(normieId, row, col)) continue;
                if (!_bitmapBitAt(raw, row, col, 0, -1)) {
                    path = string.concat(path, "M", col.toString(), " ", row.toString(), "v1");
                }
                if (!_bitmapBitAt(raw, row, col, 0, 1)) {
                    path = string.concat(path, "M", (col + 1).toString(), " ", row.toString(), "v1");
                }
                if (!_bitmapBitAt(raw, row, col, -1, 0)) {
                    path = string.concat(path, "M", col.toString(), " ", row.toString(), "h1");
                }
                if (!_bitmapBitAt(raw, row, col, 1, 0)) {
                    path = string.concat(path, "M", col.toString(), " ", (row + 1).toString(), "h1");
                }
            }
        }
        return path;
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

    function _forestLayer(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        string memory lines = "";
        for (uint256 bi = 0; bi < 21; bi++) {
            uint256 edge = bi / 7;
            uint256 bit = bi - edge * 7;
            if (!_edgePointActive(data, edge, bit)) continue;
            if (_rand(data, bi + 999, 100) >= 58) continue;
            lines = string.concat(lines, _forestTree(data, bi));
        }

        string memory dots = "";
        for (uint256 bi = 0; bi < 21; bi++) {
            uint256 edge = bi / 7;
            uint256 bit = bi - edge * 7;
            if (!_edgePointActive(data, edge, bit)) continue;
            if (_rand(data, bi + 999, 100) >= 58) continue;
            for (uint256 i = 0; i < 7; i++) {
                dots = string.concat(dots, _forestDot(data, bi, i));
            }
        }

        return string.concat(
            '<g fill="none" stroke="',
            planeColor,
            '" stroke-width="1.6" opacity=".14" filter="url(#p)">',
            lines,
            "</g>",
            '<g fill="none" stroke="',
            planeColor,
            '" stroke-width=".9" opacity=".36" filter="url(#g)">',
            lines,
            "</g>",
            '<g fill="',
            planeColor,
            '" opacity=".28" filter="url(#p)">',
            dots,
            "</g>",
            '<g fill="',
            planeColor,
            '" opacity=".82" filter="url(#g)">',
            dots,
            "</g>"
        );
    }

    function _forestTree(CubeNFT.CubeData memory data, uint256 bi)
        private
        pure
        returns (string memory)
    {
        uint256 edge = bi / 7;
        uint256 bit = bi - edge * 7;
        (uint256 rootX, uint256 rootY) = _edgePointCoord(edge, bit);

        uint256 trunkLen = 190 + _rand(data, bi + 80, 430);
        uint256 endX = _inwardX(rootX, trunkLen, data, bi + 120);
        uint256 endY = _inwardY(rootY, trunkLen, data, bi + 160);

        return string.concat(
            _forestCurve(data, bi, rootX, rootY, endX, endY, 0),
            _forestBranch(data, bi, endX, endY, 1),
            _forestBranch(data, bi, endX, endY, 2)
        );
    }

    function _forestBranch(
        CubeNFT.CubeData memory data,
        uint256 bi,
        uint256 rootX,
        uint256 rootY,
        uint256 branch
    )
        private
        pure
        returns (string memory)
    {
        uint256 len = 145 + _rand(data, bi + branch * 41, 210);
        uint256 endX = _offsetCanvas(rootX, data, bi + branch * 59, len);
        uint256 endY = _offsetCanvas(rootY, data, bi + branch * 73, len);
        return string.concat(
            _forestCurve(data, bi, rootX, rootY, endX, endY, branch),
            _forestTwig(data, bi, endX, endY, branch, 0),
            _forestTwig(data, bi, endX, endY, branch, 1)
        );
    }

    function _forestTwig(
        CubeNFT.CubeData memory data,
        uint256 bi,
        uint256 rootX,
        uint256 rootY,
        uint256 branch,
        uint256 twig
    )
        private
        pure
        returns (string memory)
    {
        uint256 len = 70 + _rand(data, bi + branch * 97 + twig * 31, 145);
        uint256 endX = _offsetCanvas(rootX, data, bi + branch * 101 + twig * 43, len);
        uint256 endY = _offsetCanvas(rootY, data, bi + branch * 107 + twig * 47, len);
        return _forestCurve(data, bi, rootX, rootY, endX, endY, branch * 3 + twig + 3);
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

    function _forestDot(CubeNFT.CubeData memory data, uint256 bi, uint256 i)
        private
        pure
        returns (string memory)
    {
        uint256 edge = bi / 7;
        uint256 bit = bi - edge * 7;
        (uint256 rootX, uint256 rootY) = _edgePointCoord(edge, bit);
        uint256 drift = 80 + _rand(data, bi + i + 390, 230);
        return string.concat(
            '<circle cx="',
            _offsetCanvas(rootX, data, bi * 11 + i + 400, drift).toString(),
            '" cy="',
            _offsetCanvas(rootY, data, bi * 13 + i + 470, drift).toString(),
            '" r="',
            (1 + _rand(data, bi * 17 + i + 540, 3)).toString(),
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

    function _walkerLayer(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        string memory paths = "";
        for (uint256 i = 0; i < 18; i++) {
            uint256 x = 130 + _rand(data, i + 700, 940);
            uint256 y = 115 + _rand(data, i + 740, 920);
            string memory d = string.concat("M", x.toString(), " ", y.toString());
            for (uint256 step = 0; step < 4; step++) {
                x = _offsetCanvas(x, data, i * 13 + step + 780, 160);
                y = _offsetCanvas(y, data, i * 13 + step + 860, 160);
                d = string.concat(d, "L", x.toString(), " ", y.toString());
            }
            paths = string.concat(paths, '<path d="', d, '"/>');
        }
        return string.concat(
            '<g fill="none" stroke="',
            planeColor,
            '" stroke-width="1.5" opacity=".12" filter="url(#p)">',
            paths,
            "</g>",
            '<g fill="none" stroke="',
            planeColor,
            '" stroke-width=".95" opacity=".28" filter="url(#g)">',
            paths,
            "</g>",
            '<g fill="none" stroke="#fff" stroke-width=".5" opacity=".22">',
            paths,
            "</g>"
        );
    }

    // Hilbert world order (must match viewer/main.js HILBERT_ORDER). A cube's
    // slot is its motif index in [0, 8^(ORDER-1)).
    uint256 private constant HILBERT_ORDER = 5;

    function _planeColor(CubeNFT.CubeData memory data) private pure returns (string memory) {
        uint256 axis = _mainAxis(uint256(data.slot));
        if (axis == 0) return "#ff1919"; // x -> red
        if (axis == 1) return "#38ff4d"; // y -> green
        return "#244cff";                // z -> blue
    }

    // The cube's "main" colour comes from its UNIQUE-axis plane (e.g. an XXY
    // cube takes Y). Derived from the 3D Hilbert geometry: a motif's 3 plane
    // axes are always [axis(C), axis(B), axis(C)], so the unique axis is always
    // the B basis vector's axis. We find B's axis by walking the Hilbert octree
    // (ORDER-1 levels) and tracking how the orientation basis (a,b,c) permutes
    // per child. Verified to match core/hilbert.js for all motifs (orders 2-5).
    function _mainAxis(uint256 motif) private pure returns (uint256) {
        uint256 levels = HILBERT_ORDER - 1;
        uint256 a = 0; // x
        uint256 b = 1; // y
        uint256 c = 2; // z
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (motif / (8 ** (levels - 1 - i))) % 8;
            uint256 na;
            uint256 nb;
            uint256 nc;
            if (d == 3 || d == 4) {
                (na, nb, nc) = (a, b, c); // identity
            } else if (d == 1 || d == 2 || d == 5 || d == 6) {
                (na, nb, nc) = (c, a, b);
            } else {
                (na, nb, nc) = (b, c, a); // 0 or 7
            }
            (a, b, c) = (na, nb, nc);
        }
        return b;
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

