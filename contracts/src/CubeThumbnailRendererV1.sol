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
        uint256 axis = _mainAxis(uint256(data.slot));
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            _thumbnailDefs(bitmapPath, outlinePath, labelPath, axis, planeColor),
            _forestLayer(data, planeColor),
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
    // Build a diagonal feColorMatrix "values" string that boosts the cube's own
    // colour channel (axis 0=R,1=G,2=B) by `dom` and the other two by `sec`, with
    // alpha `a`. This makes the neon glow saturate in the cube's hue (red cubes
    // glow red, blue glow blue) instead of washing toward white.
    function _neonVals(uint256 axis, string memory dom, string memory sec, string memory a)
        private
        pure
        returns (string memory)
    {
        string memory r = axis == 0 ? dom : sec;
        string memory g = axis == 1 ? dom : sec;
        string memory b = axis == 2 ? dom : sec;
        return string.concat(r, " 0 0 0 0 0 ", g, " 0 0 0 0 0 ", b, " 0 0 0 0 0 ", a, " 0");
    }

    function _thumbnailDefs(
        string memory bitmapPath,
        string memory outlinePath,
        string memory labelPath,
        uint256 axis,
        string memory planeColor
    )
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
            '<feColorMatrix in="r" type="matrix" values="', _neonVals(axis, "9", "1.8", ".92"), '" result="rc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".52" result="t"/>',
            '<feColorMatrix in="t" type="matrix" values="', _neonVals(axis, "7", "1.4", ".38"), '" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation=".74" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="', _neonVals(axis, "4.5", "1", ".025"), '" result="mc"/>',
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
            '<feColorMatrix in="t" type="matrix" values="', _neonVals(axis, "6", "1.8", "1"), '" result="tc"/>',
            '<feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="m"/>',
            '<feColorMatrix in="m" type="matrix" values="', _neonVals(axis, "4", "1.3", ".62"), '" result="mc"/>',
            '<feMerge><feMergeNode in="mc"/><feMergeNode in="tc"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            // Forest particle clouds: feTurbulence masked, coloured by the source
            // (so red/green/blue cubes get matching particles), then bloomed.
            '<filter id="pc" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">',
            '<feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="2" seed="7" result="noise"/>',
            '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.2 -1.05" result="mask"/>',
            '<feComposite operator="in" in="SourceGraphic" in2="mask" result="clip"/>',
            '<feGaussianBlur in="clip" stdDeviation="4" result="glow"/>',
            '<feMerge><feMergeNode in="glow"/><feMergeNode in="glow"/><feMergeNode in="clip"/></feMerge>',
            "</filter>",
            '<filter id="pcw" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">',
            '<feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves="2" seed="19" result="noise"/>',
            '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3.6 -2.25" result="mask"/>',
            '<feComposite operator="in" in="SourceGraphic" in2="mask" result="clip"/>',
            '<feGaussianBlur in="clip" stdDeviation="1.6" result="glow"/>',
            '<feMerge><feMergeNode in="glow"/><feMergeNode in="clip"/></feMerge>',
            "</filter>",
            // Soft radial gradients used to fill the forest particle clouds: the
            // gradient fades to transparent so the turbulence speckles read as a
            // soft diffuse haze-bloom (not hard granular blobs). cg is the cube's
            // plane colour; cgw is the white sparkle highlight.
            '<radialGradient id="cg"><stop offset="0" stop-color="', planeColor, '" stop-opacity=".95"/>',
            '<stop offset=".4" stop-color="', planeColor, '" stop-opacity=".4"/>',
            '<stop offset="1" stop-color="', planeColor, '" stop-opacity="0"/></radialGradient>',
            '<radialGradient id="cgw"><stop offset="0" stop-color="#fff" stop-opacity=".7"/>',
            '<stop offset=".3" stop-color="#fff" stop-opacity=".22"/>',
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
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

    // Forest: thin inward strands from active edge points to a hub, branching to
    // tips; each tip carries a turbulence particle-cloud (colour + white passes).
    function _forestLayer(CubeNFT.CubeData memory data, string memory planeColor)
        private
        pure
        returns (string memory)
    {
        string memory glow = "";
        string memory core = "";
        string memory tips = "";
        for (uint256 bi = 0; bi < 21; bi++) {
            uint256 edge = bi / 7;
            if (!_edgePointActive(data, edge, bi - edge * 7)) continue;
            if (_rand(data, bi + 999, 100) >= 58) continue;
            glow = string.concat(glow, _treeStrands(data, bi, false));
            core = string.concat(core, _treeStrands(data, bi, true));
            tips = string.concat(tips, _treeTips(data, bi));
        }
        if (bytes(core).length == 0) return "";

        return string.concat(
            '<g fill="none" stroke="', planeColor,
            '" stroke-width="1.4" opacity=".16" filter="url(#p)">', glow, "</g>",
            '<g fill="none" stroke="', planeColor,
            '" stroke-width=".5" opacity=".5" filter="url(#g)">', core, "</g>",
            '<g fill="url(#cg)" filter="url(#pc)">', tips, "</g>",
            '<g fill="url(#cgw)" filter="url(#pcw)">', tips, "</g>"
        );
    }

    function _treeHub(CubeNFT.CubeData memory data, uint256 bi)
        private
        pure
        returns (uint256 rootX, uint256 rootY, uint256 hubX, uint256 hubY)
    {
        uint256 edge = bi / 7;
        (rootX, rootY) = _edgePointCoord(edge, bi - edge * 7);
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
    function _treeStrands(CubeNFT.CubeData memory data, uint256 bi, bool bunch)
        private
        pure
        returns (string memory)
    {
        (uint256 rootX, uint256 rootY, uint256 hubX, uint256 hubY) = _treeHub(data, bi);
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

    // A bundle of 3 fibres between the same endpoints. Each fibre shares the base
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
        for (uint256 f = 0; f < 3; f++) {
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
        returns (string memory)
    {
        // inner _offsetCanvas = shared base control point (same for all fibres);
        // outer = small per-fibre deviation (depends on f) -> tight bundle.
        uint256 cx1 = _offsetCanvas(_offsetCanvas(_mix(x1, x2, 34), data, bi + salt * 29 + 170, 80), data, bi + salt * 7 + f * 97 + 500, 11);
        uint256 cy1 = _offsetCanvas(_offsetCanvas(_mix(y1, y2, 34), data, bi + salt * 31 + 210, 80), data, bi + salt * 7 + f * 101 + 540, 11);
        uint256 cx2 = _offsetCanvas(_offsetCanvas(_mix(x1, x2, 68), data, bi + salt * 37 + 250, 105), data, bi + salt * 7 + f * 103 + 580, 14);
        uint256 cy2 = _offsetCanvas(_offsetCanvas(_mix(y1, y2, 68), data, bi + salt * 41 + 290, 105), data, bi + salt * 7 + f * 107 + 620, 14);
        // first fibre hits the exact tip; the others fan a little around it.
        uint256 ex = _offsetCanvas(x2, data, bi + f * 109 + 660, f == 0 ? 0 : 14);
        uint256 ey = _offsetCanvas(y2, data, bi + f * 113 + 700, f == 0 ? 0 : 14);
        return _curvePath(x1, y1, cx1, cy1, cx2, cy2, ex, ey);
    }

    function _curvePath(
        uint256 x1,
        uint256 y1,
        uint256 cx1,
        uint256 cy1,
        uint256 cx2,
        uint256 cy2,
        uint256 x2,
        uint256 y2
    )
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<path d="M', x1.toString(), " ", y1.toString(),
            "C", cx1.toString(), " ", cy1.toString(),
            " ", cx2.toString(), " ", cy2.toString(),
            " ", x2.toString(), " ", y2.toString(), '"/>'
        );
    }

    function _treeTips(CubeNFT.CubeData memory data, uint256 bi)
        private
        pure
        returns (string memory)
    {
        (,, uint256 hubX, uint256 hubY) = _treeHub(data, bi);
        string memory t = "";
        for (uint256 b = 0; b < 3; b++) {
            (uint256 tipX, uint256 tipY) = _treeTip(data, bi, hubX, hubY, b);
            t = string.concat(t, _tipEllipse(data, bi, b, tipX, tipY));
        }
        return t;
    }

    function _tipEllipse(CubeNFT.CubeData memory data, uint256 bi, uint256 b, uint256 x, uint256 y)
        private
        pure
        returns (string memory)
    {
        uint256 rx = 28 + _rand(data, bi + b * 80 + 360, 38);
        uint256 ry = 16 + _rand(data, bi + b * 90 + 420, 28);
        uint256 rot = _rand(data, bi + b * 100 + 480, 180);
        return string.concat(
            '<ellipse cx="', x.toString(), '" cy="', y.toString(),
            '" rx="', rx.toString(), '" ry="', ry.toString(),
            '" transform="rotate(', rot.toString(), " ", x.toString(), " ", y.toString(), ')"/>'
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

