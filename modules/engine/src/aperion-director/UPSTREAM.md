# Aperion Director

The Director plugin, service, interpreter, composition and trigger registries, built-in step strategies, expression parser and ticker utilities come from Aperion Libs at commit `f739bea9a14cf208461800ec7604833b7ba4d337`.

OliveStudio uses the Pixi application ticker and supplies an event bus, audio and animation ports. Its Timeline runs as an independent Director dispatch. The editor also registers camera, scene navigation, physics, Audio Source, particle, global and visibility strategies. The same runtime plays saved compositions in Live and in game exports.

An upstream `audio` step can be hosted by any implementation of the audio port. OliveStudio's Howler host supports asset playback, layer and alias stops, fades, crossfade and mix snapshots. Audio sprites, named mix profiles, adaptive music stems and beat/bar scheduling require a host that provides the corresponding audio services.
