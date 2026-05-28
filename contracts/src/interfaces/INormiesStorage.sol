// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface INormiesStorage {
    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory);
    function getTokenTraits(uint256 tokenId) external view returns (bytes8);
    function isTokenDataSet(uint256 tokenId) external view returns (bool);
    function isRevealed() external view returns (bool);
}
