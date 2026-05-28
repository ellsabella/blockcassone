// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {CubeNFT} from "./CubeNFT.sol";
import {ICubeRenderer} from "./interfaces/ICubeRenderer.sol";

contract CubeRendererV1 is ICubeRenderer {
    using Strings for uint256;

    CubeNFT public immutable cubes;

    constructor(CubeNFT cubes_) {
        cubes = cubes_;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(metadataJSON(tokenId)))
        );
    }

    function metadataJSON(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);

        return string.concat(
            "{",
            _metadataHeader(tokenId),
            _metadataMedia(tokenId),
            '"attributes":[',
            _attributesJSON(data),
            "]",
            "}"
        );
    }

    function _metadataHeader(uint256 tokenId) private pure returns (string memory) {
        return string.concat(
            '"name":"Blockcassone Cube #',
            tokenId.toString(),
            '",',
            '"description":"A fully onchain Blockcassone Hilbert cube. This renderer is an early metadata boundary; final visual chunks will replace the placeholder image and animation.",'
        );
    }

    function _metadataMedia(uint256 tokenId) private view returns (string memory) {
        string memory image = imageURI(tokenId);
        return string.concat(
            '"image":"',
            image,
            '",',
            '"image_url":"',
            image,
            '",',
            '"animation_url":"',
            animationURI(tokenId),
            '",'
        );
    }

    function _attributesJSON(CubeNFT.CubeData memory data) private pure returns (string memory) {
        return string.concat(
            _placementAttributes(data),
            ",",
            _sourceAttributes(data),
            ",",
            _versionAttributes(data)
        );
    }

    function _placementAttributes(CubeNFT.CubeData memory data)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            _trait("Hilbert Slot", uint256(data.slot).toString()),
            ",",
            _trait("Region", regionForSlot(data.slot).toString()),
            ",",
            _trait("Neighbourhood", neighbourhoodForSlot(data.slot).toString())
        );
    }

    function _sourceAttributes(CubeNFT.CubeData memory data) private pure returns (string memory) {
        return string.concat(
            _trait("Source Kind", sourceKindName(data.sourceKind)),
            ",",
            _trait("Source Chain ID", data.sourceChainId.toString()),
            ",",
            _trait("Source Contract", _addressHex(data.sourceContract)),
            ",",
            _trait("Source Token ID", data.sourceTokenId.toString())
        );
    }

    function _versionAttributes(CubeNFT.CubeData memory data) private pure returns (string memory) {
        return string.concat(
            _trait("Renderer Version", uint256(data.rendererVersion).toString()),
            ",",
            _trait("Payload Version", uint256(data.payloadVersion).toString())
        );
    }

    function imageURI(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);
        string memory sourceColor = data.sourceKind == cubes.SOURCE_KIND_NORMIE()
            ? "#ff2a2a"
            : "#ff0a0a";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">',
            '<rect width="1200" height="1200" fill="#050505"/>',
            '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M340 315 720 205 940 460 550 590Z" stroke="#5d6a72" stroke-width="10" opacity=".72"/>',
            '<path d="M340 315v430l210 260V590Z" stroke="#4b565e" stroke-width="10" opacity=".58"/>',
            '<path d="M550 590v415l390-280V460Z" stroke="#6c7780" stroke-width="10" opacity=".64"/>',
            '<path d="M340 315 340 745 550 1005 940 725 940 460 720 205Z" stroke="#d8e6ee" stroke-width="7" opacity=".42"/>',
            '<path d="M415 455h195v210h180v-120h-85v-150h-205v-95" stroke="',
            sourceColor,
            '" stroke-width="18" opacity=".92"/>',
            '<path d="M450 700c90-70 190-35 275-95 76-54 88-145 140-176" stroke="#ffffff" stroke-width="5" opacity=".42"/>',
            "</g>",
            '<text x="70" y="1080" fill="#f5f5f5" font-family="monospace" font-size="42">slot ',
            uint256(data.slot).toString(),
            "</text>",
            '<text x="70" y="1134" fill="#a8a8a8" font-family="monospace" font-size="28">',
            sourceKindName(data.sourceKind),
            " / region ",
            regionForSlot(data.slot).toString(),
            " / neighbourhood ",
            neighbourhoodForSlot(data.slot).toString(),
            "</text>",
            "</svg>"
        );

        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function animationURI(uint256 tokenId) public view returns (string memory) {
        CubeNFT.CubeData memory data = cubes.cubeData(tokenId);
        string memory html = string.concat(
            "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
            "<title>Blockcassone Cube #",
            tokenId.toString(),
            "</title><style>html,body{margin:0;width:100%;height:100%;background:#050505;color:#eee;font:14px monospace;display:grid;place-items:center}main{max-width:720px;padding:24px}b{color:#ff2a2a}</style></head>",
            "<body><main><h1>Blockcassone Cube #",
            tokenId.toString(),
            "</h1><p><b>Interactive raw WebGL renderer placeholder.</b></p><p>slot ",
            uint256(data.slot).toString(),
            " / region ",
            regionForSlot(data.slot).toString(),
            " / neighbourhood ",
            neighbourhoodForSlot(data.slot).toString(),
            "</p><p>Final orbit, zoom, glass, voxel, contour, and banner rendering will be supplied by renderer asset chunks.</p></main></body></html>"
        );

        return string.concat("data:text/html;base64,", Base64.encode(bytes(html)));
    }

    function regionForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 8;
    }

    function neighbourhoodForSlot(uint32 slot) public pure returns (uint256) {
        return uint256(slot) / 64;
    }

    function sourceKindName(uint8 sourceKind) public pure returns (string memory) {
        if (sourceKind == 1) return "Normie";
        if (sourceKind == 2) return "External ERC-721";
        return "Unknown";
    }

    function _trait(string memory traitType, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', traitType, '","value":"', value, '"}');
    }

    function _addressHex(address value) private pure returns (string memory) {
        return Strings.toHexString(uint160(value), 20);
    }
}
