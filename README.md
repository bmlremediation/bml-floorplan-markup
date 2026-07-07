# BML Floor Plan Markup (v3)

Standalone client-side markup tool: calibrate a floor plan image, mark up
remediation scope in the locked BML v2 colour convention, and export
per-room quantities as JSON for the `bml-floorplan-quantify-quote` engine.

Client-side only — no server, no backend. Floor plans and markup never
leave the browser. Autosave uses IndexedDB (per-browser convenience);
the project JSON file is the durable, cross-device record (save it into
the Drive job folder at the end of every session).

Ported from the validated v2 artifact per `docs/BUILD_SPEC.md`. The export
JSON schema and the 8-category colour palette are frozen downstream
contracts — do not change field names or hex values without also updating
the `quantify_quote.py` engine in the same change.

## Develop

```
npm install
npm run dev
```

## Deploy

Push to `main` — GitHub Actions builds and publishes to GitHub Pages.
