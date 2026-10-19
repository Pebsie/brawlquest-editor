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

## Navigation

NPCs, quests and dialogue are linked both ways: an NPC lists the quests it
gives, takes hand-ins for or is a talk step in (with why, and links to each
quest line); a quest links to its giver, turn-in and talk NPCs, kill targets
(their loot page), items, prerequisite and follow-up quests, and shows its
dialogue in order. Dialogue nodes link back to the NPCs that reach them.

Every view has a URL, so Back/Forward work and links can be shared (after the
same .db is opened): `#npc/ID`, `#quest/ID`, `#quest/ID/line/Offer`,
`#quest/ID/step/N`, `#dialog/IDENTIFIER`, `#item/ID`, `#loot/ENEMYID`, `#map/X,Y`.

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
