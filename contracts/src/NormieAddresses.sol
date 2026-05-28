// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library NormieAddresses {
    address public constant NORMIES = 0x9eb6e2025b64f340691e424b7fe7022ffde12438;
    address public constant NORMIES_STORAGE = 0x1b976baf51cf51f0e369c070d47fbc47a706e602;
    address public constant NORMIES_RENDERER = 0xbe57fc4d0c729b8e8d33b638dd441f57365e4c25;
    address public constant NORMIES_RENDERER_V2 = 0x7818f24d3239c945510e0a1a523dd9971812c6c0;
    address public constant NORMIES_RENDERER_V3 = 0x1af01b902256d77cf9499a14ef4e494897380b05;
    address public constant NORMIES_RENDERER_V4 = 0x8ec46cc1f306652868a4dfbaaae87cba2715a0eb;
    address public constant NORMIES_MINTER = 0xc74994dd70ffb621cc514ce18a4f6f52124e296d;
    address public constant NORMIES_MINTER_V2 = 0xc513272597d3022d77b3d7eeba92cea5d7fb2808;
    address public constant NORMIES_CANVAS = 0x64951d92e345c50381267380e2975f66810e869c;
    address public constant NORMIES_CANVAS_STORAGE = 0xc255be0983776bab027a156681b6925cde47b2d1;

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
