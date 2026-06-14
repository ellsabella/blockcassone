// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CubeMintController} from "../src/CubeMintController.sol";
import {DeployCore} from "../script/DeployCore.s.sol";
import {FlatteningAttestation} from "../src/FlatteningAttestation.sol";
import {NonNormieArtStore} from "../src/NonNormieArtStore.sol";

contract DeployCoreHarness is DeployCore {
    function deploy(
        address initialOwner,
        address attestationSigner,
        address normies,
        uint32 totalSlots
    ) external returns (Deployment memory deployment) {
        return _deploy(initialOwner, attestationSigner, normies, totalSlots);
    }
}

contract DeployCoreTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant SIGNER = address(0xB0B);

    MockNormiesForDeploy private normies;
    DeployCoreHarness private deployer;

    function setUp() public {
        normies = new MockNormiesForDeploy();
        deployer = new DeployCoreHarness();
    }

    function testDeploysAndWiresCoreSystem() public {
        DeployCore.Deployment memory deployment =
            deployer.deploy(OWNER, SIGNER, address(normies), 4096);

        assertEq(deployment.cubes.normieContract(), address(normies));
        assertEq(deployment.cubes.totalSlots(), 4096);
        assertEq(deployment.cubes.agentStatusRegistry(), address(deployment.agentRegistry));
        assertEq(deployment.cubes.owner(), address(deployment.controller));
        assertEq(deployment.agentRegistry.owner(), OWNER);
        assertEq(deployment.artStore.owner(), address(deployment.controller));
        assertEq(deployment.attestation.owner(), OWNER);
        assertEq(deployment.attestation.attestationSigner(), SIGNER);
        assertEq(deployment.attestation.authorizedConsumer(), address(deployment.controller));

        assertEq(address(deployment.controller.cubes()), address(deployment.cubes));
        assertEq(address(deployment.controller.artStore()), address(deployment.artStore));
        assertEq(
            address(deployment.controller.attestationVerifier()),
            address(deployment.attestation)
        );
    }
}

contract MockNormiesForDeploy {
    function ownerOf(uint256) external pure returns (address) {
        return address(0);
    }
}
