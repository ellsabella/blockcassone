// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {CubeMintController} from "../src/CubeMintController.sol";
import {CubeNFT} from "../src/CubeNFT.sol";
import {FlatteningAttestation} from "../src/FlatteningAttestation.sol";
import {NonNormieArt} from "../src/NonNormieArt.sol";
import {NonNormieArtStore} from "../src/NonNormieArtStore.sol";

contract ControllerMockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract CubeMintControllerTest is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant OWNER = address(0xCAFE);
    address private constant MINTER = address(0xB0B);
    address private constant OTHER = address(0xBAD);

    ControllerMockERC721 private normies;
    ControllerMockERC721 private externalNft;
    CubeNFT private cubes;
    NonNormieArtStore private artStore;
    FlatteningAttestation private attestationVerifier;
    CubeMintController private controller;
    address private signer;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        normies = new ControllerMockERC721("Normies", "NORM");
        externalNft = new ControllerMockERC721("External", "EXT");
        cubes = new CubeNFT("Blockcassone Cubes", "CUBE", address(normies), 64, address(this));
        artStore = new NonNormieArtStore(address(this));
        attestationVerifier = new FlatteningAttestation(OWNER, signer);
        controller = new CubeMintController(cubes, artStore, attestationVerifier);

        cubes.setCustomizer(address(controller)); // authorize re-base (while test still owns cubes)
        cubes.transferOwnership(address(controller));
        artStore.transferOwnership(address(controller));

        vm.prank(OWNER);
        attestationVerifier.setAuthorizedConsumer(address(controller));

        externalNft.mint(MINTER, 1);
        externalNft.mint(OTHER, 2);
        vm.warp(1_000);
    }

    function testMintExternalCubeWithPayload() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        uint256 cubeId = controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );

        assertEq(cubeId, 1);
        assertEq(cubes.ownerOf(cubeId), MINTER);
        assertEq(cubes.cubeForSlot(7), cubeId);
        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.payloadVersion, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT);
        assertFalse(data.agentic);
        assertEq(data.agentId, 0);
        assertEq(artStore.payloadForCube(cubeId), payload);
        assertTrue(attestationVerifier.nonceUsed(MINTER, 1));

        (uint8 version, bytes32 payloadHash) = artStore.payloadRecordForCube(cubeId);
        assertEq(version, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT);
        assertEq(payloadHash, NonNormieArt.hashTonalBands2Bit(payload));
    }

    function testMintExternalCubeWithAgenticPayload() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        attestation.agentic = true;
        attestation.agentId = 32813;
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        uint256 cubeId = controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertTrue(data.agentic);
        assertEq(data.agentId, 32813);
    }

    function testRejectsAttestationForDifferentMinter() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(OTHER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        vm.expectRevert(CubeMintController.AttestationMinterMismatch.selector);
        controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );
    }

    function testRejectsAttestationForDifferentSource() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 2, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        vm.expectRevert(CubeMintController.AttestationSourceMismatch.selector);
        controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );
    }

    function testRejectsPayloadHashMismatch() public {
        bytes memory payload = _samplePayload();
        bytes memory changedPayload = _samplePayload();
        changedPayload[0] = bytes1(uint8(0));
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CubeMintController.PayloadHashMismatch.selector,
                attestation.payloadHash,
                NonNormieArt.hashTonalBands2Bit(changedPayload)
            )
        );
        controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            changedPayload,
            attestation,
            signature
        );
    }

    function testRejectsPayloadVersionMismatch() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 2, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(CubeMintController.AttestationPayloadVersionMismatch.selector, 2)
        );
        controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );
    }

    function testRejectsWhenMinterNoLongerOwnsSource() public {
        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        externalNft.transferFrom(MINTER, OTHER, 1);

        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(CubeNFT.NotSourceOwner.selector, address(externalNft), 1, MINTER)
        );
        controller.mintExternalERC721CubeWithPayload(
            address(externalNft),
            1,
            7,
            bytes32("seed"),
            payload,
            attestation,
            signature
        );
    }

    function testCustomizeCubeRebasesSourceAndPayload() public {
        // A Normie genesis cube owned by MINTER.
        normies.mint(MINTER, 500);
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(500, 7, bytes32("seed"));

        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(MINTER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(MINTER);
        controller.customizeCube(cubeId, address(externalNft), 1, payload, attestation, signature);

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.sourceKind, cubes.SOURCE_KIND_EXTERNAL_ERC721()); // adopts the new source
        assertEq(data.sourceContract, address(externalNft));
        assertEq(data.sourceTokenId, 1);
        assertEq(data.payloadVersion, NonNormieArt.PAYLOAD_VERSION_TONAL_BANDS_2BIT);
        assertEq(data.slot, 7); // slot preserved
        assertEq(data.seed, bytes32("seed")); // identity preserved
        assertEq(artStore.payloadForCube(cubeId), payload);
        assertTrue(attestationVerifier.nonceUsed(MINTER, 1));
    }

    function testCustomizeCubeIsRepeatable() public {
        normies.mint(MINTER, 500);
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(500, 7, bytes32("seed"));

        bytes memory p1 = _samplePayload();
        FlatteningAttestation.Attestation memory a1 =
            _attestation(MINTER, address(externalNft), 1, 1, p1, block.timestamp + 1 days);
        // Sign before pranking: _sign() calls hashAttestation() (an external call),
        // which would otherwise consume the vm.prank meant for customizeCube.
        bytes memory s1 = _sign(a1);
        vm.prank(MINTER);
        controller.customizeCube(cubeId, address(externalNft), 1, p1, a1, s1);

        bytes memory p2 = _samplePayload();
        p2[10] = bytes1(uint8(0x55)); // different art
        FlatteningAttestation.Attestation memory a2 =
            _attestation(MINTER, address(externalNft), 2, 1, p2, block.timestamp + 1 days);
        a2.nonce = 2; // fresh nonce
        bytes memory s2 = _sign(a2); // sign before prank (see above)
        vm.prank(MINTER);
        controller.customizeCube(cubeId, address(externalNft), 2, p2, a2, s2);

        CubeNFT.CubeData memory data = cubes.cubeData(cubeId);
        assertEq(data.sourceTokenId, 2); // latest source wins
        assertEq(artStore.payloadForCube(cubeId), p2); // latest art wins
    }

    function testCustomizeRejectsNonCubeOwner() public {
        normies.mint(MINTER, 500);
        vm.prank(MINTER);
        uint256 cubeId = cubes.mintNormieCube(500, 7, bytes32("seed"));

        bytes memory payload = _samplePayload();
        FlatteningAttestation.Attestation memory attestation =
            _attestation(OTHER, address(externalNft), 1, 1, payload, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation);

        vm.prank(OTHER); // OTHER does not own the cube
        vm.expectRevert(abi.encodeWithSelector(CubeMintController.CubeOwnerMismatch.selector, cubeId, OTHER));
        controller.customizeCube(cubeId, address(externalNft), 1, payload, attestation, signature);
    }

    function _attestation(
        address minter,
        address sourceContract,
        uint256 sourceTokenId,
        uint8 payloadVersion,
        bytes memory payload,
        uint256 deadline
    ) private pure returns (FlatteningAttestation.Attestation memory) {
        return FlatteningAttestation.Attestation({
            minter: minter,
            sourceContract: sourceContract,
            sourceTokenId: sourceTokenId,
            payloadVersion: payloadVersion,
            agentic: false,
            agentId: 0,
            flatteningVersion: 1,
            payloadHash: NonNormieArt.hashTonalBands2Bit(payload),
            nonce: 1,
            deadline: deadline
        });
    }

    function _samplePayload() private pure returns (bytes memory payload) {
        payload = new bytes(NonNormieArt.TONAL_BANDS_2BIT_BYTE_LENGTH);
        payload[0] = bytes1(uint8(0xE4));
        payload[399] = bytes1(uint8(0x7B));
    }

    function _sign(FlatteningAttestation.Attestation memory attestation)
        private
        view
        returns (bytes memory)
    {
        bytes32 digest = attestationVerifier.hashAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
