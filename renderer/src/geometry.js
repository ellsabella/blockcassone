// Geometry generators. Each returns typed arrays ready to upload to GL buffers.
//
// Convention:
//   - World is right-handed: +X right, +Y up, +Z toward viewer.
//   - Front faces are CCW when viewed from the +normal side.
//   - Each attribute is in its own buffer (not interleaved) so the depth
//     pass can bind positions alone.

// ------------------------------------------------------------
// Box — 24 vertices (4 per face, duplicated at seams for per-face normals
// and UVs) + 36 indices.
// ------------------------------------------------------------

export function createBox(sx = 1, sy = 1, sz = 1) {
  const x = sx * 0.5, y = sy * 0.5, z = sz * 0.5;

  // Per face: origin + u-axis + v-axis + normal + tangent.
  // u and v are chosen so cross(u, v) points along +normal, giving CCW fronts.
  const faces = [
    { o: [ x, -y,  z], u: [ 0,  0, -sz], v: [ 0,  sy,  0], n: [ 1,  0,  0], t: [ 0,  0, -1] }, // +X
    { o: [-x, -y, -z], u: [ 0,  0,  sz], v: [ 0,  sy,  0], n: [-1,  0,  0], t: [ 0,  0,  1] }, // -X
    { o: [-x,  y,  z], u: [ sx,  0,  0], v: [ 0,  0, -sz], n: [ 0,  1,  0], t: [ 1,  0,  0] }, // +Y
    { o: [-x, -y, -z], u: [ sx,  0,  0], v: [ 0,  0,  sz], n: [ 0, -1,  0], t: [ 1,  0,  0] }, // -Y
    { o: [-x, -y,  z], u: [ sx,  0,  0], v: [ 0,  sy,  0], n: [ 0,  0,  1], t: [ 1,  0,  0] }, // +Z
    { o: [ x, -y, -z], u: [-sx,  0,  0], v: [ 0,  sy,  0], n: [ 0,  0, -1], t: [-1,  0,  0] }, // -Z
  ];

  const positions = [];
  const normals   = [];
  const tangents  = [];
  const uvs       = [];
  const indices   = [];

  let base = 0;
  for (const f of faces) {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        positions.push(
          f.o[0] + f.u[0] * i + f.v[0] * j,
          f.o[1] + f.u[1] * i + f.v[1] * j,
          f.o[2] + f.u[2] * i + f.v[2] * j,
        );
        normals.push(f.n[0], f.n[1], f.n[2]);
        tangents.push(f.t[0], f.t[1], f.t[2]);
        uvs.push(i, j);
      }
    }
    // Two triangles per face, CCW from the normal side.
    // Verts (i,j): 0=(0,0), 1=(1,0), 2=(0,1), 3=(1,1)
    indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    base += 4;
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    tangents:  new Float32Array(tangents),
    uvs:       new Float32Array(uvs),
    indices:   new Uint16Array(indices),
  };
}

// ------------------------------------------------------------
// Plane in the XZ plane, +Y normal (ground).
// ------------------------------------------------------------

export function createPlane(w = 1, d = 1, segW = 1, segD = 1) {
  const positions = [];
  const normals   = [];
  const tangents  = [];
  const uvs       = [];
  const indices   = [];

  const halfW = w * 0.5, halfD = d * 0.5;

  for (let j = 0; j <= segD; j++) {
    for (let i = 0; i <= segW; i++) {
      const u = i / segW;
      const v = j / segD;
      positions.push(-halfW + u * w, 0, -halfD + v * d);
      normals.push(0, 1, 0);
      tangents.push(1, 0, 0);
      uvs.push(u, v);
    }
  }

  // Winding verified by cross((p1-p0),(p2-p0)).y > 0 → +Y normal.
  for (let j = 0; j < segD; j++) {
    for (let i = 0; i < segW; i++) {
      const a = j * (segW + 1) + i;
      const b = a + 1;
      const c = a + (segW + 1);
      const d2 = c + 1;
      indices.push(a, d2, b, a, c, d2);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    tangents:  new Float32Array(tangents),
    uvs:       new Float32Array(uvs),
    indices:   new Uint16Array(indices),
  };
}

// ------------------------------------------------------------
// Fullscreen quad for post / SDF passes. 2D positions in clip space,
// UVs in [0,1]. No normals / tangents / indices.
// ------------------------------------------------------------

export function createQuad() {
  return {
    positions: new Float32Array([
      -1, -1,   1, -1,   1,  1,
      -1, -1,   1,  1,  -1,  1,
    ]),
    uvs: new Float32Array([
      0, 0,  1, 0,  1, 1,
      0, 0,  1, 1,  0, 1,
    ]),
  };
}

// ------------------------------------------------------------
// Upload a mesh into a VAO. Attribute locations are fixed so they match
// the `layout(location = N)` in the vertex shaders:
//   0 = aPosition (vec3)
//   1 = aNormal   (vec3)
//   2 = aUv       (vec2)
//   3 = aTangent  (vec3)
//   4 = aAlpha    (float)
//   5 = aVariant  (float)
// ------------------------------------------------------------

export function createMeshGL(gl, mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const glBuffers = []; // retained for disposeMeshGL — VAO-only refs leak on delete

  const addAttr = (data, loc, size) => {
    const buf = gl.createBuffer();
    glBuffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  addAttr(mesh.positions, 0, 3);
  if (mesh.normals)  addAttr(mesh.normals,  1, 3);
  if (mesh.uvs)      addAttr(mesh.uvs,      2, 2);
  if (mesh.tangents) addAttr(mesh.tangents, 3, 3);
  if (mesh.alphas)   addAttr(mesh.alphas,   4, 1);
  if (mesh.variants) addAttr(mesh.variants, 5, 1);

  let indexCount = 0;
  let indexType = gl.UNSIGNED_SHORT;
  if (mesh.indices) {
    let indices = mesh.indices;
    if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
      let maxIndex = 0;
      for (let i = 0; i < indices.length; i++) if (indices[i] > maxIndex) maxIndex = indices[i];
      indices = maxIndex > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    }
    indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const idxBuf = gl.createBuffer();
    glBuffers.push(idxBuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    indexCount = indices.length;
  }

  gl.bindVertexArray(null);
  const glMode = mesh.mode === 'LINES' ? gl.LINES : gl.TRIANGLES;
  return {
    vao,
    indexCount,
    indexType,
    vertexCount: mesh.positions.length / 3,
    mode: glMode,
    glBuffers,
  };
}

// Free a createMeshGL mesh's GPU resources. Without this, regenerating meshes
// (wallet loads, resets, scope churn) leaks every VBO/VAO permanently.
export function disposeMeshGL(gl, meshGL) {
  if (!meshGL) return;
  for (const buf of meshGL.glBuffers || []) gl.deleteBuffer(buf);
  if (meshGL.vao) gl.deleteVertexArray(meshGL.vao);
}

// ------------------------------------------------------------
// UV sphere. `stacks` = latitude segments, `slices` = longitude segments.
// Normals are unit position directions. Tangents point along +theta.
// ------------------------------------------------------------

export function createSphere(radius = 1, stacks = 24, slices = 32) {
  const positions = [];
  const normals   = [];
  const tangents  = [];
  const uvs       = [];
  const indices   = [];

  for (let y = 0; y <= stacks; y++) {
    const v   = y / stacks;
    const phi = v * Math.PI;
    for (let x = 0; x <= slices; x++) {
      const u     = x / slices;
      const theta = u * 2 * Math.PI;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      tangents.push(-Math.sin(theta), 0, Math.cos(theta));
      uvs.push(u, 1 - v);
    }
  }

  const stride = slices + 1;
  for (let y = 0; y < stacks; y++) {
    for (let x = 0; x < slices; x++) {
      const a = y * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // CCW from outside
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    tangents:  new Float32Array(tangents),
    uvs:       new Float32Array(uvs),
    indices:   new Uint16Array(indices),
  };
}

// ------------------------------------------------------------
// Unit billboard quad. Positions are (x, y, 0) in [-0.5, 0.5]; z is unused
// — the vertex shader expands along camera-space axes. Counter-clockwise
// when UV (0,0) lies at world bottom-left.
// ------------------------------------------------------------

export function createBillboard() {
  return {
    positions: new Float32Array([
      -0.5, -0.5, 0,   0.5, -0.5, 0,   0.5,  0.5, 0,
      -0.5, -0.5, 0,   0.5,  0.5, 0,  -0.5,  0.5, 0,
    ]),
    uvs: new Float32Array([
      0, 0,  1, 0,  1, 1,
      0, 0,  1, 1,  0, 1,
    ]),
  };
}

// ------------------------------------------------------------
// Line network — takes an array of vec3 points and an array of [i, j]
// connection pairs, produces a flat GL_LINES mesh. Each line has a
// per-vertex alpha (1.0 at first endpoint, 0.2 at second) so the fragment
// shader can fade the line along its length.
// ------------------------------------------------------------

export function createLineNetwork(points, connections) {
  const n = connections.length;
  const positions = new Float32Array(n * 6);
  const alphas    = new Float32Array(n * 2);
  let p = 0, a = 0;
  for (let k = 0; k < n; k++) {
    const [i, j] = connections[k];
    const s = points[i], e = points[j];
    positions[p++] = s[0]; positions[p++] = s[1]; positions[p++] = s[2];
    positions[p++] = e[0]; positions[p++] = e[1]; positions[p++] = e[2];
    alphas[a++] = 1.0;
    alphas[a++] = 0.2;
  }
  return { positions, alphas, mode: 'LINES' };
}

// ------------------------------------------------------------
// Wireframe bounding cube — 12 edges as GL_LINES, 24 vertices (no sharing).
// Positions only; no normals, no UVs, no indices.
// ------------------------------------------------------------

export function createWireframeBox(sx = 1, sy = 1, sz = 1) {
  const x = sx * 0.5, y = sy * 0.5, z = sz * 0.5;
  // 8 corner positions
  const c = [
    [-x, -y, -z], [ x, -y, -z], [ x,  y, -z], [-x,  y, -z], // back  face
    [-x, -y,  z], [ x, -y,  z], [ x,  y,  z], [-x,  y,  z], // front face
  ];
  // 12 edges as (start, end) corner indices
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // back rect
    [4, 5], [5, 6], [6, 7], [7, 4], // front rect
    [0, 4], [1, 5], [2, 6], [3, 7], // connectors
  ];
  const pos = new Float32Array(edges.length * 6);
  let k = 0;
  for (const [a, b] of edges) {
    pos[k++] = c[a][0]; pos[k++] = c[a][1]; pos[k++] = c[a][2];
    pos[k++] = c[b][0]; pos[k++] = c[b][1]; pos[k++] = c[b][2];
  }
  return {
    positions: pos,
    mode: 'LINES',
  };
}

// Upload a fullscreen clip-space quad. Positions are vec2 (not vec3),
// so this needs its own helper. Used by the present / post passes.
export function createQuadGL(gl) {
  const q = createQuad();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const bindAttr = (data, loc, size) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  bindAttr(q.positions, 0, 2);
  bindAttr(q.uvs,       1, 2);

  gl.bindVertexArray(null);
  return { vao, vertexCount: 6 };
}
