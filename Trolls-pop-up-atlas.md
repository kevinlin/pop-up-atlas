# Trolls pop-up atlas prompt

## Build "Pop-up Atlas: Troll Edition", a browser 3D walking toy, in Three.js.

**Reference**
none yet. First generate 4-6 concept frames with imagegen (handmade scrapbook diorama, tiny fuzzy troll traveller with tall upswept hair, candy-bright forest folding up out of an open felt-and-paper scrapbook, glitter catching soft sunlight). Collect photos of real pop-up books, felt crafts, scrapbooks and glitter papercraft. These become the target. Match their look and tactile handmade feel exactly.

**Details**
small troll traveller walks across an endless open pop-up scrapbook. Terrain ahead folds up out of the flat page: hinged felt-and-cardstock tiles (giant flowers, mushroom houses, cupcake trees, yarn bridges, glitter rivers) rise on springs, overshoot and settle with a bouncy wobble. Wave function collapse picks tiles so neighbours always connect. Tiles behind fold back flat. Look: felt, fuzzy fabric and cardstock, saturated rainbow palette, glitter sparkle on edges, stitched seams, layered cut-paper silhouettes, soft shadows between layers, high-angle tilt-shift camera with strong DOF blur, warm key light + pink-violet fill. Traveller has a bouncy walk cycle, hair sways with secondary motion, and does a short dance when idle. Every fold gets a soft "pop" sound plus a chime, pitched to notes of one musical key so walking plays a little tune. Controls: WASD or click to walk, smooth camera follow. No physical-looking UI.

**Tools**
Blender (tile models with hinge pivots, rigged troll traveller with hair physics or baked hair sway, walk/idle/dance animations, fold animations, baked felt and paper materials → glTF). Codex CLI imagegen (concept frames, felt and glitter textures, printed details). Web Audio procedural pop and chime sounds (or samples if better).

**How to work**
autonomous, no questions; log assumptions. Study reference → checklist of components with measurable targets. One sub-agent per component, each owns its files, project stays running. Loop on every component: separate harsh blind critic, A/B side by side vs reference in random order, says which is better + fixes. Continue until critics can't reliably pick the original and are wowed. Also judge fold motion/spring feel, walking and dance feel, hair motion, sound and musicality, performance (steady 60 fps mid-range laptop, glitter included). Revert anything that makes it worse. Append-only log. User's explicit instructions override critics.

**Deliver**
playable Vite build + run instructions, 30-second gameplay capture, final side-by-sides and scores.
