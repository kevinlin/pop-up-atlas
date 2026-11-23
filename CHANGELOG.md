# Changelog

All notable changes to Pop-up Atlas: Troll Edition. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/). Measurable targets are in `docs/contracts.md`, and the decision record is `docs/log.md`.

## [0.2.0] - 2026-11-24

Round 6 brings the art direction of a forest film clip to the game: its light, colour, composition and character animation. The two characters are new, original designs. The changes follow the art and animation review in `docs/review/2026-11-23-art-animation-review.md`.

### Added
- A new pair of original felt characters in the troll-doll style. The lead is an orange felt creature with a tall sky-blue yarn plume and a lime pinafore. The companion is mint felt, with an upswept tomato-red tuft, a violet sweater and a small umbrella. Tripo made both meshes, and Blender rigs them (`blender/duo/`). Each character has its own walk, idle and dance clips. The lead also has a skip, and the companion has a look-around.
- The faces act. Stitched mouth shapes change with each voice line and sung note, and the eyes blink.
- The bodies squash and stretch on footsteps, on the dance landing and on hops. The hair stands up on "ooh" and droops on "hmph". The companion's hair bounces on each step.
- The companion's umbrella opens with a pop when it walks into a river, and again at the end of the dance.
- A beat camera comes closer and lower for the duo dance. When a big pop-up prop folds up next to the leader, it comes closer for 1.5 s. Then it returns to the walk camera.
- Folds now have two stages. Tiles within 4.5 units of the leader lift a little, without a sound, and they fold up completely within 2 units. Each fold-up dips a little before the spring releases it. Cards bend as they move, and doors and petals settle a moment after the main card.
- When the pair dances, the props next to them fold flat to clear a small stage.
- A warm fuzz rim light shines on the characters and the hero props (flower, mushroom house, cupcake tree) only.
- Each grove gives its props one colour family: pink-violet, orange-butter, sky-mint or lime-mint. The page, the characters, the river, the bridges and near-white felt keep their own colours.
- Both characters have new voices, designed with ElevenLabs from text descriptions. Every line and sung note was generated again with these voices.
- New debug hooks: `__atlas.events`, `__atlas.camera`, `__atlas.face` and `__atlas.umbrella`. The capture, side-by-side, look-stats, perf and e2e tools have round-6 checks.

### Changed
- The walk camera is closer and lower: 7.5 units at 35° (was 10 units at 45°). It increases its distance, to 10 units at most, only when it must keep both characters in frame.
- The tilt-shift sharp band covers 40 % of the frame (was 30 %). Its maximum blur is smaller: 1.0 % of the image width (was 1.5 %).
- Ground appliqué is larger and layered two or three deep, with French knots, sequins and buttons instead of the pink rectangles. Mushroom caps and cupcake crowns are domes, not flat cards.
- The duo turns to face the camera when it starts to dance.
- The lead hums melody notes above MIDI 78 an octave lower, because the new voice does not reach them.
- Footsteps follow the length of each character's walk clip.
- Perf is compared with a new baseline, PB6 (commit fa6d96b).

### Removed
- The new pair replaces the round-5 characters: the mint troll with the sunset plume and the butter troll with the rope-twist hair.

## [0.1.0] - 2026-11-22

Rounds 1 to 5 built the walking toy, the pop-up world, the sound and the first duo.

### Added
- The game is a Three.js walking toy on an endless pop-up scrapbook. Wave function collapse picks the felt-and-cardstock tiles. They fold up on springs near the troll and fold flat behind it.
- Blender builds the tiles, the scrapbook page and a felt troll, and exports them as glTF.
- The renderer adds felt, cardstock and glitter shading, a warm key light with a pink-violet fill, soft shadows and a tilt-shift pass.
- Every fold plays a pop, and every fold-up plays a pentatonic chime, so walking plays a tune. Each tile has its own chime timbre. Footsteps change with the surface, and the troll hums the last notes when it stands still.
- The troll dances when it is idle. Its voice lines and sung notes were designed with ElevenLabs.
- A second original troll follows the leader. Space, or a click on the follower, swaps the lead, and the voices follow whoever leads.
- An on-screen guide shows the controls.
- The browser tools add an e2e acceptance gate, a perf test, a 30-second capture with offline audio, blind side-by-sides and look statistics.
