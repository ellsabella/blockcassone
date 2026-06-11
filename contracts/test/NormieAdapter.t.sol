// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { NormieAdapter } from "../src/NormieAdapter.sol";
import { MainnetNormieAdapter } from "../src/MainnetNormieAdapter.sol";
import { NormieAddresses } from "../src/NormieAddresses.sol";

contract MockNormiesCore {
    address public storageContract;
    address public rendererContract;
    uint256 public totalSupply = 123;

    mapping(uint256 tokenId => address owner) private _ownerOf;

    error MissingToken();

    constructor(address storageContract_, address rendererContract_) {
        storageContract = storageContract_;
        rendererContract = rendererContract_;
    }

    function setOwner(uint256 tokenId, address owner) external {
        _ownerOf[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _ownerOf[tokenId];
        if (owner == address(0)) revert MissingToken();
        return owner;
    }

    function maxSupply() external pure returns (uint256) {
        return 10_000;
    }

    function tokenURI(uint256) external pure returns (string memory) {
        return "data:application/json;base64,test";
    }
}

contract MockNormiesStorage {
    bool public revealed;

    mapping(uint256 tokenId => bool dataSet) public isTokenDataSet;
    mapping(uint256 tokenId => bytes rawImageData) private _rawImageData;
    mapping(uint256 tokenId => bytes8 tokenTraits) private _tokenTraits;

    error TokenDataNotSet(uint256 tokenId);

    function setRevealed(bool revealed_) external {
        revealed = revealed_;
    }

    function setTokenData(uint256 tokenId, bytes calldata rawImageData, bytes8 traits) external {
        isTokenDataSet[tokenId] = true;
        _rawImageData[tokenId] = rawImageData;
        _tokenTraits[tokenId] = traits;
    }

    function isRevealed() external view returns (bool) {
        return revealed;
    }

    function getTokenRawImageData(uint256 tokenId) external view returns (bytes memory) {
        if (!isTokenDataSet[tokenId]) revert TokenDataNotSet(tokenId);
        return _rawImageData[tokenId];
    }

    function getTokenTraits(uint256 tokenId) external view returns (bytes8) {
        if (!isTokenDataSet[tokenId]) revert TokenDataNotSet(tokenId);
        return _tokenTraits[tokenId];
    }
}

contract NormieAdapterTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant RENDERER = address(0xBEEF);

    MockNormiesCore private normies;
    MockNormiesStorage private storageContract;
    NormieAdapter private adapter;

    function setUp() public {
        storageContract = new MockNormiesStorage();
        normies = new MockNormiesCore(address(storageContract), RENDERER);
        adapter = new NormieAdapter(
            NormieAdapter.NormieContracts({
                normies: address(normies),
                storageContract: address(storageContract),
                renderer: address(0x1),
                rendererV2: address(0x2),
                rendererV3: address(0x3),
                rendererV4: address(0x4),
                minter: address(0x5),
                minterV2: address(0x6),
                canvas: address(0x7),
                canvasStorage: address(0x8)
            })
        );
    }

    function testMainnetAdapterUsesKnownContracts() public {
        MainnetNormieAdapter mainnetAdapter = new MainnetNormieAdapter();
        NormieAdapter.NormieContracts memory config = mainnetAdapter.contractsConfig();

        assertEq(config.normies, NormieAddresses.NORMIES);
        assertEq(config.storageContract, NormieAddresses.NORMIES_STORAGE);
        assertEq(config.rendererV4, NormieAddresses.NORMIES_RENDERER_V4);
        assertEq(config.canvas, NormieAddresses.NORMIES_CANVAS);
        assertEq(config.canvasStorage, NormieAddresses.NORMIES_CANVAS_STORAGE);
    }

    function testAdapterExposesConfiguredAndCoreAddresses() public view {
        assertEq(adapter.normies(), address(normies));
        assertEq(adapter.normiesStorage(), address(storageContract));
        assertEq(adapter.coreStorageContract(), address(storageContract));
        assertEq(adapter.coreRendererContract(), RENDERER);

        NormieAdapter.NormieContracts memory config = adapter.contractsConfig();
        assertEq(config.rendererV3, address(0x3));
        assertEq(config.minterV2, address(0x6));
    }

    function testAdapterReadsOwnerStorageAndTraits() public {
        bytes memory rawImageData = hex"0102030405";
        bytes8 traits = bytes8(hex"aabbccddeeff0011");

        normies.setOwner(42, OWNER);
        storageContract.setRevealed(true);
        storageContract.setTokenData(42, rawImageData, traits);

        assertEq(adapter.ownerOf(42), OWNER);
        assertTrue(adapter.isRevealed());
        assertTrue(adapter.isTokenDataSet(42));
        assertEq(adapter.rawImageData(42), rawImageData);
        assertEq(adapter.traits(42), traits);

        NormieAdapter.NormieData memory data = adapter.normieData(42);
        assertTrue(data.exists);
        assertTrue(data.storageDataSet);
        assertTrue(data.revealed);
        assertEq(data.owner, OWNER);
        assertEq(data.rawImageData, rawImageData);
        assertEq(data.traits, traits);
    }

    function testNormieDataHandlesMissingOwnerButPresentStorage() public {
        bytes memory rawImageData = hex"99";
        bytes8 traits = bytes8(hex"1111111111111111");
        storageContract.setTokenData(7, rawImageData, traits);

        NormieAdapter.NormieData memory data = adapter.normieData(7);
        assertFalse(data.exists);
        assertTrue(data.storageDataSet);
        assertEq(data.owner, address(0));
        assertEq(data.rawImageData, rawImageData);
        assertEq(data.traits, traits);
    }

    function testNormieDataSkipsRawReadsWhenStorageMissing() public {
        normies.setOwner(8, OWNER);

        NormieAdapter.NormieData memory data = adapter.normieData(8);
        assertTrue(data.exists);
        assertFalse(data.storageDataSet);
        assertEq(data.owner, OWNER);
        assertEq(data.rawImageData.length, 0);
        assertEq(data.traits, bytes8(0));
    }

    function testRenderDataExposesRendererFriendlySummary() public {
        bytes memory rawImageData = hex"010203040506";
        bytes8 traits = bytes8(hex"0102030405060708");

        normies.setOwner(77, OWNER);
        storageContract.setRevealed(true);
        storageContract.setTokenData(77, rawImageData, traits);

        NormieAdapter.RenderData memory data = adapter.renderData(77);
        assertTrue(data.exists);
        assertTrue(data.storageDataSet);
        assertTrue(data.revealed);
        assertEq(data.owner, OWNER);
        assertEq(data.rawImageDataLength, rawImageData.length);
        assertEq(data.rawImageDataHash, keccak256(rawImageData));
        assertEq(data.traits, traits);
        assertEq(data.traitsHash, keccak256(abi.encodePacked(traits)));

        assertEq(adapter.rawImageDataHash(77), keccak256(rawImageData));
        assertEq(adapter.traitsHash(77), keccak256(abi.encodePacked(traits)));
    }

    function testRenderDataSkipsStorageReadsWhenStorageMissing() public {
        normies.setOwner(88, OWNER);

        NormieAdapter.RenderData memory data = adapter.renderData(88);
        assertTrue(data.exists);
        assertFalse(data.storageDataSet);
        assertEq(data.owner, OWNER);
        assertEq(data.rawImageDataLength, 0);
        assertEq(data.rawImageDataHash, bytes32(0));
        assertEq(data.traits, bytes8(0));
        assertEq(data.traitsHash, bytes32(0));
    }

    function testConstructorRejectsMissingNormiesContract() public {
        vm.expectRevert(NormieAdapter.InvalidNormiesContract.selector);
        new NormieAdapter(
            NormieAdapter.NormieContracts({
                normies: address(0),
                storageContract: address(storageContract),
                renderer: address(0),
                rendererV2: address(0),
                rendererV3: address(0),
                rendererV4: address(0),
                minter: address(0),
                minterV2: address(0),
                canvas: address(0),
                canvasStorage: address(0)
            })
        );
    }

    function testConstructorRejectsMissingStorageContract() public {
        vm.expectRevert(NormieAdapter.InvalidStorageContract.selector);
        new NormieAdapter(
            NormieAdapter.NormieContracts({
                normies: address(normies),
                storageContract: address(0),
                renderer: address(0),
                rendererV2: address(0),
                rendererV3: address(0),
                rendererV4: address(0),
                minter: address(0),
                minterV2: address(0),
                canvas: address(0),
                canvasStorage: address(0)
            })
        );
    }
}
