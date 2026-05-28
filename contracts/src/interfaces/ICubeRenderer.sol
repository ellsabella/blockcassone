// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ICubeRenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
