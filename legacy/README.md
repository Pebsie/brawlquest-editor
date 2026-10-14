# BrawlQuest Content Editor

Browser-only editor for BrawlQuest **`bq-content.db`** (catalogue data). Load a SQLite file, edit in memory with sql.js, download the modified database. No server backend, no passwords, no player data.

**Never** load or ship `bq-users.db`, Firebase keys, or live player data.

## Live

Prefer **https://tomlock.me/brawlquest-editor/** (same custom-domain pattern as the armoury), else https://pebsie.github.io/brawlquest-editor/

## Use

1. **Load sample** (bundled content catalogue) or **Open file** your own `.db` / `.sqlite`.
2. Edit via the tabs: Items, Enemies (spells + loot), NPCs (routines), Quests, Dialogue, World, Loot, Craft, Forge.
3. **Download database** — validates references first. Edits are UPDATE/INSERT on the existing schema (never recreate tables or renumber ids).
4. Deploy the file to the game server, then **restart the API** or **GET /refresh**. Only `POST /world` writes content at runtime; the client never opens SQLite.

## Editors (v1)

| Tab | What |
|-----|------|
| Items | All fields; Types/Subtypes; Attributes `None` or `STAT,N` |
| Enemies | Stats + spells + per-enemy loot; rename updates `world.Enemy` / kill quests |
| NPCs | Conversation start Identifier, spawn, routines/nodes |
| Quests | kill / gather / go; giver/return NPCs; ItemsGiven JSON |
| Dialogue | Tree/graph; Options single-quoted arrays; ItemsGiven; Identifier rename refactor |
| World | Canvas paint/select; Ground/Fore/Name/Music/Collision/Enemy; XY unique |
| Loot | Global drop table |
| Craft | Result ItemID + ingredients JSON + Chance |
| Forge | EnterID → ResultID |

`mobs`, `tiles`, and `recipeItems` are empty/unused in the live game (mobs spawn from `world.Enemy`).

## Formats (must match the game)

### Options (conversation)

Not strict JSON — single-quoted nested arrays:

```text
[['Heard any rumours?','npc-priest-2'],['Forgive me Father...','npc-priest-3']]
```

- Second value = next `Identifier`, or `'1'` to end.
- The client replaces every `'` with `"` then JSON-decodes. Straight apostrophes/double-quotes in labels break parsing; the editor converts them to curly quotes on save.
- `NPC.Conversation` = starting Identifier string (e.g. `npc-priest-1`).

### ItemsGiven / craft Items

Strict JSON: `[{"Amount":1,"ItemID":9},{"Amount":-5,"ItemID":11}]` — negative Amount is a cost.

### Other

- Bools as `0`/`1`. Empty strings `""` not NULL. Attributes/Subtype use `"None"` not empty.
- Quest Type: `kill` | `gather` | `go`. Value = enemy **Name** (kill) or item **Name** (gather). `go` = within 4 tiles of quest X,Y.
- Loot Chance: integer percent (`rand.Intn(100) < Chance`). AmountVariance `0` treated as `1`.
- World keyed by unique `X,Y`. Enemy is enemy Name; empty spawn is `""`.

## ID / rename pitfalls

Append new ids (`MAX(id)+1`). **Never renumber.** Hardcoded item ids include starter gear 1–3, fish drop 23, Old World Crystal 53, Crystal Fragment 135, reputation currencies 116–118. Renaming enemies/items/Identifiers is a refactor — the editor updates known references or asks before proceeding. `bq-users.db` also holds FKs outside this file.

## Item picker & assets

Every ItemID field uses a searchable picker (icon + name + id). Pixel art is served from bundled `assets/` (paths match game `ImgPath`). Override the asset base URL in the header if you host images elsewhere (e.g. the armoury asset root).

## Local preview

```bash
cd brawlquest-editor && python3 -m http.server 8080
```

Open http://localhost:8080/

## Tech

Static GitHub Pages site. [sql.js](https://sql.js.org/) (WASM) in `vendor/`. Sample catalogue in `sample/sample-content.db`.
