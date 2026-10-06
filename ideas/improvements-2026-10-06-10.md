# Quality pass — Jamming — 2026-10-06 (loop 10, open brief)

> Brief widened after loop 9: UI/UX, music generation (engine and model paths), more styles and options, jazz and pop conventions, refactors where they help quality. The goal is fewer, bigger wins. Each change was planned, built, tested and pushed on its own; this file records what shipped and why.
> Starting commit: 7136ff7.
> The rejected-ideas file was used as background, not as a veto: loops 4–9 picked their ideas by quota, so some ideas they passed over came back here, because they were worth more than their quota slot.

## Standards played like standards

### Choruses, not bars (da57927)
- **Problem.** Standards were capped at 48 bars, so a 32-bar tune was played once: the head on the A sections, then an 8-bar bridge split between every soloist. Solos were cut into 4-bar pieces whatever the form, so two soloists on a blues got 4 and 8 bars.
- **Shipped.** Up to six choruses (128 bars). The default is the head, a chorus per soloist, then the head out. Soloists take whole choruses; with more soloists than choruses, a chorus splits at the form's section boundary. A drummer in the solo order trades 4s for a whole chorus, rotating with the horns.

### The actual melody (d1e5be5)
- **Problem.** A standard's head was built from a 1–2 bar motif plus transforms, so "When the Saints" never sounded like "When the Saints".
- **Shipped.** A `melody` per bar on public-domain standards, played with `@tune N`. It is transposed to the chosen key, voiced into the leader's register as one whole, and exempt from the band's harmony fixes. The model paths treat these bars as already decided.
  - Melodies: When the Saints, Greensleeves (verse and chorus, with chords re-fit to the melody), and a new Ode to Joy.

### Intros (a3eab53, 1437b95)
- **Shipped.** Swing, bossa, pop, funk and New Orleans now start with a rhythm-section intro: the tune's last bars, ending on the dominant of the head's first chord.
  - Standards add the intro on top of their choruses.
  - Free charts take it out of the solos, so the length stays as picked.

### Lengths read as times through the tune (9a33d2e)
- The length chips for a standard now read once, 2×, 3×, and so on.

## The band's musicianship (local engine)

### Comping out of the mud (c44e41a)
- **Problem.** Voicings ignored low-interval limits (7% of swing chords and 11% of bossa chords were muddy), and a fallback could stack a triad under the bass.
- **Shipped.**
  - Low-interval penalties in voice selection.
  - A floor at the bass register.
  - Comping returns to its normal range when there is no room under a low tune.
  - The ambient pedal stays deep.
- **Result.** Muddy chords are under 2% in every style, and a test holds that.

### Each style's feel (c96fd2b)
- **Bossa.** The bass plays the surdo pulse and leans into each chord change on the "and" of 4.
- **Funk.** The guitar locks one rhythm cell per section, interlocks with the bass, and is voiced up high as a 9th "grip".
- **Jazz waltz.** Six comping cells, and the bass strikes every chord change in 3/4.

### Harmony as written (aece8c3)
- sus2 is read correctly, as are 7#5 and 7b5.
- A standard keeps its own mode; the mode picker is disabled while one is chosen.
- The cello's fifths follow the chord's quality.

### Endings (8415120)
- Fade and cadence endings ease off through the ritardando instead of peaking in it.
- Fixed a bossa pp → mp slip.

### Pop (8c5ef20)
- **Shipped.** A new style:
  - backbeat drums locked to the bass
  - `@pump` root-8ths bass
  - `@pulse` block-triad comping
  - hooky pentatonic lines
  - diatonic I–V–vi–IV-family changes with no jazz reharmonization
  - Chorus / Break / Last chorus naming
  - two pop progressions in the tune list

## Model-driven band

### Trades are a conversation (a96c505)
- **Problem.** Every turn in a phrase was asked at once and written blind.
- **Shipped.** Turns inside a phrase now go in order, and a later turn gets "what Hoot just played, right before your turn".

## UI

### The how-to note no longer covers the band (0bc184a)
- On desktop the note now sits in the page flow as a strip under the form strip.

### A play dock on phones (53bf54e)
- Play/stop, the take's name and the main button stay in reach once the transport scrolls away.

### Drum notation that reads (d0cac6d)
- Each hit lasts until the next one: 8th-note hats read as 8ths, with no picket fence of 16th rests.

### Model-only settings appear with a key (b5ac141)
- Phrase and "best of 4" only show once a key is saved; the Mode picker says it needs one.

### Band talk matches the music (7884b36)
- A soloist's opening line is read from their first bar, and answers are announced as answers.
- The tune is named when its written melody plays.
- The intro gets a line.
- The bass chair is respected.
