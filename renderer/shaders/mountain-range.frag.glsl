#version 300 es
precision highp float;

// Mountain-range fragment stage.
//
// Translucent matte rock. Three octaves of value noise sampled at the world
// position give per-fragment speckle, mid-frequency banding, and broad veins
// — turns the smooth ridge geometry into something that reads as stone. Steep
// faces darken via `vUpAlign` (local-frame N.y from the shared vert) so
// ridgelines feel like rock face. No specular, no env reflection — matte.

in vec3  vWorldPos;
in vec3  vWorldNormal;
in vec2  vUv;
in float vHeightLocal;
in float vElev;
in float vUpAlign;

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

// #include "chunks/noise3d.glsl"

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  // Three octaves of value noise sampled in world space — each mountain cube
  // hashes to its own grain pattern because vWorldPos is per-cube.
  float specks = vnoise(vWorldPos * 22.0);
  float bands  = vnoise(vWorldPos *  7.0);
  float veins  = vnoise(vWorldPos *  2.6);

  // Warm/cool palette shift along the broad veins for varied rock.
  vec3 warm = uTint * vec3(1.08, 0.96, 0.84);
  vec3 cool = uTint * vec3(0.88, 0.93, 1.04);
  vec3 stone = mix(cool, warm, 0.5 + veins * 0.5);

  // Speckle + band brightness modulation, then elevation lift so peaks read
  // a touch lighter than valleys.
  float lum = 1.0 + specks * 0.34 + bands * 0.20;
  lum *= (0.78 + 0.30 * clamp(vElev, 0.0, 1.0));

  // Slope shading via local-frame up. Vertical rock face darker than the
  // flatter caps — emphasises ridge silhouettes. vUpAlign already lives in
  // [-1, 1]; we want [0, 1] for "facing up".
  float upFrac   = clamp(vUpAlign * 0.5 + 0.5, 0.0, 1.0);
  float slopeDim = 0.55 + 0.45 * upFrac;

  vec3 base = stone * lum * slopeDim;

  // Soft ambient + directional lambert. Mountains are diffuse only.
  vec3 L = normalize(uLightDir);
  float NdotL = max(dot(N, L), 0.0);
  vec3 col = base * 0.35 + base * NdotL * 0.55 + uLightCol * NdotL * 0.18 * uLightScale;

  // Per-cube point-light lambert (no specular — non-shiny).
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3 lightPos = (uCubeHalfSize > 0.0)
                      ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                      : uPointLightPos[i];
    vec3 Lp    = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.30);
    float lam  = max(dot(N, Lp), 0.0);
    col += uPointLightCol[i] * lam * att * 0.35 * uLightScale * base;
  }

  fragColor = vec4(col, uOpacity);
}
