# Export schema diff — markup app v7.5 → v7.6 (Jordan 13 Nov 2026)

**Re-typed: one key.** `property.contents_inventory` was a boolean; it is now `"included"` | `"optional"` | `false`.

| Value | Meaning | Engine reads it as |
|---|---|---|
| `"included"` | Contents inventory priced in the base quote | `quantify_quote.inventory_mode()` = `included` (priced base line) |
| `"optional"` | Contents inventory quoted as an `#OPTIONAL#` line | `optional` (`#OPTIONAL#` line, outside the base) |
| `false` | Not selected | `None` (spec 19 default: optional) |

- **Old jobs:** a PROJECT file saved before v7.6 holds `true` or `false`. `true` loads and exports as `"included"` (Jordan: a tick means the base price), `false` as not selected. Nothing is dropped.
- **Engine readiness:** engine v7.59 (13 Nov 2026) reads `true`, `"included"` and `"optional"`, so it prices a v7.5 or a v7.6 export correctly. Merge order is safe either way.
- **UI:** the "Contents inventory" checkbox becomes a selector beside "Contents storage": not selected / included (base price) / optional. The quantities panel shows the choice.
- **Unchanged:** `markup_convention`, every other key, every flag code. `source` reads `bml-floorplan-markup v7.6`; a `v7_6_model` string describes the change.
- **Checked by:** `tests/item9_contents_inventory.test.mjs` (5 tests) and the engine repo's `00_Engine/check_markup_app.py` (app tests, 7 fixture exports through `markup_export_check.py`, inventory round trip).
