// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface INormiesCore {
    function ownerOf(uint256 tokenId) external view returns (address);
    function storageContract() external view returns (address);
    function rendererContract() external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function maxSupply() external pure returns (uint256);
}
