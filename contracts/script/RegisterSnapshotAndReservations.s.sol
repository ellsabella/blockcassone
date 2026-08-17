// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";

/// @notice MAINNET owner ops, one command: register the Normie candidate pool
///         (data/normie-pool.json, GTD picks injected) and bake every verified GTD
///         reservation (reserve-plan-mainnet.json, freshly ownership-verified).
///         Deliberately does NOT finalize — that comes after the Studio recon.
///         Idempotent-ish: --resume replays; a re-run from scratch reverts on
///         DuplicateNormie / NormieNotInPool for already-done work.
///
///         Env: BLOCKCASSONE_MINTER. Broadcast as the minter's owner.
contract RegisterSnapshotAndReservations is Script {
    uint256 internal constant SNAPSHOT_BATCH = 120;

    function run() external {
        MultiSourceGenesisMinter genesis =
            MultiSourceGenesisMinter(vm.envAddress("BLOCKCASSONE_MINTER"));
        require(!genesis.finalized(), "minter already finalized");

        // 1) Normie candidate pool.
        uint256[] memory ids =
            vm.parseJsonUintArray(vm.readFile("data/normie-pool.json"), ".tokenIds");
        console2.log("normie candidate ids:", ids.length);
        for (uint256 off = 0; off < ids.length; off += SNAPSHOT_BATCH) {
            uint256 n = ids.length - off < SNAPSHOT_BATCH ? ids.length - off : SNAPSHOT_BATCH;
            uint256[] memory batch = new uint256[](n);
            for (uint256 i = 0; i < n; i++) batch[i] = ids[off + i];
            vm.broadcast();
            genesis.addSnapshotNormies(msg.sender, batch);
        }

        // 2) GTD reservations, one tx per wallet (matches reserve.mjs's plan).
        string memory plan = vm.readFile("data/mainnet/reserve-plan.json");
        uint256 wallets;
        uint256 sources;
        for (uint256 i = 0;; i++) {
            string memory base = string.concat(".plan[", vm.toString(i), "]");
            address wallet;
            try vm.parseJsonAddress(plan, string.concat(base, ".wallet")) returns (address w) {
                wallet = w;
            } catch {
                break; // end of plan
            }
            uint256[] memory cidsRaw =
                vm.parseJsonUintArray(plan, string.concat(base, ".collectionIds"));
            uint256[] memory sids =
                vm.parseJsonUintArray(plan, string.concat(base, ".sourceIds"));
            require(cidsRaw.length == sids.length && cidsRaw.length > 0, "bad plan row");
            uint8[] memory cids = new uint8[](cidsRaw.length);
            for (uint256 k = 0; k < cidsRaw.length; k++) cids[k] = uint8(cidsRaw[k]);

            if (genesis.reservationCount(wallet) > 0) {
                console2.log("skip (already reserved):", wallet);
                continue;
            }
            vm.broadcast();
            genesis.reserveSources(wallet, cids, sids);
            wallets++;
            sources += sids.length;
        }
        console2.log("reserved wallets:", wallets);
        console2.log("reserved sources:", sources);
        console2.log("DONE. Next: user Studio recon; finalizeSnapshot comes later.");
    }
}
