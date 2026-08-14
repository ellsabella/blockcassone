// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CubeNFT} from "../CubeNFT.sol";
import {CubeEnv} from "./CubeEnv.sol";

/// @title CubeWorldLib
/// @notice The post-mint world mechanics (move / merge / displacement economics),
///         extracted from CubeNFT as an EXTERNAL library so the logic deploys as
///         its own contract and links via DELEGATECALL. This is a size measure:
///         CubeNFT breached EIP-170 under legacy codegen with this logic inlined
///         (25,635 B at runs=1); the extraction is what lets via-ir stay off.
///
/// Execution model (all functions run under DELEGATECALL from CubeNFT):
///   - storage args (`WorldState`, the cube mappings) are pointers into CubeNFT's
///     own storage — the library contract itself holds no state;
///   - msg.sender / msg.value are the original caller's, so fee checks and
///     refunds behave exactly as they did inlined;
///   - events emitted here carry CubeNFT's address (delegatecall context), so
///     indexers and `expectEmit(.., address(cubes))` see no difference.
///
/// Boundary rule: anything touching ERC-721 token lifecycle (`_burn`, `_safeMint`)
/// stays in CubeNFT — OZ internals aren't reachable from a library. Ownership
/// READS use the public `ownerOf` via a self-call (`address(this)` == CubeNFT
/// under delegatecall); every cube id read out of `cubeForSlot` is live by
/// invariant (merged plots are burned only after the slot repoints to the street
/// token), so those self-calls cannot revert.
///
/// Errors/events are re-declared here with the SAME signatures as CubeNFT's
/// originals: selectors/topics are derived from the signature alone, so tests
/// matching `CubeNFT.X.selector` and ABI consumers are unaffected. CubeNFT keeps
/// its declarations (unused declarations cost no runtime bytecode).
library CubeWorldLib {
    // Mirrors of CubeNFT's public constants (a contract's public constants aren't
    // reachable through its type from external code, so they're restated here —
    // any change must land in both places).
    uint8 internal constant SOURCE_KIND_MERGED_STREET = 3;
    uint256 internal constant STREET_MOVE_MAJORITY = 5;
    uint256 internal constant MERGE_MIN_FILLED = 5;

    /// @dev The move/merge/fee state CubeNFT holds for the library. One struct so
    ///      call sites pass a single storage pointer instead of ten. CubeNFT
    ///      re-exposes each field through an explicit getter to keep the ABI of
    ///      the former public variables identical.
    struct WorldState {
        // Off during genesis so a moved cube can't land on a slot the allocator
        // will target (which would brick a mint tx); owner flips post-mint.
        bool movesEnabled;
        // Independent of moves — move and merge reveal on their own schedules.
        bool mergesEnabled;
        // Flat base fee: move-to-empty and per-empty-plot merge (both to the
        // house), and the base term of a displacement fee (paid to the victim).
        uint256 baseFee;
        // Added per downgrade-point when a displacement pushes the victim into a
        // lower-rarity biome.
        uint256 premiumPerPoint;
        // Fee-rarity points per biome id (0 desert,1 water,2 grass,3 forest,
        // 4 mountain,5 ice). Independent of CubeEnv's world distribution so
        // pricing tunes without moving biomes.
        uint256[6] biomeWeight;
        // House cut (bps) of a displacement fee, taken ONLY when the mover grabs
        // a higher tier.
        uint16 displaceHouseCutBps;
        // Min seconds between displacements of the same victim (anti-harassment).
        uint256 displaceCooldown;
        uint256 houseBalance; // accrued house fees, owner-withdrawable
        mapping(address => uint256) owed; // pull-payment fallback for failed pushes
        mapping(address => uint256) lastDisplacedAt; // victim -> last displacement ts
    }

    error MovesDisabled();
    error MergesDisabled();
    error NonexistentCube(uint256 cubeId);
    error NotCubeOwner(uint256 cubeId, address caller);
    error CannotMoveStreet(uint256 cubeId);
    error CannotDisplaceStreet(uint256 cubeId);
    error InvalidSlot(uint32 slot);
    error NotStreetMajority(uint32 slot, uint256 owned);
    error InsufficientFee(uint256 required, uint256 sent);
    error DisplaceCooldownActive(address victim, uint256 readyAt);
    error EmptyStreet(uint32 street);
    error NotEnoughFilled(uint32 street, uint256 occupied);
    error NotStreetOwner(uint32 street, uint256 cubeId);
    error StreetAlreadyMerged(uint32 street);
    error InvalidLeader(uint32 street, uint256 cubeId);

    event CubeMoved(uint256 indexed cubeId, uint32 indexed fromSlot, uint32 indexed toSlot, address owner);
    event MoveFeePaid(uint256 indexed cubeId, uint256 fee);
    event DisplacementPaid(uint256 indexed cubeId, address indexed victim, uint256 victimShare, uint256 houseShare);
    event MetadataUpdate(uint256 _tokenId);

    // ---- Move ----------------------------------------------------------------

    /// @notice Full moveCube logic (see CubeNFT.moveCube for the game rules).
    /// @param owner `_ownerOf(cubeId)` resolved by CubeNFT — passed in (rather
    ///        than self-called) so a nonexistent cube reverts NonexistentCube,
    ///        not ERC721's own error, and AFTER the moves-enabled gate exactly
    ///        as the inlined code did.
    function moveCube(
        WorldState storage ws,
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint256 cubeId,
        uint32 newSlot,
        uint32 totalSlots,
        address owner
    ) external {
        if (!ws.movesEnabled) revert MovesDisabled();
        if (owner == address(0)) revert NonexistentCube(cubeId);
        if (owner != msg.sender) revert NotCubeOwner(cubeId, msg.sender);

        CubeNFT.CubeData storage data = cubeData[cubeId];
        if (data.sourceKind == SOURCE_KIND_MERGED_STREET) revert CannotMoveStreet(cubeId);
        if (newSlot >= totalSlots) revert InvalidSlot(newSlot);

        uint32 oldSlot = data.slot;
        if (newSlot == oldSlot) revert InvalidSlot(newSlot);

        uint256 occupant = cubeForSlot[newSlot];
        if (occupant == 0) {
            // Plain move into a vacant slot: flat base fee to the house.
            if (msg.value < ws.baseFee) revert InsufficientFee(ws.baseFee, msg.value);
            ws.houseBalance += ws.baseFee;
            cubeForSlot[oldSlot] = 0;
            cubeForSlot[newSlot] = cubeId;
            data.slot = newSlot;
            emit CubeMoved(cubeId, oldSlot, newSlot, msg.sender);
            emit MoveFeePaid(cubeId, ws.baseFee);
            emit MetadataUpdate(cubeId); // slot changed => colour/env/street changed
            _refundExcess(ws, ws.baseFee);
            return;
        }

        // Occupied target => displacement. Merged-street tokens are anchored.
        if (cubeData[occupant].sourceKind == SOURCE_KIND_MERGED_STREET) {
            revert CannotDisplaceStreet(occupant);
        }
        _displace(ws, cubeData, cubeForSlot, cubeId, oldSlot, newSlot, occupant);
    }

    /// @dev Force-swap `cubeId` into `newSlot`, sending the occupant to `oldSlot`. A self-swap
    ///      (you own both) is free; otherwise requires majority + cooldown and pays the victim.
    function _displace(
        WorldState storage ws,
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint256 cubeId,
        uint32 oldSlot,
        uint32 newSlot,
        uint256 occupant
    ) private {
        address victim = CubeNFT(address(this)).ownerOf(occupant);

        if (victim != msg.sender) {
            uint256 ownedCount = _ownedInStreet(cubeForSlot, msg.sender, newSlot);
            if (ownedCount < STREET_MOVE_MAJORITY) revert NotStreetMajority(newSlot, ownedCount);
            // No cooldown for a never-displaced victim (lastDisplacedAt == 0).
            uint256 last = ws.lastDisplacedAt[victim];
            if (last != 0 && block.timestamp < last + ws.displaceCooldown) {
                revert DisplaceCooldownActive(victim, last + ws.displaceCooldown);
            }
        }

        (uint256 fee, uint256 houseShare, uint256 victimShare) =
            victim == msg.sender ? (uint256(0), uint256(0), uint256(0)) : _displaceFee(ws, oldSlot, newSlot);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        // Effects.
        ws.houseBalance += houseShare;
        if (victim != msg.sender) ws.lastDisplacedAt[victim] = block.timestamp;
        cubeForSlot[oldSlot] = occupant;
        cubeForSlot[newSlot] = cubeId;
        cubeData[occupant].slot = oldSlot;
        cubeData[cubeId].slot = newSlot;

        emit CubeMoved(cubeId, oldSlot, newSlot, msg.sender);
        emit CubeMoved(occupant, newSlot, oldSlot, victim); // the displaced cube
        emit MetadataUpdate(cubeId); // both cubes changed slot => colour/env/street changed
        emit MetadataUpdate(occupant);
        if (victimShare > 0 || houseShare > 0) emit DisplacementPaid(cubeId, victim, victimShare, houseShare);

        // Interactions last: pay the victim (push, pull-fallback), then refund the mover.
        _payout(ws, victim, victimShare);
        _refundExcess(ws, fee);
    }

    // ---- Merge (validation + state; burns/mint stay in CubeNFT) --------------

    /// @notice Everything of a street merge EXCEPT the token lifecycle: validates
    ///         sole ownership + fill, charges the fee, writes the street token's
    ///         CubeData/StreetInfo, and repoints all 8 slots to `streetTokenId`.
    ///         CubeNFT then burns the returned plots, mints the street token, and
    ///         emits the merge events — preserving the original event order
    ///         (plot-burn Transfers before the street mint's Transfer).
    function mergeStreet(
        WorldState storage ws,
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint256 => CubeNFT.StreetInfo) storage streetInfo,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint32 street,
        uint256 requestedLeader,
        uint256 streetTokenId,
        uint32 totalSlots
    ) external returns (uint256[8] memory plots, uint8 occupiedCount, uint256 fee) {
        // Split into helpers: legacy codegen (no via-ir) runs out of stack with the
        // storage-pointer params and the loop locals in one frame.
        if (!ws.mergesEnabled) revert MergesDisabled();

        if (uint256(street) * 8 + 8 > totalSlots) revert InvalidSlot(uint32(uint256(street) * 8));

        uint256 leader;
        (plots, occupiedCount, leader) = _collectPlots(cubeData, cubeForSlot, street, requestedLeader);

        // Fee: free when you own the whole street; baseFee per vacant plot you lock up.
        fee = (8 - uint256(occupiedCount)) * ws.baseFee;
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        ws.houseBalance += fee;

        _writeStreetToken(cubeData, streetInfo, cubeForSlot, streetTokenId, street, leader, occupiedCount, plots);
    }

    /// @dev Merge validation: every occupied plot must be the caller's, none already a
    ///      street, fill >= MERGE_MIN_FILLED; resolves the leader (lowest occupied plot
    ///      unless `requestedLeader` names an occupied plot).
    function _collectPlots(
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint32 street,
        uint256 requestedLeader
    ) private view returns (uint256[8] memory plots, uint8 occupiedCount, uint256 leader) {
        uint256 occ;
        bool leaderFound;
        for (uint256 k = 0; k < 8; k++) {
            uint256 cid = cubeForSlot[uint32(uint256(street) * 8 + k)];
            if (cid == 0) continue;
            if (cubeData[cid].sourceKind == SOURCE_KIND_MERGED_STREET) {
                revert StreetAlreadyMerged(street);
            }
            if (CubeNFT(address(this)).ownerOf(cid) != msg.sender) revert NotStreetOwner(street, cid);
            plots[k] = cid;
            if (leader == 0) leader = cid; // default: lowest occupied plot leads
            if (cid == requestedLeader) leaderFound = true;
            occ++;
        }
        if (occ == 0) revert EmptyStreet(street);
        if (occ < MERGE_MIN_FILLED) revert NotEnoughFilled(street, occ); // merge with vacants OK, but >= 5 filled
        // An explicit leader must be one of this street's occupied plots.
        if (requestedLeader != 0) {
            if (!leaderFound) revert InvalidLeader(street, requestedLeader);
            leader = requestedLeader;
        }
        occupiedCount = uint8(occ);
    }

    /// @dev Street-token bookkeeping: the leader's CubeData drives the street token's
    ///      art; all 8 slots repoint to the street token (locking them).
    function _writeStreetToken(
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint256 => CubeNFT.StreetInfo) storage streetInfo,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint256 streetTokenId,
        uint32 street,
        uint256 leader,
        uint8 occupiedCount,
        uint256[8] memory plots
    ) private {
        CubeNFT.CubeData memory ld = cubeData[leader];
        cubeData[streetTokenId] = CubeNFT.CubeData({
            slot: ld.slot, // leader's slot drives the street thumbnail (colour/geometry)
            sourceKind: SOURCE_KIND_MERGED_STREET,
            rendererVersion: ld.rendererVersion,
            payloadVersion: ld.payloadVersion,
            agentic: false,
            agentId: 0,
            mintedAt: uint64(block.timestamp),
            sourceChainId: block.chainid,
            sourceContract: ld.sourceContract,
            sourceTokenId: ld.sourceTokenId, // leader Normie -> street SVG thumbnail
            seed: ld.seed
        });

        CubeNFT.StreetInfo storage si = streetInfo[streetTokenId];
        si.street = street;
        si.occupiedCount = occupiedCount;
        for (uint256 k = 0; k < 8; k++) {
            si.plotCubeIds[k] = plots[k];
            cubeForSlot[uint32(uint256(street) * 8 + k)] = streetTokenId; // street locks all 8 slots
        }
    }

    // ---- Quotes --------------------------------------------------------------

    /// @notice What a moveCube(cubeId, newSlot) would cost right now, and how it splits.
    /// @param moverOwner `_ownerOf(cubeId)` — passed in so quoting a nonexistent
    ///        cube keeps the inlined behavior (no revert; owner treated as 0).
    function quoteMove(
        WorldState storage ws,
        mapping(uint256 => CubeNFT.CubeData) storage cubeData,
        mapping(uint32 => uint256) storage cubeForSlot,
        uint256 cubeId,
        uint32 newSlot,
        address moverOwner
    ) external view returns (uint256 fee, address victim, uint256 victimShare, uint256 houseShare) {
        uint256 occupant = cubeForSlot[newSlot];
        if (occupant == 0) return (ws.baseFee, address(0), 0, 0);
        address v = CubeNFT(address(this)).ownerOf(occupant);
        if (v == moverOwner) return (0, address(0), 0, 0); // free self-swap
        (fee, houseShare, victimShare) = _displaceFee(ws, cubeData[cubeId].slot, newSlot);
        victim = v;
    }

    /// @notice What a mergeStreet(street) would cost right now, plus the vacant-plot count.
    function quoteMerge(WorldState storage ws, mapping(uint32 => uint256) storage cubeForSlot, uint32 street)
        external
        view
        returns (uint256 fee, uint256 emptyPlots)
    {
        uint256 base = uint256(street) * 8;
        uint256 occ;
        for (uint256 k = 0; k < 8; k++) {
            if (cubeForSlot[uint32(base + k)] != 0) occ++;
        }
        emptyPlots = 8 - occ;
        fee = emptyPlots * ws.baseFee;
    }

    // ---- Fee internals -------------------------------------------------------

    /// @notice Return any msg.value above `fee` to the caller (fee already validated
    ///         as <= msg.value). External so CubeNFT's merge path can refund AFTER
    ///         its burns/mint — interactions stay last.
    function refundExcess(WorldState storage ws, uint256 fee) external {
        _refundExcess(ws, fee);
    }

    /// @dev Displacement fee split. D = rarity the victim loses = weight(target) - weight(oldSlot);
    ///      the house cut applies only when the mover grabs a higher tier (D > 0).
    function _displaceFee(WorldState storage ws, uint32 oldSlot, uint32 newSlot)
        private
        view
        returns (uint256 fee, uint256 houseShare, uint256 victimShare)
    {
        uint256 wTarget = ws.biomeWeight[CubeEnv.idForStreet(uint256(newSlot) / 8)];
        uint256 wOld = ws.biomeWeight[CubeEnv.idForStreet(uint256(oldSlot) / 8)];
        uint256 d = wTarget > wOld ? wTarget - wOld : 0;
        fee = ws.baseFee + d * ws.premiumPerPoint;
        houseShare = d > 0 ? (fee * ws.displaceHouseCutBps) / 10000 : 0;
        victimShare = fee - houseShare;
    }

    /// @dev Send `amount` to `to`; on failure credit a withdrawable balance so a recipient
    ///      that reverts on receive can't block the caller's action. Capped gas bounds griefing.
    function _payout(WorldState storage ws, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{ value: amount, gas: 30000 }("");
        if (!ok) ws.owed[to] += amount;
    }

    function _refundExcess(WorldState storage ws, uint256 fee) private {
        uint256 excess = msg.value - fee;
        if (excess > 0) _payout(ws, msg.sender, excess);
    }

    /// @dev How many of the 8 plots in `slot`'s street are cubes owned by `account`.
    function _ownedInStreet(mapping(uint32 => uint256) storage cubeForSlot, address account, uint32 slot)
        private
        view
        returns (uint256 count)
    {
        uint32 base = (slot / 8) * 8;
        for (uint32 k = 0; k < 8; k++) {
            uint256 cid = cubeForSlot[base + k];
            if (cid != 0 && CubeNFT(address(this)).ownerOf(cid) == account) count++;
        }
    }
}
