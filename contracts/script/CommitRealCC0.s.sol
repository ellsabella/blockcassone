// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Phase 1: overwrite the STUB CC0 tonal payloads on the EXISTING Sepolia deployment with
// REAL flattened Chain-Runners / Skulls / Pepes / Nouns art (data/cc0/<i>.hex, produced by
// dev/cc0-proof/flatten.mjs from mainnet-fork art). Signed by the throwaway deployer, which
// OWNS the genesis minter; setSourcePayload[Batch] is onlyOwner and doesn't check finalized,
// and the store has no already-recorded guard, so this is a clean post-drop overwrite.
//
// Live source keys (queried on-chain): Runners 1000/1001, Skulls 2000/2002, Pepes 3001,
// Nouns 4000. Payload index -> kind: runner 0..7, skull 8..15, noun 16..19, pepe 20..23.

import { Script } from "forge-std/Script.sol";

interface IMultiSourceGenesisMinter {
    function setSourcePayload(uint8 collectionId, uint256 tokenId, bytes calldata payload) external;
    function setSourcePayloadBatch(uint8 collectionId, uint256[] calldata tokenIds, bytes[] calldata payloads) external;
}

contract CommitRealCC0 is Script {
    IMultiSourceGenesisMinter constant MINTER =
        IMultiSourceGenesisMinter(0x8d0848afA056bc58C2dfecF2bd002226EBcc0254);

    function _payload(uint256 idx) internal view returns (bytes memory) {
        string memory s = vm.readFile(string.concat("data/cc0/", vm.toString(idx), ".hex"));
        bytes memory p = vm.parseBytes(s);
        require(p.length == 400, "payload not 400 bytes");
        return p;
    }

    function run() external {
        vm.startBroadcast();

        // Collection 1 (Chain Runners): srcIds 1000, 1001 -> runner payloads 0, 1
        uint256[] memory rIds = new uint256[](2);
        bytes[] memory rPl = new bytes[](2);
        rIds[0] = 1000; rPl[0] = _payload(0);
        rIds[1] = 1001; rPl[1] = _payload(1);
        MINTER.setSourcePayloadBatch(1, rIds, rPl);

        // Collection 2 (1337 Skulls): srcIds 2000, 2002 -> skull payloads 8, 9
        uint256[] memory sIds = new uint256[](2);
        bytes[] memory sPl = new bytes[](2);
        sIds[0] = 2000; sPl[0] = _payload(8);
        sIds[1] = 2002; sPl[1] = _payload(9);
        MINTER.setSourcePayloadBatch(2, sIds, sPl);

        // Collection 3 (Baby Pepes): srcId 3001 -> pepe payload 20
        MINTER.setSourcePayload(3, 3001, _payload(20));

        // Collection 4 (Nouns): srcId 4000 -> noun payload 16
        MINTER.setSourcePayload(4, 4000, _payload(16));

        vm.stopBroadcast();
    }
}
