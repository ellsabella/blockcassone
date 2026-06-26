// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CubeEnv
/// @notice The Big Cube's environment (biome) model. Environment is a STREET
/// property — all 8 plots of a street share it — distributed across the 512
/// streets at world setup, rarity-weighted so some biomes are scarcer.
///
/// Deterministic and permanent: `id = weightedPick(keccak(WORLD_SEED, street))`.
/// The JS viewer must use the same WORLD_SEED + weights so 2D/3D agree (mirror
/// of the sidePlan parity).
///
/// Biome ids match the dev viewer's ENVIRONMENTS order:
///   0 desert  1 water  2 grass  3 forest  4 mountain  5 ice
library CubeEnv {
    bytes32 internal constant WORLD_SEED = keccak256("blockcassone-environments-v1");

    // Rarity weights out of 100 (first pass — tune freely):
    //   commons  grass 28, forest 24
    //   uncommon desert 18, water 16
    //   rare     mountain 9, ice 5
    function idForStreet(uint256 street) internal pure returns (uint256) {
        uint256 r = uint256(keccak256(abi.encodePacked(WORLD_SEED, street))) % 100;
        if (r < 28) return 2; // grass
        if (r < 52) return 3; // forest
        if (r < 70) return 0; // desert
        if (r < 86) return 1; // water
        if (r < 95) return 4; // mountain
        return 5; // ice
    }

    function nameForStreet(uint256 street) internal pure returns (string memory) {
        uint256 id = idForStreet(street);
        if (id == 0) return "desert";
        if (id == 1) return "water";
        if (id == 2) return "grass";
        if (id == 3) return "forest";
        if (id == 4) return "mountain";
        return "ice";
    }
}
