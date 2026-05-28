// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {NormieAdapter} from "./NormieAdapter.sol";
import {NormieAddresses} from "./NormieAddresses.sol";

contract MainnetNormieAdapter is NormieAdapter {
    constructor() NormieAdapter(_mainnetContracts()) {}

    function _mainnetContracts() private pure returns (NormieContracts memory contracts_) {
        NormieAddresses.Config memory config = NormieAddresses.mainnetConfig();
        return NormieContracts({
            normies: config.normies,
            storageContract: config.storageContract,
            renderer: config.renderer,
            rendererV2: config.rendererV2,
            rendererV3: config.rendererV3,
            rendererV4: config.rendererV4,
            minter: config.minter,
            minterV2: config.minterV2,
            canvas: config.canvas,
            canvasStorage: config.canvasStorage
        });
    }
}
