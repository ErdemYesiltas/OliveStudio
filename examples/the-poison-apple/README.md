# The Poison Apple

Open **Hub → Examples → The Poison Apple**, then select **Play Game**. The JSON embeds the complete scene. [The art directory](art) also contains the individual sheets, depth map and sound files.

| Director cue | Starts at | Staging |
| --- | ---: | --- |
| The table | 0.00 s | Wide bar shot and opening fade. Hearth, distant talk, lute and strings enter on independent channels. |
| Why the long face? | 3.64 s | Doris glances up and speaks. The tankard and linen sounds stay on their own track. |
| The pause | 5.82 s | Return to the group. The stallion blinks and lifts its muzzle, the cat leans in, and human Shrek raises his gaze. |
| The regret | 9.53 s | Reverse close-up. The second subtitle is timed to the pause in the new recording. |

The speaking characters each have eight authored poses, driven by clips assembled from 18 fps phoneme timing. The dialogue was synthesized locally with Kokoro voices and remixed with a short tavern reflection. The last shot has room for both spoken phrases to finish before the fade. [Kokoro voice model](https://huggingface.co/hexgrad/Kokoro-82M)

ImageGen was used for the wide tavern and barrel wall and for the cutouts and spritesheets. The latest prompts extended the existing barmaid and human patron with vowel and blink poses, the pale stallion with eye and ear reactions, and the candle with eight flame poses. Art follows a stylized 3D fantasy tavern treatment.

To try **3D Photo**, move the pointer over the wide shot. The **Tavern wide plate** Sprite has a grayscale Depth Map under **Inspector → Effects → 3D Photo**. Choose an image with matching framing. Strength X/Y controls the displacement and Invert Depth reverses it. The example map separates the bar, timber and back wall.

[Reference clip](https://www.youtube.com/watch?v=R5HaAID_4Ls)
