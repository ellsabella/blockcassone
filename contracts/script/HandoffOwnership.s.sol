// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeRendererV2 } from "../src/CubeRendererV2.sol";
import { CubeMintController } from "../src/CubeMintController.sol";

/// @notice Ops-key retirement, step 1: transfer ownership of the FIVE owned contracts
///         (CubeNFT, MultiSourceGenesisMinter, RendererAssetStore, AgentStatusRegistry,
///         FlatteningAttestation) to the long-term owner. All five are derived from the
///         CubeNFT address on-chain — no address list to fat-finger. NonNormieArtStore
///         is deliberately NOT touched (owned by CubeMintController by design; verified
///         and logged). Ownable is 1-step: TRIPLE-CHECK BLOCKCASSONE_NEW_OWNER.
///
///         Env: BLOCKCASSONE_CUBES, BLOCKCASSONE_NEW_OWNER. Broadcast as current owner.
contract HandoffOwnership is Script {
    function run() external {
        CubeNFT cubes = CubeNFT(vm.envAddress("BLOCKCASSONE_CUBES"));
        address newOwner = vm.envAddress("BLOCKCASSONE_NEW_OWNER");
        require(newOwner != address(0), "zero new owner");

        address minter = cubes.genesisMinter();
        address agentRegistry = cubes.agentStatusRegistry();
        CubeMintController customizer = CubeMintController(cubes.customizer());
        address attestation = address(customizer.attestationVerifier());
        address assetStore = address(CubeRendererV2(cubes.renderer()).assets());

        address[5] memory owned = [address(cubes), minter, assetStore, agentRegistry, attestation];
        string[5] memory names =
            ["CubeNFT", "MultiSourceGenesisMinter", "RendererAssetStore", "AgentStatusRegistry", "FlatteningAttestation"];

        for (uint256 i = 0; i < 5; i++) {
            address cur = Ownable(owned[i]).owner();
            if (cur == newOwner) {
                console2.log(names[i], "already owned by new owner");
                continue;
            }
            vm.broadcast();
            Ownable(owned[i]).transferOwnership(newOwner);
            require(Ownable(owned[i]).owner() == newOwner, "transfer did not take");
            console2.log(names[i], "->", newOwner);
        }

        // Invariant, not a transfer target: the art store belongs to the controller.
        address artStoreOwner = Ownable(address(customizer.artStore())).owner();
        require(artStoreOwner == address(customizer), "art store owner drifted");
        console2.log("NonNormieArtStore owner (stays):", artStoreOwner);
        console2.log("HANDOFF COMPLETE. Next: sweep leftover ETH (scripts/retire-ops-key.sh), then delete the keystore.");
    }
}
