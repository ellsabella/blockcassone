#version 300 es
precision highp float;

// Water-surface fragment stage.
//
// Schlick fresnel modulates the mix between a translucent body colour and the
// env-cubemap reflection. Directional + point lights add sun-like and lamp-
// like specular highlights. Env sampling helpers (cubeFaceUV, crossLayoutUV)
// are lifted verbatim from feather-glass.frag.glsl — when a third shader
// needs them, extract to a JS-side prepend helper.

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec2 vUv;

uniform vec3      uCamPos;
uniform vec3      uTint;
uniform float     uOpacity;
uniform vec3      uLightDir;
uniform vec3      uLightCol;
uniform float     uLightScale;
uniform vec3      uCubeCenter;
uniform float     uCubeHalfSize;
uniform sampler2D uEnvTex;
uniform int       uEnvLayout;

#define MAX_PT_LIGHTS 8
uniform vec3 uPointLightPos[MAX_PT_LIGHTS];
uniform vec3 uPointLightCol[MAX_PT_LIGHTS];
uniform int  uPointLightCount;

out vec4 fragColor;

vec2 cubeFaceUV(vec3 d) {
  vec3 ad = abs(d);
  vec2 uv;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    uv = vec2(-sign(d.x) * d.z, -d.y) / ad.x;
  } else if (ad.y >= ad.z) {
    uv = vec2(d.x, sign(d.y) * d.z) / ad.y;
  } else {
    uv = vec2(sign(d.z) * d.x, -d.y) / ad.z;
  }
  return uv * 0.5 + 0.5;
}

vec2 crossLayoutUV(vec3 d) {
  vec3 ad = abs(d);
  vec2 cell, faceUV;
  if (ad.z >= ad.x && ad.z >= ad.y) {
    if (d.z > 0.0) { faceUV = vec2( d.x, -d.y) / ad.z; cell = vec2(1.0, 1.0); }
    else           { faceUV = vec2(-d.x, -d.y) / ad.z; cell = vec2(3.0, 1.0); }
  } else if (ad.x >= ad.y) {
    if (d.x > 0.0) { faceUV = vec2(-d.z, -d.y) / ad.x; cell = vec2(2.0, 1.0); }
    else           { faceUV = vec2( d.z, -d.y) / ad.x; cell = vec2(0.0, 1.0); }
  } else {
    if (d.y > 0.0) { faceUV = vec2( d.x,  d.z) / ad.y; cell = vec2(1.0, 0.0); }
    else           { faceUV = vec2( d.x, -d.z) / ad.y; cell = vec2(1.0, 2.0); }
  }
  return (cell + faceUV * 0.5 + 0.5) / vec2(4.0, 3.0);
}

vec3 sampleEnv(vec3 dir) {
  vec3 d  = normalize(dir);
  vec2 uv = (uEnvLayout == 1) ? crossLayoutUV(d) : cubeFaceUV(d);
  return texture(uEnvTex, uv).rgb;
}

float schlick(float cosTheta) {
  float x = 1.0 - cosTheta;
  float x2 = x * x;
  return mix(0.02, 1.0, x2 * x2 * x);  // F0 = 0.02 for water IOR ~1.33
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  vec3 R    = reflect(-V, N);
  vec3 envR = sampleEnv(R);

  // Translucent body — slightly more saturated where the surface is steep
  // (low NdotV) so wave crests catch a tint shift.
  vec3 body = uTint * (0.32 + 0.30 * (1.0 - fres));

  // Sun-like specular from the global directional light.
  vec3 H        = normalize(normalize(uLightDir) + V);
  float specP   = pow(max(dot(N, H), 0.0), 110.0);
  vec3 dirSpec  = uLightCol * specP * 1.6 * uLightScale;

  // Per-point-light specular + soft body contribution. Same cube-relative
  // light convention as feather-glass / normie-voxel.
  vec3 ptSpec = vec3(0.0);
  vec3 ptBody = vec3(0.0);
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3 lightPos = (uCubeHalfSize > 0.0)
                      ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                      : uPointLightPos[i];
    vec3 Lp    = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.22);
    vec3 Hp    = normalize(Lp + V);
    float sp   = pow(max(dot(N, Hp), 0.0), 64.0);
    ptSpec += uPointLightCol[i] * sp * att * (1.4 + fres * 2.4);
    ptBody += uPointLightCol[i] * max(dot(N, Lp), 0.0) * att * 0.32;
  }
  ptSpec *= uLightScale;
  ptBody *= uLightScale;

  vec3 col = mix(body + ptBody, envR, fres * 0.85)
           + dirSpec
           + ptSpec;

  // Alpha climbs with fresnel so the surface reads as nearly-clear when
  // viewed flat-on and almost-mirror at glancing angles — classic water.
  float alpha = uOpacity * mix(0.40, 0.98, fres);
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
