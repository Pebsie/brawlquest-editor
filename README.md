# BrawlQuest Content Editor

Static, browser-only editor for BrawlQuest's `bq-content.db`. It uses
[sql.js](https://sql.js.org/) (SQLite in WebAssembly): the database is opened,
edited and saved in your browser tab. Nothing is uploaded unless you commit
it to GitHub (see [Saving, history and GitHub](#saving-history-and-github)).

Live: **https://tomlock.me/bq-editor/** (also https://tomlock.me/brawlquest-editor/)

## Use

1. **Open .db** (or drop the file on the page): a `bq-content.db`. Never `bq-users.db`.
2. Edit in the tabs:
   * **Quest Studio**: plan and play through the player journey.
     * **Journey**: every quest as a card on a pannable, zoomable map (drag, pinch, Ctrl+scroll or trackpad pinch), in story order or by level, grouped into questlines. Each card shows the level, giver and hand-in portraits and the objectives (joined when they are in order). Problems are flagged on the cards and listed under Problems: missing or circular prerequisites (and everything they lock), level drops and jumps, no giver, missing enemies/items/NPCs in objectives, no reward, missing lines. Drag a card's + onto another quest to make it need this one; click an arrow to unlink; click + to add a quest after it. Click a card to edit everything in place (Enter saves, Esc cancels).
     * **Cast**: NPCs as character cards in the order you meet them; each opens a character sheet with their look, notes (editor-only `npc_notes` table, created on the first note), where they stand on the real map (click to move), their quests, who they're connected to, and their **conversation**: one tree from the greeting through the chat to the quests it brings up, every line editable, with the game's conversation window beside it.
     * **Playtest**: a pretend character: pick a level, take, finish and hand in quests through the same menu rules as the server, and see what's on offer, what's coming up and why.
     * **+ Quest** / **+ NPC**: quick creation (giver, objective, words; level, XP and gold suggested from nearby quests). Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) for every Studio edit; edits go straight into the open db, so History autosaves them.
   * **Map**: tile sprites, NPCs, mob spawns, quest reach points, plots.
     * **Paint tiles**: the brush has Ground, Object (keep / paint / clear),
       Collision, Zone (`world.Name`: lighting, music, quest zones) and a size (1, 2, 3, 5). Pick sprites from the
       thumbnail grid (search, folders, "On the map" by use, recently used).
       Edits show as you draw; they are stored when you let go. Alt-click a
       tile to copy its ground and object. "Show collision" / "Show zone
       names" / "Show areas" overlays.
     * **Areas**: named regions painted per tile (a house, a mine), separate
       from zones. Each has Interior (Outside / Roofed / Cave: roofed and cave
       are inside, no rain), "Rain can fall here" for outdoor areas, a room
       reverb (small, room, hall, cave, large cave) with Wet and Dry levels,
       and an ambient sound and light level (stored, not used by the game
       yet). Paint or erase with a 1/2/3/5 brush, or Room fill (connected
       tiles with the same ground). Alt-click picks the area under the
       cursor. Tables `areas` and `area_tiles` (the API's
       `content/migrations/2026-10-24-areas.sql`); a db without them offers to
       create them. Unpainted tiles use the old rule in the game (cave, floor
       and wall grounds are inside).
     * **NPCs**: put someone in the world where you click or tap: "Someone
       you have" (search the cast) or "A new NPC" (name, look, faction).
       One NPC can stand in many places (a Guard at every gate): same
       name, words and quests at each, and the game offers, takes hand-ins
       and shows markers at all of them. Drag a placement to move it; the
       panel lists every place of the picked NPC with Remove. Each place is
       a row in `npc_spawn` (the API's `content/migrations/2026-10-27-npc-spawns.sql`,
       `docs/NPC_SPAWNS.md`); the first placement turns the table on in a
       db without it (every NPC's current position becomes its first
       place). `npc.SpawnX`/`SpawnY` follow each NPC's first place. On a
       phone the map sits above the panel: one finger taps and drags,
       two fingers pan and pinch-zoom.
       Each place has a **Routine** button (with its count of walks): it
       opens that place's routine in Quest Studio, and the picked place's
       walks are drawn on the map.
     * **Place mobs**: pick the enemy from a thumbnail grid, click to place.
     * **Select**: drag NPCs and mobs; "Change sprite..." / "Change..." open a
       sprite picker for the NPC or the mob on that tile.
     * **Plots** (see below).
   * **Quests**: title, text (offer, accept, in progress, complete), steps
     (kill, boss, collect, talk, reach, use, craft, equip, level), rewards,
     prerequisites, levels. Needs the questline migration (`quest_def`).
     **Complete objectives in order** (`quest_def.Sequential`): unticked, the
     default, every objective counts at once ("kill 3 Spiders" and "kill 3 Cave
     Spiders" fill together); ticked, one at a time in order. Opening a db
     without the column adds it (every quest unticked), as the API's
     `content/migrations/2026-10-24-quest-sequential.sql` does.
   * **NPCs & dialogue**: name, sprite, position, dialogue nodes and answers,
     and the quest lines each NPC speaks.
   * **Items**: name, type, Val, image (with preview), description, worth,
     attributes (stat bonuses), subtype, cooldown. Shows what drops it.
   * **Mobs**: list/search, create, edit, duplicate and delete enemies (every
     `enemies` column; sprite from the thumbnail picker) and their boss pattern
     primitives, with a live preview. See [Mobs and boss patterns](#mobs-and-boss-patterns).
   * **Effects**: status effects (buffs/debuffs) that projectiles apply. See
     [Effects and projectiles](#effects-and-projectiles).
   * **Loot**: each enemy's drops (item, chance %, amount ± variance).
3. Your work is autosaved in the browser (**History**), and **GitHub** commits
   it to BrawlQuest/brawlquest-content. **Save .db** downloads the edited database. Back up the server's copy, replace
   `bq-content.db` with it and restart the API.
4. **Export SQL** gives the same edits as a migration (keyed, safe to apply twice)
   for `content/migrations/`.

Saves never reset a column they don't send: a form without `Daily`,
`Sequential`, the quest dialogue columns or anything newer keeps the row's
current value.

## Saving, history and GitHub

**Autosave and History** (no setup, works offline). While a db is open the
editor keeps snapshots of it in this browser (IndexedDB): about 45 seconds
after an edit (at most 2 minutes into a run of edits), straight away when you
switch tab or close it, and when you open, Save .db or commit. Each is
gzipped (8.3 MB is about 1.4 MB). **History** lists them, newest first, with
the time, what changed since the one before ("Quests: edited 2; Dialogue:
edited 5") and whether it was unsaved; **Restore** opens one (what is open is
snapshotted first, so nothing is lost) and **Download** gives the .db. The
newest 50 are kept, fewer if the browser's storage for the site runs short;
ones older than 30 days go once there are more than 10. If the editor opens
with unsaved work in History, or you open a file that is older than an
unsaved autosave of it, a bar offers to restore it.

**GitHub** opens and commits `bq-content.db` in `BrawlQuest/brawlquest-content`.
Connect once with a fine-grained personal access token:

1. https://github.com/settings/personal-access-tokens/new
2. Name it (BrawlQuest editor), pick an expiry.
3. Resource owner **BrawlQuest**; Repository access **Only select
   repositories** > **brawlquest-content**.
4. Repository permissions: **Contents: Read and write** (Metadata read-only is
   added for you). Nothing else.
5. Generate, copy, and paste it into GitHub > Connect in the editor.

The token stays in this browser's `localStorage` on your machine, is only sent
to `api.github.com`, and is never logged. **Disconnect** removes it.

* **Open latest from GitHub**: the head of the branch (main by default).
* **Commit to GitHub**: commits the open db, plus a text dump,
  `content/<table>.sql` (each table's CREATE and one INSERT per row in
  primary key order, written by SQLite's `quote()`), so the diff on GitHub
  shows what changed. Only files that changed are uploaded. A blank message
  uses the summary of changes since the version you opened, e.g.
  `Quests: edited 3, added 1; Dialogue: edited 5`. It uses the Git Data API
  (blobs, trees, commits, refs) and only ever fast-forwards the branch.
* **If the branch moved on** since you opened it: if only other files changed
  (say the README), the commit goes on top. If someone committed a different
  `bq-content.db`, nothing is written: you can commit to a new branch
  (`editor/<date-time>`, made from the version you opened, to merge on
  GitHub) or open the latest instead (your db goes to History first). Never
  forced. A db opened from a file (not GitHub) asks before it replaces the
  branch's db; the old one stays in the git history.
* **Auto-commit** every 5, 10, 15 or 30 minutes while editing, to the same
  branch; off by default. It skips when the checks find anything and turns
  itself off if the branch moved on.
* **Version history**: recent commits that changed `bq-content.db` on the
  branch; **Open** loads any of them.

**Checks** before Save .db and every commit (`validate.js`), from what the API's
loaders read on startup (new-ui: `initItems`, `initEnemies`, `initEffects`,
`initNPC`, `loadQuestDefs`, `initCraftItems`, `initForging`, `initWorld`):

* SQLite `integrity_check`.
* Every table and column the loaders read is there; tables read with
  `SELECT *` (items, craft, forge, world) have exactly the columns the API
  scans; no NULL or wrong-typed values where Go's `Scan` would fail (a bad
  quest_def row stops all quests after it loading).
* JSON the API decodes, with Go's rules (a whole number field refuses 2.5
  or "3"): quest Steps, Rewards, Prereqs; boss_patterns (one bad value drops
  every primitive in the row); effects Modifiers; craft Items (the API panics
  on bad JSON there); dialogue ItemsGiven.
* References: quest givers, turn-ins, talk NPCs, kill and collect targets,
  rewards; dialogue answers leading to missing nodes; loot, craft and forge
  items; pattern spawns and effects; map spawns naming an enemy that doesn't
  exist (exact name).

Errors block, listed with links to the quest, NPC or mob. Warnings (things
that load but look wrong, such as loot for an enemy that's gone) can be
overridden; warnings that were already in the db when you opened it are shown
folded and don't ask.

Limits: History lives in this browser profile on this machine only, so
clearing site data removes it, another browser or a private window has its
own (private windows may keep none). Safari may delete a site's storage after
7 days without a visit; the editor asks for persistent storage, which Chrome
and Firefox usually grant, Safari may not. The quota is per browser: Chrome and Firefox allow a share of free disk,
Safari less, and older Safari asks before a site passes about 1 GB. GitHub
sync needs to be online; autosave doesn't.

## Quest Studio: conversations and daily quests

**The conversation flow.** The quest and NPC sheets show what the player sees, in the game's conversation-window look: the offer, after accepting, in progress and the hand-in. Every line (the NPC's and every answer) is editable inline; lines shared by several quests (an NPC's greeting) are flagged. The NPC sheet starts with an editable **Greeting** (shown when they have nothing for you). A conversation opens on quest business before the greeting (hand-in, then a talk step, then an offer), exactly as the server does; **Playtest** follows the same flow, and declining goes to the menu.

**Conversation first.** Quests come out of what NPCs say. An NPC's sheet has one **Conversation**: the greeting, the chat lines it leads to, and, hanging off any answer, the quests it brings up, each unfolding into its offer (and its branches), accept / decline, after accepting, in progress and the hand-in, all editable where they sit. Every answer has a destination picker: end the chat, another line, **+ a new line**, one of the NPC's quests, or **+ a new quest...** (the quick quest maker; you stay in the conversation). **+ quest from here** on any line does the same as a new answer ("Got any work for me?", reword it). A quest's own sheet opens with **The conversation**: "In the chat" shows the giver's greeting and the lines on the way with the answer that brings it up marked (all editable), then the quest's lines. In the data, an answer that brings up a quest is an ordinary `conversation.Options` entry with the target `@quest:<id>` (BrawlQuest-API `docs/QUEST_DIALOGUE.md`): the game shows the offer while the quest is available, in-progress talk while it's active and the hand-in when it's ready, and hides the answer otherwise. A quest the chat brings up no longer jumps in ahead of the greeting; quests nobody brings up still open straight away (listed as "Opens straight away" with a "bring it up from the greeting instead" button). Needs the API from f57505f; older servers treat `@quest:` as a missing line.

**All of a quest's dialogue, from the quest.** Whether you open a quest in Quest Studio (its sheet) or in the classic **Quests** tab (the form), you get the same view of every line tied to it, editable where it sits and saved as you go:
* **The whole path at a glance**: top to bottom, who says what, the player's answers as coloured tags (what each does, branches nested), from the way in to what it unlocks. Tap a line to jump to it.
* **In the chat**: the giver's greeting and the lines that bring it up (or a button to bring it up), and **All of <NPC>'s conversation** folded underneath; a hand-in NPC whose chat brings it up gets its own path.
* **Offer, after accepting, in progress, hand-in**: single boxes or conversations (see below).
* **Talk objectives at other NPCs**: that NPC's line and the player's answer (`Steps[i].Line`, `Steps[i].Reply`, default "Right."), or **Turn into a conversation** (`Steps[i].Tree`: their own branching lines; answers can carry on (`@next`), end, go to the menu or another line). Needs the API from d7fc124; older servers show the Line and "Right.".
* **Then**: the quests this one unlocks, each unfolding into its own lines.
* **more** on any line: its portrait override, items given, identifier and raw answers (the classic node editor) in place. Lines of the quest nobody reaches are listed under the offer, tap to edit or delete.

In the classic form the four plain text boxes are replaced by this view for saved quests (new quests keep them until the first Save), and **Save** keeps the dialogue as stored, so it never overwrites a line you edited below. The NPCs tab's quest links (`#quest/ID/line/Offer`...) land on those lines. On phones the list-and-form tabs stack (short list on top).

**Branching offers.** "Turn into a conversation" on a quest, then **+ question** under any NPC line. Every answer has its own wording and a small action tag: another line, back to the offer (`@offer`), accept (`@accept`), decline (`@decline`), the menu (`@menu`), anything else (`@more`) or end (`@close`). "I'll do it." / "Not right now." / "On it." are greyed defaults you can overwrite (stored in the quest's `Replies`); several accept or decline answers with different wording are fine. A click-through preview plays the tree as a player (with the Playtest character), and warnings flag an accept that can't be reached, dead ends, loops with no way out and more than 6 answers on a line. **Enable quest conversations in this db** adds the dialogue columns (`OfferTree`, `AcceptTree`, `ProgressTree`, `CompleteTree`, `Replies`) with the same statements as the API's `2026-10-26-quest-dialogue.sql`; old quests stay single-box. Schema: BrawlQuest-API `docs/QUEST_DIALOGUE.md`.

**Daily quests.** A quest's **Once / Daily** switch. A daily keeps pools (`quest_daily_pool`): `{mob}`, `{item}`, `{count}`, `{place}` lists with sprite pickers, groups ("any of these counts"), ranges, odds and places picked on the map. Tap a placeholder chip while editing text to write it in. The roll preview is a port of the server's own roll (same seed per day, quest and list) for today and the next six resets (21:00 server time). Dailies carry a blue ! on the journey, in the Cast and in Playtest, where claimed ones hide until **next reset**. **Enable daily quests in this db** adds the `Daily` column and pool table (the API's `2026-10-26-daily-quests.sql`).

Tests: `tests/headless-quest-talk.mjs`, `tests/headless-daily-quests.mjs` (serve on 127.0.0.1:8977), `tests/qtalk.mjs`, `tests/daily-roll.mjs`, `tests/dialogue-migration.mjs`, `tests/daily-migration.mjs`.

## NPC routines

Quest Studio's NPC sheet has a **Daily routine** window (also from the Map's NPCs tool: **Routine** beside each place, or `#studio/npc/ID/routine/X,Y`). Each place an NPC stands has its own routine; a new place has none (they stand still), and the first place keeps the routines NPCs had before placements.
* **The day**: 24 hour blocks, night (18:00-06:00) dark. A gold block is a walk starting then, striped blocks the hours it is still going. Tap an empty hour to start a walk then. A day is 30 minutes; an hour is 75 seconds.
* **The path**: tap the map to add a point at the end; drag a point to move it; tap a point to give it a wait (seconds standing there) or remove it, and while it's open taps add points right after it. Numbered gold squares are the points; small dots are the tiles they actually step on.
* **Once** (walk it, stay at the end until their next walk), **Round and round** (start again from the first point all hour) or **There and back** (back and forth all hour). **Pace**: Stroll (half a tile a second), Walk (1), Hurry (2).
* **Watch this walk** plays it on the map as the server walks it (a port of the API's `tickRoutine`, at 4x); **Watch their day** plays the whole day from 06:00 (30x), clock and all. A walk still going when the next hour comes, and a step through a wall (they go in straight lines, diagonals first, no path finding), are flagged.

Every change is one undo step. The first routine saved upgrades the db with the same statements as the API's `content/migrations/2026-10-27-routine-placements.sql` (`routine.Spawn`, `routine.Speed`, `routineNode.Wait`; Loop 2 is new); schema and behaviour: BrawlQuest-API `docs/NPC_ROUTINES.md`. Needs the API from ff9d6ce for pace, waits, there and back and routines on other places; older servers ignore the new columns (every routine walks the first place, at 1 tile a second, no waits). Removing a place removes its routines. Test: `tests/headless-routine.mjs`.

## Plots

Plots are leased building land outside Foundation Forest (table `plot`,
`content/migrations/2026-10-14-plots.sql`; `Agent` from
`2026-10-19-plot-agents.sql`). None ship: you place them all.

* **Draw**: Map > Plots, drag a rectangle (1 to 12 tiles a side). The outline is
  red, with the reason, if it can't go there: overlapping another plot, any tile
  in Foundation Forest (shaded orange) or a Dominion, or off the map.
* **Edit**: click a plot; drag it to move, drag an edge or corner handle to
  resize, arrow keys nudge (Shift+arrows resize). Name, rent (gold/week), min
  level and **Offered by** (any Land Agent, or one: Gideon or Sharon Gazump) are
  in the side panel, with a buildability check. Enter saves, Esc deselects,
  Delete removes.
* A Land Agent lists the plots offered by them or by "any agent"; in game the
  player sees them on a map (client `scripts/ui/panels/plot-map.lua`).
* Opening an older database adds the `Agent` column in the editor's copy; Export
  SQL then includes the same idempotent schema step.

## Mobs and boss patterns

Mobs and bosses use only the `boss_patterns` primitives the API runs
(`enemies.go`, `zone_script.go`, `mob_shots.go`, `mob_casts.go`): **zone**,
**soak**, **projectile**, **spawn**, **suicide** and **effect**.

* **Mob fields**: Name, ATK, sprite, HP, Range, CanMove, XP, Width, Height,
  Attributes, AttackSpeed (if the database has it), KnockbackResist (0 = full
  knockback from player hits, 1 = immune; bosses are 1 after the 2026-10-20
  boss-knockback migration, which the editor also applies to an older copy
  it opens and includes in Export SQL), HitEffect (a dropdown: what comes off
  the mob when hit or killed - blood, wood, stone, crystal, ice, bone, slime,
  ichor, ectoplasm, water, metal, embers, leaf, pulp or none; the client falls
  back to blood for anything else. The 2026-10-22 hit-effects migration sets
  every mob by what it is made of; the editor applies it to an older copy too
  and includes it in Export SQL), Spawns in day and Spawns at night
  (`SpawnsDay` / `SpawnsNight`, two boxes, both ticked for every mob after the
  2026-10-25 day-night-spawns migration, which the editor also applies to an
  older copy). A day on the world clock is 30 minutes: day 06:00-18:00, night
  18:00-06:00. A spawner waits for its mob's time, and a mob caught out when
  the time turns fades away once it is out of combat, with no loot or XP.
  Leave both ticked for a mob that is always about. Renaming moves the mob's map
  spawns (`world.Enemy`) along. Delete is refused while it is placed on the map;
  otherwise its loot, legacy spells and patterns go with it. It is also
  refused while another mob's spawn primitive summons it. Legacy
  `enemySpells` are listed read-only (the 2026-10-20 spells-to-patterns
  migration converts them all except Cube's unimplemented "Spawn on Death").
* **Primitives**: + Zone, + Soak, + Projectile, + Spawn, + Suicide, + Effect or a preset; each has a form, Duplicate,
  Remove and up/down. **Save patterns** writes them as one JSON array in one
  `boss_patterns` row for that enemy (its lowest existing row id is kept; new
  rows start at 2000). Fields at their default are left out, so old rows
  round-trip unchanged.
* **Every primitive** (the generic cast system):
  * `every` (seconds between casts), `first` (seconds after aggro before the
    first cast; blank = 1 s, as before)
  * `castTime` seconds the mob casts first (0 / blank = instant; fractions
    allowed; max 10). While casting the mob does not move or attack (server
    side), and only one cast runs at a time: a primitive due mid-cast waits a
    second. A zone's `windup` is still its telegraph after the cast lands.
    Projectiles: castTime replaces the older `cast` key (still read); with
    neither they cast for 0.5 s.
  * `interruptible` (off = locked: nothing can interrupt it). The API's
    `interruptCast(instanceID)` cancels an interruptible cast and the client
    shows the bar breaking; no player ability calls it yet.
  * `name`: cast bar label (defaults: Zone, Soak, Web/Shot, Summon,
    Self-destruct, Curse).
  * In game a cast bar shows over the mob: name, seconds left, blue when it can
    be interrupted, grey with a lock when locked. The card header shows the
    same as a pill.
* **Zone**: every, damage, duration, radius, maxRadius, windup, once, tile.
* **Zone scripting** (all optional; a zone with none is the original single zone):
  * `count`, `formation` (ring, line, spread, list), `spacing`, `offsets`
    (`[[dx,dy],...]` for list), `anchor` (target or boss), `angle` (degrees,
    0 east, 90 south), `aim` (add the boss-to-target bearing)
  * `delay` (seconds before the first appears), `stagger` (seconds between
    each zone of the cast)
  * `move`: dir (along angle), out (away from the anchor; negative speed pulls
    in), follow (homes on the target), orbit (round the boss, `spin` deg/s),
    path (`path` waypoints from the spawn point, `loop`); `speed` tiles/s
    (default 2, max 12). Max 24 zones per cast.
* **Soak**: every, damage, duration, radius, failRadius.
* **Spawn**: `enemy` (an enemies id), `count`, `max` (live adds from this caster;
  blank = no cap), `anchor` (boss, default, or target), `formation` (blank
  round the boss = spread), `spacing`, `offsets`, `angle`, `aim`. Spots are
  chosen when the cast starts and telegraphed on the ground; walls and
  blocked tiles are skipped. Adds rise out of the ground in a spark burst over
  0.4 s, aggro'd on the caster's target, and never respawn.
* **Suicide**: the mob dies; with `damage`, players within `radius` (default
  1.5) take it as a burst.
* **Effect**: puts `effect` (Effects tab) straight on the target if it is
  within `range` (default the mob's Range); optional `visual` (`poison`).
* **Preview**: the boss in the middle and a player you can drag; zones, soaks,
  telegraphs and movement run on the server's timing (casts and damage once a
  second, movement 20 times a second). Dashed outlines are zones still waiting
  on delay/stagger (the game does not show them yet). Wheel zooms. The cast
  bar shows over the boss (grey + lock = locked, blue = interruptible);
  **Interrupt** tests an interrupt (a locked cast refuses). Spawn casts show
  their ground marks, then the adds rise in sparks (they stand still in the
  preview); a suicide leaves a dashed outline until Restart.
* Moving zones need the API and client from `new-ui` with zone scripting
  (2026-10-20). Older servers ignore the new keys and cast one still zone.

URL: `#mob/ID`.

## Effects and projectiles

The API's effects engine (`effects.go`) codes what each modifier type does;
which effects exist and their numbers are content in the `effects` table
(`content/migrations/2026-10-20-webbed-up.sql` adds it with **Webbed Up**; the
API and this editor also create it when missing).

* **Effects tab**: Name, Description (in-game tooltip), Icon (sprite picker),
  Duration (s), Stacking (`refresh`: timer restarts; `stack`: +1 stack up to Max
  stacks, modifiers per stack; `extend`: add Duration up to Duration x Max
  stacks; `ignore`: no change while active), Max stacks, Visual (client
  overlay on the affected body: `web`, `poison` or an effect sprite) and Modifiers:
  * `move_speed` `mult` (0.5 = half speed, up to 3). The server caps player
    movement by the combined multiplier and the client walks at it.
  * `stun`: no movement.
  * `dot` `damage` every `every` seconds.
  "Applied by" lists the mobs whose patterns use it; an effect in use can't be deleted.
* **projectile primitive** (Mobs tab, + Projectile or the Spider web presets):
  `every`, `castTime` (cast seconds, aim locked at its start; older rows
  say `cast`), `speed`
  (tiles/s, default 6), `range` (default 6; not cast beyond it), `radius` (hit
  size, default 0.3), `damage` (0 = effect only), `effect` (an Effects id),
  `visual` (`web`), `count` + `spread` (fan, degrees) or `formation: ring`,
  `angle`, `stagger` (ticks between shots). Walls stop shots; the first
  player touched is hit.
* The preview shows the cast line, the shots, the splat, and the effect on
  the dragged player (name, seconds left, move multiplier).

URL: `#effect/ID`.

## Effect sprites

Every primitive form has a **Look** section with a **Sprite** field (projectiles
also a **Hit sprite**): Pick sprite… opens the sprite picker on the effect art
(`assets/fx/index.json`: All effects, a chip per category such as fire, ice,
poison, lightning, web, explosion, ring, rune, smoke, missile, plus
`procedural`), with search, recent picks and hover-animated thumbnails. The
small canvas next to it plays the sprite with the red danger outline, and the
Mobs preview draws it in place. Blank = the default look.

Stored in the primitive JSON as `sprite` / `hitSprite`, e.g.
`"sprite":{"img":"assets/fx/ring-burst-fire.png","frames":8,"fps":12}`. Keys:

* `img` (a client image) or `style` (procedural, drawn in code by the client
  and here: `ringpulse`, `runes`, `shockwave`, `swirl`, `embers`).
* `frames` (cut left to right), `fw`/`fh` frame size (default: the image
  split evenly), `cols` (frames per row for a grid sheet), `fps` (10), `loop`
  (default true; false plays once and holds the last frame).
* `fit`: `radius` (one frame stretched over the circle; default for zones,
  soaks, spawn spots, bursts), `tile` (repeated at native size, clipped to the
  circle), `scale` (native size x `scale`; default for shots, splats and effect
  overlays).
* `scale`, `tint` (`#rrggbb`), `alpha`, `rot` (degrees), `spin` (degrees/s),
  `blend: "add"`, `face` (projectile turns along its path), `over` (zone/soak:
  keep the red/blue fill under the sprite).

Where it shows: zone (half strength during windup, full when it lands),
soak (under the timer pie), projectile shot, hit splat (`hitSprite`), spawn
telegraph on each spot, suicide burst (sized to Radius), effect primitive
splat on the target. The telegraph outline is always drawn on top. The API
passes the definition through (max 600 characters) and sends each distinct
sprite once per snapshot.

The Effects tab Visual takes a tag (`web`, `poison`) or a sprite (stored as
JSON or a .png path in the same column) drawn over the affected body; the
Icon picker lists the still effect icons.

`assets/fx/` is cut from the Gervais tome tiles (CC BY 3.0, credited in the
client) by the client's `tools/build_fx_sprites.py`; existing client art
(auras, smoke, webs, portals, blood, enchantment glows) is listed in place.

## Quest dialogue and portraits

* **Quest dialogue, in order** (Quests tab): every line is editable in place.
  Click the text or "edit": a growing text box opens; Enter or Save writes it,
  Shift+Enter adds a line break, Esc or Cancel drops it. The lines are all
  `quest_def` text: offer = `Offer`, "On accepting" = `Accept`, in progress =
  `Progress`, complete = `Complete`, "(step N)" = that talk step's `Line` inside
  `Steps`. Saving writes only that field to the stored quest (marked unsaved
  for Save .db / Export SQL) and to the form above; other unsaved form edits
  are left for the quest's own Save. Tokens such as `{SHIELD}` stay as typed.
  The talk step's Line box below is kept in step both ways.
* **Portraits**: the game's conversation panel shows the node's `ImgPath` if it
  is set, otherwise the speaking NPC's sprite. Each node shows "Portrait: NPC
  sprite (...)" or "override ..." with Override… / Use NPC sprite. Save node no
  longer copies the NPC sprite into the node, new nodes start blank, and
  changing an NPC's sprite clears nodes in its tree that still hold the old
  one. The NPC page lists nodes that override the portrait, with "Use the NPC
  sprite on all". `content/migrations/2026-10-20-node-portraits.sql` (API repo)
  clears the copies older editors saved.

## Reach steps and the sleep visual

- A quest step of type `reach` (walk within Radius tiles of X,Y) shows a small
  map of the world around its target with the completion radius drawn as the
  blue ring players see in game. Click a tile on it to move the target there;
  typing X, Y or Radius redraws it. "open on map" jumps to the full map. Press
  Save on the quest to store it.
- Effects tab, Visual: `sleep` makes the affected player lie down with Zs over
  their head and stand back up when it ends. Effects with a `stun` modifier
  do this by default when Visual is blank; set Visual to `none` to turn it off.

## One step, several enemies (or items)

- A `kill` or `boss` step can count more than one enemy towards the same
  Count, e.g. "Kill 10 spiders" where both Spider and Cave Spider count. Pick
  the first enemy as Target, then use **+ also counts...** next to it to add
  more; each shows as a chip (x removes it). The Text box is the label
  players see in the tracker ("Kill 10 spiders"), so write it for the group.
- `collect` steps have the same: held amounts of every listed item add up,
  and Consume takes them in list order.
- Stored inside `quest_def.Steps` as `"Targets": ["Spider", "Cave Spider"]`
  (the full list, Target first; Target is kept so older servers still count
  the first one). No extras means no `Targets` key, exactly as before. Names
  match exactly (any case), never partially. No schema change.
- The checks report any listed enemy or item that doesn't exist, and a
  `Targets` that isn't a list of names.

## Navigation

NPCs, quests and dialogue are linked both ways: an NPC lists the quests it
gives, takes hand-ins for or is a talk step in (with why, and links to each
quest line); a quest links to its giver, turn-in and talk NPCs, kill targets
(their loot page), items, prerequisite and follow-up quests, and shows its
dialogue in order. Dialogue nodes link back to the NPCs that reach them.

Every view has a URL, so Back/Forward work and links can be shared (after the
same .db is opened): `#npc/ID`, `#quest/ID`, `#quest/ID/line/Offer`,
`#quest/ID/step/N`, `#dialog/IDENTIFIER`, `#item/ID`, `#mob/ID`, `#effect/ID`, `#loot/ENEMYID`, `#map/X,Y`.

## Sprites

Sprite pickers (paint brush, mobs, NPC sprite, item image) show thumbnails of
whatever art source is selected here. The **Sprites** tab picks where art comes from:

* **Bundled** (default): `assets/` here, a copy of the client's `new-ui` art.
* **Local folder**: pick your `BrawlQuest-Client` folder for the newest art.
* **URL**: any server that serves the client folder.

The client repo is private, so GitHub raw / jsDelivr links don't work.
`assets/index.json` lists the bundled sprites for the image pickers; refresh with
`git archive` from the client and the snippet in the commit history.

## Notes

* The whole database lives in memory (about 8 MB today): fine in any modern browser.
* New quests and NPCs get ids from 1700 up, clear of the questline's 1300-1699.
* The API also has a server-backed version of this editor (`BQ_EDITOR=1`), which
  saves straight into a running server with live reload.
* The previous editor is kept in [`legacy/`](legacy/).

Local preview: `python3 -m http.server 8080`, then open http://localhost:8080/.

Tests: `node tests/mobsim.test.cjs` (preview simulator vs the API rules);
`tests/headless-*.mjs` (Playwright, see their headers), including
`headless-history.mjs` (autosave), `headless-validate.mjs` (checks) and
`headless-github.mjs` (GitHub sync against a mocked api.github.com,
`tests/github-mock.mjs`; it never talks to GitHub).
