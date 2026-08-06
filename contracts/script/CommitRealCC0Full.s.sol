// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Commit REAL flattened art to ALL 12 seeded CC0 pool sources on the existing Sepolia
// deployment (idempotent overwrite of the deploy's stub payloads). The 6 claimed sources
// render real art on their cubes; the 6 unclaimed ones become real-art spin targets, so
// "spin CC0" always previews real art. Signed by the throwaway deployer (owns the minter).
//
// Pool (from _ccStartIds/_ccCaps): Runners 1000-1003, Skulls 2000-2002, Pepes 3000-3001,
// Nouns 4000-4001, Kevin 5000. Payload index -> kind: runner 0-7, skull 8-15, noun 16-19,
// pepe 20-23, kevin 24-27.

import { Script } from "forge-std/Script.sol";

interface IMultiSourceGenesisMinter {
    function setSourcePayloadBatch(uint8 collectionId, uint256[] calldata tokenIds, bytes[] calldata payloads) external;
}

contract CommitRealCC0Full is Script {
    IMultiSourceGenesisMinter constant MINTER =
        IMultiSourceGenesisMinter(0x8d0848afA056bc58C2dfecF2bd002226EBcc0254);

    function _p(uint256 idx) internal view returns (bytes memory) {
        bytes memory p = vm.parseBytes(vm.readFile(string.concat("data/cc0/", vm.toString(idx), ".hex")));
        require(p.length == 400, "payload not 400 bytes");
        return p;
    }

    function _batch(uint8 col, uint256[] memory ids, uint256[] memory hexIdx) internal {
        bytes[] memory pl = new bytes[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) pl[i] = _p(hexIdx[i]);
        MINTER.setSourcePayloadBatch(col, ids, pl);
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d, uint256 n) internal pure returns (uint256[] memory out) {
        out = new uint256[](n);
        if (n > 0) out[0] = a; if (n > 1) out[1] = b; if (n > 2) out[2] = c; if (n > 3) out[3] = d;
    }

    function run() external {
        vm.startBroadcast();
        _batch(1, _ids(1000, 1001, 1002, 1003, 4), _ids(0, 1, 2, 3, 4));   // Runners
        _batch(2, _ids(2000, 2001, 2002, 0, 3), _ids(8, 10, 9, 0, 3));      // Skulls
        _batch(3, _ids(3000, 3001, 0, 0, 2), _ids(21, 20, 0, 0, 2));        // Pepes
        _batch(4, _ids(4000, 4001, 0, 0, 2), _ids(16, 17, 0, 0, 2));        // Nouns
        _batch(5, _ids(5000, 0, 0, 0, 1), _ids(24, 0, 0, 0, 1));            // Kevin
        vm.stopBroadcast();
    }
}
