// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract RendererAssetStore is Ownable {
    event ChunkUpdated(uint256 indexed chunkId, bytes32 contentHash, uint256 byteLength);
    event ChunkCountUpdated(uint256 chunkCount);

    mapping(uint256 chunkId => string content) private _chunks;
    uint256 public chunkCount;

    constructor(address initialOwner_) Ownable(initialOwner_) { }

    function setChunk(uint256 chunkId, string calldata content) external onlyOwner {
        _chunks[chunkId] = content;
        if (chunkId >= chunkCount) {
            chunkCount = chunkId + 1;
            emit ChunkCountUpdated(chunkCount);
        }
        emit ChunkUpdated(chunkId, keccak256(bytes(content)), bytes(content).length);
    }

    function setChunkCount(uint256 chunkCount_) external onlyOwner {
        chunkCount = chunkCount_;
        emit ChunkCountUpdated(chunkCount_);
    }

    function chunk(uint256 chunkId) external view returns (string memory) {
        return _chunks[chunkId];
    }
}
