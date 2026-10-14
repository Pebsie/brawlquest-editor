# BrawlQuest Content Editor

Static, browser-only editor for BrawlQuest's `bq-content.db`. It uses
[sql.js](https://sql.js.org/) (SQLite in WebAssembly): the database is opened,
edited and saved in your browser tab. Nothing is uploaded.

Live: **https://tomlock.me/bq-editor/** (also https://tomlock.me/brawlquest-editor/)

## Use

1. **Open .db** (or drop the file on the page): a `bq-content.db`. Never `bq-users.db`.
2. Edit in the tabs:
   * **Map**: tile sprites, NPCs, mob spawns, quest reach points. Drag NPCs and
     mobs, place several mobs of a type, erase spawns, paint ground / object /
     collision / area names.
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

## Sprites

The **Sprites** tab picks where art comes from:

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
