// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {AgentStatusRegistry} from "../src/AgentStatusRegistry.sol";

contract AgentStatusRegistryTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant UPDATER = address(0xBEEF);
    address private constant OTHER = address(0xCAFE);
    address private constant SOURCE = address(0x1234);

    AgentStatusRegistry private registry;

    function setUp() public {
        registry = new AgentStatusRegistry(OWNER);
    }

    function testOwnerCanSetAgentBinding() public {
        vm.prank(OWNER);
        registry.setAgentBinding(SOURCE, 5025, true, 777);

        (bool hasBinding, bool agentic, uint256 agentId, uint64 updatedAt) =
            registry.currentAgentBinding(SOURCE, 5025);

        assertTrue(hasBinding);
        assertTrue(agentic);
        assertEq(agentId, 777);
        assertEq(updatedAt, block.timestamp);
    }

    function testOwnerCanSetUpdaterAndUpdaterCanSetAgentBinding() public {
        vm.prank(OWNER);
        registry.setAgentUpdater(UPDATER, true);

        vm.prank(UPDATER);
        registry.setAgentBinding(SOURCE, 5025, true, 777);

        (, bool agentic, uint256 agentId,) = registry.currentAgentBinding(SOURCE, 5025);
        assertTrue(agentic);
        assertEq(agentId, 777);
    }

    function testNonUpdaterCannotSetAgentBinding() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(AgentStatusRegistry.UnauthorizedAgentUpdater.selector, OTHER)
        );
        registry.setAgentBinding(SOURCE, 5025, true, 777);
    }

    function testCannotSetAgenticWithoutAgentId() public {
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(AgentStatusRegistry.InvalidAgentBinding.selector, true, 0)
        );
        registry.setAgentBinding(SOURCE, 5025, true, 0);
    }

    function testCannotSetNonAgenticWithAgentId() public {
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(AgentStatusRegistry.InvalidAgentBinding.selector, false, 777)
        );
        registry.setAgentBinding(SOURCE, 5025, false, 777);
    }

    function testExplicitNonAgenticBindingIsStored() public {
        vm.prank(OWNER);
        registry.setAgentBinding(SOURCE, 5025, false, 0);

        (bool hasBinding, bool agentic, uint256 agentId,) =
            registry.currentAgentBinding(SOURCE, 5025);

        assertTrue(hasBinding);
        assertFalse(agentic);
        assertEq(agentId, 0);
    }

    function testNonOwnerCannotSetUpdater() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        registry.setAgentUpdater(UPDATER, true);
    }
}
