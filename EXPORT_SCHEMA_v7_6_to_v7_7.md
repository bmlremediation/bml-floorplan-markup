# Export schema diff — markup app v7.6 → v7.7 (Jordan 13 Nov 2026)

**Added: one key. Removed / renamed / re-typed: none.**

| Path | Type | Meaning |
|---|---|---|
| `property.asbestos_tests` | number | How many asbestos identification tests (suspect linings, pre-cutting). The count Jordan enters when **Asbestos testing** is ticked; `0` when it is not ticked or no count is entered. |

- **New flag:** `ASBESTOS_TEST_COUNT_NOT_SET` (FLAG, non-blocking) when Asbestos testing is ticked with no count.
- **Engine readiness:** `quantify_quote.py` already reads `property.asbestos_tests`: a count prices `asbestos_tests × asbestos_test_each`; `0` gives the test line at quantity 0 ("count confirmed on site"), as before. `rulings_sheet.py` reads it too. Found by the engine repo's `00_Engine/check_markup_app.py` contract report (engine read the key, no app export carried it).
- **Old jobs:** no `asbestos_tests` key → exports `0`, exactly the v7.6 behaviour.
- **Unchanged:** `markup_convention`, every other key and flag code. `source` reads `bml-floorplan-markup v7.7`; a `v7_7_model` string describes the change.
- **Checked by:** `tests/item10_asbestos_tests.test.mjs` (5 tests) and `check_markup_app.py`.
