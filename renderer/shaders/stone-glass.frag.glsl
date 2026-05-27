#version 300 es
precision highp float;

// Glass shader, gallery-piece feel.
//
//   Schlick Fresnel (F0 = 0.04, glass)
//   Tight Blinn-Phong specular from the scene's directional light, fresnel-
//     modulated so highlights pop at grazing.
//   Procedural "studio environment": a dim sky gradient sampled by the
//     reflection vector PLUS three hardcoded bright peaks (acting like
//     studio lights at fixed orientations). As the camera orbits, the
//     reflection vector sweeps across these peaks and the cube flashes —
//     the same trick that makes real glass read as glass.
//   Very low body component so the cube is convincingly transparent;
//   the tint shows up mostly at silhouettes (Fresnel edge) and inside
//   reflections.

in vec3 vWorldPos;
in vec3 vNormal;

uniform vec3  uCamPos;
uniform vec3  uTint;
uniform float uAlpha;
uniform vec3  uLightDir;
uniform vec3  uLightCol;

out vec4 fragColor;

float schlick(float cosTheta) {
  float x  = 1.0 - cosTheta;
  float x2 = x * x;
  float x5 = x2 * x2 * x;
  return mix(0.04, 1.0, x5);
}

// Procedural studio environment. Sampled by the reflection vector R.
//   sky : a soft top-to-bottom gradient (the ambient room tone)
//   peaks: three pow-tightened directional peaks acting like studio lights
//          reflecting off the surface — these are what give the glass its
//          "expensive" sparkle.
vec3 fakeEnv(vec3 R) {
  float h = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(
    vec3(0.025, 0.035, 0.060),   // ground
    vec3(0.230, 0.300, 0.460),   // zenith
    h * h
  );

  const vec3 L1 = vec3( 0.6116,  0.7396,  0.2806);  // pre-normalised
  const vec3 L2 = vec3(-0.4030,  0.8460,  0.3493);
  const vec3 L3 = vec3( 0.1474, -0.3934,  0.9072);
  const vec3 L4 = vec3(-0.7071,  0.0000,  0.7071);

  float p1 = pow(max(dot(R, L1), 0.0),  90.0);
  float p2 = pow(max(dot(R, L2), 0.0), 120.0);
  float p3 = pow(max(dot(R, L3), 0.0),  60.0);
  float p4 = pow(max(dot(R, L4), 0.0),  40.0);

  vec3 peaks = p1 * vec3(1.7, 1.5, 1.1)
             + p2 * vec3(0.9, 1.2, 1.7)
             + p3 * vec3(1.5, 1.1, 0.8)
             + p4 * vec3(1.1, 1.4, 1.6);

  return sky + peaks * 2.6;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  // Two-sided: face the normal toward the camera so back faces shade like fronts.
  if (dot(N, V) < 0.0) N = -N;

  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  vec3 R = reflect(-V, N);

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  // Tight key-light specular, Fresnel-boosted at grazing.
  float NdotH = max(dot(N, H), 0.0);
  float specP = pow(NdotH, 160.0);
  vec3  spec  = uLightCol * specP * (0.5 + fres * 2.4);

  // Environment reflection — strongest at grazing.
  vec3 env = fakeEnv(R) * (0.40 + fres * 1.80);

  // Body — kept very dim so the cube reads as transparent. The tint shows
  // up via the Fresnel edge term and via tinting whatever reflects.
  vec3 base = uTint * 0.08;
  vec3 edge = uTint * fres * fres * 1.30;   // squared falloff = sharper edge

  vec3 col = base + edge + env + spec;

  // Alpha — low face-on, ramps toward grazing, plus a bump where specular
  // hits hard so highlight regions read as solid bright glass surfaces.
  float specBoost = clamp(dot(spec, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * 0.55;
  float a = uAlpha * mix(0.40, 0.95, fres) + specBoost;
  a = clamp(a, 0.0, 1.0);

  fragColor = vec4(col, a);
}
