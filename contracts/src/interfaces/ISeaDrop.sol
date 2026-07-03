// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Minimal vendored subset of OpenSea SeaDrop v1 (ProjectOpenSea/seadrop) — just the
// structs + the config functions our token forwards to SeaDrop, and the token
// interface SeaDrop calls back. We do NOT inherit ERC721SeaDrop (it is ERC721A /
// sequential); our mint does bespoke Normie-source assignment, so CubeNFT
// implements INonFungibleSeaDropToken with a custom mintSeaDrop that routes to
// NormieGenesisMinter. Struct layouts match SeaDrop so the real SeaDrop singleton
// can drive the drop unchanged.

struct PublicDrop {
    uint80 mintPrice;
    uint48 startTime;
    uint48 endTime;
    uint16 maxTotalMintableByWallet;
    uint16 feeBps;
    bool restrictFeeRecipients;
}

struct AllowListData {
    bytes32 merkleRoot;
    string[] publicKeyURIs;
    string allowListURI;
}

struct TokenGatedDropStage {
    uint80 mintPrice;
    uint16 maxTotalMintableByWallet;
    uint48 startTime;
    uint48 endTime;
    uint8 dropStageIndex;
    uint32 maxTokenSupplyForStage;
    uint16 feeBps;
    bool restrictFeeRecipients;
}

struct SignedMintValidationParams {
    uint80 minMintPrice;
    uint24 maxMaxTotalMintableByWallet;
    uint40 minStartTime;
    uint40 maxEndTime;
    uint40 maxMaxTokenSupplyForStage;
    uint16 minFeeBps;
    uint16 maxFeeBps;
}

/// @notice The SeaDrop singleton contract — the config surface our token forwards
///         to. (Payment / allowlist / limit validation live here; only the parts
///         our token calls are declared.)
interface ISeaDrop {
    function updatePublicDrop(PublicDrop calldata publicDrop) external;
    function updateAllowList(AllowListData calldata allowListData) external;
    function updateTokenGatedDrop(address allowedNftToken, TokenGatedDropStage calldata dropStage)
        external;
    function updateDropURI(string calldata dropURI) external;
    function updateCreatorPayoutAddress(address payoutAddress) external;
    function updateAllowedFeeRecipient(address feeRecipient, bool allowed) external;
    function updateSignedMintValidationParams(
        address signer,
        SignedMintValidationParams calldata signedMintValidationParams
    ) external;
    function updatePayer(address payer, bool allowed) external;
}

/// @notice The token interface the SeaDrop singleton calls back (mint + stats) and
///         through which the creator configures the drop.
interface INonFungibleSeaDropToken {
    /// @notice Set which SeaDrop addresses may call `mintSeaDrop`.
    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop) external;

    /// @notice SeaDrop-only: mint `quantity` tokens to `minter`.
    function mintSeaDrop(address minter, uint256 quantity) external;

    /// @notice SeaDrop reads this to enforce per-wallet + supply limits.
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply);

    // ---- creator config forwarders (token -> the given SeaDrop impl) ----
    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop) external;
    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData) external;
    function updateTokenGatedDrop(
        address seaDropImpl,
        address allowedNftToken,
        TokenGatedDropStage calldata dropStage
    ) external;
    function updateDropURI(address seaDropImpl, string calldata dropURI) external;
    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress) external;
    function updateAllowedFeeRecipient(address seaDropImpl, address feeRecipient, bool allowed)
        external;
    function updateSignedMintValidationParams(
        address seaDropImpl,
        address signer,
        SignedMintValidationParams calldata signedMintValidationParams
    ) external;
    function updatePayer(address seaDropImpl, address payer, bool allowed) external;
}
