// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { CubeHilbertGeometry } from "../src/render/CubeHilbertGeometry.sol";
import { CubeFrameLayer } from "../src/render/CubeFrameLayer.sol";
import { CubeWalkerLayer } from "../src/render/CubeWalkerLayer.sol";

contract BakeMockNormies is ERC721 {
    mapping(uint256 => bytes) private _raw;
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id, bytes calldata raw) external { _mint(to, id); _raw[id] = raw; }
    function getTokenRawImageData(uint256 id) external view returns (bytes memory) { return _raw[id]; }
}

/// @notice Bake ONE Normie thumbnail at a chosen slot, sourced from its REAL id so the on-chain
///         #NNNN label matches (fixes PreviewThumbnail slot-mode, which sources 100000+slot).
///   NORMIE_ID=1252 SLOT=153 forge script contracts/script/BakeNormieAtSlot.s.sol --tc BakeNormieAtSlot
contract BakeNormieAtSlot is Script {
    function run() external {
        uint256 id = vm.envUint("NORMIE_ID");
        uint32 slot = uint32(vm.envUint("SLOT"));
        bytes memory raw = vm.parseBytes(vm.readFile(string.concat("data/normie-raw-", vm.toString(id), ".hex")));
        require(raw.length == 200, "normie raw wrong length");

        address dev = address(0xBEEF);
        BakeMockNormies normies = new BakeMockNormies();
        CubeNFT cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, dev);
        CubeThumbnailRendererV1 thumb = new CubeThumbnailRendererV1(
            cubes, address(normies), address(0),
            address(new CubeHilbertGeometry()), address(new CubeFrameLayer()), address(new CubeWalkerLayer())
        );

        normies.mint(dev, id, raw);
        vm.prank(dev);
        uint256 cubeId = cubes.mintNormieCube(id, slot, keccak256(abi.encode("albake", id)));
        vm.writeFile(string.concat("data/normie-plane-", vm.toString(id), ".svg"), thumb.thumbnailSVG(cubeId));
    }
}
