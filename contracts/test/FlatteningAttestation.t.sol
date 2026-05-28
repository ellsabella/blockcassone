// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {FlatteningAttestation} from "../src/FlatteningAttestation.sol";

contract FlatteningAttestationTest is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant WRONG_SIGNER_KEY = 0xB0B;
    address private constant OWNER = address(0xCAFE);
    address private constant MINTER = address(0xDAD);
    address private constant OTHER = address(0xBAD);
    address private constant SOURCE_CONTRACT = address(0x1234);

    FlatteningAttestation private verifier;
    address private signer;
    address private wrongSigner;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        wrongSigner = vm.addr(WRONG_SIGNER_KEY);
        verifier = new FlatteningAttestation(OWNER, signer);
        vm.warp(1_000);
    }

    function testValidSignatureVerifiesAndConsumes() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, SIGNER_KEY);

        assertTrue(verifier.verifyAttestation(attestation, signature));

        vm.prank(MINTER);
        verifier.consumeAttestation(attestation, signature);

        assertTrue(verifier.nonceUsed(MINTER, 1));
    }

    function testConsumeEmitsEvent() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(7, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, SIGNER_KEY);

        vm.expectEmit(true, true, true, true, address(verifier));
        emit FlatteningAttestation.AttestationConsumed(
            MINTER,
            SOURCE_CONTRACT,
            attestation.sourceTokenId,
            attestation.nonce,
            attestation.payloadHash
        );

        vm.prank(MINTER);
        verifier.consumeAttestation(attestation, signature);
    }

    function testRejectsWrongSigner() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, WRONG_SIGNER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(FlatteningAttestation.InvalidAttestationSigner.selector, wrongSigner)
        );
        verifier.verifyAttestation(attestation, signature);
    }

    function testRejectsExpiredAttestation() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp - 1);
        bytes memory signature = _sign(attestation, SIGNER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(
                FlatteningAttestation.ExpiredAttestation.selector,
                attestation.deadline
            )
        );
        verifier.verifyAttestation(attestation, signature);
    }

    function testRejectsNonceReuseForVerifyAndConsume() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, SIGNER_KEY);

        vm.prank(MINTER);
        verifier.consumeAttestation(attestation, signature);

        vm.expectRevert(
            abi.encodeWithSelector(FlatteningAttestation.NonceAlreadyUsed.selector, MINTER, 1)
        );
        verifier.verifyAttestation(attestation, signature);

        vm.prank(MINTER);
        vm.expectRevert(
            abi.encodeWithSelector(FlatteningAttestation.NonceAlreadyUsed.selector, MINTER, 1)
        );
        verifier.consumeAttestation(attestation, signature);
    }

    function testConsumeRequiresCallerIsMinter() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, SIGNER_KEY);

        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(FlatteningAttestation.InvalidMinter.selector, MINTER, OTHER)
        );
        verifier.consumeAttestation(attestation, signature);
    }

    function testOwnerCanRotateSigner() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory oldSignature = _sign(attestation, SIGNER_KEY);
        bytes memory newSignature = _sign(attestation, WRONG_SIGNER_KEY);

        vm.prank(OWNER);
        verifier.setAttestationSigner(wrongSigner);

        vm.expectRevert(
            abi.encodeWithSelector(FlatteningAttestation.InvalidAttestationSigner.selector, signer)
        );
        verifier.verifyAttestation(attestation, oldSignature);

        assertTrue(verifier.verifyAttestation(attestation, newSignature));
    }

    function testNonOwnerCannotRotateSigner() public {
        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER)
        );
        verifier.setAttestationSigner(wrongSigner);
    }

    function testSignatureBindsPayloadHash() public {
        FlatteningAttestation.Attestation memory attestation = _attestation(1, block.timestamp + 1 days);
        bytes memory signature = _sign(attestation, SIGNER_KEY);
        attestation.payloadHash = keccak256("changed");

        vm.expectRevert();
        verifier.verifyAttestation(attestation, signature);
    }

    function _attestation(uint256 nonce, uint256 deadline)
        private
        pure
        returns (FlatteningAttestation.Attestation memory)
    {
        return FlatteningAttestation.Attestation({
            minter: MINTER,
            sourceContract: SOURCE_CONTRACT,
            sourceTokenId: 42,
            payloadVersion: 1,
            flatteningVersion: 1,
            payloadHash: keccak256("payload"),
            nonce: nonce,
            deadline: deadline
        });
    }

    function _sign(FlatteningAttestation.Attestation memory attestation, uint256 privateKey)
        private
        view
        returns (bytes memory)
    {
        bytes32 digest = verifier.hashAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
