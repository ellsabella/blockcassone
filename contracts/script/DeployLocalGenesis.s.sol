// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {CubeRendererV1} from "../src/CubeRendererV1.sol";
import {NormieGenesisMinter} from "../src/NormieGenesisMinter.sol";

contract LocalMockNormies {
    mapping(uint256 tokenId => address owner) public ownerOf;

    function mint(address to, uint256 tokenId) external {
        ownerOf[tokenId] = to;
    }
}

contract DeployLocalGenesis is Script {
    uint32 internal constant DEFAULT_TOTAL_SLOTS = 4096;

    function run() external {
        address initialOwner = vm.envOr("BLOCKCASSONE_OWNER", msg.sender);
        address seaDrop = vm.envOr("BLOCKCASSONE_SEADROP", initialOwner);
        uint32 totalSlots = uint32(vm.envOr("BLOCKCASSONE_TOTAL_SLOTS", uint256(DEFAULT_TOTAL_SLOTS)));
        uint256 sampleMints = vm.envOr("BLOCKCASSONE_SAMPLE_MINTS", uint256(8));
        bytes32 publicSeed = vm.envOr("BLOCKCASSONE_PUBLIC_SEED", keccak256("blockcassone-local"));
        string memory configOut = vm.envOr("BLOCKCASSONE_CHAIN_CONFIG_OUT", string("data/chain-config.json"));

        vm.startBroadcast();

        LocalMockNormies normies = new LocalMockNormies();
        CubeNFT cubes = new CubeNFT(
            "Blockcassone Cubes",
            "CUBE",
            address(normies),
            totalSlots,
            address(this)
        );
        CubeRendererV1 renderer = new CubeRendererV1(cubes);
        NormieGenesisMinter genesis = new NormieGenesisMinter(cubes, publicSeed, address(this));

        cubes.setRenderer(address(renderer));
        cubes.transferOwnership(address(genesis));

        uint256[] memory sampleNormies = new uint256[](sampleMints);
        for (uint256 i = 0; i < sampleMints; i++) {
            normies.mint(initialOwner, i);
            sampleNormies[i] = i;
        }

        if (sampleMints > 0) {
            genesis.addSnapshotNormies(initialOwner, sampleNormies);
            genesis.finalizeSnapshot();
            genesis.setSeaDrop(seaDrop);
            genesis.setPhase(NormieGenesisMinter.Phase.Public);
            genesis.mintPublicFor(initialOwner, sampleMints);
        }

        genesis.transferOwnership(initialOwner);

        vm.stopBroadcast();

        console2.log("LocalMockNormies", address(normies));
        console2.log("CubeNFT", address(cubes));
        console2.log("CubeRendererV1", address(renderer));
        console2.log("NormieGenesisMinter", address(genesis));
        console2.log("SeaDrop", seaDrop);
        console2.log("Sample mints", sampleMints);

        _writeViewerConfig(configOut, block.chainid, address(cubes), address(genesis), address(normies));
    }

    function _writeViewerConfig(
        string memory outPath,
        uint256 chainId,
        address cubes,
        address genesis,
        address normies
    ) private {
        string memory root = "chainConfig";
        vm.serializeBool(root, "enabled", true);
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
        vm.serializeAddress(root, "cubeNft", cubes);
        vm.serializeAddress(root, "genesisMinter", genesis);
        string memory json = vm.serializeAddress(root, "normies", normies);
        vm.writeJson(json, outPath);
    }
}
