#version 300 es
precision highp float;

in vec3  vWorldPos;
in vec3  vNormal;
in float vAlpha;
in float vVariant;

uniform vec3      uCamPos;
uniform vec3      uTint;
uniform float     uAlpha;
uniform float     uLightScale;
uniform vec3      uLightDir;
uniform vec3      uLightCol;
uniform vec3      uCubeCenter;
uniform float     uCubeHalfSize;
uniform float     uTime;
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
  vec3 d = normalize(dir);
  vec2 uv = (uEnvLayout == 1) ? crossLayoutUV(d) : cubeFaceUV(d);
  vec3 c = texture(uEnvTex, uv).rgb;
  return pow(c, vec3(0.95)) * 1.15;
}

float schlick(float cosTheta) {
  float x = 1.0 - cosTheta;
  float x2 = x * x;
  return mix(0.04, 1.0, x2 * x2 * x);
}

vec3 unitColor(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  return (m > 0.0) ? clamp(c / m, 0.0, 1.0) : vec3(0.0);
}

vec3 complement(vec3 c) {
  return clamp(vec3(1.0) - unitColor(c), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  vec3 R = reflect(-V, N);
  vec3 T = refract(-V, N, 1.0 / 1.18);

  float NdotV = max(dot(N, V), 0.0);
  float fres = schlick(NdotV);
  float wave = 0.5 + 0.5 * sin(uTime * 1.7 + vVariant * 19.0);

  vec3 tint = complement(uTint);
  vec3 envR = sampleEnv(R);
  vec3 envT = sampleEnv(T);

  vec3 H = normalize(normalize(uLightDir) + V);
  float dirSpecP = pow(max(dot(N, H), 0.0), 72.0);
  vec3 dirSpec = uLightCol * dirSpecP * (0.25 + fres * 0.75) * uLightScale;

  vec3 ptSpec = vec3(0.0);
  vec3 ptBody = vec3(0.0);
  vec3 ptRim = vec3(0.0);
  vec3 localOpposite = vec3(0.0);
  float localWeight = 0.0;
  vec3 dominantOpposite = tint;
  float dominantWeight = 0.0;
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3 lightPos = (uCubeHalfSize > 0.0)
                      ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                      : uPointLightPos[i];
    vec3 Lp = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att = 1.0 / (1.0 + dist * dist * 0.18);
    vec3 Hp = normalize(Lp + V);
    float sp = pow(max(dot(N, Hp), 0.0), 26.0);
    float lambert = max(dot(N, Lp), 0.0);
    float proximity = smoothstep(2.4, 0.02, dist);
    float sideWash = 0.35 + 0.65 * abs(dot(N, Lp));
    vec3 compLight = complement(uPointLightCol[i]);
    float receiver = (0.18 + proximity * 1.15 + sideWash * 0.28) * att;
    localOpposite += compLight * receiver;
    localWeight += receiver;
    if (receiver > dominantWeight) {
      dominantWeight = receiver;
      dominantOpposite = compLight;
    }
    ptSpec += compLight * sp * att * (2.8 + fres * 2.6);
    ptBody += compLight * (lambert * 0.22 + proximity * sideWash * 0.90) * att;
    ptRim += compLight * proximity * fres * 0.95;
  }
  ptSpec *= uLightScale;
  ptBody *= uLightScale;
  ptRim *= uLightScale;
  if (localWeight > 0.0) {
    localOpposite /= localWeight;
  } else {
    localOpposite = tint;
  }
  localOpposite = mix(localOpposite, dominantOpposite, 0.82);
  float specEnergy = dot(ptSpec, vec3(0.299, 0.587, 0.114));
  float bodyEnergy = dot(ptBody, vec3(0.299, 0.587, 0.114));
  float rimEnergy = dot(ptRim, vec3(0.299, 0.587, 0.114));
  ptSpec = localOpposite * specEnergy * 0.95;
  ptBody = localOpposite * bodyEnergy * 1.35;
  ptRim = localOpposite * rimEnergy * 1.10;

  vec3 glass = mix(envT * 0.02, envR * 0.06, fres);
  vec3 body = localOpposite * (0.52 + 0.18 * wave + fres * 0.24);
  vec3 edge = localOpposite * fres * fres * 1.25;
  vec3 col = glass + body + edge + dirSpec * 0.20 + ptSpec + ptBody + ptRim;

  float lightBoost = clamp(dot(ptBody + ptRim + ptSpec, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  float specBoost = clamp(dot(dirSpec + ptSpec, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * 0.35;
  float a = uAlpha * vAlpha * mix(0.48, 0.98, fres) + specBoost + lightBoost * 0.22;
  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}
