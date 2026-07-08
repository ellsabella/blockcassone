// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
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

// Minimal CC0 source stand-in: needs only code + name() (genesis external minting
// takes the committed pool as authority; no source-ownership check).
contract WiringMockCC0 {
    string public name;
    constructor(string memory name_) { name = name_; }
}

// Minimal stand-in for the OpenSea SeaDrop singleton (mirrors CubeSeaDrop.t.sol):
// validates payment + limits, then calls mintSeaDrop.
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

/// @notice End-to-end proof that DeployLocalGenesis' wiring produces a live multi-source
///         drop: the admin stays the token OWNER, the MultiSourceGenesisMinter is the
///         active `genesisMinter` and an authorized art-store recorder, and SeaDrop
///         drives a public mint that draws a MIX of collections — Normie cubes (live
///         art) plus CC0 cubes with their tonal payload recorded. Mirrors the wiring in
///         DeployLocalGenesis._deploy / _setupAndMint.
contract DeployLocalGenesisWiringTest is Test {
    address private constant ADMIN = address(0xA11CE); // stays token owner
    address private constant ALICE = address(0xA11CA);
    address private constant BOB = address(0xB0B);

    WiringMockNormies private normies;
    WiringMockCC0 private runners; // collection 1
    WiringMockCC0 private skulls; // collection 2
    CubeNFT private cubes;
    NonNormieArtStore private artStore;
    MultiSourceGenesisMinter private genesis;
    WiringMockSeaDrop private seaDrop;

    // Allocation: Normie 3 / Runners 2 / Skulls 1 = 6 (one street, so ALICE + BOB can
    // each take 3 and sell it out).
    function setUp() public {
        normies = new WiringMockNormies();
        runners = new WiringMockCC0("Chain Runners");
        skulls = new WiringMockCC0("1337 skulls");
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 6, ADMIN);
        artStore = new NonNormieArtStore(address(cubes), ADMIN);

        address[] memory cc = new address[](2);
        cc[0] = address(runners);
        cc[1] = address(skulls);
        uint32[] memory caps = new uint32[](2);
        caps[0] = 2;
        caps[1] = 1;
        genesis = new MultiSourceGenesisMinter(cubes, bytes32("public-seed"), ADMIN, artStore, 3, cc, caps);
        seaDrop = new WiringMockSeaDrop();

        vm.startPrank(ADMIN);

        // ---- Decoupled SeaDrop wiring (owner stays ADMIN) --------------------
        cubes.setGenesisMinter(address(genesis));
        address[] memory allowed = new address[](1);
        allowed[0] = address(seaDrop);
        cubes.updateAllowedSeaDrop(allowed);
        artStore.setAuthorizedRecorder(address(genesis), true);
        genesis.setSeaDrop(address(cubes));

        // ---- Snapshot / pools / payloads / public phase ----------------------
        genesis.addSnapshotNormies(ADMIN, _ids(101, 102, 103, 104, 105)); // >= Normie cap 3

        uint256[] memory rp = new uint256[](2);
        rp[0] = 201; rp[1] = 202;
        genesis.addSourcePool(1, rp);
        genesis.setSourcePayload(1, 201, _payload(0x11));
        genesis.setSourcePayload(1, 202, _payload(0x22));

        uint256[] memory sp = new uint256[](1);
        sp[0] = 301;
        genesis.addSourcePool(2, sp);
        genesis.setSourcePayload(2, 301, _payload(0x33));

        genesis.finalizeSnapshot();
        genesis.setPhase(GenesisMinterBase.Phase.Public);

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
        assertTrue(artStore.authorizedRecorder(address(genesis)));
    }

    function testMultiSourceSelloutViaSeaDropHitsAllocationWithArt() public {
        // Two wallets each take 3 (one street, 3-plot cap) → the whole 6-cube supply.
        vm.prank(ALICE);
        seaDrop.mintPublic(address(cubes), ALICE, 3);
        vm.prank(BOB);
        seaDrop.mintPublic(address(cubes), BOB, 3);

        assertEq(genesis.mintedCount(), 6);
        // Sellout lands exactly on the allocation.
        assertEq(genesis.collectionMinted(0), 3); // Normie
        assertEq(genesis.collectionMinted(1), 2); // Runners
        assertEq(genesis.collectionMinted(2), 1); // Skulls

        // Every CC0 cube carries its source + recorded 400-byte art (never a placeholder);
        // every Normie cube is the live-art path (no recorded payload).
        uint256 normieCubes;
        uint256 ccCubes;
        for (uint256 id = 1; id <= 6; id++) {
            CubeNFT.CubeData memory d = cubes.cubeData(id);
            if (d.sourceContract == address(normies)) {
                normieCubes++;
                assertEq(d.sourceKind, cubes.SOURCE_KIND_NORMIE());
            } else {
                ccCubes++;
                assertEq(d.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721());
                assertTrue(d.sourceContract == address(runners) || d.sourceContract == address(skulls));
                assertEq(artStore.payloadForCube(id).length, 400);
            }
        }
        assertEq(normieCubes, 3);
        assertEq(ccCubes, 3);
        assertEq(cubes.owner(), ADMIN); // ownership never moved to make this work
    }

    function _payload(uint8 fill) private pure returns (bytes memory p) {
        p = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        p[0] = bytes1(fill);
        p[399] = bytes1(fill);
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e)
        private
        pure
        returns (uint256[] memory r)
    {
        r = new uint256[](5);
        r[0] = a; r[1] = b; r[2] = c; r[3] = d; r[4] = e;
    }
}
