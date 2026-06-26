// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Base64 } from "openzeppelin-contracts/contracts/utils/Base64.sol";
import { Strings } from "openzeppelin-contracts/contracts/utils/Strings.sol";
import { CubeNFT } from "./CubeNFT.sol";
import { ICubeRenderer } from "./interfaces/ICubeRenderer.sol";
import { RendererAssetStore } from "./RendererAssetStore.sol";
import { StrBuf } from "./lib/StrBuf.sol";
import { CubeEnv } from "./lib/CubeEnv.sol";

interface INormieRawImageStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
}

interface ICubeThumbnailRenderer {
    function thumbnailSVG(uint256 tokenId) external view returns (string memory);
}

contract CubeRendererV2 is ICubeRenderer {
    using Strings for uint256;
    using StrBuf for bytes;

    uint256 public constant HTML_HEAD_CHUNK = 0;
    uint256 public constant HTML_SCRIPT_CHUNK = 1;
    uint256 public constant HTML_SCRIPT_START_CHUNK = 1;

    CubeNFT public immutable cubes;
    RendererAssetStore public immutable assets;
    address public immutable normieStorage;
    address public immutable thumbnailRenderer;

    constructor(
        CubeNFT cubes_,
        RendererAssetStore assets_,
        address normieStorage_,
        address thumbnailRenderer_
    ) {
        cubes = cubes_;
        assets = assets_;
        normieStorage = normieStorage_;
        thumbnailRenderer = thumbnailRenderer_;
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
        return ICubeThumbnailRenderer(thumbnailRenderer).thumbnailSVG(tokenId);
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
            ",seed:'",
            Strings.toHexString(uint256(data.seed), 32),
            "',raw:'",
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

    function _attributesJSON(CubeNFT.CubeData memory data) private view returns (string memory) {
        // Built into the shared O(n) buffer: many trait calls in one concat risk
        // the legacy stack limit (no via-IR).
        uint256 street = streetForSlot(data.slot);
        bytes memory buf = StrBuf.alloc(2048);
        buf.cat(_trait("plot", uint256(data.slot).toString()));
        buf.cat(",");
        buf.cat(_trait("region", regionForSlot(data.slot).toString()));
        buf.cat(",");
        buf.cat(_trait("neighbourhood", neighbourhoodForSlot(data.slot).toString()));
        buf.cat(",");
        buf.cat(_trait("street", street.toString()));
        buf.cat(",");
        buf.cat(_trait("Environment", CubeEnv.nameForStreet(street)));
        buf.cat(",");
        // Population is 1 for a single cube; a merged-street token reports its
        // occupied-plot count instead.
        buf.cat(_trait("Population", "1"));
        buf.cat(",");
        buf.cat(_trait("Source Kind", data.sourceKind == cubes.SOURCE_KIND_NORMIE() ? "Normie" : "External ERC-721"));
        buf.cat(",");
        buf.cat(_trait("Source Contract", Strings.toHexString(uint160(data.sourceContract), 20)));
        buf.cat(",");
        buf.cat(_trait("Source Token ID", data.sourceTokenId.toString()));
        buf.cat(",");
        buf.cat(_trait("Agentic", data.agentic ? "Y" : "N"));
        buf.cat(",");
        buf.cat(_trait("Agent ID", data.agentId.toString()));
        buf.cat(",");
        buf.cat(_trait("Renderer Version", "2"));
        buf.cat(",");
        buf.cat(_trait("Payload Version", uint256(data.payloadVersion).toString()));
        return buf.str();
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

        // Fetch each chunk once, sum lengths, then build into the shared O(n)
        // buffer — the old `out = concat(out, chunk)` loop was O(n^2) on a ~100KB
        // bundle.
        uint256 n = count - HTML_SCRIPT_START_CHUNK;
        string[] memory parts = new string[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            parts[i] = assets.chunk(HTML_SCRIPT_START_CHUNK + i);
            total += bytes(parts[i]).length;
        }
        bytes memory buf = StrBuf.alloc(total + 32);
        for (uint256 i = 0; i < n; i++) {
            buf.cat(parts[i]);
        }
        string memory out = buf.str();
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

