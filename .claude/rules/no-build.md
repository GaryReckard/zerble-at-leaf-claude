# No build step

This project deliberately ships with no bundler, no transpiler, no PostCSS, no
asset pipeline. Plain ES modules + an importmap in `index.html`. Open the file
in a browser and it runs.

## Don't add tooling

ROADMAP.md flags a bundler as **out of scope**. Don't propose one as a
solution to perf, organization, or "modern dev experience" — the trade is
intentional. The "open `index.html` and it just works" property is a feature
of the project, not an accident.

If you genuinely believe a build step is the only way forward, raise it
explicitly with Gary and explain what specifically can't be done otherwise.
Don't quietly introduce one.

## Importmap maintenance

When you add a new source file under `src/` (or `src/models/`), you must add
its bare module name to the importmap list in `index.html`:

```js
const mods = ['main','world','zerble', /* ... */, 'midiPlayer'];
const models = ['canoe','hammock','tent', /* ... */, 'wook'];
```

Without that, the dev cache-buster won't decorate the URL with `?v=<timestamp>`
on local dev — meaning your edits won't reload (Chrome's heuristic cache holds
ES module bodies past `Cache-Control: no-store` in some cases). Production is
unaffected by the missing entry (it loads modules unsuffixed) but local dev
will silently bite you.

## Three.js comes from a CDN

`three` and `three/addons/` are pinned to unpkg `0.160.0` in the importmap.
Don't `npm install three`. Don't vendor it locally. If you need to bump,
update the URLs in the importmap and re-test on at least one mobile browser.

## Stay no-build

The point: "no build step" is one of the core constraints. Working around it
adds the moving parts the project was set up to avoid.
