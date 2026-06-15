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
        string memory bitmapPath = _bitmapPath(raw);
        string memory outlinePath = _outlinePath(raw);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#020203"/>',
            _thumbnailDefs(bitmapPath, outlinePath),
            _thumbnailPlaneFrame(data),
            _thumbnailBitmap(bitmapPath, outlinePath),
            '<text x="70" y="1078" fill="#ff98d9" font-family="monospace" font-size="42">cube #',
            tokenId.toString(),
            " / plot ",
            uint256(data.slot).toString(),
            "</text>",
            '<text x="70" y="1132" fill="#aaffb2" font-family="monospace" font-size="28">Normie #',
            data.sourceTokenId.toString(),
            " / region ",
            regionForSlot(data.slot).toString(),
            " / neighbourhood ",
            neighbourhoodForSlot(data.slot).toString(),
            " / street ",
            streetForSlot(data.slot).toString(),
            "</text></svg>"
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

    function _thumbnailDefs(string memory bitmapPath, string memory outlinePath)
        private
        pure
        returns (string memory)
    {
        if (bytes(bitmapPath).length == 0 || bytes(outlinePath).length == 0) return "";
        return string.concat(
            '<defs>',
            '<filter id="g" x="-20%" y="-20%" width="140%" height="140%">',
            '<feGaussianBlur stdDeviation="2.8" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>',
            "</filter>",
            '<path id="n" d="',
            bitmapPath,
            '"/>',
            '<path id="o" d="',
            outlinePath,
            '"/>',
            "</defs>"
        );
    }

    function _thumbnailBitmap(string memory bitmapPath, string memory outlinePath)
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
            '<g transform="translate(180 132) scale(21)">',
            '<use href="#n" fill="#ff174d" opacity=".10"/>',
            '<use href="#o" fill="none" stroke="#ff1919" stroke-width=".34" opacity=".95" filter="url(#g)"/>',
            '<use href="#o" fill="none" stroke="#ffffff" stroke-width=".08" opacity=".72"/>',
            "</g>"
        );
    }

    function _thumbnailPlaneFrame(CubeNFT.CubeData memory data) private pure returns (string memory) {
        string memory axis = _slotAxis(data.slot);
        return string.concat(
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<rect x="150" y="100" width="900" height="900" stroke="#ff3ab8" stroke-width="10" opacity=".95"/>',
            '<rect x="166" y="116" width="868" height="868" stroke="#ffffff" stroke-width="2" opacity=".42"/>',
            '<path d="M150 100h900M150 100v900M1050 100v900M150 100l900 900M1050 100 150 1000" stroke="#38ff4d" stroke-width="3" opacity=".26"/>',
            '<path d="M150 100h900M150 100v900" stroke="#ffffff" stroke-width="2" opacity=".64"/>',
            "</g>",
            '<text x="178" y="85" fill="#aaffb2" font-family="monospace" font-size="24">main plane / ',
            axis,
            "-axis</text>"
        );
    }

    function _slotAxis(uint32 slot) private pure returns (string memory) {
        uint256 axis = uint256(slot) % 3;
        if (axis == 0) return "x";
        if (axis == 1) return "y";
        return "z";
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

    function _outlinePath(bytes memory raw) private pure returns (string memory) {
        if (raw.length != 200) return "";

        string memory path = "";
        for (uint256 row = 0; row < 40; row++) {
            for (uint256 col = 0; col < 40; col++) {
                if (!_bitmapBit(raw, row * 40 + col)) continue;
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
