// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CubeHilbertGeometry
/// @notice Stateless, swappable module that derives a motif's drawing geometry
/// from its Hilbert slot: the colour axis (unique plane axis) and a 9-bit frame
/// layout (which 3 of the 4 frame sides the unique plane's path-edges occupy).
///
/// A motif = 8 Hilbert vertices -> 3 plane quads (offsets [0,1,2,3],[2,3,4,5],
/// [4,5,6,7]); the UNIQUE plane is always the middle one (verts [2,3,4,5]) and
/// its axis is the cube's colour. We compute the 8 vertices via an O(order)
/// per-motif octree descent (mirrors core/hilbert.js hilbertC child transforms;
/// validated to match the canonical generator for all 4096 slots).
///
/// Layout packing: 3 bits per path-edge — bit0 horizontal?, bit1 const-side
/// high (top/right), bit2 start-side high. Consumers decode it for side + point
/// placement. `mainAxis` is provably the same unique axis (0 mismatches/4096).
contract CubeHilbertGeometry {
    uint256 private constant HILBERT_ORDER = 5;

    function motifLayout(uint256 slot) external pure returns (uint256) {
        (int256[3] memory c0, int256[3] memory c1, int256[3] memory c2, int256[3] memory c3) =
            _uniqueVerts(slot);
        return _encodeLayout(c0, c1, c2, c3);
    }

    // 0=x(red), 1=y(green), 2=z(blue) — the unique plane axis (octree walk).
    function mainAxis(uint256 motif) external pure returns (uint256) {
        uint256 levels = HILBERT_ORDER - 1;
        uint256 a = 0;
        uint256 b = 1;
        uint256 c = 2;
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (motif / (8 ** (levels - 1 - i))) % 8;
            uint256 na;
            uint256 nb;
            uint256 nc;
            if (d == 3 || d == 4) {
                (na, nb, nc) = (a, b, c);
            } else if (d == 1 || d == 2 || d == 5 || d == 6) {
                (na, nb, nc) = (c, a, b);
            } else {
                (na, nb, nc) = (b, c, a);
            }
            (a, b, c) = (na, nb, nc);
        }
        return b;
    }

    // The DOUBLED axis: both outer plane quads ([0,1,2,3] and [4,5,6,7]) are
    // parallel and share this axis (the octree's `c`, = the b3 basis whose normal
    // both outer planes carry). It's the colour of the majority of stone walkers.
    // Same octree walk as mainAxis; returns `c` instead of `b`.
    function sideAxis(uint256 motif) external pure returns (uint256) {
        uint256 levels = HILBERT_ORDER - 1;
        uint256 a = 0;
        uint256 b = 1;
        uint256 c = 2;
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (motif / (8 ** (levels - 1 - i))) % 8;
            uint256 na;
            uint256 nb;
            uint256 nc;
            if (d == 3 || d == 4) {
                (na, nb, nc) = (a, b, c);
            } else if (d == 1 || d == 2 || d == 5 || d == 6) {
                (na, nb, nc) = (c, a, b);
            } else {
                (na, nb, nc) = (b, c, a);
            }
            (a, b, c) = (na, nb, nc);
        }
        return c;
    }

    // Motif verts [2,3,4,5] (the unique plane) via per-motif octree descent.
    function _uniqueVerts(uint256 slot)
        private
        pure
        returns (int256[3] memory c0, int256[3] memory c1, int256[3] memory c2, int256[3] memory c3)
    {
        int256[3] memory b1;
        b1[0] = 1;
        int256[3] memory b2;
        b2[1] = 1;
        int256[3] memory b3;
        b3[2] = 1;
        int256[3] memory o;
        int256 s = int256(1) << HILBERT_ORDER; // 2^order = 32
        uint256 levels = HILBERT_ORDER - 1;
        for (uint256 i = 0; i < levels; i++) {
            uint256 d = (slot / (8 ** (levels - 1 - i))) % 8;
            s /= 2;
            (o, b1, b2, b3) = _child(s, o, b1, b2, b3, d);
        }
        s /= 2; // expand the s=2 node into its s=1 leaves
        int256[3] memory bO = _adjustOrigin(o, s, b1, b2, b3);
        c0 = _add2(bO, s, b1, b2); // vert 2
        c1 = _add(bO, s, b2); // vert 3
        c2 = _add2(bO, s, b2, b3); // vert 4
        c3 = _add3(bO, s, b1, b2, b3); // vert 5
    }

    function _encodeLayout(
        int256[3] memory c0,
        int256[3] memory c1,
        int256[3] memory c2,
        int256[3] memory c3
    )
        private
        pure
        returns (uint256)
    {
        uint256 B = (c0[0] == c1[0] && c1[0] == c2[0] && c2[0] == c3[0])
            ? 0
            : (c0[1] == c1[1] && c1[1] == c2[1] && c2[1] == c3[1] ? 1 : 2);
        uint256 U = B == 0 ? 1 : 0;
        uint256 V = B == 2 ? 1 : 2;
        int256 minU = _min4(c0[U], c1[U], c2[U], c3[U]);
        int256 minV = _min4(c0[V], c1[V], c2[V], c3[V]);
        return _edgeBits(c0, c1, U, V, minU, minV) | (_edgeBits(c1, c2, U, V, minU, minV) << 3)
            | (_edgeBits(c2, c3, U, V, minU, minV) << 6);
    }

    function _edgeBits(
        int256[3] memory A,
        int256[3] memory Bp,
        uint256 U,
        uint256 V,
        int256 minU,
        int256 minV
    )
        private
        pure
        returns (uint256)
    {
        uint256 uA = uint256(A[U] - minU);
        uint256 vA = uint256(A[V] - minV);
        uint256 uB = uint256(Bp[U] - minU);
        if (uA == uB) {
            return (uA == 1 ? 2 : 0) | (vA == 0 ? 4 : 0);
        }
        return 1 | (vA == 1 ? 2 : 0) | (uA == 0 ? 4 : 0);
    }

    function _child(
        int256 s,
        int256[3] memory o,
        int256[3] memory b1,
        int256[3] memory b2,
        int256[3] memory b3,
        uint256 d
    )
        private
        pure
        returns (int256[3] memory, int256[3] memory, int256[3] memory, int256[3] memory)
    {
        int256[3] memory bO = _adjustOrigin(o, s, b1, b2, b3);
        if (d == 0) return (bO, b2, b3, b1);
        if (d == 1) return (_add(bO, s, b1), b3, b1, b2);
        if (d == 2) return (_add2(bO, s, b1, b2), b3, b1, b2);
        if (d == 3) return (_add(bO, s, b2), _neg(b1), _neg(b2), b3);
        if (d == 4) return (_add2(bO, s, b2, b3), _neg(b1), _neg(b2), b3);
        if (d == 5) return (_add3(bO, s, b1, b2, b3), _neg(b3), b1, _neg(b2));
        if (d == 6) return (_add2(bO, s, b1, b3), _neg(b3), b1, _neg(b2));
        return (_add(bO, s, b3), b2, _neg(b3), _neg(b1));
    }

    function _adjustOrigin(
        int256[3] memory o,
        int256 s,
        int256[3] memory b1,
        int256[3] memory b2,
        int256[3] memory b3
    )
        private
        pure
        returns (int256[3] memory r)
    {
        r[0] = o[0];
        r[1] = o[1];
        r[2] = o[2];
        if (b1[0] < 0) r[0] -= s * b1[0];
        if (b2[0] < 0) r[0] -= s * b2[0];
        if (b3[0] < 0) r[0] -= s * b3[0];
        if (b1[1] < 0) r[1] -= s * b1[1];
        if (b2[1] < 0) r[1] -= s * b2[1];
        if (b3[1] < 0) r[1] -= s * b3[1];
        if (b1[2] < 0) r[2] -= s * b1[2];
        if (b2[2] < 0) r[2] -= s * b2[2];
        if (b3[2] < 0) r[2] -= s * b3[2];
    }

    function _add(int256[3] memory o, int256 s, int256[3] memory a)
        private
        pure
        returns (int256[3] memory r)
    {
        r[0] = o[0] + s * a[0];
        r[1] = o[1] + s * a[1];
        r[2] = o[2] + s * a[2];
    }

    function _add2(int256[3] memory o, int256 s, int256[3] memory a, int256[3] memory b)
        private
        pure
        returns (int256[3] memory r)
    {
        r[0] = o[0] + s * a[0] + s * b[0];
        r[1] = o[1] + s * a[1] + s * b[1];
        r[2] = o[2] + s * a[2] + s * b[2];
    }

    function _add3(
        int256[3] memory o,
        int256 s,
        int256[3] memory a,
        int256[3] memory b,
        int256[3] memory c
    )
        private
        pure
        returns (int256[3] memory r)
    {
        r[0] = o[0] + s * (a[0] + b[0] + c[0]);
        r[1] = o[1] + s * (a[1] + b[1] + c[1]);
        r[2] = o[2] + s * (a[2] + b[2] + c[2]);
    }

    function _neg(int256[3] memory v) private pure returns (int256[3] memory r) {
        r[0] = -v[0];
        r[1] = -v[1];
        r[2] = -v[2];
    }

    function _min4(int256 a, int256 b, int256 c, int256 d) private pure returns (int256 m) {
        m = a;
        if (b < m) m = b;
        if (c < m) m = c;
        if (d < m) m = d;
    }
}
