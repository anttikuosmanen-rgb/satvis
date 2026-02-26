# CesiumJS Multi-Frustum Rendering & Depth Occlusion

Technical notes on how CesiumJS handles depth testing across its multi-frustum
rendering pipeline, and how SatVis leverages this for celestial body rendering.

## Multi-Frustum Rendering Order

CesiumJS splits the scene into multiple frustum segments based on object
distances. Frustums render **far-to-near** (back-to-front painter's algorithm):

1. Farthest frustum renders first — writes color and depth
2. Each nearer frustum clears the depth buffer, then renders
3. The color buffer is **shared** across frustums (not cleared between them)
4. Nearer frustums therefore paint over farther frustum output

This means objects in a near frustum naturally occlude objects in farther
frustums without any explicit depth comparison between them.

## Implications for SatVis

### Planet/Moon Billboards — Natural Occlusion

Planet billboards at 50M+ km are in a far frustum. Earth's globe is in a near
frustum. Because near frustums render last, Earth paints over planet billboards
that are behind it. No `disableDepthTestDistance` or manual occlusion checks
are needed — the frustum rendering order handles it.

Previously SatVis used `disableDepthTestDistance: Number.POSITIVE_INFINITY` on
planet billboards with a custom angular occlusion check (throttled to 1/sec).
This was removed in favour of Cesium's native frustum-based occlusion.

### Orbit Lines (OrbitLinePrimitive) — Depth Testing Within Frustums

Orbit lines are 3D `GL_LINE_STRIP` geometry rendered via custom `DrawCommand`.
With `depthTest: { enabled: true }`, depth comparisons work correctly **within**
each frustum. A line segment in the same frustum as Earth's globe will be
correctly hidden if behind Earth.

At very close camera distances (< ~100K km), orbit lines and Earth may be in
the same frustum — depth testing handles occlusion. At greater distances, they
end up in different frustums and the rendering order handles it instead.

`cull: false` and `occlude: false` are set on the DrawCommand to prevent
CesiumJS from culling the orbit based on bounding volume checks, which would
hide orbits at extreme distances.

### The Sun — ENVIRONMENT Pass

The Sun bypasses multi-frustum rendering entirely. It renders in the
`Pass.ENVIRONMENT` pass using viewport orthographic projection:

```glsl
// SunVS.glsl — positions Sun quad in window space with correct depth
vec4 positionWC = czm_eyeToWindowCoordinates(czm_view * position);
gl_Position = czm_viewportOrthographic * vec4(positionWC.xy + halfSize, -positionWC.z, 1.0);
```

The `-positionWC.z` maps the Sun's depth directly into the depth buffer.
When Earth renders later (in a nearer frustum), it correctly overwrites
Sun pixels where Earth is in front.

## Known Limitations

### Cross-Frustum 3D Model Occlusion

CesiumJS's built-in Moon 3D model does not occlude objects behind it across
frustum boundaries. When the camera is at ~370K km altitude with the Moon
between camera and Earth, Earth and satellites show through the Moon model.

This is because the Moon model writes depth only within its own frustum.
Objects in a farther frustum (Earth) rendered before the Moon's frustum
already wrote their color, and the Moon's depth buffer is cleared before
it renders — no cross-frustum depth comparison occurs.

This is a minor edge case requiring precise camera placement. It would become
more significant if SatVis supported placing the camera at other planetary
bodies (e.g., orbiting Mars with Earth behind it).

### Frustum Boundary Distance

The transition between "same frustum" and "different frustum" for orbit
lines vs Earth occurs at roughly ~100K km camera altitude. Below this,
orbit lines and Earth share a frustum and depth testing handles occlusion.
Above it, frustum rendering order takes over.

## Key CesiumJS Source References

- `Scene.js` — Frustum splitting, rendering order, ENVIRONMENT pass execution
- `View.js` — Frustum far plane clamping (`camera.frustum.far`)
- `Sun.js` / `SunVS.glsl` — Viewport orthographic Sun rendering
- `UniformState.js` — `czm_viewportOrthographic` matrix computation
- `DrawCommand` — `cull`, `occlude`, `pass` properties

## SatVis Files

- `src/modules/OrbitLinePrimitive.js` — Custom GL_LINE_STRIP primitive
- `src/modules/CelestialOrbitRenderer.js` — Orbit management, modelMatrix updates, frustum far extension
- `src/modules/PlanetManager.js` — Planet billboard/point rendering
- `src/modules/EarthManager.js` — Earth/Moon billboard/point rendering
