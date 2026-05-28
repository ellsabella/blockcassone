// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library NormieAddresses {
    address public constant NORMIES = 0x9Eb6E2025B64f340691e424b7fe7022fFDE12438;
    address public constant NORMIES_STORAGE = 0x1B976bAf51cF51F0e369C070d47FBc47A706e602;
    address public constant NORMIES_RENDERER = 0xBe57fC4D0c729b8e8d33b638Dd441F57365e4c25;
    address public constant NORMIES_RENDERER_V2 = 0x7818f24D3239C945510e0a1A523dd9971812C6C0;
    address public constant NORMIES_RENDERER_V3 = 0x1Af01b902256D77cf9499A14Ef4E494897380B05;
    address public constant NORMIES_RENDERER_V4 = 0x8eC46Cc1f306652868a4dfbAAae87CBa2715A0eB;
    address public constant NORMIES_MINTER = 0xC74994dD70FFb621CC514cE18a4F6F52124e296d;
    address public constant NORMIES_MINTER_V2 = 0xc513272597d3022D77b3d7EEBA92cea5D7fb2808;
    address public constant NORMIES_CANVAS = 0x64951d92e345C50381267380e2975f66810E869c;
    address public constant NORMIES_CANVAS_STORAGE = 0xC255BE0983776BAB027a156681b6925cde47B2D1;

    struct Config {
        address normies;
        address storageContract;
        address renderer;
        address rendererV2;
        address rendererV3;
        address rendererV4;
        address minter;
        address minterV2;
        address canvas;
        address canvasStorage;
    }

    function mainnetConfig() internal pure returns (Config memory config) {
        return Config({
            normies: NORMIES,
            storageContract: NORMIES_STORAGE,
            renderer: NORMIES_RENDERER,
            rendererV2: NORMIES_RENDERER_V2,
            rendererV3: NORMIES_RENDERER_V3,
            rendererV4: NORMIES_RENDERER_V4,
            minter: NORMIES_MINTER,
            minterV2: NORMIES_MINTER_V2,
            canvas: NORMIES_CANVAS,
            canvasStorage: NORMIES_CANVAS_STORAGE
        });
    }
}
