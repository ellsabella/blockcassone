// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC721 } from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";

/// @notice Render thumbnails for REAL Normies, reading each one's binary bitmap
/// straight from the live NormiesStorage (no mock, no placeholder). Run against
/// a mainnet-fork anvil (the renderer reads the on-chain binary feed via
/// `getTokenRawImageData`, exactly as it will in production).
///
/// The CubeNFT is pointed at the real Normies ERC721 so `ownerOf` resolves on
/// the fork; we prank the real holder to mint each cube, then render. This
/// touches only local (script-deployed) state — it never writes to mainnet.
///
/// Usage (anvil already forked from mainnet on 127.0.0.1:8545):
///   NORMIE_IDS=1,42,777 forge script contracts/script/PreviewLiveNormie.s.sol \
///     --tc PreviewLiveNormie --rpc-url http://127.0.0.1:8545
/// Or point directly at a fork:
///   NORMIE_IDS=1,42,777 forge script contracts/script/PreviewLiveNormie.s.sol \
///     --tc PreviewLiveNormie --fork-url $MAINNET_RPC
///
/// Writes: data/live-normie-<id>.svg for each id.
contract PreviewLiveNormie is Script {
    function run() external {
        uint256[] memory ids = _normieIds();

        // CubeNFT must reference the real Normies ERC721 (so ownerOf works on the
        // fork); the thumbnail renderer reads bitmaps from the real storage.
        CubeNFT cubes =
            new CubeNFT("Blockcassone Cubes", "CUBE", NormieAddresses.NORMIES, 4096, address(this));
        CubeThumbnailRendererV1 thumb =
            new CubeThumbnailRendererV1(cubes, NormieAddresses.NORMIES_STORAGE, address(0));

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 normieId = ids[i];
            address owner = IERC721(NormieAddresses.NORMIES).ownerOf(normieId);

            vm.prank(owner);
            uint256 cubeId =
                cubes.mintNormieCube(normieId, uint32(i), keccak256(abi.encode("live", normieId)));

            string memory svg = thumb.thumbnailSVG(cubeId);
            vm.writeFile(string.concat("data/live-normie-", vm.toString(normieId), ".svg"), svg);

            console2.log("normie", normieId);
            console2.log("  owner", owner);
            console2.log("  cube ", cubeId);
            console2.log("  bytes", bytes(svg).length);
        }
    }

    function _normieIds() private view returns (uint256[] memory) {
        uint256[] memory fallbackIds = new uint256[](3);
        fallbackIds[0] = 1;
        fallbackIds[1] = 2;
        fallbackIds[2] = 3;
        return vm.envOr("NORMIE_IDS", ",", fallbackIds);
    }
}
