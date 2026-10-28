# Balance guide (Mobs tab)

Under every mob's form. Pick the level you want the mob to sit at and it shows
what a player of that level has, what happens when they fight your mob with
the numbers in the form right now, and HP / ATK ranges for five bands. A chart
puts the mob among every other mob that fights back.

## Where the numbers come from

The game's own rules are copied from the API (`BrawlQuest-API`, branch
`new-ui`) into `balance.js`, one function each, with a comment naming the Go
function:

| What | Go | Rule |
|---|---|---|
| Your swing | `enemies.go meleeHitDamage` | round((weapon + enchant) x (1 + STR/(STR+40)) + STR/10) x order, at least 1 |
| Crits | `enemies.go` | 1 swing in 5 does double |
| Armour | `players.go mitigateArmor`, `armorK` | taken = ATK x K / (armour + K), K = 12 + 4 x ATK; x2 for a boss (Old World Crystal in its loot), x1.5 when exotic |
| Its strikes | `enemies.go enemyConeStrike` | AttackSpeed hits a second; ranged mobs (Range > 1) half that |
| Things that cannot move | `enemies.go` | lose 1 HP a swing (pickaxes excepted) |
| Your HP | `players.go getMaxHP` | 100 + 10 x STA + 5 x STR (orders differ) |
| Points to spend | `players.go cpGains` | per level, 1/1/1 at the start |
| Kill XP | `players.go givePlayerXP` | XP / your level, rounded down; nothing if that is 1 or less |
| Levels | `players.go xpPerLevel`, `maxLevel` | 400 XP each, level 40 cap |
| Exotic spawns | `enemies.go` | 1 in 10: 3x HP, double XP |
| Speeds | `movement.go` | you walk 2.5 tiles/s, sprint 1.4x; mobs `enemies.Speed` (1 by default, 0.25 to 6) |
| Passive | `enemies.go passiveCalmTicks` | never starts a fight; calms after 8 s left alone |
| Sleeps at night | `sleep.go` | 18:00 to 06:00 asleep, aggro range 0; a hit or a sprint within 3 tiles wakes it dazed for 1 s. The guide calls it an optional fight at night |

The API's `testdata/balance_cases.json` is written by those Go functions
(`TestBalanceCases`); `tests/balance-cases.json` here is a copy and
`node tests/balance.test.mjs` checks `balance.js` against every case. When the
server maths changes, the Go test fails until the file is regenerated
(`go test -run TestBalanceCases -update-balance .`); copy it here and fix
`balance.js` until this test passes too.

## The model (assumptions)

* **Stage.** A mob's level is, in order: the lowest Level of the quests that
  ask you to kill it; the quest levels of the zones it is placed in on the map;
  or, failing both, the first level at which its numbers make a fair fight. The
  chips show each; tap one, or drag the slider.
* **The player** is a melee build with no order: character points split evenly
  between STR and STA, and in each slot (weapon, head, chest, legs) the
  strongest piece whose level requirement (`Worth`) they meet and that can be
  had at all: a drop, a craft, a quest reward or the starting kit. Staves,
  pickaxes, rods and the trident are left out. "A few levels behind" (the
  default) caps the gear at five levels under theirs; "the best they can get"
  does not. Shields only count while blocking, so they are left out.
* **Swings.** A swing costs 10 stamina and standing still refills 20 a second,
  so 2 swings a second is what anyone can keep up; crits make that 1.2x on
  average. Every swing lands.
* **Its hits.** 3 in 4 land (knockback, stepping back and wind-ups), as the
  bots assume (`botai FightCost`).
* **Packs.** Fighting n at once: n times as long, and the damage of
  1 + 2 + ... + n of them as they drop one by one.
* **Bands.** By seconds to kill one and how many of its hits would kill you;
  the harder of the two decides:

  | Band | Seconds | Its hits to kill you |
  |---|---|---|
  | Easy | up to 3 | 40 or more |
  | Fair | 3 to 7 | 15 to 40 |
  | Tough | 7 to 15 | 7 to 15 |
  | Elite | 15 to 40 | 3 to 7 |
  | Boss | 60 to 240 for a group of 4 | 2 to 5 (through double armour) |

  The suggested HP and ATK ranges are these turned round for the player at the
  chosen level. Tap a band to put its middle into the form.

## Gaps

* Orders (Warrior, Stoic, Mage), mages' bolts, enchantments, potions, spells,
  auras and boss patterns are not in the sums; patterns have their own preview.
* Gear from bosses counts once its level requirement is met, even though few
  people have it then.
* Shops are not in the content database, so bought gear is not seen.
* Zones whose quests span the whole game (Squall's End, 1 to 40) give a
  middling level; the quest chip is usually the better guide.
* The chart's "out of line" list is a prompt, not a verdict: no XP at its level,
  150+ kills a level, gone in one swing, or past elite for an ordinary mob.
