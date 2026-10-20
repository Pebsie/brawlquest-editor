# BrawlQuest Content Editor

Static, browser-only editor for BrawlQuest's `bq-content.db`. It uses
[sql.js](https://sql.js.org/) (SQLite in WebAssembly): the database is opened,
edited and saved in your browser tab. Nothing is uploaded.

Live: **https://tomlock.me/bq-editor/** (also https://tomlock.me/brawlquest-editor/)

## Use

1. **Open .db** (or drop the file on the page): a `bq-content.db`. Never `bq-users.db`.
2. Edit in the tabs:
   * **Map**: tile sprites, NPCs, mob spawns, quest reach points, plots.
     * **Paint tiles**: the brush has Ground, Object (keep / paint / clear),
       Collision, Area and a size (1, 2, 3, 5). Pick sprites from the
       thumbnail grid (search, folders, "On the map" by use, recently used).
       Edits show as you draw; they are stored when you let go. Alt-click a
       tile to copy its ground and object. "Show collision" / "Show area
       names" overlays.
     * **Place mobs**: pick the enemy from a thumbnail grid, click to place.
     * **Select**: drag NPCs and mobs; "Change sprite..." / "Change..." open a
       sprite picker for the NPC or the mob on that tile.
     * **Plots** (see below).
   * **Quests**: title, text (offer, accept, in progress, complete), steps
     (kill, boss, collect, talk, reach, use, craft, equip, level), rewards,
     prerequisites, levels. Needs the questline migration (`quest_def`).
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
3. **Save .db** downloads the edited database. Back up the server's copy, replace
   `bq-content.db` with it and restart the API.
4. **Export SQL** gives the same edits as a migration (keyed, safe to apply twice)
   for `content/migrations/`.

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
(`enemies.go`, `zone_script.go`): **zone** and **soak**.

* **Mob fields**: Name, ATK, sprite, HP, Range, CanMove, XP, Width, Height,
  Attributes, AttackSpeed (if the database has it). Renaming moves the mob's map
  spawns (`world.Enemy`) along. Delete is refused while it is placed on the map;
  otherwise its loot, legacy spells and patterns go with it. Legacy
  `enemySpells` are listed read-only.
* **Primitives**: + Zone, + Soak or a preset; each has a form, Duplicate,
  Remove and up/down. **Save patterns** writes them as one JSON array in one
  `boss_patterns` row for that enemy (its lowest existing row id is kept; new
  rows start at 2000). Fields at their default are left out, so old rows
  round-trip unchanged.
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
* **Preview**: the boss in the middle and a player you can drag; zones, soaks,
  telegraphs and movement run on the server's timing (casts and damage once a
  second, movement 20 times a second). Dashed outlines are zones still waiting
  on delay/stagger (the game does not show them yet). Wheel zooms.
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
  overlay on the affected body: `web`) and Modifiers:
  * `move_speed` `mult` (0.5 = half speed, up to 3). The server caps player
    movement by the combined multiplier and the client walks at it.
  * `stun`: no movement.
  * `dot` `damage` every `every` seconds.
  "Applied by" lists the mobs whose patterns use it; an effect in use can't be deleted.
* **projectile primitive** (Mobs tab, + Projectile or the Spider web presets):
  `every`, `cast` (telegraph seconds, aim locked at its start), `speed`
  (tiles/s, default 6), `range` (default 6; not cast beyond it), `radius` (hit
  size, default 0.3), `damage` (0 = effect only), `effect` (an Effects id),
  `visual` (`web`), `count` + `spread` (fan, degrees) or `formation: ring`,
  `angle`, `stagger` (ticks between shots). Walls stop shots; the first
  player touched is hit.
* The preview shows the cast line, the shots, the splat, and the effect on
  the dragged player (name, seconds left, move multiplier).

URL: `#effect/ID`.

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
`tests/headless-mobs.mjs`, `tests/headless-effects.mjs` and `tests/headless-map-plots.mjs` (Playwright, see their headers).
