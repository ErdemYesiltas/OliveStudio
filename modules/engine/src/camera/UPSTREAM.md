# Aperion Camera

Ported from Aperion Labs at `4286ae352183eb97fa7930b42b4594d370e90457`.

The `@olivestudio/engine/camera` entry point exposes the Pixi application plugin, camera registry, container camera and Director strategy. Cameras attached to an application use its ticker for tweens and follow smoothing. The editor uses the registry to apply the active Camera 2D object's pose to the world container.

OliveStudio adds `Camera.applyDepth(options, layers?)` and `Camera.applyTheater(options, layers?)` for depth and radius-based curvature. Layer transforms and filters are temporary. `Camera.clearDepth()` restores the original hierarchy and draw order.
