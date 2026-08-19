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

interface INonNormieArtStore {
    function imageBytesForCube(uint256 cubeId) external view returns (bytes memory);
    function payloadForCube(uint256 cubeId) external view returns (bytes memory);
}

interface ICollectionName {
    function name() external view returns (string memory);
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
    address public immutable nonNormieStore;

    constructor(
        CubeNFT cubes_,
        RendererAssetStore assets_,
        address normieStorage_,
        address thumbnailRenderer_,
        address nonNormieStore_
    ) {
        cubes = cubes_;
        assets = assets_;
        normieStorage = normieStorage_;
        thumbnailRenderer = thumbnailRenderer_;
        nonNormieStore = nonNormieStore_;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        // Base64 wrapper: raw JSON in a data URI carries unescaped `"{}` and
        // spaces, which strict URI parsers (and some marketplace validators)
        // reject. Base64 keeps every byte URI-safe end to end.
        return string.concat(
            "data:application/json;base64,", Base64.encode(bytes(metadataJSON(tokenId)))
        );
    }

    function metadataJSON(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.resolvedCubeData(tokenId);
        string memory image = imageURI(tokenId);
        bool isStreet = data.sourceKind == cubes.SOURCE_KIND_MERGED_STREET();
        return string.concat(
            "{",
            isStreet ? '"name":"TheBLOCK Street #' : '"name":"TheBLOCK #',
            tokenId.toString(),
            '",',
            '"description":"A fully onchain TheBLOCK Hilbert cube, rendered from contract-stored source facts and onchain renderer chunks.",',
            '"image":"',
            image,
            '",',
            '"animation_url":"',
            animationURI(tokenId),
            '",',
            '"attributes":[',
            _attributesJSON(tokenId, data),
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

    function _sourceKindLabel(uint8 sourceKind) private view returns (string memory) {
        if (sourceKind == cubes.SOURCE_KIND_NORMIE()) return "Normie";
        if (sourceKind == cubes.SOURCE_KIND_MERGED_STREET()) return "Merged Street";
        return "External ERC-721";
    }

    function _tokenConfig(uint256 tokenId, CubeNFT.CubeData memory data)
        private
        view
        returns (string memory)
    {
        if (data.sourceKind == cubes.SOURCE_KIND_MERGED_STREET()) {
            return _streetTokenConfig(tokenId);
        }
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
            _rawImageBase64(tokenId, data),
            "',tonal:'",
            _tonalBase64(tokenId, data),
            "'};</script>"
        );
    }

    /// Street tokens inject `{kind:'street', plots:[...8...]}` so the renderer's
    /// per-street view (entry.js) lights up. Each plot carries the source facts of
    /// its (now-burned) cube; vacant plots carry only their slot.
    function _streetTokenConfig(uint256 tokenId) private view returns (string memory) {
        (uint32 street, uint8 occ, uint256[8] memory plotIds) = cubes.streetPlots(tokenId);
        uint256 base = uint256(street) * 8;

        // Pre-fetch each occupied plot's data + raw base64 so the buffer can be
        // sized exactly (raw image data dominates and is variable length).
        CubeNFT.CubeData[8] memory pds;
        string[8] memory raws;
        uint256 total = 512;
        for (uint256 k = 0; k < 8; k++) {
            if (plotIds[k] != 0) {
                pds[k] = cubes.cubeDataUnchecked(plotIds[k]);
                raws[k] = _rawImageBase64(plotIds[k], pds[k]);
            }
            // Fixed-field cushion per plot: labels+seed(66) ≈ 190, plus slot/sourceTokenId/
            // agentId which are uint256s (≤78 digits each) — 512 covers the worst case
            // (the old 192 cushion violated the buffer contract for huge re-based ids).
            total += bytes(raws[k]).length + 512;
        }

        bytes memory buf = StrBuf.alloc(total + 64);
        buf.cat("<script>window.BLOCKCASSONE_TOKEN={kind:'street',tokenId:");
        buf.cat(tokenId.toString());
        buf.cat(",street:");
        buf.cat(uint256(street).toString());
        buf.cat(",population:");
        buf.cat(uint256(occ).toString());
        buf.cat(",normieStorage:'");
        buf.cat(Strings.toHexString(uint160(normieStorage), 20));
        buf.cat("',plots:[");
        for (uint256 k = 0; k < 8; k++) {
            if (k != 0) buf.cat(",");
            if (plotIds[k] == 0) {
                buf.cat("{occupied:false,slot:");
                buf.cat((base + k).toString());
                buf.cat("}");
            } else {
                buf.cat("{occupied:true,slot:");
                buf.cat(uint256(pds[k].slot).toString());
                buf.cat(",sourceTokenId:");
                buf.cat(pds[k].sourceTokenId.toString());
                buf.cat(",seed:'");
                buf.cat(Strings.toHexString(uint256(pds[k].seed), 32));
                buf.cat("',agentic:");
                buf.cat(pds[k].agentic ? "true" : "false");
                buf.cat(",agentId:");
                buf.cat(pds[k].agentId.toString());
                buf.cat(",raw:'");
                buf.cat(raws[k]);
                buf.cat("'}");
            }
        }
        buf.cat("]};</script>");
        return buf.str();
    }

    function _rawImageBase64(uint256 cubeId, CubeNFT.CubeData memory data)
        private
        view
        returns (string memory)
    {
        return Base64.encode(_rawImageBytes(cubeId, data));
    }

    // The 2-bit tonal payload (base64) for external/customized cubes, so the WebGL
    // renderer can draw band contours + band-shaded voxels instead of a 1-bit
    // silhouette. Empty for Normie (intrinsically 1-bit) or if none is recorded.
    function _tonalBase64(uint256 cubeId, CubeNFT.CubeData memory data)
        private
        view
        returns (string memory)
    {
        if (data.sourceKind == cubes.SOURCE_KIND_NORMIE() || nonNormieStore == address(0)) return "";
        try INonNormieArtStore(nonNormieStore).payloadForCube(cubeId) returns (bytes memory p) {
            return Base64.encode(p);
        } catch {
            return "";
        }
    }

    function _rawImageBytes(uint256 cubeId, CubeNFT.CubeData memory data)
        private
        view
        returns (bytes memory)
    {
        if (data.sourceKind == cubes.SOURCE_KIND_NORMIE()) {
            if (normieStorage == address(0)) return "";
            try INormieRawImageStorage(normieStorage).getTokenRawImageData(data.sourceTokenId) returns (
                bytes memory raw
            ) {
                return raw;
            } catch {
                return "";
            }
        }
        // External / customized cubes pull the store's recorded art (already the
        // 1-bit bitmap the 3D view expects). Same source as the thumbnail.
        if (nonNormieStore != address(0)) {
            try INonNormieArtStore(nonNormieStore).imageBytesForCube(cubeId) returns (
                bytes memory bitmap
            ) {
                return bitmap;
            } catch {
                return "";
            }
        }
        return "";
    }

    function _attributesJSON(uint256 tokenId, CubeNFT.CubeData memory data) private view returns (string memory) {
        // Built into the shared O(n) buffer: many trait calls in one concat risk
        // the legacy stack limit (no via-IR).
        bool isStreet = data.sourceKind == cubes.SOURCE_KIND_MERGED_STREET();
        uint256 street = streetForSlot(data.slot);
        // Population is 1 for a single cube; a merged-street token reports its
        // occupied-plot count.
        string memory population = "1";
        if (isStreet) {
            (, uint8 occ,) = cubes.streetPlots(tokenId);
            population = uint256(occ).toString();
        }
        // 4KB: base traits ~1.4KB + up to 8 merged-plot source traits.
        bytes memory buf = StrBuf.alloc(4096);
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
        buf.cat(_trait("Population", population));
        buf.cat(",");
        buf.cat(_trait("Merged", isStreet ? "Y" : "N"));
        buf.cat(",");
        buf.cat(_trait("Source Kind", _sourceKindLabel(data.sourceKind)));
        buf.cat(",");
        buf.cat(_trait("Source Contract", Strings.toHexString(uint160(data.sourceContract), 20)));
        buf.cat(",");
        // Collection names read live from the source contracts' own ERC-721 name().
        // Origin = the immutable genesis collection (permanent provenance); Current =
        // what the cube shows now (they differ once a cube re-bases post-mint).
        (address originContract,) = cubes.cubeOrigin(tokenId);
        buf.cat(_trait("Origin Collection", _sourceArtLabel(originContract)));
        buf.cat(",");
        buf.cat(_trait("Current Collection", _sourceArtLabel(data.sourceContract)));
        buf.cat(",");
        buf.cat(_trait("Source Token ID", data.sourceTokenId.toString()));
        buf.cat(",");
        buf.cat(_trait("Agentic", data.agentic ? "Y" : "N"));
        buf.cat(",");
        buf.cat(_trait("Agent ID", data.agentId.toString()));
        // Renderer/payload versions are implementation internals (queryable via
        // cubeData), not collector traits — deliberately NOT emitted.
        if (isStreet) {
            // A merged street lists every burned plot's source artwork — the
            // provenance of what it absorbed. View-only; plot data is retained
            // at merge time exactly for this.
            (, , uint256[8] memory plots) = cubes.streetPlots(tokenId);
            for (uint256 i = 0; i < 8; i++) {
                if (plots[i] == 0) continue;
                CubeNFT.CubeData memory pd = cubes.cubeDataUnchecked(plots[i]);
                buf.cat(",");
                buf.cat(
                    _trait(
                        string.concat("Plot ", i.toString(), " Source"),
                        string.concat(
                            _sourceArtLabel(pd.sourceContract), " #", pd.sourceTokenId.toString()
                        )
                    )
                );
            }
        }
        return buf.str();
    }

    function _trait(string memory traitType, string memory value)
        private
        pure
        returns (string memory)
    {
        return string.concat('{"trait_type":"', traitType, '","value":"', value, '"}');
    }

    /// @dev The source collection's display name, read live from its ERC-721 name().
    ///      Falls back gracefully so a source without name() (or address(0), e.g. a
    ///      merged-street token) never breaks metadata. The token's art never depends
    ///      on this — it's a cosmetic trait only.
    function _sourceArtLabel(address sourceContract) private view returns (string memory) {
        // Skip address(0) and codeless addresses: a name() call on a contract-less
        // address returns empty data that fails string-decode outside the catch.
        if (sourceContract == address(0) || sourceContract.code.length == 0) return "Unknown";
        // Gas-capped: an untrusted (customized-source) contract must not be able to
        // consume the whole render budget from inside name().
        try ICollectionName(sourceContract).name{ gas: 200_000 }() returns (string memory n) {
            if (bytes(n).length > 0) return _jsonEscape(n);
        } catch { }
        return "Unknown";
    }

    /// @dev Minimal JSON string escaping for an untrusted external name(): escape " and
    ///      \, replace control chars with a space, and cap the length (collection names
    ///      are short) so a hostile source can't bloat or break the metadata JSON.
    function _jsonEscape(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 len = b.length > 64 ? 64 : b.length;
        bytes memory out = new bytes(len * 2);
        uint256 k;
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[k++] = "\\";
                out[k++] = c;
            } else if (uint8(c) < 0x20) {
                out[k++] = " ";
            } else {
                out[k++] = c;
            }
        }
        bytes memory res = new bytes(k);
        for (uint256 i = 0; i < k; i++) {
            res[i] = out[i];
        }
        return string(res);
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
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><style>@font-face{font-family:'NormiesFont';src:url(data:font/woff2;base64,d09GMgABAAAAAAJcAAoAAAAACfgAAAISAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAPAqMfIocATYCJAMmCyQABCAFgkoHIBvBBwCeBXbLE2WILCc+GpqG29HsXqU0Hqp7fXt3KdrG6/gHi2AEAhiEkEbj0dK00sLzcM33r9KOI6lq1iCz6ZnPaBO5i20iXtJXLCTIHEl8S4h4CGmp7QANr0x1OoF7tVYtR/T+/19NZ9kFN5J2lebRa7jVPwb45rb8ZaiTJZ5YxgElEGLK2dQVWDoZW5D/TPQT1fqPImm2xeCv/xR0XvXNDfVmAdRZBZgBBSpMqQSmNDX0aYRi98pE55qZxzwdABgBC9hB4oWyBQENYEhnMmkMJoNDa5u1PO9HG6vIRTmf/dwfeJY5t7U+Onb2xnWfGGwn3e/4w7bCnwvZltgYex5/mJTbvtqcgjjReSZX0qP+fe5/IBaafxI21AORwEDOQLE+lnyBD8AezUszCXykD64t8Tj+bXZXhTwpRtKCBGo46z2d5PDF4dgvnDBabhAsBJh7VaNmef406p7qgCsMgRCKkUCD4qz6JJQCoUxd4lapRN/Qgs2SW9/T367bVkDzXSpOqaOYfg8goOL/3x9RqL4twV9wPv1XXn6ND5USSV/sNQ72G2LblArX+f+DcqTjPVDwq4EPnDQWwQp6IyJ5owhcGtWL3mhK30YX+b2XoXR6JrPHqlGp7UDtwIu9FVYZw2Q1aBQ2mslo5yhUDr3E6j9EWTZ5KUVv3dejRVOT2UAnxI8CFSisPmHzHGDU6Grfj9sAAA==) format('woff2');font-display:block}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020203;color:#ff98d9;font:13px monospace}canvas{width:100vw;height:100vh;display:block}.h{position:fixed;left:14px;bottom:12px;padding:9px 11px;border:2px solid #ff3ab8;background:#070208cc;text-shadow:0 0 10px #ff3ab8}</style></head><body><canvas id=c></canvas><div class=h id=h>TheBLOCK</div>";
    }

    function _defaultHTMLScript() private pure returns (string memory) {
        return
        "<script>(()=>{const T=window.BLOCKCASSONE_TOKEN,H=document.getElementById('h'),C=document.getElementById('c'),x=C.getContext('2d');C.width=innerWidth;C.height=innerHeight;x.fillStyle='#020203';x.fillRect(0,0,C.width,C.height);x.fillStyle='#ff98d9';x.font='700 18px monospace';x.fillText('Renderer asset chunks are not installed.',32,54);x.fillStyle='#aaffb2';x.font='14px monospace';x.fillText('Cube #'+T.tokenId+' / Normie #'+T.sourceTokenId+' / plot '+T.slot,32,84);H.textContent='TheBLOCK renderer fallback';})();</script></body></html>";
    }
}

