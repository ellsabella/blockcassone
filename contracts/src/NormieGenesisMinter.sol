// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CubeNFT } from "./CubeNFT.sol";
import { GenesisMinterBase } from "./GenesisMinterBase.sol";

/// @notice Genesis mint for Normie-sourced cubes. Art is on-chain (the renderer
///         reads the Normie bitmap directly), so the source cube mint carries only
///         the optional agent-awakening id. All snapshot/allowlist/public/pool
///         logic lives in GenesisMinterBase.
contract NormieGenesisMinter is GenesisMinterBase {
    constructor(CubeNFT cubes_, bytes32 publicSeed_, address initialOwner_)
        GenesisMinterBase(cubes_, publicSeed_, initialOwner_)
    { }

    function _mintSourceCube(
        address minter,
        uint256 sourceId,
        uint32 slot,
        bytes32 seed,
        uint256 agentId
    ) internal override returns (uint256 cubeId) {
        return agentId == 0
            ? cubes.mintSnapshotNormieCubeFor(minter, sourceId, slot, seed)
            : cubes.mintSnapshotNormieCubeForWithAgent(minter, sourceId, slot, seed, agentId);
    }
}
