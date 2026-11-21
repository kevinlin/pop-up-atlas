### 1. Fold motion and spring feel · 4/10

The pink flower near the front of the opening shot visibly tips up. Once the troll walks, the scenery mostly looks upright as it scrolls into view. I couldn’t follow a rear tile all the way back to flat. The spring itself has character. The traced hinge crosses upright in 0.16 s, overshoots by 18.5°, then swings back by 3.8°. At 8 fps, the first 90° gets barely one frame interval.

1. Trigger the next fold 2.5–3 units ahead of the troll, about 1.5 tiles. Start closing around 4 units behind, while the player can still see the return.
2. Stretch the rise to 0.30–0.35 s before it crosses upright. Keep the first overshoot and let it settle by about 0.8 s. Keep the closing stroke damped.
3. Open the tallest cutout first, with its crease visible against bare paper. Let the smaller pieces follow 100–150 ms apart. The current 50 ms stagger reads as one burst.

### 2. Walk feel · 5/10

The offline sheet has a jaunty stride, especially when the forward foot clears the red bag. In gameplay, the scrolling page tells me the troll is travelling. The feet do much less of that work, and the flower in the second row of the walk sheet hides both contacts.

1. Plant each support foot on the page for roughly 0.25 s. At 1.2 units/s, that means the body travels 0.30 units over the planted foot. Let the trailing foot peel away toe-last.
2. Try a body bob of 0.06 units, up from 0.03. Put the low point just after contact and the high point as the free foot passes. That gives the bounce a felt puppet’s weight.
3. Keep a foot-width of clear page around the landing spot. Bend foreground stems aside as the troll passes so the player can see which foot carries the weight.

### 3. Dance · 5/10

The offline side kick and airborne turn are appealing. By the bridge, the brief change of facing in the middle row is the clearest dance beat. Most of the five seconds share the same narrow silhouette, so the routine feels long for what the player can see.

1. Turn three-quarters toward the camera for the first kick. Send the foot sideways past the bag and lift the opposite hand clear of the head.
2. Give the hop a 0.2 s crouch, then hold the one-foot landing for 0.3 s. That gives the player two distinct poses to catch around the fast turn.
3. Trim the five-second clip to about three seconds. A kick, a turning hop and a held bow make a complete phrase after the four-second idle wait.

### 4. Hair secondary motion · 7/10

The plume is the strongest moving silhouette. Its sideways sweep sells the offline spin, and the purple tip stays visible even when flowers hide the feet. During gameplay walking, I can see the tuft change angle. It’s harder to see the tip catch up with the root.

1. Keep the bottom third close to the scalp and concentrate the bend in the upper half. Aim for 2–3 pixels of tip travel relative to the head in a gameplay frame.
2. Let the tip crest 80–120 ms after the body reverses direction. Check the phase on a foot plant, where the head slows and the tip should keep going.
3. Use the baked curve for the dance whip and reserve the runtime spring for changes in travel speed or direction. On a stop, aim for one small recoil that dies within 0.3 s.

### Overall

**Would a player be wowed? No.** The plume catches the eye, but the signature moment, a piece of flat paper becoming scenery just ahead of the troll, is too easy to miss.

1. Bring the next fold into clear view and give the player time to see it pivot.
2. Make each foot plant visible and time the body’s drop to the landing.
3. Restage the dance around a camera-facing kick and a held finish.

**Lesson learned:** Judge the fold by whether you can follow one crease, and the walk by whether you can follow one planted foot, at gameplay size.
