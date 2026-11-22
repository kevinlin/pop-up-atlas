# Frozen acceptance scenarios for "Round 5: duo" (docs/contracts.md) and the Space / click-on-follower control.
# scripts/e2e.mjs runs every scenario not tagged @manual or @external through scripts/e2e-duo.mjs and reports it
# under its ID. Seeds, routes, URLs, viewports and waits live in scripts/e2e-duo-sessions.mjs and
# scripts/e2e-duo-plan.mjs, not here. The human procedure is docs/qa/duo.md.
Feature: Two trolls on screen, one leads, the lead swaps
  Every executable scenario judges a per-frame trace: the game is stepped one requestAnimationFrame at a time
  and both trolls, the debug surface, the camera and the logs are sampled after every frame. A scenario must
  observe the event it judges; a route that never produces it fails the scenario.
  "Pose jump" below means the route moves the leader with the look-shots pose hook, which is not player input.
  A route step that cannot set up its event fails only the scenarios that depend on it, naming the step.

  Background:
    Given the production build is served by the preview server
    And the game has reported ready with both trolls loaded
    And audio has been unlocked by a first key press

  @DUO-01
  Scenario: Debug surface and stable player identity
    Then __atlas.duo exposes leader, follower {x, z, state}, swaps, pendingSwap and swap()
    And at start the leader is "a", swaps is 0 and pendingSwap is false
    And on every frame __atlas.player is the same object and holds the leader's pose
    And on every frame outside a hop the leader's model sits on player and the follower's model on follower within 0.03

  @DUO-02
  Scenario: Troll B asset contract
    When public/models/troll_b.glb is inspected next to troll.glb
    Then troll B has the same bone names and the same clip names as troll A
    And its body height is 0.5 to 0.6 and its hair tip is at most 0.95
    And it has at most 20,000 triangles and no texture larger than 1024 px
    And its origin is between the feet
    And every material name starts with felt_, card_, glitter_ or yarn_

  @DUO-03
  Scenario: Start formation
    Then troll A leads
    And troll B stands 1.1 units behind A's heading when that point is unblocked, otherwise beside A
    And troll B never starts on a blocked point

  @DUO-04
  Scenario: The trail resets on swaps and a short trail holds the follower
    Given a swap has just reset the trail to the straight segment from the follower to the leader
    When the new leader walks away so the trail is shorter than 1.1 units of path
    Then the follower holds still until the trail reaches 1.1 units

  @DUO-05
  Scenario: Follow distance while walking straight
    When the leader walks straight at 1.2 units per second for at least 2 seconds
    Then over those frames the median leader-follower distance is 0.9 to 1.4
    And the maximum distance is at most 2.2

  @DUO-06
  Scenario: Follower speed cap, catch-up and easing
    When the leader walks, stops, and makes a pose jump forward that leaves the follower more than 1.4 behind
    Then the follower never moves faster than 1.6 units per second outside a hop
    And while more than 1.4 behind it catches up at about 1.6 units per second
    And after the leader stops, the follower never speeds up inside the last 0.3 units and never passes its target

  @DUO-07
  Scenario: Follower walk clip time scale
    When the follower walks at a steady speed, including a catch-up
    Then its walk clip plays at speed / 1.2, clamped to 0.6 to 1.4, within 10 percent
    # Measured from the hips bob frequency against the same troll leading at 1.2 units per second.

  @DUO-08
  Scenario: Separation and sidestep
    Given the follower stands in an idle slot beside the leader
    When the leader walks into the follower
    Then the follower steps sideways, perpendicular to the leader's heading, to an unblocked side at most 1.6 units per second
    And the leader never comes within 0.45 of a follower that has a free side
    And on at least 99 percent of the route's frames where a side is free, the pair is at least 0.45 apart

  @DUO-09
  Scenario: The leader is never blocked by the follower
    When the leader walks with a movement key held on free ground, including straight through the follower
    Then the leader moves 1.2 units per second on every such frame
    When the follower stands on a yarn bridge deck with river on both sides and the leader walks back through it
    Then the follower holds and the leader passes through

  @DUO-10
  Scenario: The follower never enters a blocked cell
    When the route covers walks, idle slots, sidesteps, hops, a bridge deck and a blocked hop line
    Then on no frame is the follower's position, or its model's position, in a blocked cell

  @DUO-11
  Scenario: Idle side slot
    When the leader has been stationary for 0.5 seconds with a free slot beside it
    Then the follower walks a straight path to the nearer free slot 0.75 units to the screen left or right of the leader
    And the slots lie along the camera's right vector on the page, read from the page's camera, whatever the leader's heading
    And once there it faces within 30 degrees of the leader's heading

  @DUO-12
  Scenario: Idle with neither slot free keeps the trail target
    When the leader stops where neither side slot (0.75 units along the camera's right vector) is free or reachable on a clear path
    Then the follower stays on the trail and settles at the trail target

  @DUO-13
  Scenario: Dance canon
    When the leader dances after 4 seconds idle
    Then the follower starts the same clip 0.3125 seconds later, within 0.05 seconds
    And this holds for every dance on the route, with each troll as leader

  @DUO-14
  Scenario Outline: Both dances end on <ending>
    Given both trolls are dancing
    When <ending> happens
    Then both trolls leave the dance within 2 frames

    Examples:
      | ending                                                     |
      | a movement key press                                       |
      | a click-walk on the page                                   |
      | leader displacement over 0.02 units in 0.25 s with no input |

  @DUO-15
  Scenario: Recovery hop
    When a pose jump leaves the follower more than 2.6 units from the leader for 0.5 seconds
    And the jump is chosen so the straight hop line from the follower to its landing is clear and keeps 0.45 from the leader
    Then the follower hops to the trail point 1.1 units behind the leader
    And the hop height follows a parabola with apex 0.25
    And the hop lasts 0.35 seconds plus 0.1 seconds per unit beyond 1.5, within 2 frames
    And the hop's ground path crosses no blocked cell and every started hop lands

  @DUO-16
  Scenario: A blocked hop line walks the trail
    When the follower is due to recover but the straight line to its landing crosses a blocked cell
    Then it does not hop
    And it walks the trail at no more than 1.6 units per second, staying within 0.1 of the leader's path

  @DUO-17
  Scenario: Swap by Space exchanges poses and rebinds models
    When the player presses Space with no swap in the last 0.5 seconds
    Then the swap applies on that frame and swaps increases by 1
    And player and follower exchange position, heading and state by value
    And neither model jumps more than 0.03 or snaps its heading
    And the new leader's model sits on player, and blockedBy is cleared where it is exposed

  @DUO-18
  Scenario: Clicking the follower swaps without a click-walk
    When the player clicks inside the follower's projected bounds
    Then the lead swaps
    And the new leader does not walk during the next second

  @DUO-19
  Scenario: Swap while walking keeps held keys and cancels click-walk
    When the player swaps with Space while holding a movement key
    Then the held key drives the new leader at 1.2 units per second in the same direction
    When the player clicks the follower during a click-walk
    Then the lead swaps and the click-walk is cancelled

  @DUO-20
  Scenario: Swap while dancing ends both dances
    Given both trolls are dancing
    When the player presses Space
    Then neither troll is dancing on the frame after the swap

  @DUO-21
  Scenario: Swap requested during a hop waits for the landing
    When the player presses Space while the follower is mid-hop
    Then pendingSwap is true until the landing
    And the swap applies on the landing frame, within 1 frame

  @DUO-22
  Scenario: Swap cooldown and odd press parity
    Given a swap has just applied
    When the player presses Space three times within the next 0.5 seconds
    Then pendingSwap reads true, false, true after each press
    And exactly one more swap applies, 0.5 seconds after the first
    And every swap on every route applies at max(last swap + 0.5 s, landing of an active hop), within 1 frame

  @DUO-23
  Scenario: Even press parity cancels the pending swap
    Given a swap has just applied while walking
    When the player presses Space twice within the cooldown
    Then pendingSwap is true after the first press and false after the second
    And no further swap applies

  @DUO-24
  Scenario: Swap cooldown overlapping a hop
    Given a pose jump has left the pair more than 2.6 units apart with a clear hop line
    And a swap applies 0.3 seconds later, so the follower's hop is due inside the swap cooldown
    When the player requests a second swap and the cooldown ends during the hop
    Then the second swap waits and applies on the landing frame, within 1 frame

  @DUO-25
  Scenario: Camera settles on the new leader
    When a swap applies with both trolls standing
    Then 1.0 second later the camera target is within 0.2 units of the new leader

  @DUO-26
  Scenario: Folds are driven by the leader only
    When the follower passes near tiles the leader is far from
    Then every fold-up happens with the leader within radius 2 of the tile
    And every fold-down happens with the leader beyond radius 3
    And the route has at least one fold-down while the follower is within 3 units of the tile

  @DUO-27
  Scenario: Character cues follow the leader
    When either troll leads through walks, dances and swaps
    Then every character cue (voice, steps, sfx other than folds) logs who as "a" or "b"
    And who is always the leader at that frame
    And voice_* and sing_* cues come from troll A's bank only when A leads, b_voice_* and b_sing_* only when B leads
    And no step cue plays while only the follower walks

  @DUO-28
  Scenario: Swap lines from A to B to A
    When the player swaps from A to B and then back to A
    Then b_voice_lead plays for the first swap and voice_lead for the second, each logged with who as the new leader
    And with a voice active for at least 0.3 seconds the line starts when the 20 ms fade ends
    And with no voice active the line starts within one frame of the swap

  @DUO-29
  Scenario: The swap line guard
    Given the leader's dance voice started less than 0.3 seconds ago
    When the player swaps
    Then no swap line plays

  @DUO-30
  Scenario: The voice cut is logged as end and pending state is cleared
    Given a voice is playing
    When the player swaps
    Then that cue's end in cueLog is rewritten to 20 ms after the swap
    And no pending hum or dance cue from before the swap plays afterwards

  @DUO-31
  Scenario: A missing B sample is skipped without error
    Given the manifest served to the game lacks b_voice_lead and b_voice_giggle
    When troll B takes the lead and dances
    Then there is no page or console error
    And neither missing cue is logged as played
    And troll B still logs its other cues and finishes the dance

  @DUO-32
  Scenario: The B cue bank shipping gate
    Then the manifest has voice_lead, b_voice_lead and every required b_voice_* and b_sing_* cue with existing files
    And every B line is a non-verbal sound or a 1-2 word exclamation
    # audio/generate.mjs --check is the shipping gate itself; run it separately (docs/qa/duo.md).

  @DUO-33
  Scenario: Voice B pitch
    Then the median f0 (YIN, voiced frames) of all non-sung B takes is 220 to 380 Hz

  @DUO-34
  Scenario Outline: Both characters stay inside the frame at <viewport>
    When the duo routes run at <viewport> with the default camera
    Then on every rendered frame from ready on, both characters' projected bounds are inside the frame

    Examples:
      | viewport  |
      | 1280x720  |
      | 1920x1080 |

  @DUO-35
  Scenario Outline: The follower does not cover the leader for long at <viewport>
    When the duo routes run at <viewport> with the default camera
    Then the follower's bounds overlap the leader's by more than 50 percent of its area for at most 0.5 seconds at a stretch

    Examples:
      | viewport  |
      | 1280x720  |
      | 1920x1080 |

  @DUO-36
  Scenario Outline: Tiles do not hide a character for long at <viewport>
    When the duo routes run at <viewport> with the default camera
    Then neither character has both body centre and hair tip occluded by tiles for more than 0.5 seconds at a stretch

    Examples:
      | viewport  |
      | 1280x720  |
      | 1920x1080 |

  @DUO-37
  Scenario: The follower walks the leader's path
    When the follower is trail-following after joining the trail
    Then it stays within 0.1 units of the leader's sampled path

  @DUO-38 @manual
  Scenario: Tilt-shift focus sits between the pair
    When the pair walks with the leader ahead and then swaps
    Then the sharp band centres on the point 30 percent of the way from the leader to the follower

  @DUO-39 @external
  Scenario: Perf with both characters
    When npm run perf runs on the host at DPR 1 and DPR 2
    Then the existing targets hold and p95 frame time is at most the 06da353 baseline plus 1.5 ms on the same host and route

  @DUO-40 @external
  Scenario: Capture framing
    When the 1280x720 30 s capture with a lead swap and a duo dance is recorded
    Then the DUO-34, DUO-35 and DUO-36 limits hold on every captured frame

  @DUO-41
  Scenario: No browser errors on the duo routes
    Then no page or console error is reported on any duo route at any viewport

  @DUO-42 @manual
  Scenario: Voice B is original and in character
    When the operator listens to every B line and to swaps in both directions
    Then voice B is dry and cautious, warm underneath, and resembles no actor or film character
    And the owner's verdict is recorded in Notes
