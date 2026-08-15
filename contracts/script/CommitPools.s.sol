// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";

/// @notice MAINNET owner op: commit the CC0 pools to an already-deployed
///         MultiSourceGenesisMinter — every pool id + its real flattened payload
///         (data/cc0/pool-*.json + data/cc0-full/<key>/<id>.hex, the DNA-corrected,
///         GTD-inclusive, liveness-gated dataset). Does NOT touch the Normie
///         snapshot, reservations, or finalize — those are separate runbook steps.
///
///         Env: BLOCKCASSONE_MINTER (the deployed minter). Broadcast as the minter's
///         owner. Idempotent-ish: re-running after a partial broadcast REVERTS on
///         already-committed payloads (art store forbids overwrite) — use forge's
///         --resume instead of re-running from scratch.
contract CommitPools is Script {
    uint8 internal constant CC0_COUNT = 5;
    uint256 internal constant POOL_BATCH = 150;
    uint256 internal constant PAYLOAD_BATCH = 50;

    function _keys() private pure returns (string[CC0_COUNT] memory k) {
        k[0] = "runner";
        k[1] = "skull";
        k[2] = "pepe";
        k[3] = "noun";
        k[4] = "kevin";
    }

    function run() external {
        MultiSourceGenesisMinter genesis =
            MultiSourceGenesisMinter(vm.envAddress("BLOCKCASSONE_MINTER"));
        require(!genesis.finalized(), "minter already finalized");

        string[CC0_COUNT] memory keys = _keys();
        uint256 total;
        for (uint256 c = 0; c < CC0_COUNT; c++) {
            uint8 collectionId = uint8(c + 1);
            uint256[] memory ids = vm.parseJsonUintArray(
                vm.readFile(string.concat("data/cc0/pool-", keys[c], ".json")), ".tokenIds"
            );
            (, , uint32 cap,) = genesis.collectionAt(collectionId);
            require(ids.length == cap, "pool size != cap");

            for (uint256 off = 0; off < ids.length; off += POOL_BATCH) {
                uint256 n = _min(POOL_BATCH, ids.length - off);
                uint256[] memory batch = new uint256[](n);
                for (uint256 i = 0; i < n; i++) batch[i] = ids[off + i];
                vm.broadcast();
                genesis.addSourcePool(collectionId, batch);
            }
            for (uint256 off = 0; off < ids.length; off += PAYLOAD_BATCH) {
                uint256 n = _min(PAYLOAD_BATCH, ids.length - off);
                uint256[] memory batch = new uint256[](n);
                bytes[] memory payloads = new bytes[](n);
                for (uint256 i = 0; i < n; i++) {
                    batch[i] = ids[off + i];
                    payloads[i] = vm.parseBytes(
                        vm.readFile(
                            string.concat(
                                "data/cc0-full/", keys[c], "/", vm.toString(ids[off + i]), ".hex"
                            )
                        )
                    );
                    require(payloads[i].length == 400, "bad payload length");
                }
                vm.broadcast();
                genesis.setSourcePayloadBatch(collectionId, batch, payloads);
            }
            total += ids.length;
            console2.log(keys[c], "committed:", ids.length);
        }
        console2.log("TOTAL pool tokens committed:", total);
        console2.log("VERIFY next: genesis.firstUncommittedPoolToken(c) == (false,0) for c=1..5");
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
