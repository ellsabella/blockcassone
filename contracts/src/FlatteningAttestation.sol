// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

contract FlatteningAttestation is EIP712, Ownable {
    struct Attestation {
        address minter;
        address sourceContract;
        uint256 sourceTokenId;
        uint8 payloadVersion;
        bool agentic;
        uint16 flatteningVersion;
        bytes32 payloadHash;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address minter,address sourceContract,uint256 sourceTokenId,uint8 payloadVersion,bool agentic,uint16 flatteningVersion,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    );

    error InvalidAttestationSigner(address signer);
    error ExpiredAttestation(uint256 deadline);
    error InvalidMinter(address expected, address actual);
    error NonceAlreadyUsed(address minter, uint256 nonce);

    event AttestationSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event AuthorizedConsumerUpdated(address indexed oldConsumer, address indexed newConsumer);
    event AttestationConsumed(
        address indexed minter,
        address indexed sourceContract,
        uint256 indexed sourceTokenId,
        uint256 nonce,
        bytes32 payloadHash
    );

    address public attestationSigner;
    address public authorizedConsumer;
    mapping(address minter => mapping(uint256 nonce => bool used)) public nonceUsed;

    constructor(address initialOwner_, address attestationSigner_)
        EIP712("BlockcassoneFlattening", "1")
        Ownable(initialOwner_)
    {
        attestationSigner = attestationSigner_;
        emit AttestationSignerUpdated(address(0), attestationSigner_);
    }

    function setAuthorizedConsumer(address newConsumer) external onlyOwner {
        address oldConsumer = authorizedConsumer;
        authorizedConsumer = newConsumer;
        emit AuthorizedConsumerUpdated(oldConsumer, newConsumer);
    }

    function setAttestationSigner(address newSigner) external onlyOwner {
        address oldSigner = attestationSigner;
        attestationSigner = newSigner;
        emit AttestationSignerUpdated(oldSigner, newSigner);
    }

    function verifyAttestation(Attestation calldata attestation, bytes calldata signature)
        external
        view
        returns (bool)
    {
        _verify(attestation, signature, false);
        return true;
    }

    function consumeAttestation(Attestation calldata attestation, bytes calldata signature) external {
        _verify(attestation, signature, true);

        nonceUsed[attestation.minter][attestation.nonce] = true;
        emit AttestationConsumed(
            attestation.minter,
            attestation.sourceContract,
            attestation.sourceTokenId,
            attestation.nonce,
            attestation.payloadHash
        );
    }

    function hashAttestation(Attestation calldata attestation) public view returns (bytes32) {
        return _hashTypedDataV4(_structHash(attestation));
    }

    function _verify(
        Attestation calldata attestation,
        bytes calldata signature,
        bool requireCallerIsMinter
    ) private view {
        if (attestation.deadline < block.timestamp) revert ExpiredAttestation(attestation.deadline);
        if (
            requireCallerIsMinter && attestation.minter != msg.sender
                && authorizedConsumer != msg.sender
        ) {
            revert InvalidMinter(attestation.minter, msg.sender);
        }
        if (nonceUsed[attestation.minter][attestation.nonce]) {
            revert NonceAlreadyUsed(attestation.minter, attestation.nonce);
        }

        address signer = ECDSA.recover(hashAttestation(attestation), signature);
        if (signer != attestationSigner) revert InvalidAttestationSigner(signer);
    }

    function _structHash(Attestation calldata attestation) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                attestation.minter,
                attestation.sourceContract,
                attestation.sourceTokenId,
                attestation.payloadVersion,
                attestation.agentic,
                attestation.flatteningVersion,
                attestation.payloadHash,
                attestation.nonce,
                attestation.deadline
            )
        );
    }
}
