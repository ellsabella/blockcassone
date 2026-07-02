// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { BrainrotGenesisMinter } from "../src/BrainrotGenesisMinter.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { NonNormieArt } from "../src/NonNormieArt.sol";
import {
    INonFungibleSeaDropToken,
    ISeaDrop,
    PublicDrop,
    AllowListData,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "../src/interfaces/ISeaDrop.sol";

contract WiringMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract WiringMockBrainrot is ERC721 {
    constructor() ERC721("BRAINROT", "BRAINROT") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

// Minimal stand-in for the OpenSea SeaDrop singleton (mirrors the one in
// CubeSeaDrop.t.sol): validates payment + limits, then calls mintSeaDrop.
contract WiringMockSeaDrop is ISeaDrop {
    mapping(address token => PublicDrop) public publicDrops;

    function updatePublicDrop(PublicDrop calldata pd) external { publicDrops[msg.sender] = pd; }
    function updateAllowList(AllowListData calldata) external { }
    function updateTokenGatedDrop(address, TokenGatedDropStage calldata) external { }
    function updateDropURI(string calldata) external { }
    function updateCreatorPayoutAddress(address) external { }
    function updateAllowedFeeRecipient(address, bool) external { }
    function updateSignedMintValidationParams(address, SignedMintValidationParams calldata) external { }
    function updatePayer(address, bool) external { }

    function mintPublic(address token, address minter, uint256 quantity) external payable {
        PublicDrop memory pd = publicDrops[token];
        require(block.timestamp >= pd.startTime && block.timestamp <= pd.endTime, "drop inactive");
        require(msg.value == uint256(pd.mintPrice) * quantity, "wrong payment");
        (uint256 minted, uint256 total, uint256 max) =
            INonFungibleSeaDropToken(token).getMintStats(minter);
        require(total + quantity <= max, "max supply");
        require(
            pd.maxTotalMintableByWallet == 0 || minted + quantity <= pd.maxTotalMintableByWallet,
            "wallet limit"
        );
        INonFungibleSeaDropToken(token).mintSeaDrop(minter, quantity);
    }
}

/// @notice End-to-end proof that DeployLocalGenesis' wiring produces a live drop:
///         the admin stays the token OWNER (never transfers to a minter), the Normie
///         genesis is the active `genesisMinter`, SeaDrop drives mints through the
///         token, and the Brainrot stack is a recorder-authorized minter that mints
///         external cubes with art recorded the moment it's made the genesisMinter.
///         Mirrors the exact wiring calls in DeployLocalGenesis._deploy /
///         _mintAndFinalize / _finalizeBrainrot.
contract DeployLocalGenesisWiringTest is Test {
    address private constant ADMIN = address(0xA11CE); // stays token owner
    address private constant ALICE = address(0xA11CA);
    address private constant BOB = address(0xB0B);

    WiringMockNormies private normies;
    WiringMockBrainrot private brainrotSource;
    CubeNFT private cubes;
    NonNormieArtStore private artStore;
    NormieGenesisMinter private genesis;
    BrainrotGenesisMinter private brainrot;
    WiringMockSeaDrop private seaDrop;

    function setUp() public {
        normies = new WiringMockNormies();
        brainrotSource = new WiringMockBrainrot();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 16, ADMIN);
        artStore = new NonNormieArtStore(ADMIN);
        genesis = new NormieGenesisMinter(cubes, bytes32("public-seed"), ADMIN);
        brainrot = new BrainrotGenesisMinter(
            cubes, bytes32("brainrot-seed"), ADMIN, address(brainrotSource), artStore
        );
        seaDrop = new WiringMockSeaDrop();

        vm.startPrank(ADMIN);

        // ---- Decoupled SeaDrop wiring (owner stays ADMIN) --------------------
        cubes.setGenesisMinter(address(genesis));
        address[] memory allowed = new address[](1);
        allowed[0] = address(seaDrop);
        cubes.updateAllowedSeaDrop(allowed);
        artStore.setAuthorizedRecorder(address(brainrot), true);
        genesis.setSeaDrop(address(cubes));
        brainrot.setSeaDrop(address(cubes));

        // ---- Normie snapshot / public phase ----------------------------------
        genesis.addSnapshotNormies(ALICE, _ids(101, 102, 103));
        genesis.finalizeSnapshot();
        genesis.setPhase(GenesisMinterBase.Phase.Public);

        // ---- Brainrot snapshot: commit payloads, finalize --------------------
        for (uint256 i = 0; i < 4; i++) {
            brainrot.setBrainrotPayload(5001 + i, _payload(uint8(0x10 + i)));
        }
        brainrot.addSnapshotNormies(BOB, _ids(5001, 5002, 5003));
        brainrot.finalizeSnapshot();
        brainrot.setPhase(GenesisMinterBase.Phase.Public);

        // ---- Configure the public drop on SeaDrop through the token ----------
        _configureDrop();

        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    function _configureDrop() private {
        cubes.updatePublicDrop(
            address(seaDrop),
            PublicDrop({
                mintPrice: 0,
                startTime: uint48(block.timestamp),
                endTime: uint48(block.timestamp + 1 days),
                maxTotalMintableByWallet: 0,
                feeBps: 0,
                restrictFeeRecipients: false
            })
        );
    }

    function testAdminStaysOwnerAndMinterIsDecoupled() public view {
        assertEq(cubes.owner(), ADMIN); // never transferred to a minter
        assertEq(cubes.genesisMinter(), address(genesis));
        assertTrue(cubes.allowedSeaDrop(address(seaDrop)));
        assertTrue(artStore.authorizedRecorder(address(brainrot)));
    }

    function testNormieStackMintsEndToEndViaSeaDrop() public {
        vm.prank(ALICE);
        seaDrop.mintPublic(address(cubes), ALICE, 2);

        assertEq(cubes.balanceOf(ALICE), 2);
        assertEq(genesis.mintedCount(), 2);
        assertEq(cubes.cubeData(1).sourceKind, cubes.SOURCE_KIND_NORMIE());
        // Ownership never moved to the minter to make this work.
        assertEq(cubes.owner(), ADMIN);
    }

    function testBrainrotStackMintsEndToEndWhenActivated() public {
        // Activate the Brainrot drop: admin flips the genesisMinter (no ownership
        // change needed — that's the point of the decoupled wiring).
        vm.prank(ADMIN);
        cubes.setGenesisMinter(address(brainrot));

        vm.prank(BOB);
        seaDrop.mintPublic(address(cubes), BOB, 2);

        assertEq(cubes.balanceOf(BOB), 2);
        assertEq(brainrot.mintedCount(), 2);

        // Both minted cubes are external Brainrot-sourced with art recorded.
        for (uint256 id = 1; id <= 2; id++) {
            CubeNFT.CubeData memory dta = cubes.cubeData(id);
            assertEq(dta.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
            assertEq(dta.sourceContract, address(brainrotSource));
            assertEq(artStore.payloadForCube(id).length, 400); // never a placeholder
        }
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }

    function _ids(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }
}
