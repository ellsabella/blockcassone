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

// Swappable render modules (see contracts/src/render/). The orchestrator holds
// their addresses immutably; swapping a layer = deploy the new module + redeploy
// this thin orchestrator pointing at it + cubes.setRenderer(...).
interface ICubeHilbertGeometry {
    function motifLayout(uint256 slot) external pure returns (uint256);
    function mainAxis(uint256 slot) external pure returns (uint256);
}

interface ICubeFrameLayer {
    function render(bytes32 seed, uint256 srcId, uint256 layout)
        external
        pure
        returns (string memory);
}

contract CubeThumbnailRendererV1 {
    using Strings for uint256;

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
        bytes memory raw = _rawImageBytes(data, tokenId);
        string memory labelPath = _labelPath(data.sourceTokenId);
        string memory bitmapPath = _bitmapPath(raw);
        string memory outlinePath = _outlinePath(raw, data.sourceTokenId);
        uint256 axis = geometry.mainAxis(uint256(data.slot));
        uint256 layout = geometry.motifLayout(uint256(data.slot));
        string memory planeColor = _colour(axis);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            _thumbnailDefs(bitmapPath, outlinePath, labelPath, axis, planeColor),
            _forestLayer(data, planeColor, layout),
            _thumbnailBitmap(bitmapPath, outlinePath, labelPath, planeColor),
            _glassLayer(raw, data.sourceTokenId),
            frame.render(data.seed, data.sourceTokenId, layout),
            "</svg>"
        );
    }

    function _colour(uint256 axis) private pure returns (string memory) {
        if (axis == 0) return "#ff1919"; // x -> red
        if (axis == 1) return "#38ff4d"; // y -> green
        return "#244cff"; // z -> blue
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

    function _edgePointActive(CubeNFT.CubeData memory data, uint256 edge, uint256 bit)
        private
        pure
        returns (bool)
    {
        return uint256(keccak256(abi.encodePacked(data.seed, data.sourceTokenId, edge, bit))) % 3 != 0;
    }

    // --- O(n) string builder ---------------------------------------------------
    // Repeated `s = string.concat(s, piece)` in the dense per-cell path loops is
    // O(n^2) (each append re-copies the whole growing string) and is the main
    // MemoryOOG risk for detailed Normies. These helpers append into a pre-sized
    // bytes buffer in O(total length). The caller MUST reserve `cap` >= total
    // appended bytes + 32: the word-aligned copy can write up to 31 bytes of slack
    // past the logical end, which must stay inside the reserved buffer.
    function _bufNew(uint256 cap) private pure returns (bytes memory buf) {
        buf = new bytes(cap); // zero-filled; capacity reserved past the length word
        assembly {
            mstore(buf, 0) // logical length starts at 0 (capacity stays allocated)
        }
    }

    function _bufCat(bytes memory buf, string memory piece) private pure {
        assembly {
            let len := mload(buf)
            let plen := mload(piece)
            let dst := add(add(buf, 0x20), len)
            let src := add(piece, 0x20)
            for { let i := 0 } lt(i, plen) { i := add(i, 0x20) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
            mstore(buf, add(len, plen)) // advance logical length
        }
    }

    function _bufStr(bytes memory buf) private pure returns (string memory) {
        return string(buf);
    }

    function _bitmapPath(bytes memory raw) private pure returns (string memory) {
        if (raw.length != 200) return "";

        // <= 40 rows * 20 runs * ~15 bytes/run; 24KB leaves ample slack.
        bytes memory buf = _bufNew(24576);
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

                _bufCat(
                    buf,
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
        return _bufStr(buf);
    }

    function _outlinePath(bytes memory raw, uint256 normieId) private pure returns (string memory) {
        if (raw.length != 200) return "";

        // <= 1600 cells * 4 edges * 8 bytes = 51200; 64KB leaves ample slack.
        bytes memory buf = _bufNew(65536);
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
                if (_isLabelCell(normieId, row, col)) continue;
                if (!_bitmapBitAt(raw, row, col, 0, -1)) {
                    _bufCat(buf, string.concat("M", col.toString(), " ", row.toString(), "v1"));
                }
                if (!_bitmapBitAt(raw, row, col, 0, 1)) {
                    _bufCat(buf, string.concat("M", (col + 1).toString(), " ", row.toString(), "v1"));
                }
                if (!_bitmapBitAt(raw, row, col, -1, 0)) {
                    _bufCat(buf, string.concat("M", col.toString(), " ", row.toString(), "h1"));
                }
                if (!_bitmapBitAt(raw, row, col, 1, 0)) {
                    _bufCat(buf, string.concat("M", col.toString(), " ", (row + 1).toString(), "h1"));
                }
            }
        }
        return _bufStr(buf);
    }

    // --- Glass voxel cells -----------------------------------------------------
    // Infill some Normie cells with luminous translucent panes, the way the 3D
    // viewer assigns voxel alpha: 3x3 density bands -> interior dimming -> centre
    // falloff -> per-cell variety -> visibility floor. Colour comes from a static
    // RGB light field (red upper-right, green lower-left, blue top), saturated
    // near a single light and blooming to white where they overlap. All maths is
    // fixed-point (band/mult/falloff/variety/intensity x1000; light field x10000)
    // and was validated against the float prototype before porting.
    function _glassLayer(bytes memory raw, uint256 normieId) private pure returns (string memory) {
        if (raw.length != 200) return "";
        (uint256 cMin, uint256 cMax, uint256 rMin, uint256 rMax, bool any) = _bbox(raw);
        if (!any) return "";

        // Cap the cell count so a pathological/noisy bitmap can't overflow the
        // fixed buffer. A real coherent silhouette keeps far fewer than this
        // (the prototype #1250 kept ~120); 600 * ~190 bytes/cell < the 128KB cap.
        bytes memory buf = _bufNew(131072);
        _bufCat(buf, '<g filter="url(#g)" stroke-width="1.6">');
        uint256 kept = 0;
        for (uint256 row = 0; row < 40 && kept < 600; row++) {
            for (uint256 col = 0; col < 40 && kept < 600; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
                if (_isLabelCell(normieId, row, col)) continue;
                uint256 intensity = _glassIntensity(raw, col, row, cMin, cMax, rMin, rMax);
                if (intensity < 70) continue;
                _bufCat(buf, _glassRect(col, row, intensity));
                kept++;
            }
        }
        _bufCat(buf, "</g>");
        return _bufStr(buf);
    }

    // intensity (x1000) = bandAlpha * interiorMult * falloff * variety / 1e9.
    // Built incrementally (v = v * factor / 1000) to keep the stack shallow.
    function _glassIntensity(
        bytes memory raw,
        uint256 col,
        uint256 row,
        uint256 cMin,
        uint256 cMax,
        uint256 rMin,
        uint256 rMax
    )
        private
        pure
        returns (uint256 v)
    {
        {
            uint256 nb = _neigh8(raw, col, row); // 3x3 on-count (excl. centre)
            uint256 band = nb <= 1 ? 0 : (nb - 1 > 6 ? 6 : nb - 1);
            v = _bandAlpha(band);
        }
        {
            uint256 interiorSum = _cellOn(raw, int256(col) - 1, int256(row))
                + _cellOn(raw, int256(col) + 1, int256(row))
                + _cellOn(raw, int256(col), int256(row) - 1)
                + _cellOn(raw, int256(col), int256(row) + 1);
            v = v * _interiorMult(interiorSum) / 1000;
        }
        {
            uint256 tA = cMax > cMin ? 1000 * _absd(2 * col, cMin + cMax) / (cMax - cMin) : 0;
            uint256 tB = rMax > rMin ? 1000 * _absd(2 * row, rMin + rMax) / (rMax - rMin) : 0;
            uint256 t = tA > tB ? tA : tB;
            uint256 sub = 850 * t / 1000;
            v = v * (sub >= 850 ? 50 : 900 - sub) / 1000;
        }
        {
            uint256 variety = 350 + (uint256(keccak256(abi.encodePacked(col, row))) % 1000) * 650 / 1000;
            v = v * variety / 1000;
        }
    }

    function _glassRect(uint256 col, uint256 row, uint256 intensity)
        private
        pure
        returns (string memory rect)
    {
        uint256 x = 100 + col * 25 + 2;
        uint256 y = 85 + row * 25 + 2;
        (uint256 R, uint256 G, uint256 B) = _lightColor(100 + col * 25 + 12, 85 + row * 25 + 12);
        uint256 op = intensity * 2 > 1000 ? 1000 : intensity * 2;
        uint256 bodyOp = intensity > 880 ? 880 : intensity;
        rect = string.concat(
            '<rect x="', x.toString(), '" y="', y.toString(), '" width="21" height="21" fill="rgb(',
            R.toString(), ",", G.toString(), ",", B.toString(), ')" fill-opacity="', _dec2(bodyOp),
            '" stroke="rgb(', _lerp255(R), ",", _lerp255(G), ",", _lerp255(B),
            ')" stroke-opacity="', _dec2(op), '"/>'
        );
        if (intensity > 500) {
            rect = string.concat(
                rect,
                '<circle cx="', (x + 6).toString(), '" cy="', (y + 6).toString(),
                '" r="1.1" fill="#fff" opacity="', _dec2(op / 2), '"/>'
            );
        }
    }

    // RGB light field at canvas (px,py). Each light contributes a = R^2/(R^2+d^2)
    // to its channel (R=520). Saturate to the dominant hue, then blend toward
    // white only where several lights strongly overlap.
    function _lightColor(uint256 px, uint256 py)
        private
        pure
        returns (uint256 R8, uint256 G8, uint256 B8)
    {
        uint256 r = _lightA(px, py, 1010, 300);
        uint256 g = _lightA(px, py, 210, 770);
        uint256 b = _lightA(px, py, 660, 120);
        uint256 mx = r;
        if (g > mx) mx = g;
        if (b > mx) mx = b;
        if (mx == 0) mx = 1;
        uint256 R = r * 10000 / mx;
        uint256 G = g * 10000 / mx;
        uint256 B = b * 10000 / mx;
        uint256 sum = r + g + b;
        uint256 white = sum > 13000 ? (sum - 13000) / 2 : 0;
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
        return 270400 * 10000 / (270400 + dx * dx + dy * dy);
    }

    // bright hue-tinted rim: v lerped 30% toward 255.
    function _lerp255(uint256 v) private pure returns (string memory) {
        return (v + (255 - v) * 3 / 10).toString();
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

    function _bbox(bytes memory raw)
        private
        pure
        returns (uint256 cMin, uint256 cMax, uint256 rMin, uint256 rMax, bool any)
    {
        cMin = 39;
        rMin = 39;
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
                any = true;
                if (col < cMin) cMin = col;
                if (col > cMax) cMax = col;
                if (row < rMin) rMin = row;
                if (row > rMax) rMax = row;
            }
        }
    }

    function _bandAlpha(uint256 band) private pure returns (uint256) {
        if (band == 0) return 1000;
        if (band == 1) return 840;
        if (band == 2) return 680;
        if (band == 3) return 500;
        if (band == 4) return 340;
        if (band == 5) return 200;
        return 80;
    }

    function _interiorMult(uint256 interiorSum) private pure returns (uint256) {
        if (interiorSum == 0) return 1000;
        if (interiorSum == 1) return 871;
        if (interiorSum == 2) return 671;
        if (interiorSum == 3) return 430;
        return 160;
    }

    function _absd(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : b - a;
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
        for (uint256 bi = 0; bi < 21; bi++) {
            uint256 edge = bi / 7;
            if (!_edgePointActive(data, edge, bi - edge * 7)) continue;
            // one tree per active edge point (matches the nodes/streets exactly).
            glow = string.concat(glow, _treeStrands(data, bi, false, layout));
            core = string.concat(core, _treeStrands(data, bi, true, layout));
            tips = string.concat(tips, _treeTips(data, bi, layout));
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

