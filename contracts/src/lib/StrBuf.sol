// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title StrBuf
/// @notice O(n) string builder shared across the renderer suite. Repeated
/// `s = string.concat(s, piece)` inside a loop is O(n^2) — each append re-copies
/// the whole growing string — and the main MemoryOOG risk for large outputs.
/// These helpers append into a pre-sized `bytes` buffer in O(total length).
///
/// Usage: `using StrBuf for bytes;` then
///   bytes memory buf = StrBuf.alloc(cap);
///   buf.cat("...");
///   return buf.str();
///
/// The caller MUST reserve `cap` >= total appended bytes + 32: the word-aligned
/// copy can write up to 31 bytes of slack past the logical end, which must stay
/// inside the reserved buffer.
library StrBuf {
    /// Allocate a buffer with `cap` bytes of capacity and logical length 0.
    function alloc(uint256 cap) internal pure returns (bytes memory buf) {
        buf = new bytes(cap); // zero-filled; capacity reserved past the length word
        assembly {
            mstore(buf, 0) // logical length starts at 0 (capacity stays allocated)
        }
    }

    /// Append `piece`, advancing the buffer's logical length.
    function cat(bytes memory buf, string memory piece) internal pure {
        assembly {
            let len := mload(buf)
            let plen := mload(piece)
            let dst := add(add(buf, 0x20), len)
            let src := add(piece, 0x20)
            for { let i := 0 } lt(i, plen) { i := add(i, 0x20) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
            mstore(buf, add(len, plen)) // advance logical length
        }
    }

    /// Finalize as a string (truncated to the logical length appended).
    function str(bytes memory buf) internal pure returns (string memory) {
        return string(buf);
    }
}
