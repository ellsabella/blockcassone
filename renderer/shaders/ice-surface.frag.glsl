#version 300 es
precision highp float;

// Ice-surface fragment stage.
//
// Shares the ridge-terrain vertex stage with mountain-range — same noise,
// same displacement, same normal — but the surface is now translucent ice:
// strong env-cubemap reflection at all angles (ice is more reflective than
// water flat-on), tight specular highlights for shard glint, and a cool
// pale-cyan body that picks up the rim glow at silhouettes so the jagged
// edges read sharply.
//
// Env-sampling helpers (cubeFaceUV / crossLayoutUV / sampleEnv) lifted
// verbatim from water-surface.frag — when a third reflective material
// arrives, extract them into a chunk file alongside chunks/noise3d.glsl.

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
  // F0 = 0.14 — ice reads as visibly reflective even when flat-on, well
  // above water's 0.02 and the previous ice value of 0.06.
  return mix(0.14, 1.0, x2 * x2 * x);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  vec3 R    = reflect(-V, N);
  vec3 envR = sampleEnv(R);

  // Cool blue body — deep crevasses sit at a saturated blue, ridge tips
  // brighten to icy-blue rather than pure white so the surface always reads
  // as "ice" rather than "diamond".
  vec3 deepBody  = uTint * vec3(0.40, 0.52, 0.62);
  vec3 ridgeBody = mix(uTint, vec3(0.75, 0.88, 1.00), 0.55);
  vec3 body = mix(deepBody, ridgeBody, clamp(vElev * 1.4, 0.0, 1.0));

  // Tight sun-like specular catches a sharp single highlight per shard.
  vec3  H       = normalize(normalize(uLightDir) + V);
  float specP   = pow(max(dot(N, H), 0.0), 260.0);
  vec3  dirSpec = uLightCol * specP * 3.2 * uLightScale;

  // Per-cube point-light sharp specular + soft body contribution. Higher
  // exponent and stronger gain than water for crystalline glint.
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
    float sp   = pow(max(dot(N, Hp), 0.0), 140.0);
    ptSpec += uPointLightCol[i] * sp * att * (2.4 + fres * 3.2);
    ptBody += uPointLightCol[i] * max(dot(N, Lp), 0.0) * att * 0.24;
  }
  ptSpec *= uLightScale;
  ptBody *= uLightScale;

  // Aggressively mix env reflection at all angles — flat zones still mirror
  // the sky strongly, glancing angles go near-mirror.
  float refMix = mix(0.58, 0.97, fres);
  // Subtle blue tint on the env sample so reflections read cold even when
  // the env probe is warm.
  vec3 envTinted = envR * mix(vec3(0.78, 0.90, 1.05), vec3(1.0), 0.6);
  vec3 col = mix(body + ptBody, envTinted, refMix) + dirSpec + ptSpec;

  // Rim glow on the silhouette emphasises sharp ridge edges.
  float rim = pow(1.0 - NdotV, 3.0);
  col += vec3(0.55, 0.78, 1.00) * rim * 0.90;

  // Alpha climbs with fresnel — ice is almost-clear flat-on, near-opaque
  // at glancing angles where total internal reflection takes over.
  float alpha = uOpacity * mix(0.55, 0.98, fres);
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
