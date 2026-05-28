// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CubeMintController} from "../src/CubeMintController.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {FlatteningAttestation} from "../src/FlatteningAttestation.sol";
import {NonNormieArtStore} from "../src/NonNormieArtStore.sol";
import {NormieAddresses} from "../src/NormieAddresses.sol";

contract DeployCore is Script {
    struct Deployment {
        CubeNFT cubes;
        NonNormieArtStore artStore;
        FlatteningAttestation attestation;
        CubeMintController controller;
    }

    uint32 internal constant DEFAULT_TOTAL_SLOTS = 4096;

    function run() external returns (Deployment memory deployment) {
        address initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        address attestationSigner = vm.envOr("BLOCKCASSONE_ATTESTATION_SIGNER", initialOwner);
        uint32 totalSlots = uint32(vm.envOr("BLOCKCASSONE_TOTAL_SLOTS", uint256(DEFAULT_TOTAL_SLOTS)));

        vm.startBroadcast();
        deployment = _deploy(initialOwner, attestationSigner, NormieAddresses.NORMIES, totalSlots);
        vm.stopBroadcast();

        _logDeployment(deployment);
    }

    function _deploy(
        address initialOwner,
        address attestationSigner,
        address normies,
        uint32 totalSlots
    ) internal returns (Deployment memory deployment) {
        deployment.cubes = new CubeNFT(
            "Blockcassone Cubes",
            "CUBE",
            normies,
            totalSlots,
            address(this)
        );
        deployment.artStore = new NonNormieArtStore(address(this));
        deployment.attestation = new FlatteningAttestation(address(this), attestationSigner);
        deployment.controller =
            new CubeMintController(deployment.cubes, deployment.artStore, deployment.attestation);

        deployment.cubes.transferOwnership(address(deployment.controller));
        deployment.artStore.transferOwnership(address(deployment.controller));
        deployment.attestation.setAuthorizedConsumer(address(deployment.controller));
        deployment.attestation.transferOwnership(initialOwner);
    }

    function _logDeployment(Deployment memory deployment) internal view {
        console2.log("CubeNFT", address(deployment.cubes));
        console2.log("NonNormieArtStore", address(deployment.artStore));
        console2.log("FlatteningAttestation", address(deployment.attestation));
        console2.log("CubeMintController", address(deployment.controller));
        console2.log("CubeNFT owner", deployment.cubes.owner());
        console2.log("ArtStore owner", deployment.artStore.owner());
        console2.log("Authorized consumer", deployment.attestation.authorizedConsumer());
    }
}
