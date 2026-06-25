// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";

/// @notice Parity probe: logs the on-chain _sidePlan masks for fixed seeds so the
/// JS twin (core/side-plan.js) can be diffed against them. Mirrors
/// CubeThumbnailRendererV1._sidePlan exactly. Not deployed — `forge script` only.
contract SidePlanProbe is Script {
    function run() external pure {
        bytes32[3] memory seeds = [
            bytes32(uint256(0x7777777777777777777777777777777777777777777777777777777777777777)),
            keccak256("blockcassone-mainnet-preview"),
            bytes32(uint256(1))
        ];
        for (uint256 s = 0; s < 3; s++) {
            console2.log("seed");
            console2.logBytes32(seeds[s]);
            for (uint256 edge = 0; edge < 3; edge++) {
                (uint256 orb, uint256 strand) = _sidePlan(seeds[s], edge);
                console2.log("  edge", edge);
                console2.log("    orbMask   ", orb);
                console2.log("    strandMask", strand);
            }
        }
    }

    function _sidePlan(bytes32 seed, uint256 edge)
        private
        pure
        returns (uint256 orbMask, uint256 strandMask)
    {
        uint256 canon = edge == 0 ? 23 : (edge == 1 ? 34 : 45);
        uint256 h = uint256(keccak256(abi.encodePacked(seed, canon)));
        uint256 count = 2 + (h & 0xff) % 5;
        uint256 placed;
        for (uint256 i = 0; i < 7; i++) {
            uint256 needed = count - placed;
            if ((((h >> (8 + i * 8)) & 0xff) % (7 - i)) < needed) {
                orbMask |= (1 << i);
                placed++;
                if (edge == 1 || ((h >> (72 + i)) & 1) == 1) {
                    strandMask |= (1 << i);
                }
            }
        }
    }
}
