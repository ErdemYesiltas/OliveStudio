# Skeleton Workshop

Open **Hub → Examples → Skeleton Workshop**. Select **Workshop Bot** in the Hierarchy to see its joints in Edit. Expand the rig to select a bone, use its **Rig** Inspector section to add a child or change the guide length, and drag an image or sprite sheet from Assets to attach it at the bone's origin. Use the bone's Transform fields to pose the sprite.

In **Timeline**, select **Greeting Wave** to inspect or scrub the authored rotation tracks. Use **Director → Workshop Greeting → Preview Composition** to play the same clip. **Play Game** runs it automatically at scene entry while the main Timeline animates the status light independently.

The project uses rigid sprite attachments. Each bone inherits its parent's transform, and each sprite can have its own local offset and anchor.

Open **Static Relay** in the **Scenes** panel for an editable Spine 4.2 rig. Select **Relay Creature** in the Hierarchy to choose its starting clip. Select **relay-creature.json** in **Assets** and open **Spine Studio** to edit the bones, atlas attachments, animation tracks, and the `charged` event.

In **Timeline → Director Compositions**, preview **Relay Animation Mix** to see idle blend into charge, then charge blend into hop. Select **Relay Creature → Inspector → Animation Settings → Animation Transitions** to change the blend durations. A Director animation step can override its incoming blend duration.

Preview **Relay Parallel Tracks** in the same panel to play hop on track 0 and fin flutter on track 1 at 65% weight.

Play **Static Relay** in Live mode to hear the `charged` event on the charge animation. **Animation Settings → Event Audio** maps the Spine event's `relay-chime.wav` path to the built-in chime. Edit the path in **Spine Studio → Tracks → Events**, and use the keyframe's **Volume** and **Balance** to change how it plays.

**Relay Creature → Animation Settings → Skin Layers** combines the violet shell and amber antenna. Add the copper shell and change its order relative to the violet shell to compare which color is used on the overlapping attachments.

Select **relay-creature.json** in Assets and use **Export Spine Project** with Spine 4.2 installed to open the rig in Spine Editor. The export includes the textures and chime. Select `relay-base` to see the full neutral rig, then add the shell and antenna skins in the desired order.

Play **Static Relay** to see the base track play charge, wait briefly, hop, and then loop idle. The fin flutter runs concurrently at 70% weight. Edit the sequence and its overlay in **Animation Settings → Animation Channels and Queues**.

Open **Relay Control Lab** in Scenes and choose **Play from Active Scene**. The relay charges in its copper skin while a separate track animates the fins. The `charged` keyframe plays the chime, restores the Inspector skin, and triggers a hop through the **Sequence Card** object's Logic Graph. When the hop completes, the rig returns to idle. Click **Replay sequence** to run it again.

Select **Lab Relay** and open **Scripts** to inspect the gameplay hooks. The gold marker uses `game.spine.bone` to follow the antenna. The Live Trace shows the current phase while the scene runs.
