// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { NormieGenesisMinter } from "../src/NormieGenesisMinter.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";
import {
    INonFungibleSeaDropToken,
    ISeaDrop,
    PublicDrop,
    AllowListData,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "../src/interfaces/ISeaDrop.sol";

contract SeaDropMockERC721 is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

// Minimal stand-in for the OpenSea SeaDrop singleton: stores the drop config the
// token forwards, and mimics SeaDrop's mint call pattern (validate against the
// public drop + getMintStats, then call mintSeaDrop). Enough to prove the cube
// token is drivable by a real SeaDrop unchanged.
contract MockSeaDrop is ISeaDrop {
    mapping(address token => PublicDrop) public publicDrops;
    mapping(address token => address) public creatorPayout;
    mapping(address token => mapping(address recipient => bool)) public allowedFeeRecipient;

    function updatePublicDrop(PublicDrop calldata pd) external { publicDrops[msg.sender] = pd; }
    function updateAllowList(AllowListData calldata) external { }
    function updateTokenGatedDrop(address, TokenGatedDropStage calldata) external { }
    function updateDropURI(string calldata) external { }
    function updateCreatorPayoutAddress(address p) external { creatorPayout[msg.sender] = p; }
    function updateAllowedFeeRecipient(address r, bool a) external {
        allowedFeeRecipient[msg.sender][r] = a;
    }
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

contract CubeSeaDropTest is Test {
    address private constant OWNER = address(0xA11CE); // admin / drop configurer
    address private constant ALICE = address(0xA11CA); // buyer
    address private constant FEE = address(0xFEE);
    address private constant PAYOUT = address(0x9A70);

    SeaDropMockERC721 private normies;
    CubeNFT private cubes;
    NormieGenesisMinter private genesis;
    MockSeaDrop private seaDrop;

    function setUp() public {
        normies = new SeaDropMockERC721();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 8, OWNER);
        genesis = new NormieGenesisMinter(cubes, bytes32("public-seed"), OWNER);
        seaDrop = new MockSeaDrop();

        vm.startPrank(OWNER);
        genesis.addSnapshotNormies(ALICE, _ids(101, 102, 103));
        genesis.setSnapshotRoot(genesis.hashSnapshot(ALICE, _ids(101, 102, 103)));
        genesis.finalizeSnapshot();
        genesis.setPhase(GenesisMinterBase.Phase.Public);

        // Decoupled SeaDrop wiring: OWNER stays token admin (configures the drop),
        // `genesis` is the mint role, and the TOKEN is what calls the minter.
        cubes.setGenesisMinter(address(genesis));
        address[] memory allowed = new address[](1);
        allowed[0] = address(seaDrop);
        cubes.updateAllowedSeaDrop(allowed);
        genesis.setSeaDrop(address(cubes));

        // Configure the public drop on SeaDrop through the token forwarders.
        cubes.updateCreatorPayoutAddress(address(seaDrop), PAYOUT);
        cubes.updateAllowedFeeRecipient(address(seaDrop), FEE, true);
        cubes.updatePublicDrop(
            address(seaDrop),
            PublicDrop({
                mintPrice: 0.01 ether,
                startTime: uint48(block.timestamp),
                endTime: uint48(block.timestamp + 1 days),
                maxTotalMintableByWallet: 5,
                feeBps: 500,
                restrictFeeRecipients: true
            })
        );
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    function testSeaDropDrivesGenesisMint() public {
        (uint256 m0, uint256 t0, uint256 max) = cubes.getMintStats(ALICE);
        assertEq(m0, 0);
        assertEq(t0, 0);
        assertEq(max, 8); // maxSupply = the genesis cap (cube totalSlots)

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        seaDrop.mintPublic{ value: 0.02 ether }(address(cubes), ALICE, 2);

        assertEq(cubes.balanceOf(ALICE), 2);
        assertEq(genesis.mintedCount(), 2);

        (uint256 m1, uint256 t1,) = cubes.getMintStats(ALICE);
        assertEq(m1, 2); // per-wallet count surfaced for SeaDrop's limit
        assertEq(t1, 2);

        // The minted cubes are real Normie-sourced genesis cubes.
        CubeNFT.CubeData memory d = cubes.cubeData(1);
        assertEq(d.sourceKind, cubes.SOURCE_KIND_NORMIE());
    }

    function testMintSeaDropRejectsUnallowedCaller() public {
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.OnlyAllowedSeaDrop.selector, address(this)));
        cubes.mintSeaDrop(ALICE, 1);
    }

    function testWalletLimitEnforcedViaGetMintStats() public {
        vm.deal(ALICE, 1 ether);
        // maxTotalMintableByWallet = 5; a 6-qty mint must fail on the wallet limit.
        vm.prank(ALICE);
        vm.expectRevert(bytes("wallet limit"));
        seaDrop.mintPublic{ value: 0.06 ether }(address(cubes), ALICE, 6);
    }

    function testSupportsSeaDropInterface() public view {
        assertTrue(cubes.supportsInterface(type(INonFungibleSeaDropToken).interfaceId));
    }

    function testForwarderRequiresAllowedSeaDrop() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.OnlyAllowedSeaDrop.selector, address(0xBAD)));
        cubes.updateDropURI(address(0xBAD), "x");
    }

    function _ids(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }
}
