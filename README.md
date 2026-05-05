# Stitch Public Demo

Static GitHub Pages demo for Stitch, a developer API for rendering natural multi-speaker conversations from structured dialogue.

This repo contains only the public demo page and exported proof clips. The private Stitch engine, Studio tooling, API server, environment files, and source goldens stay in the main Stitch repository.

## Local Preview

Open `index.html` directly, or serve the folder with any static file server.

## Updating

From the private Stitch repo:

```sh
npm run demo:build-pages
```

Then copy the generated `artifacts/github-pages-demo/` contents into this repository and push `main`.
