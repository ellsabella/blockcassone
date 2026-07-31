// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {CubeEnv} from "../src/lib/CubeEnv.sol";

contract FeesMockNormies is ERC721 {
    constructor() ERC721("Normies", "NORM") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
}

/// @dev A cube owner that can refuse ETH on demand — exercises the push→pull fallback.
contract ToggleReceiver is IERC721Receiver {
    bool public reject;
    function setReject(bool v) external { reject = v; }
    function pull(CubeNFT c) external { c.withdrawOwed(); }
    receive() external payable { if (reject) revert("nope"); }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// Fee / displacement economics — see FEES_AND_DISPLACEMENT_SPEC.md. Uses the contract's
/// default fee knobs (baseFee 0.001, premiumPerPoint 0.01, weights [3,1,1,1,8,12], cut 1/3).
contract CubeFeesTest is Test {
    CubeNFT private cubes;
    FeesMockNormies private normies;

    address private constant OWNER = address(0xA11CE);
    address private constant MINTER = address(0xB0B);
    address private constant OTHER = address(0xCA11);

    uint256 private constant BASE = 0.001 ether;
    uint256 private constant PREMIUM = 0.01 ether;

    function setUp() public {
        normies = new FeesMockNormies();
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 4096, OWNER);
        vm.startPrank(OWNER);
        cubes.setMovesEnabled(true);
        cubes.setMergesEnabled(true);
        vm.stopPrank();
        vm.deal(MINTER, 100 ether);
        vm.deal(OTHER, 100 ether);
    }

    // ---- helpers ------------------------------------------------------------

    function _mint(uint256 id, uint32 slot, address who) private returns (uint256 cubeId) {
        normies.mint(who, id);
        vm.prank(who);
        cubeId = cubes.mintNormieCube(id, slot, keccak256(abi.encodePacked(id, slot)));
    }

    function _weight(uint32 slot) private view returns (uint256) {
        return cubes.biomeWeight(CubeEnv.idForStreet(uint256(slot) / 8));
    }

    /// First street (of the 512) whose biome fee-weight is >= 8 (mountain/ice) or == 1 (common).
    function _street(bool rare) private view returns (uint32) {
        for (uint32 s = 0; s < 512; s++) {
            uint256 w = cubes.biomeWeight(CubeEnv.idForStreet(s));
            if (rare && w >= 8) return s;
            if (!rare && w == 1) return s;
        }
        revert("no street");
    }

    // ---- move to empty ------------------------------------------------------

    function testMoveToEmptyChargesHouse() public {
        uint256 c = _mint(1, 0, MINTER);
        (uint256 fee,,,) = cubes.quoteMove(c, 100);
        assertEq(fee, BASE);
        vm.prank(MINTER);
        cubes.moveCube{value: BASE}(c, 100);
        assertEq(cubes.houseBalance(), BASE);
        assertEq(cubes.cubeForSlot(100), c);
    }

    function testMoveUnderpayReverts() public {
        uint256 c = _mint(1, 0, MINTER);
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InsufficientFee.selector, BASE, BASE - 1));
        cubes.moveCube{value: BASE - 1}(c, 100);
    }

    function testMoveOverpayRefundsExcess() public {
        uint256 c = _mint(1, 0, MINTER);
        uint256 balBefore = MINTER.balance;
        vm.prank(MINTER);
        cubes.moveCube{value: 1 ether}(c, 100); // massively overpay
        assertEq(balBefore - MINTER.balance, BASE, "only baseFee kept, rest refunded");
        assertEq(cubes.houseBalance(), BASE);
    }

    // ---- merge --------------------------------------------------------------

    function testMergeFullyOwnedStreetIsFree() public {
        for (uint256 k = 0; k < 8; k++) _mint(100 + k, uint32(k), MINTER); // fill street 0
        vm.prank(MINTER);
        cubes.mergeStreet{value: 0}(0);
        assertEq(cubes.houseBalance(), 0, "8/8 merge is free");
    }

    function testMergeWithVacantPlotsChargesPerPlot() public {
        _mint(100, 0, MINTER);
        _mint(101, 1, MINTER);
        _mint(102, 2, MINTER); // 3 occupied, 5 vacant
        (uint256 fee, uint256 empties) = cubes.quoteMerge(0);
        assertEq(empties, 5);
        assertEq(fee, 5 * BASE);
        vm.prank(MINTER);
        cubes.mergeStreet{value: fee}(0);
        assertEq(cubes.houseBalance(), 5 * BASE);
    }

    function testMergeUnderpayReverts() public {
        _mint(100, 0, MINTER); // 1 occupied, 7 vacant -> 7*BASE
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.InsufficientFee.selector, 7 * BASE, 0));
        cubes.mergeStreet{value: 0}(0);
    }

    // ---- displacement -------------------------------------------------------

    /// Build a displacement: MINTER owns 5/8 of `targetStreet`, OTHER holds one plot (the target),
    /// and MINTER's mover cube sits in `moverStreet`. Returns (moverCube, targetSlot, victimCube).
    function _setupDisplace(uint32 targetStreet, uint32 moverStreet)
        private
        returns (uint256 moverCube, uint32 targetSlot, uint256 victimCube)
    {
        uint32 tb = targetStreet * 8;
        for (uint256 k = 0; k < 5; k++) _mint(200 + k, tb + uint32(k), MINTER); // 5/8 majority
        targetSlot = tb + 5;
        victimCube = _mint(210, targetSlot, OTHER);
        moverCube = _mint(220, moverStreet * 8, MINTER);
    }

    function testDisplaceDowngradeSplitsAndPaysVictim() public {
        uint32 rare = _street(true); // weight >= 8
        uint32 common = _street(false); // weight 1
        (uint256 moverCube, uint32 targetSlot, uint256 victimCube) = _setupDisplace(rare, common);

        uint256 fee = BASE + (_weight(targetSlot) - 1) * PREMIUM; // moverStreet weight = 1
        uint256 houseShare = (fee * 3333) / 10000;

        {
            (uint256 qFee, address qVictim, uint256 qVictimShare, uint256 qHouseShare) =
                cubes.quoteMove(moverCube, targetSlot);
            assertEq(qFee, fee, "quote fee");
            assertEq(qVictim, OTHER);
            assertEq(qHouseShare, houseShare, "quote house share");
            assertEq(qVictimShare, fee - houseShare, "quote victim share");
        }

        uint256 victimBalBefore = OTHER.balance;
        vm.prank(MINTER);
        cubes.moveCube{value: fee}(moverCube, targetSlot);

        assertEq(cubes.houseBalance(), houseShare, "house cut = 1/3");
        assertEq(OTHER.balance - victimBalBefore, fee - houseShare, "victim paid directly (2/3)");
        assertEq(cubes.cubeForSlot(targetSlot), moverCube, "mover took the slot");
        assertEq(cubes.cubeForSlot(common * 8), victimCube, "victim swapped to old slot");
        assertGt(cubes.lastDisplacedAt(OTHER), 0, "cooldown stamped");
    }

    function testDisplaceSameTierNoHouseCutAllToVictim() public {
        // Two distinct common streets (weight 1) -> D = 0 -> baseFee only, all to the victim.
        uint32 common1 = _commonStreet(0);
        uint32 common2 = _commonStreet(1);
        (uint256 moverCube, uint32 targetSlot,) = _setupDisplace(common1, common2);

        (uint256 fee,, uint256 victimShare, uint256 houseShare) = cubes.quoteMove(moverCube, targetSlot);
        assertEq(fee, BASE, "same tier => just baseFee");
        assertEq(houseShare, 0, "no house cut when not upgrading");
        assertEq(victimShare, BASE);

        uint256 victimBalBefore = OTHER.balance;
        vm.prank(MINTER);
        cubes.moveCube{value: fee}(moverCube, targetSlot);
        assertEq(cubes.houseBalance(), 0);
        assertEq(OTHER.balance - victimBalBefore, BASE);
    }

    function _commonStreet(uint256 nth) private view returns (uint32) {
        uint256 seen;
        for (uint32 s = 0; s < 512; s++) {
            if (cubes.biomeWeight(CubeEnv.idForStreet(s)) == 1) {
                if (seen == nth) return s;
                seen++;
            }
        }
        revert("no common street");
    }

    function testDisplacePushFailsFallsBackToOwed() public {
        ToggleReceiver recv = new ToggleReceiver();
        uint32 rare = _street(true);
        uint32 common = _street(false);
        uint32 tb = rare * 8;
        for (uint256 k = 0; k < 5; k++) _mint(300 + k, tb + uint32(k), MINTER);
        uint32 targetSlot = tb + 5;
        // Victim is the contract; it rejects ETH.
        normies.mint(address(recv), 310);
        vm.prank(address(recv));
        cubes.mintNormieCube(310, targetSlot, keccak256("recv"));
        recv.setReject(true);
        uint256 moverCube = _mint(320, common * 8, MINTER);

        (uint256 fee,, uint256 victimShare, uint256 houseShare) = cubes.quoteMove(moverCube, targetSlot);
        vm.prank(MINTER);
        cubes.moveCube{value: fee}(moverCube, targetSlot);

        assertEq(cubes.houseBalance(), houseShare, "house paid");
        assertEq(cubes.owed(address(recv)), victimShare, "victim comp credited to owed");

        // Once the victim stops rejecting, it can pull.
        recv.setReject(false);
        uint256 before = address(recv).balance;
        recv.pull(cubes);
        assertEq(address(recv).balance - before, victimShare, "pulled owed");
        assertEq(cubes.owed(address(recv)), 0);
    }

    function testSelfSwapIsFree() public {
        // MINTER owns two cubes in the same street; swapping them is free.
        uint256 a = _mint(400, 0, MINTER);
        uint256 b = _mint(401, 1, MINTER);
        (uint256 fee, address victim,,) = cubes.quoteMove(a, 1);
        assertEq(fee, 0, "self-swap free");
        assertEq(victim, address(0));
        vm.prank(MINTER);
        cubes.moveCube{value: 0}(a, 1);
        assertEq(cubes.cubeForSlot(1), a);
        assertEq(cubes.cubeForSlot(0), b);
        assertEq(cubes.houseBalance(), 0);
    }

    // ---- cooldown -----------------------------------------------------------

    function testCooldownBlocksSecondDisplaceThenClears() public {
        // street0: MINTER owns 0..4, OTHER owns 5. Movers at 16 (street2) + 24 (street3).
        for (uint256 k = 0; k < 5; k++) _mint(500 + k, uint32(k), MINTER); // street 0 majority
        uint256 victim = _mint(505, 5, OTHER);
        uint256 mover1 = _mint(520, 16, MINTER); // street 2
        uint256 mover2 = _mint(521, 24, MINTER); // street 3
        // MINTER's majority of street 2 (slots 17..21), so it can hit OTHER again once OTHER lands there.
        for (uint256 k = 1; k < 6; k++) _mint(530 + k, uint32(16 + k), MINTER);

        // First displacement: OTHER (slot 5) -> slot 16 (mover1's old slot).
        (uint256 fee1,,,) = cubes.quoteMove(mover1, 5);
        vm.prank(MINTER);
        cubes.moveCube{value: fee1}(mover1, 5);
        assertEq(cubes.cubeForSlot(16), victim, "victim swapped into slot 16");

        // Second displacement of OTHER (now at slot 16) inside the window must revert on cooldown.
        uint256 readyAt = cubes.lastDisplacedAt(OTHER) + cubes.displaceCooldown();
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.DisplaceCooldownActive.selector, OTHER, readyAt));
        cubes.moveCube{value: 1 ether}(mover2, 16);

        // After the window, it succeeds.
        vm.warp(readyAt + 1);
        vm.prank(MINTER);
        cubes.moveCube{value: 1 ether}(mover2, 16);
        assertEq(cubes.cubeForSlot(16), mover2);
    }

    // ---- treasury + knobs ---------------------------------------------------

    function testWithdrawHouseOnlyOwner() public {
        uint256 c = _mint(1, 0, MINTER);
        vm.prank(MINTER);
        cubes.moveCube{value: BASE}(c, 100);

        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MINTER));
        cubes.withdrawHouse(MINTER);

        uint256 before = OWNER.balance;
        vm.prank(OWNER);
        cubes.withdrawHouse(OWNER);
        assertEq(OWNER.balance - before, BASE);
        assertEq(cubes.houseBalance(), 0);
    }

    function testKnobSettersOnlyOwnerAndBounds() public {
        vm.prank(MINTER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MINTER));
        cubes.setBaseFee(1);

        vm.startPrank(OWNER);
        cubes.setBaseFee(5);
        assertEq(cubes.baseFee(), 5);
        cubes.setBiomeWeight(5, 99);
        assertEq(cubes.biomeWeight(5), 99);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.BadBiomeId.selector, uint8(6)));
        cubes.setBiomeWeight(6, 1);
        vm.expectRevert(abi.encodeWithSelector(CubeNFT.CutTooHigh.selector, uint16(10001)));
        cubes.setDisplaceHouseCutBps(10001);
        vm.stopPrank();
    }

    function testWithdrawOwedRevertsWhenNothing() public {
        vm.prank(MINTER);
        vm.expectRevert(CubeNFT.NothingOwed.selector);
        cubes.withdrawOwed();
    }
}
