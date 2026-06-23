// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IERC721 } from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { CubeThumbnailRendererV1 } from "../src/CubeThumbnailRendererV1.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";

/// @notice Render a thumbnail for any REAL Normie (by its own token id), reading
/// the bitmap straight from the live NormiesStorage on a mainnet-fork anvil.
///
/// This is a standalone preview for arbitrary Normies (e.g. #1250, the prototype
/// source) that aren't necessarily cubed in the dev viewer. It deploys a
/// throwaway CubeNFT pointed at the real Normies ERC721, pranks each Normie's
/// real holder to mint a one-off cube, then renders through the current source
/// of CubeThumbnailRendererV1. It only touches script-local state; it never
/// writes to mainnet and doesn't disturb the viewer's deployment.
///
/// Colour comes from the Hilbert SLOT, not the Normie. SLOT defaults to 1, which
/// resolves to the red (x) axis — matching the red prototype (#1250). Use SLOT=0
/// for blue, or any slot whose unique axis you want.
///
/// Usage (against the fork anvil):
///   NORMIE_IDS=1250 forge script contracts/script/PreviewLiveNormie.s.sol \
///     --tc PreviewLiveNormie --rpc-url http://127.0.0.1:8545
///
/// Writes data/live-normie-<id>.svg for each id.
contract PreviewLiveNormie is Script {
    function run() external {
        uint256[] memory ids = _normieIds();
        uint32 baseSlot = uint32(vm.envOr("SLOT", uint256(1)));

        CubeNFT cubes =
            new CubeNFT("Blockcassone Cubes", "CUBE", NormieAddresses.NORMIES, 4096, address(this));
        CubeThumbnailRendererV1 thumb =
            new CubeThumbnailRendererV1(cubes, NormieAddresses.NORMIES_STORAGE, address(0));

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 normieId = ids[i];
            address owner = IERC721(NormieAddresses.NORMIES).ownerOf(normieId);

            vm.prank(owner);
            uint256 cubeId = cubes.mintNormieCube(
                normieId, baseSlot + uint32(i), keccak256(abi.encode("live", normieId))
            );

            string memory svg = thumb.thumbnailSVG(cubeId);
            vm.writeFile(string.concat("data/live-normie-", vm.toString(normieId), ".svg"), svg);

            console2.log("normie", normieId);
            console2.log("  owner", owner);
            console2.log("  slot ", uint256(baseSlot + uint32(i)));
            console2.log("  bytes", bytes(svg).length);
        }
    }

    function _normieIds() private view returns (uint256[] memory) {
        uint256[] memory fallbackIds = new uint256[](1);
        fallbackIds[0] = 1250;
        return vm.envOr("NORMIE_IDS", ",", fallbackIds);
    }
}
