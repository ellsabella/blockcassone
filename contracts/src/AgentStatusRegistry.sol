// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract AgentStatusRegistry is Ownable {
    struct AgentBinding {
        bool hasBinding;
        bool agentic;
        uint256 agentId;
        uint64 updatedAt;
    }

    error UnauthorizedAgentUpdater(address account);
    error InvalidAgentBinding(bool agentic, uint256 agentId);
    error InvalidAgentBindingList();

    event AgentUpdaterSet(address indexed updater, bool allowed);
    event AgentBindingUpdated(
        address indexed sourceContract,
        uint256 indexed sourceTokenId,
        bool agentic,
        uint256 agentId,
        uint64 updatedAt
    );

    mapping(bytes32 sourceKey => AgentBinding binding) private _bindings;
    mapping(address updater => bool allowed) public agentUpdater;

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyAgentUpdater() {
        if (msg.sender != owner() && !agentUpdater[msg.sender]) {
            revert UnauthorizedAgentUpdater(msg.sender);
        }
        _;
    }

    function setAgentUpdater(address updater, bool allowed) external onlyOwner {
        agentUpdater[updater] = allowed;
        emit AgentUpdaterSet(updater, allowed);
    }

    function setAgentBinding(
        address sourceContract,
        uint256 sourceTokenId,
        bool agentic,
        uint256 agentId
    ) external onlyAgentUpdater {
        _setAgentBinding(sourceContract, sourceTokenId, agentic, agentId);
    }

    function setAgentBindings(
        address[] calldata sourceContracts,
        uint256[] calldata sourceTokenIds,
        bool[] calldata agenticFlags,
        uint256[] calldata agentIds
    ) external onlyAgentUpdater {
        uint256 length = sourceContracts.length;
        if (
            sourceTokenIds.length != length || agenticFlags.length != length
                || agentIds.length != length
        ) {
            revert InvalidAgentBindingList();
        }

        for (uint256 i = 0; i < length; i++) {
            _setAgentBinding(sourceContracts[i], sourceTokenIds[i], agenticFlags[i], agentIds[i]);
        }
    }

    function currentAgentBinding(address sourceContract, uint256 sourceTokenId)
        external
        view
        returns (bool hasBinding, bool agentic, uint256 agentId, uint64 updatedAt)
    {
        AgentBinding memory binding = _bindings[sourceKey(sourceContract, sourceTokenId)];
        return (binding.hasBinding, binding.agentic, binding.agentId, binding.updatedAt);
    }

    function sourceKey(address sourceContract, uint256 sourceTokenId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(sourceContract, sourceTokenId));
    }

    function _setAgentBinding(
        address sourceContract,
        uint256 sourceTokenId,
        bool agentic,
        uint256 agentId
    ) private {
        if (agentic == (agentId == 0)) {
            revert InvalidAgentBinding(agentic, agentId);
        }

        uint64 updatedAt = uint64(block.timestamp);
        _bindings[sourceKey(sourceContract, sourceTokenId)] = AgentBinding({
            hasBinding: true,
            agentic: agentic,
            agentId: agentId,
            updatedAt: updatedAt
        });

        emit AgentBindingUpdated(sourceContract, sourceTokenId, agentic, agentId, updatedAt);
    }
}
