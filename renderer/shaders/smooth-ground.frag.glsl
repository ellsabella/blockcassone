#version 300 es
precision highp float;

// Smooth-ground fragment stage. Diffuse terrain — used by grass-meadow and
// desert-dunes. Ambient + directional lambert + per-point-light lambert with
// the same cube-relative convention as feather-glass / mountain-range. Tint
// shifts gently with vElev so peaks read lighter and hollows darker without
// needing a detail texture.

in vec3  vWorldPos;
in vec3  vWorldNormal;
in vec2  vUv;
in float vHeightLocal;
in float vElev;

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

  vec3 lo = uTint * 0.55;
  vec3 hi = uTint * 1.15;
  vec3 base = mix(lo, hi, vElev);

  vec3 L = normalize(uLightDir);
  float NdotL = max(dot(N, L), 0.0);
  vec3 col = base * 0.28 + base * NdotL * 0.55 + uLightCol * NdotL * 0.35 * uLightScale;

  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3 lightPos = (uCubeHalfSize > 0.0)
                      ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                      : uPointLightPos[i];
    vec3 Lp    = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.25);
    float lam  = max(dot(N, Lp), 0.0);
    col += uPointLightCol[i] * lam * att * 0.55 * uLightScale * base;
  }

  fragColor = vec4(col, uOpacity);
}
