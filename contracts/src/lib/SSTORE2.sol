// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Store immutable byte blobs as contract runtime code, read back via
///         EXTCODECOPY. ~200 gas/byte to write (vs 20k/word for SSTORE) — the cheap
///         way to keep large read-only data (e.g. flattened art payloads) on-chain.
///         Minimal vendored variant of the well-known Solmate/Solady SSTORE2.
library SSTORE2 {
    error DeploymentFailed();

    /// @dev Deploys a contract whose runtime code is `0x00 ++ data` (the leading
    ///      STOP makes the code inert) and returns its address.
    function write(bytes memory data) internal returns (address pointer) {
        // 11-byte creation prefix that CODECOPYs everything after it and RETURNs it
        // as runtime code, then the STOP byte, then the data.
        bytes memory creationCode =
            abi.encodePacked(hex"60_0B_59_81_38_03_80_92_59_39_F3_00", data);
        assembly {
            pointer := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        if (pointer == address(0)) revert DeploymentFailed();
    }

    /// @dev Reads the full stored blob (skips the 1-byte STOP prefix).
    function read(address pointer) internal view returns (bytes memory data) {
        uint256 size;
        assembly {
            size := extcodesize(pointer)
        }
        if (size < 2) return "";
        unchecked {
            size -= 1; // drop the STOP prefix
        }
        data = new bytes(size);
        assembly {
            extcodecopy(pointer, add(data, 0x20), 1, size)
        }
    }

    /// @dev Reads `size` bytes starting at byte `start` of the stored blob (i.e.
    ///      the data AFTER the 1-byte STOP prefix). Used to slice one payload out of
    ///      a packed batch blob without loading the whole 24KB into memory.
    function read(address pointer, uint256 start, uint256 size)
        internal
        view
        returns (bytes memory data)
    {
        data = new bytes(size);
        assembly {
            // +1 skips the STOP prefix that write() prepends.
            extcodecopy(pointer, add(data, 0x20), add(start, 1), size)
        }
    }

    /// @dev Byte length of the blob stored at `pointer` (0 if none).
    function length(address pointer) internal view returns (uint256 len) {
        assembly {
            len := extcodesize(pointer)
        }
        if (len == 0) return 0;
        unchecked {
            len -= 1;
        }
    }
}
