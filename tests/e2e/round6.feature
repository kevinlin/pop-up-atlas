# Frozen acceptance scenarios for "Round 6" (docs/contracts.md "Round 6" and every older bullet marked "round 6"): the
# camera rig, the two-stage fold, faces, squash and stretch, the umbrella, B's look, the footstep cadence and the hum's octave.
# scripts/e2e.mjs runs every scenario not tagged @manual or @external through scripts/e2e-duo-round6.mjs and reports it under
# "<ID> <title>" (the titles are in scripts/e2e-duo-round6-common.mjs). Seeds, routes, URLs, viewports and waits live in
# scripts/e2e-duo-round6-sessions.mjs and scripts/e2e-duo-round6-plan.mjs, not here. The human procedure is docs/qa/round6.md.
# The numbers moved by round 6 in the older gate (the click projection, the rise and fall of one tile, the hair tip, the
# swap settle, the footstep time) are in scripts/e2e.mjs, scripts/e2e-character.mjs and tests/e2e/duo.feature.
Feature: A closer camera, a two-stage fold, living faces and a walking troll with a voice
  Every executable scenario judges what the game reported while it was stepped one requestAnimationFrame at a time: the
  per-frame probe sample (camera, face, umbrella, states), the events on __atlas.events (read from event.detail), the fold,
  pop, cue and audio logs and the hinge traces. A scenario must observe the event it judges; a route that never produces
  it fails the scenario. A route step that cannot set up its event fails only the scenarios that depend on it, naming the step.
  Scenarios tagged @needs-round-6-glb read the faces, squash, look and skip that the round-6 rigs carry and fail on the
  round-5 GLBs until those are integrated.

  Background:
    Given the production build is served by the preview server
    And the game has reported ready with both trolls loaded
    And audio has been unlocked by a first key press

  # ---- Camera --------------------------------------------------------------------------------------------------------

  @R6-CAM-01
  Scenario: The walk camera is 7.5 units out at 35 degrees
    When the leader walks, stands and swaps with no beat active for 1.5 s
    Then __atlas.camera.pitch is 35 ± 0.05 on every such frame
    And __atlas.camera.distance is between 7.5 and 10, never below 7.5 - 0.02
    And at least 70 % of those frames are at 7.5 ± 0.02, because the fit only raises the distance when a character would leave the frame

  @R6-CAM-02
  Scenario: The dance beat is 4.5 units at 22 degrees from duo-dance-start to duo-dance-end
    When a duo dance runs from duo-dance-start to duo-dance-end
    Then the camera beat is "dance" on every frame between the two events
    And once the 0.6 s ease in is over the pitch is 22 ± 0.05, the distance is 4.5 and the aim point is 0.25 above the ground
    And half a second after duo-dance-start and 0.4 s after duo-dance-end the pitch lies strictly between the two poses
    And 0.95 s after duo-dance-end the pitch is back at 35 ± 0.05 with no beat

  @R6-CAM-03
  Scenario: A hero fold-up within 2.5 units starts the hero beat
    When a mushroom_house, cupcake_tree or yarn_bridge folds up within 2.5 units of the leader with no beat active, no hop in flight and 8 s since the last beat
    Then the camera beat becomes "hero" within 3 frames
    And it lasts 1.5 s at 6.0 units and 30 ± 0.05 degrees
    And no hero beat starts without such a fold-up, and a fold-up beyond 2.5 units starts none

  @R6-CAM-04
  Scenario: At most one hero beat per 8 seconds
    When a second hero fold-up within 2.5 units happens less than 8 s after a hero beat started
    Then no second hero beat starts
    And no two hero beats in any run start less than 8 s apart

  @R6-CAM-05
  Scenario: A swap or a recovery hop cancels a beat
    When a swap, or the take-off of a recovery hop, happens during a hero or a dance beat
    Then the beat is no longer active 3 frames later
    And the pitch does not jump by more than 2.5 degrees in those frames, because the beat eases out over 0.8 s
    And 1 s later the camera is back at 35 ± 0.05 degrees with no beat, unless another event began a new one

  @R6-CAM-06
  Scenario: A fixed camera turns beats off
    Given the route runs with the "cam" URL parameter set to a distance and a pitch
    When the leader passes a hero fold-up, swaps and dances
    Then on every frame the camera beat is null and the distance and pitch are the requested ones

  @R6-CAM-07
  Scenario: The camera yaw never changes
    Then on every frame of every route the camera's right vector is (1, 0) within 0.001

  @R6-CAM-08
  Scenario: Both characters stay on screen under every shipped camera
    When the duo routes and the round-6 routes run at 1280x720 and 1920x1080 with the default camera
    Then on every rendered frame under the walk, dance and hero cameras both characters' projected bounds are inside the frame
    And the follower overlaps the leader by more than 50 % of its area for at most 0.5 s at a stretch within one route
    And a character with both body centre and hair tip occluded by tiles is hidden for at most 0.5 s at a stretch within one route
    And the walk, dance and hero cameras each appeared in at least 300, 60 and 30 frames of the run

  # ---- Folds ----------------------------------------------------------------------------------------------------------

  @R6-FOLD-01
  Scenario: Stage 1 lifts to -63 degrees within 4.5 units and drops beyond 5.5, silently
    When the leader moves so that a tile's cell centre enters 4.5 units and later leaves 5.5 units
    Then the tile's hinge settles at -63 ± 2 degrees after entering and at -90 ± 2 degrees after leaving
    And neither move emits a fold event, a pop, a chime or a cue
    And every pop matches a fold event, every chime matches a fold-up event and every fold layer matches a pop

  @R6-FOLD-02
  Scenario: A stage-2 fold-up starts with a 4 degree dip
    When a tile at -63 degrees folds up within 2 units
    Then the fold event is logged at the start of the dip and the hinge dips 4 ± 1 degrees below -63, clamped at the page, from the next frame on
    And a tile that folds up from flat holds for 80 ms and does not dip

  @R6-FOLD-03
  Scenario: The upright crossing, overshoot and settle are measured from the release
    When a tile folds up from -63 degrees or from -90 degrees
    Then the hinge first reaches upright 0.40 ± 0.05 s after the release, 80 ms after the event
    And its overshoot is 12 to 20 % of the travel from the release angle
    And it stays within ±2 degrees of upright from less than 1.4 s after the release

  @R6-FOLD-04
  Scenario: A fold-down beyond 3 units returns to -63 degrees within 5.5 and to -90 beyond
    When the leader leaves a folded-up tile by more than 3 units, staying within 5.5 units for 1.4 s
    Then the hinge starts upright and returns to -63 ± 2 degrees without going lower
    When the leader later leaves it by more than 5.5 units
    Then the hinge settles at -90 ± 2 degrees without a second fold event

  @R6-FOLD-05
  Scenario: The dance stage holds props flat from duo-dance-start to duo-dance-end
    When a duo dance starts with a flower, mushroom_house or cupcake_tree within 1.8 units of either character
    Then at duo-dance-start a tile in stage 2 folds down with an event marked cause "stage", and a tile in stage 1 drops without an event
    And these tiles stay flat, with no fold-up event, until duo-dance-end
    And down events marked cause "stage" appear only from stage 2 and only at duo-dance-start
    And after duo-dance-end the normal rules apply again

  # ---- Characters -------------------------------------------------------------------------------------------------------

  @R6-CHR-01 @needs-round-6-glb
  Scenario: Troll A's mouth cell follows its cues
    When troll A speaks or sings a cue (voice_* or sing_*)
    Then __atlas.face.a.cell is the cue's cell from the cue's start to its effective end, a cut included, and the rest cell 0.1 s later
    And ooh and eep show cell 2, hmph 4, hm 3, hup 6, whee and lead 1, every sing_* 5, and a giggle alternates cells 1 and 7 about 8 times a second
    And at least three different cue words were seen with the right cell
    And the follower shows its rest cell, except while its state is dance: then __atlas.face.<follower>.cell is the leader's cue cell at now - 0.3125 s (one canon delay), or the follower's rest cell when the leader has no cue then (round 6 C6)
    And the frames at a cue's start and end + 0.1 s are skipped at that shifted time too

  @R6-CHR-02 @needs-round-6-glb
  Scenario: Troll B's mouth cell follows its own bank
    When troll B speaks or sings a cue (b_voice_* or b_sing_*)
    Then __atlas.face.b.cell follows the same table as for troll A, with B's rest cell
    And at least three different cue words of B were seen with the right cell
    And a dancing follower A shows B's cue cell 0.3125 s late, and any other follower frame shows its rest cell

  @R6-CHR-03 @needs-round-6-glb
  Scenario: Blink interval and rest closure
    When both trolls stand and walk for at least 20 s
    Then each blinks every 2.5 to 5.5 s, the lid closing to 0.9 or more for about 0.15 s
    And between blinks the lid rests at 0 for troll A and at 0.35 for troll B

  @R6-CHR-04 @needs-round-6-glb
  Scenario: Squash on contacts, the dance landing and the hop
    When a character makes foot contacts, stretches before and lands from the dance jump at 1.67 s, takes off and lands from a recovery hop
    Then the root's scale.y is 0.95 ± 0.012 on a contact, 1.04 ± 0.012 on the dance anticipation at 1.57 s of dance clip time (0.1 s before the landing marker, skipped when the dance ends before it), 0.88 on the dance landing and on the hop landing, and 1.10 on the hop take-off
    And scale.x is 1/√(scale.y) on those frames
    And 0.8 s after the last trigger, the anticipation included, the scale is back at 1 ± 0.004

  @R6-CHR-05 @needs-round-6-glb
  Scenario: B's umbrella pops on a river collision and at the bow and closes after 1.2 s
    When troll B leads into a river, and when troll B dances
    Then __atlas.umbrella.open turns true on the collision (at most once per 3 s) and at the bow, 2.19 s into the dance
    And it turns false 1.2 s later, or when the dance ends
    And it opens at no other time

  @R6-CHR-06 @needs-round-6-glb
  Scenario: A skip keeps the state walk
    When troll A's first walk start after 1 s of standing is a skip by the seed's hash
    Then for the two cycles of the skip the leader's state is "walk" and never "skip"
    And troll.glb carries a skip clip

  @R6-CHR-07 @needs-round-6-glb
  Scenario: Troll B's look holds the follower and a swap interrupts it
    When troll B has stood still as the follower for 2 s while the leader walks
    Then it plays its look clip, staying still and idle for the whole clip, and sets off when it ends
    And a swap during the look cuts it short
    And troll_b.glb carries a look clip

  # ---- Audio -------------------------------------------------------------------------------------------------------------

  @R6-AUD-01
  Scenario: Footsteps at clip time 0 and half the playing clip, leader only
    When the leader walks
    Then every leader contact plays one step cue within 40 ms and every step cue has a leader contact
    And the contacts of the follower play nothing
    And on a straight walk the steps are half a clip apart, within 40 ms: 0.5 s for A and 0.4 s for B
    And the left foot lands at clip time 0

  @R6-AUD-02
  Scenario: The hum sings melody notes above MIDI 78 an octave down
    When troll A leads, a melody chime above MIDI 78 has been scheduled and A stands still for the hum
    Then the hum's sung pitch is the melody note minus 12 semitones for every note above MIDI 78, within 0.25 semitones
    And a note at or below 78 is sung at its own pitch
