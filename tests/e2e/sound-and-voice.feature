# Frozen acceptance scenarios for scripts/e2e.mjs. This file is documentation.
Feature: Sound and voice in Pop-up Atlas
  Every scenario must observe the events it judges. The Playwright gate
  must report each scenario and every existing check.

  @VOX-01
  Scenario: Samples wait for the first input
    Given the samples are decoded and the player has provided no input
    When the game advances through idle and the player then unlocks audio and walks
    Then no sample cue is logged before the first input
    And at least one sample plays afterwards
    And every logged sample file appears under its cue in the manifest
    And only synthesized step plucks have a null file and a MIDI pitch

  @VOX-02
  Scenario: Felt steps follow the walk cycle and alternate
    When the troll walks continuously on felt at 1.2 units per second
    Then at least three consecutive contacts play step_felt
    And successive contacts are 0.5 seconds apart within 40 ms
    And successive contacts alternate pan sign and never repeat the same file

  @VOX-03
  Scenario: Path and bridge contacts use their own sounds
    When the troll walks on a path tile, then turns on a yarn bridge before leaving it
    Then path contacts play step_paper
    And at least four plucks on the first bridge visit follow D5 E5 F#5 A5 B5 D6 in order
    And the exit plays voice_whee with cause bridge-exit when the gap and cooldown allow it
    When the troll re-enters the bridge
    Then the plucks start at D5 again

  @VOX-04
  Scenario: Holding movement into a page edge does not repeat a bump reaction
    Given no voice is playing and the reaction gap and bump cooldown have expired
    When the troll hits the page edge and pushes on for two seconds
    Then sfx_bump and voice_hmph play within 0.3 seconds of contact
    And no second bump reaction plays within three seconds

  @VOX-05
  Scenario: Fold layers follow scheduled pops
    Given at least three post-unlock fold-up frames and at least one fold-down frame have pops
    Then each up pop has one fold layer for its tile within 10 ms of the pop time
    And each down pop has one fold_down within 10 ms of the pop time
    And no fold layer plays without a corresponding pop

  @VOX-06
  Scenario: Reaction lines leave space and voices do not overlap
    Given at least two reaction lines occur during the run
    Then consecutive reactions by cause start at least 2.5 seconds apart
    And the dance whee is excluded from reaction spacing
    And each voice cue ends by the start of the next voice cue

  @VOX-07
  Scenario: The troll hums the recent walking melody after stopping
    Given the troll has walked and at least one melody chime has sounded
    When the troll stops
    Then sing_hum echoes up to the last three melody notes in order
    And the notes start 1.5 seconds after stopping, then every 0.3125 seconds, within 50 ms
    And each pitch calculated from manifest baseMidi and cue rate is within 25 cents

  @VOX-08
  Scenario: An uninterrupted dance has timed sounds and a sung answer
    When the troll stands still for four seconds and finishes the dance
    Then the following cues sound within 50 ms of their offsets from dance start
      | cue          | offset (seconds) | pitch |
      | sfx_clap     | 0                |       |
      | sfx_clap     | 0.3125           |       |
      | voice_giggle | 0.45             |       |
      | sfx_spin     | 0.92             |       |
      | voice_whee   | 0.92             |       |
      | sing_ta      | 2.19             | A4    |
      | sing_da      | 2.50             | D5    |
      | chorus_yay   | 2.65             |       |
    And each sung pitch calculated from manifest baseMidi and cue rate is within 25 cents

  @VOX-09
  Scenario: A key press before the bow cancels the dance ending
    Given the dance has played its spin cue
    When the player presses a movement key before the bow
    Then the troll leaves the dance state
    And no sing_ta, sing_da or chorus_yay from that dance plays

  @VOX-10
  Scenario: Chimes hold the phrase between slow folds and add harmony
    Given the run observes a fold-up gap longer than six eighths and shorter than six seconds mid-phrase
    And the run observes another gap of at least six seconds and at least one harmony chime
    Then the shorter gap re-anchors the eighth-note grid on the next fold while continuing the phrase
    And the longer gap restarts the phrase on its next fold-up
    And the existing melody comparison excludes harmony entries
    And each harmony starts with a melody note and is two pentatonic degrees below it, or above at the range floor
