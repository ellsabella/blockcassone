// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Base64 } from "openzeppelin-contracts/contracts/utils/Base64.sol";
import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { ICubeRenderer } from "./interfaces/ICubeRenderer.sol";
import { RendererAssetStore } from "./RendererAssetStore.sol";

interface INormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

contract CubeRendererV2 is ICubeRenderer {
    using Strings for uint256;

    uint256 public constant HTML_HEAD_CHUNK = 0;
    uint256 public constant HTML_SCRIPT_CHUNK = 1;
    uint256 public constant HTML_SCRIPT_START_CHUNK = 1;

    CubeNFT public immutable cubes;
    RendererAssetStore public immutable assets;
    address public immutable normieStorage;

    constructor(CubeNFT cubes_, RendererAssetStore assets_, address normieStorage_) {
        cubes = cubes_;
        assets = assets_;
        normieStorage = normieStorage_;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        return string.concat("data:application/json;utf8,", metadataJSON(tokenId));
    }

    function metadataJSON(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        string memory image = imageURI(tokenId);
        return string.concat(
            "{",
            '"name":"Blockcassone Cube #',
            tokenId.toString(),
            '",',
            '"description":"A fully onchain Blockcassone Hilbert cube, rendered from contract-stored source facts and onchain renderer chunks.",',
            '"image":"',
            image,
            '",',
            '"animation_url":"',
            animationURI(tokenId),
            '",',
            '"attributes":[',
            _attributesJSON(data),
            "]}"
        );
    }

    function imageURI(uint256 tokenId) public view returns (string memory) {
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(thumbnailSVG(tokenId))));
    }

    function thumbnailSVG(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        bytes memory raw = _rawImageBytes(data);
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

    function animationURI(uint256 tokenId) public view returns (string memory) {
        return string.concat("data:text/html;base64,", Base64.encode(bytes(animationHTML(tokenId))));
    }

    function animationHTML(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        return string.concat(
            _chunkOrDefault(HTML_HEAD_CHUNK, _defaultHTMLHead()),
            _tokenConfig(tokenId, data),
            _scriptChunksOrDefault()
        );
    }

    function regionForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 512;
    }

    function neighbourhoodForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 64;
    }

    function streetForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 8;
    }

    function _tokenConfig(uint256 tokenId, CubeNFT.CubeData memory data)
        private
        view
        returns (string memory)
    {
        return string.concat(
            "<script>window.BLOCKCASSONE_TOKEN={",
            "tokenId:",
            tokenId.toString(),
            ",slot:",
            uint256(data.slot).toString(),
            ",sourceKind:",
            uint256(data.sourceKind).toString(),
            ",sourceContract:'",
            Strings.toHexString(uint160(data.sourceContract), 20),
            "',sourceTokenId:",
            data.sourceTokenId.toString(),
            ",normieStorage:'",
            Strings.toHexString(uint160(normieStorage), 20),
            "',agentic:",
            data.agentic ? "true" : "false",
            ",agentId:",
            data.agentId.toString(),
            ",raw:'",
            _rawImageBase64(data),
            "'};</script>"
        );
    }

    function _rawImageBase64(CubeNFT.CubeData memory data) private view returns (string memory) {
        return Base64.encode(_rawImageBytes(data));
    }

    function _rawImageBytes(CubeNFT.CubeData memory data) private view returns (bytes memory) {
        if (data.sourceKind != cubes.SOURCE_KIND_NORMIE() || normieStorage == address(0)) return "";
        try INormieRawImageStorage(normieStorage).getTokenRawImageData(data.sourceTokenId) returns (
            bytes memory raw
        ) {
            return raw;
        } catch {
            return "";
        }
    }

    function _thumbnailDefs(string memory bitmapPath, string memory outlinePath, string memory labelPath)
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        return string.concat(
            '<defs>',
            '<filter id="g" x="-40%" y="-40%" width="180%" height="180%">',
            '<feGaussianBlur stdDeviation="4.2" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="p" x="-65%" y="-65%" width="230%" height="230%">',
            '<feGaussianBlur stdDeviation="11" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<filter id="h" x="-90%" y="-90%" width="280%" height="280%">',
            '<feGaussianBlur stdDeviation="22" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>',
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
            '<g transform="translate(100 85) scale(25)">',
            '<use href="#n" fill="',
            planeColor,
            '" opacity=".055"/>',
            '<use href="#o" fill="none" stroke="',
            planeColor,
            '" stroke-width=".56" opacity=".82" filter="url(#p)"/>',
            '<use href="#o" fill="none" stroke="',
            planeColor,
            '" stroke-width=".28" opacity=".99" filter="url(#g)"/>',
            '<use href="#o" fill="none" stroke="#fff5f5" stroke-width=".055" opacity=".86"/>',
            bytes(labelPath).length == 0
                ? ""
                : string.concat(
                    '<use href="#l" fill="none" stroke="',
                    planeColor,
                    '" stroke-width=".34" opacity=".95" filter="url(#g)"/><use href="#l" fill="none" stroke="#fff" stroke-width=".07" opacity=".68"/>'
                ),
            "</g>"
        );
    }

    function _thumbnailPlaneFrame(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        return string.concat(_planeEdges(data, planeColor), _edgePoints(data, planeColor));
    }

    function _planeEdges(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
            _svgPath("M100 85H1100V1085H100", "#38ff4d", "10", ".28", "url(#p)"),
            _svgPath("M100 85H1100V1085H100", "#38ff4d", "4.8", ".88", "url(#g)"),
            _svgPath("M100 85H1100V1085H100", "#fff", "1.35", ".48", ""),
            _edgeAccents(data, planeColor),
            "</g>"
        );
    }

    function _edgePoints(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        string memory out = "";
        for (uint256 edge = 0; edge < 3; edge++) {
            for (uint256 bit = 0; bit < 7; bit++) {
                if (!_edgePointActive(data, edge, bit)) continue;
                (uint256 x, uint256 y) = _edgePointCoord(edge, bit);
                out = string.concat(out, _edgePoint(x, y, edge == 1 ? "#fff" : planeColor, edge == 1 ? "13" : "9"));
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
        uint256 d = 82;
        uint256 x0 = x > d ? x - d : x;
        uint256 x1 = x + d;
        string memory path = string.concat("M", x0.toString(), " ", y.toString(), "H", x1.toString());
        return string.concat(
            _svgPath(path, "#ff1ba6", "46", ".28", "url(#h)"),
            _svgPath(path, "#ff1ba6", "30", ".54", "url(#p)"),
            _svgPath(path, "#ff3ab8", "17", ".92", "url(#g)"),
            _svgPath(path, "#ff0f6f", "8", ".98", ""),
            _svgPath(path, "#fff", "3.2", ".82", "")
        );
    }

    function _edgeAccentV(uint256 x, uint256 y) private pure returns (string memory) {
        uint256 d = 82;
        uint256 y0 = y > d ? y - d : y;
        uint256 y1 = y + d;
        string memory path = string.concat("M", x.toString(), " ", y0.toString(), "V", y1.toString());
        return string.concat(
            _svgPath(path, "#ff1ba6", "46", ".28", "url(#h)"),
            _svgPath(path, "#ff1ba6", "30", ".54", "url(#p)"),
            _svgPath(path, "#ff3ab8", "17", ".92", "url(#g)"),
            _svgPath(path, "#ff0f6f", "8", ".98", ""),
            _svgPath(path, "#fff", "3.2", ".82", "")
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
            '"',
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
            _circle(x, y, (r * 3).toString(), color, ".28", "url(#h)"),
            _circle(x, y, (r * 2).toString(), color, ".46", "url(#p)"),
            _circle(x, y, radius, color, ".94", "url(#g)"),
            _circle(x, y, (r / 2 + 2).toString(), "#fff", ".82", "")
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
        return 0x2BAA; // '#'
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
            '" stroke-width=".85" opacity=".28" filter="url(#g)">',
            lines,
            "</g>",
            '<g fill="',
            planeColor,
            '" opacity=".68" filter="url(#g)">',
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
            '" stroke-width=".9" opacity=".22" filter="url(#g)">',
            paths,
            "</g>",
            '<g fill="none" stroke="#fff" stroke-width=".45" opacity=".18">',
            paths,
            "</g>"
        );
    }

    function _planeColor(CubeNFT.CubeData memory data) private pure returns (string memory) {
        uint256 axis = uint256(data.slot) % 3;
        if (axis == 0) return "#ff1919";
        if (axis == 1) return "#38ff4d";
        return "#244cff";
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

    function _attributesJSON(CubeNFT.CubeData memory data) private view returns (string memory) {
        return string.concat(
            _trait("plot", uint256(data.slot).toString()),
            ",",
            _trait("region", regionForSlot(data.slot).toString()),
            ",",
            _trait("neighbourhood", neighbourhoodForSlot(data.slot).toString()),
            ",",
            _trait("street", streetForSlot(data.slot).toString()),
            ",",
            _trait(
                "Source Kind",
                data.sourceKind == cubes.SOURCE_KIND_NORMIE() ? "Normie" : "External ERC-721"
            ),
            ",",
            _trait("Source Contract", Strings.toHexString(uint160(data.sourceContract), 20)),
            ",",
            _trait("Source Token ID", data.sourceTokenId.toString()),
            ",",
            _trait("Agentic", data.agentic ? "Y" : "N"),
            ",",
            _trait("Agent ID", data.agentId.toString()),
            ",",
            _trait("Renderer Version", "2"),
            ",",
            _trait("Payload Version", uint256(data.payloadVersion).toString())
        );
    }

    function _trait(string memory traitType, string memory value)
        private
        pure
        returns (string memory)
    {
        return string.concat('{"trait_type":"', traitType, '","value":"', value, '"}');
    }

    function _chunkOrDefault(uint256 chunkId, string memory fallbackContent)
        private
        view
        returns (string memory)
    {
        string memory content = assets.chunk(chunkId);
        return bytes(content).length == 0 ? fallbackContent : content;
    }

    function _scriptChunksOrDefault() private view returns (string memory) {
        uint256 count = assets.chunkCount();
        if (count <= HTML_SCRIPT_START_CHUNK) {
            return _chunkOrDefault(HTML_SCRIPT_CHUNK, _defaultHTMLScript());
        }

        string memory out = "";
        for (uint256 i = HTML_SCRIPT_START_CHUNK; i < count; i++) {
            out = string.concat(out, assets.chunk(i));
        }
        return bytes(out).length == 0 ? _defaultHTMLScript() : out;
    }

    function _defaultHTMLHead() private pure returns (string memory) {
        return
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020203;color:#ff98d9;font:13px monospace}canvas{width:100vw;height:100vh;display:block}.h{position:fixed;left:14px;bottom:12px;padding:9px 11px;border:2px solid #ff3ab8;background:#070208cc;text-shadow:0 0 10px #ff3ab8}</style></head><body><canvas id=c></canvas><div class=h id=h>Blockcassone</div>";
    }

    function _defaultHTMLScript() private pure returns (string memory) {
        return
        "<script>(()=>{const T=window.BLOCKCASSONE_TOKEN,H=document.getElementById('h'),C=document.getElementById('c'),x=C.getContext('2d');C.width=innerWidth;C.height=innerHeight;x.fillStyle='#020203';x.fillRect(0,0,C.width,C.height);x.fillStyle='#ff98d9';x.font='700 18px monospace';x.fillText('Renderer asset chunks are not installed.',32,54);x.fillStyle='#aaffb2';x.font='14px monospace';x.fillText('Cube #'+T.tokenId+' / Normie #'+T.sourceTokenId+' / plot '+T.slot,32,84);H.textContent='Blockcassone renderer fallback';})();</script></body></html>";
    }
}
