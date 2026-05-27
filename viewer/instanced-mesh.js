// Instanced billboard mesh helper.
// One shared clip-space corner quad (6 verts) + a per-instance buffer with
// (pos.xyz, size, seed, depth) = 6 floats per instance, uploaded via
// `vertexAttribDivisor = 1` so each instance gets its own data.

const CORNER_DATA = new Float32Array([
  -0.5, -0.5,   0.5, -0.5,   0.5,  0.5,
  -0.5, -0.5,   0.5,  0.5,  -0.5,  0.5,
]);

// `instanceData` must be a Float32Array of length instanceCount * 6, each
// instance laid out as [pos.x, pos.y, pos.z, size, seed, depth].
export function createInstancedBillboardMesh(gl, instanceData) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Location 0: shared corner (not instanced).
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, CORNER_DATA, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Location 1-4: per-instance, interleaved (stride 24 bytes).
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

  // pos (vec3)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(1, 1);
  // size (float)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 12);
  gl.vertexAttribDivisor(2, 1);
  // seed (float)
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 16);
  gl.vertexAttribDivisor(3, 1);
  // depth (float)
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 24, 20);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  return {
    vao,
    instanceCount: (instanceData.length / 6) | 0,
    mode: 'INSTANCED',
  };
}
