#version 300 es
precision highp float;

// Grass-blade vertex stage.
//
// Each blade is a thin quad strip CPU-built along a quadratic Bezier curve.
// The mesh stores REST positions; this shader adds a time-varying lateral
// sway by sampling the shared 3D noise field at the blade root + uTime. The
// sway amplitude scales with u² so tips swing more than roots — natural
// grass behaviour. All offsets are in LOCAL cube space; uM rotates the result
// onto the cube's unique-axis plane.
//
// Vertex attribute layout (packed into createMeshGL's standard slots):
//   loc 0  aPosition  — rest position on the bezier
//   loc 1  aRoot      — XYZ of the blade root (samples wind from same place
//                       for every vertex of one blade)
//   loc 4  aAlong     — u along the blade [0, 1]
//   loc 5  aSeed      — per-blade phase seed [0, 1)

layout(location = 0) in vec3  aPosition;
layout(location = 1) in vec3  aRoot;
layout(location = 4) in float aAlong;
layout(location = 5) in float aSeed;

uniform mat4  uView;
uniform mat4  uProj;
uniform mat4  uM;
uniform float uTime;
uniform float uSpeed;    // wind temporal frequency
uniform float uScale;    // wind spatial frequency
uniform float uAlpha;    // sway amplitude (peak lateral offset of the tip)

out vec3  vWorldPos;
out vec3  vWorldNormal;
out float vAlong;

// #include "chunks/noise3d.glsl"

void main() {
  // Sample wind noise at the blade root. Time advances the field so the same
  // root sees a varying wind direction over time. aSeed decorrelates blades
  // so a clump doesn't all bend in lockstep.
  vec3 windQ = vec3(aRoot.x * uScale + uTime * uSpeed,
                    aSeed * 12.34,
                    aRoot.z * uScale + uTime * uSpeed * 0.7);
  float wx = vnoise(windQ);
  float wz = vnoise(windQ + vec3(31.0, 11.0, 7.0));

  // Sway magnitude grows quadratically along the blade so tips swing most.
  float mag = aAlong * aAlong * uAlpha;
  vec3 sway = vec3(wx, 0.0, wz) * mag;

  vec3 localPos = aPosition + sway;
  vec4 world4   = uM * vec4(localPos, 1.0);
  vWorldPos     = world4.xyz;

  // Approximate normal: cross of blade tangent (~up) and the sway direction,
  // then transformed to world. Cheap and good enough for thin blades.
  vec3 tangent = normalize(vec3(0.0, 1.0, 0.0) + sway * 4.0);
  vec3 across  = length(sway) > 1e-5 ? normalize(vec3(-wz, 0.0, wx)) : vec3(1.0, 0.0, 0.0);
  vec3 localN  = normalize(cross(tangent, across));
  vWorldNormal = normalize(mat3(uM) * localN);

  vAlong = aAlong;
  gl_Position = uProj * uView * world4;
}
