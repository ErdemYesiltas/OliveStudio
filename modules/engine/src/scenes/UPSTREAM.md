# Aperion Scenes

Ported from Aperion Labs at `4286ae352183eb97fa7930b42b4594d370e90457`.

The `@olivestudio/engine/scenes` entry point exposes the Pixi application plugin, layered scene manager, screen lifecycle and transitions. Scene transitions advance on the application's ticker. The manager accepts adapters for bundle loading and alternate display roots. The Aperion Spine occlusion helper is outside this port.

Editor projects use the scene-link adapter. A project Push remembers the current scene and its additive scene IDs. Returning reconstructs that scene from the project document. Programmatic `SceneManager.push` on a stack layer retains its screen instance and resumes it on pop.
