// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { MainnetNormieAdapter } from "../src/MainnetNormieAdapter.sol";
import { NormieAdapter } from "../src/NormieAdapter.sol";

contract InspectNormieData is Script {
    function run() external {
        MainnetNormieAdapter adapter = new MainnetNormieAdapter();

        _logToken(adapter, 1);
        _logToken(adapter, 42);
        _logToken(adapter, 6722);
    }

    function _logToken(MainnetNormieAdapter adapter, uint256 tokenId) private view {
        NormieAdapter.RenderData memory data = adapter.renderData(tokenId);

        console2.log("Normie token", tokenId);
        console2.log("exists", data.exists);
        console2.log("storageDataSet", data.storageDataSet);
        console2.log("revealed", data.revealed);
        console2.log("owner", data.owner);
        console2.log("rawImageDataLength", data.rawImageDataLength);
        console2.log("rawImageDataHash");
        console2.logBytes32(data.rawImageDataHash);
        console2.log("traits");
        console2.logBytes32(bytes32(data.traits));
        console2.log("traitsHash");
        console2.logBytes32(data.traitsHash);
    }
}
