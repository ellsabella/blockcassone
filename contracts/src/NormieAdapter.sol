// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {NormieAddresses} from "./NormieAddresses.sol";
import {INormiesCore} from "./interfaces/INormiesCore.sol";
import {INormiesStorage} from "./interfaces/INormiesStorage.sol";

contract NormieAdapter {
    struct NormieContracts {
        address normies;
        address storageContract;
        address renderer;
        address rendererV2;
        address rendererV3;
        address rendererV4;
        address minter;
        address minterV2;
        address canvas;
        address canvasStorage;
    }

    struct NormieData {
        bool exists;
        bool storageDataSet;
        bool revealed;
        address owner;
        bytes rawImageData;
        bytes8 traits;
    }

    error InvalidNormiesContract();
    error InvalidStorageContract();

    NormieContracts private _contracts;

    constructor(NormieContracts memory contracts_) {
        if (contracts_.normies == address(0)) revert InvalidNormiesContract();
        if (contracts_.storageContract == address(0)) revert InvalidStorageContract();
        _contracts = contracts_;
    }

    function mainnetContracts() external pure returns (NormieContracts memory contracts_) {
        NormieAddresses.Config memory config = NormieAddresses.mainnetConfig();
        return _fromAddressConfig(config);
    }

    function contractsConfig() external view returns (NormieContracts memory contracts_) {
        return _contracts;
    }

    function normies() external view returns (address) {
        return _contracts.normies;
    }

    function normiesStorage() external view returns (address) {
        return _contracts.storageContract;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return INormiesCore(_contracts.normies).ownerOf(tokenId);
    }

    function coreStorageContract() external view returns (address) {
        return INormiesCore(_contracts.normies).storageContract();
    }

    function coreRendererContract() external view returns (address) {
        return INormiesCore(_contracts.normies).rendererContract();
    }

    function isTokenDataSet(uint256 tokenId) external view returns (bool) {
        return INormiesStorage(_contracts.storageContract).isTokenDataSet(tokenId);
    }

    function isRevealed() external view returns (bool) {
        return INormiesStorage(_contracts.storageContract).isRevealed();
    }

    function rawImageData(uint256 tokenId) external view returns (bytes memory) {
        return INormiesStorage(_contracts.storageContract).getTokenRawImageData(tokenId);
    }

    function traits(uint256 tokenId) external view returns (bytes8) {
        return INormiesStorage(_contracts.storageContract).getTokenTraits(tokenId);
    }

    function normieData(uint256 tokenId) external view returns (NormieData memory data) {
        data.revealed = INormiesStorage(_contracts.storageContract).isRevealed();
        data.storageDataSet = INormiesStorage(_contracts.storageContract).isTokenDataSet(tokenId);

        try INormiesCore(_contracts.normies).ownerOf(tokenId) returns (address owner) {
            data.exists = true;
            data.owner = owner;
        } catch {
            data.exists = false;
            data.owner = address(0);
        }

        if (data.storageDataSet) {
            data.rawImageData = INormiesStorage(_contracts.storageContract).getTokenRawImageData(
                tokenId
            );
            data.traits = INormiesStorage(_contracts.storageContract).getTokenTraits(tokenId);
        }
    }

    function _fromAddressConfig(NormieAddresses.Config memory config)
        private
        pure
        returns (NormieContracts memory contracts_)
    {
        return NormieContracts({
            normies: config.normies,
            storageContract: config.storageContract,
            renderer: config.renderer,
            rendererV2: config.rendererV2,
            rendererV3: config.rendererV3,
            rendererV4: config.rendererV4,
            minter: config.minter,
            minterV2: config.minterV2,
            canvas: config.canvas,
            canvasStorage: config.canvasStorage
        });
    }
}
