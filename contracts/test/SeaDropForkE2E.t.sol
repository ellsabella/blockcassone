// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// End-to-end against the REAL OpenSea SeaDrop 1.0 singleton on a mainnet fork — proves
// the cube token + genesis minter + GTD reservations are driven correctly by the actual
// SeaDrop contract (its own getMintStats pre-check, payment split, per-wallet limit, and
// allowlist merkle verification), not just our mock.
//
//   ETH_RPC_URL=<mainnet> forge test --match-path test/SeaDropForkE2E.t.sol -vv
import { Test } from "forge-std/Test.sol";
import { ERC721 } from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import { CubeNFT } from "../src/CubeNFT.sol";
import { MultiSourceGenesisMinter } from "../src/MultiSourceGenesisMinter.sol";
import { NonNormieArtStore } from "../src/NonNormieArtStore.sol";
import { GenesisMinterBase } from "../src/GenesisMinterBase.sol";
import { PublicDrop, AllowListData } from "../src/interfaces/ISeaDrop.sol";

// SeaDrop 1.0 allowlist MintParams + the mint entrypoints (real signatures).
struct MintParams {
    uint256 mintPrice;
    uint256 maxTotalMintableByWallet;
    uint256 startTime;
    uint256 endTime;
    uint256 dropStageIndex;
    uint256 maxTokenSupplyForStage;
    uint256 feeBps;
    bool restrictFeeRecipients;
}

interface IRealSeaDrop {
    function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) external payable;
    function mintAllowList(
        address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity,
        MintParams calldata mintParams, bytes32[] calldata proof
    ) external payable;
}

contract ForkMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") { }
    function mint(address to, uint256 id) external { _mint(to, id); }
}

contract SeaDropForkE2E is Test {
    address private constant SEADROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5; // OpenSea SeaDrop 1.0

    address private constant OWNER = address(0xA11CE);
    address private constant BUYER = address(0xB0B);   // public buyer (clean, no 7702 code)
    address private constant WINNER = address(0xB1D);   // GTD winner with a reservation
    address private constant WINNER2 = address(0xB2D);  // second GTD winner (multi-leaf tree)
    address private constant FEE = address(0xFEE);
    address private constant PAYOUT = address(0x9A70);

    uint80 private constant PRICE = 0.0069 ether;
    uint256 private constant RESERVED_NORMIE = 201;
    uint256 private constant RESERVED_NORMIE2 = 202;

    ForkMockNormies private normies;
    CubeNFT private cubes;
    MultiSourceGenesisMinter private genesis;
    NonNormieArtStore private store;
    uint256 private startT; // pinned so the allowlist leaf is identical at config + mint time
    uint256 private endT;
    bool private skipAll;   // no ETH_RPC_URL → skip (keeps the non-fork suite green)

    function setUp() public {
        string memory rpc = vm.envOr("ETH_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { skipAll = true; return; }
        vm.createSelectFork(rpc);
        require(SEADROP.code.length > 0, "SeaDrop not on this chain/fork");
        startT = block.timestamp;
        endT = block.timestamp + 7 days;

        normies = new ForkMockNormies();
        cubes = new CubeNFT("TheBLOCK", "BLOCK", address(normies), 8, OWNER);
        store = new NonNormieArtStore(address(cubes), OWNER);
        genesis = new MultiSourceGenesisMinter(cubes, bytes32("seed"), OWNER, store, 8, new address[](0), new uint32[](0));

        vm.startPrank(OWNER);
        // seed the Normie pool (8), reserve one for the GTD winner, finalize
        uint256[] memory ids = new uint256[](8);
        for (uint256 i = 0; i < 8; i++) ids[i] = 201 + i;
        genesis.addSnapshotNormies(OWNER, ids);
        uint8[] memory cids = new uint8[](1); cids[0] = 0;
        uint256[] memory sids = new uint256[](1); sids[0] = RESERVED_NORMIE;
        genesis.reserveSources(WINNER, cids, sids);
        uint256[] memory sids2 = new uint256[](1); sids2[0] = RESERVED_NORMIE2;
        genesis.reserveSources(WINNER2, cids, sids2);
        genesis.finalizeSnapshot();

        // decoupled SeaDrop wiring against the REAL singleton
        cubes.setGenesisMinter(address(genesis));
        address[] memory allowed = new address[](1); allowed[0] = SEADROP;
        cubes.updateAllowedSeaDrop(allowed);
        genesis.setSeaDrop(address(cubes));
        cubes.updateCreatorPayoutAddress(SEADROP, PAYOUT);
        cubes.updateAllowedFeeRecipient(SEADROP, FEE, true);

        // public drop (index 0)
        cubes.updatePublicDrop(SEADROP, PublicDrop({
            mintPrice: PRICE, startTime: uint48(startT), endTime: uint48(endT),
            maxTotalMintableByWallet: 8, feeBps: 500, restrictFeeRecipients: true
        }));
        // allowlist stage (index 1): single leaf = WINNER capped at 1 (their reservation count)
        cubes.updateAllowList(SEADROP, AllowListData({ merkleRoot: _leaf(WINNER, _winnerParams(1)), publicKeyURIs: new string[](0), allowListURI: "" }));
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    function _winnerParams(uint256 cap) private view returns (MintParams memory) {
        return MintParams({
            mintPrice: PRICE, maxTotalMintableByWallet: cap, startTime: startT, endTime: endT,
            dropStageIndex: 1, maxTokenSupplyForStage: 8, feeBps: 500, restrictFeeRecipients: true
        });
    }
    function _leaf(address minter, MintParams memory p) private pure returns (bytes32) {
        return keccak256(abi.encode(minter, p));
    }
    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    // ---- 1) real SeaDrop drives the public random mint ----
    function testRealSeaDropPublicMint() public {
        if (skipAll) { vm.skip(true); return; }
        vm.prank(OWNER); genesis.setPhase(GenesisMinterBase.Phase.Public);
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        IRealSeaDrop(SEADROP).mintPublic{ value: uint256(PRICE) * 2 }(address(cubes), FEE, address(0), 2);

        assertEq(cubes.balanceOf(BUYER), 2, "buyer got 2 cubes");
        assertEq(genesis.mintedCount(), 2);
        assertEq(PAYOUT.balance, uint256(PRICE) * 2 * 9500 / 10000, "creator payout net of fee");
    }

    // ---- 2) real SeaDrop allowlist mint assigns the winner's RESERVED art ----
    function testRealSeaDropAllowlistAssignsReservedArt() public {
        if (skipAll) { vm.skip(true); return; }
        vm.prank(OWNER); genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        vm.deal(WINNER, 1 ether);
        bytes32[] memory proof = new bytes32[](0); // single-leaf tree → empty proof
        vm.prank(WINNER);
        IRealSeaDrop(SEADROP).mintAllowList{ value: uint256(PRICE) }(address(cubes), FEE, address(0), 1, _winnerParams(1), proof);

        assertEq(cubes.balanceOf(WINNER), 1, "winner minted 1");
        // the cube must be sourced from their RESERVED Normie, not a random draw
        uint256 cubeId = cubes.cubeForNormieId(RESERVED_NORMIE);
        assertEq(cubes.ownerOf(cubeId), WINNER, "winner owns the cube for their reserved Normie");
        CubeNFT.CubeData memory d = cubes.cubeData(cubeId);
        assertEq(d.sourceTokenId, RESERVED_NORMIE, "winner got their chosen art");
    }

    // ---- 2b) MULTI-winner allowlist (real merkle tree, each winner capped at their
    //          reservation count) — proves the tree format the JS generator emits ----
    function testTwoWinnerAllowlistMerkle() public {
        if (skipAll) { vm.skip(true); return; }
        vm.prank(OWNER); genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        bytes32 leafA = _leaf(WINNER, _winnerParams(1));
        bytes32 leafB = _leaf(WINNER2, _winnerParams(1));
        vm.prank(OWNER);
        cubes.updateAllowList(SEADROP, AllowListData({ merkleRoot: _hashPair(leafA, leafB), publicKeyURIs: new string[](0), allowListURI: "" }));

        vm.deal(WINNER, 1 ether); vm.deal(WINNER2, 1 ether);
        bytes32[] memory proofA = new bytes32[](1); proofA[0] = leafB;
        vm.prank(WINNER);
        IRealSeaDrop(SEADROP).mintAllowList{ value: PRICE }(address(cubes), FEE, address(0), 1, _winnerParams(1), proofA);
        assertEq(cubes.ownerOf(cubes.cubeForNormieId(RESERVED_NORMIE)), WINNER, "winner A got their art");

        bytes32[] memory proofB = new bytes32[](1); proofB[0] = leafA;
        vm.prank(WINNER2);
        IRealSeaDrop(SEADROP).mintAllowList{ value: PRICE }(address(cubes), FEE, address(0), 1, _winnerParams(1), proofB);
        assertEq(cubes.ownerOf(cubes.cubeForNormieId(RESERVED_NORMIE2)), WINNER2, "winner B got their art");
    }

    // ---- 3) Allowlist phase blocks random draws for non-reserved wallets ----
    function testAllowlistPhaseBlocksRandomDraw() public {
        if (skipAll) { vm.skip(true); return; }
        vm.prank(OWNER); genesis.setPhase(GenesisMinterBase.Phase.Allowlist);
        vm.deal(BUYER, 1 ether);
        // BUYER has no reservation → mintSeaDrop's fromPhase>0 in Allowlist phase must revert.
        vm.prank(BUYER);
        vm.expectRevert();
        IRealSeaDrop(SEADROP).mintPublic{ value: uint256(PRICE) }(address(cubes), FEE, address(0), 1);
    }
}
