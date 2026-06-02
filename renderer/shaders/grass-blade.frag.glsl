#version 300 es
precision highp float;

// Grass-blade fragment stage. Thin translucent blade. Root reads as a richer
// green; tip lightens slightly toward chartreuse/yellow. Alpha climbs toward
// the root so blades anchor visually. Receives directional + point-light
// lambert with the same cube-relative convention as grass-ground so a single
// scene reads consistently.

in vec3  vWorldPos;
in vec3  vWorldNormal;
in float vAlong;

uniform vec3      uCamPos;
uniform vec3      uTint;
uniform float     uOpacity;
uniform vec3      uLightDir;
uniform vec3      uLightCol;
uniform float     uLightScale;
uniform vec3      uCubeCenter;
uniform float     uCubeHalfSize;

#define MAX_PT_LIGHTS 8
uniform vec3 uPointLightPos[MAX_PT_LIGHTS];
uniform vec3 uPointLightCol[MAX_PT_LIGHTS];
uniform int  uPointLightCount;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  vec3 root = uTint;
  vec3 tip  = uTint * vec3(1.20, 1.10, 0.65) + vec3(0.05, 0.05, 0.00);
  vec3 base = mix(root, tip, vAlong);

  // Directional lambert + soft ambient.
  vec3 L = normalize(uLightDir);
  float NdotL = abs(dot(N, L));   // two-sided — blades are thin
  vec3 col = base * (0.30 + 0.65 * NdotL) + uLightCol * NdotL * 0.18 * uLightScale;

  // Point-light contribution (two-sided lambert).
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3 lightPos = (uCubeHalfSize > 0.0)
                      ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                      : uPointLightPos[i];
    vec3 Lp    = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.35);
    float lam  = abs(dot(N, Lp));
    col += uPointLightCol[i] * lam * att * 0.6 * uLightScale * base;
  }

  // Alpha: solid at root, slightly translucent at tip.
  float alpha = uOpacity * (0.90 - 0.30 * vAlong);
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
