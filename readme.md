# ReadZen for Reddit

A [Devvit](https://developers.reddit.com/) (Reddit Developer Platform) app that brings the
**ReadZen** bilingual Chan/Zen canon into Reddit — read a koan or passage in Chinese and English,
compose a substantive post around it, and expand ReadZen links other people paste, all inside a
Reddit post that looks and reads like native subreddit content.

Companion to the [ReadZen](https://readzen.pages.dev) web reader and the desktop CBETA translation
tool. Text is fetched **live** from the public, CC-licensed corpus on GitHub — the app never bundles
or forks the corpus, so it stays current.

## What it does

- **Bilingual reader** — a passage renders as the source Chinese + the English translation, aligned
  line-by-line from the underlying TEI documents, in a scrollable post that reads like native
  Reddit selftext.
- **Composer** — open the hub post → search the canon (titles + Zen masters) or pick a classic
  Wúmén guān case → choose a line range → write **your own title and a substantive commentary**
  (≥200 words) → post it **as yourself** (`runAs: 'USER'`). The quoted passage is rendered as a
  Markdown blockquote with a cite line; your commentary follows as ordinary paragraphs.
- **Link ingestion** — an *Expand in ReadZen* menu action on any post or comment finds ReadZen
  links (from the website or the desktop app, parsed forgivingly) and renders them as a reply or a
  new post.
- **Old-Reddit / crawler friendly** — every post carries a full Markdown `textFallback`, so the
  content is legible without the webview.

## Architecture

Devvit **Web** (a webview client + a serverless Node server the platform hosts):

- `src/client/` — the post webview (reader + composer), plain TS bundled by esbuild to `public/*.js`.
- `src/server/` — request router (`server.ts`), the live GitHub content provider + TEI parser
  (`content/`, using `linkedom` server-side), the search engine (`search/`, `data/`), link
  ingestion (`ingest.ts`), and Redis helpers (`db.ts`).
- `src/shared/` — code used by both sides: route parsing (`route.ts`, mirrors the desktop
  `ZenUriParser`), the forgiving link extractor (`extract.ts`), the word counter (`words.ts`), and
  the curated cases list (`cases.ts`).
- `public/` — the webview HTML + bundled Reddit Sans (OFL).
- `devvit.json` — entrypoints, permissions, menu items, forms, and triggers.

**Data sources** (server-side fetch only; the webview client cannot fetch external hosts):

- `raw.githubusercontent.com/Fabulu/CbetaZenTranslations` — TEI source + translations, `titles.jsonl`,
  `masters.json`, master appearance shards, and the published Zen termbase. *(Approved fetch host.)*
- `readzen.pages.dev` — the sharded full-text search index (built and deployed with the website).
  *(Fetch approval pending; full-text search is gated on it.)*

**Notable constraints**

- Commentary and the parsed TEI line-map are cached in Redis; post-scoped data is purged on
  `onPostDelete` and every cache write carries a TTL (see `db.ts`).
- Posts are attributed to the invoking user; there is no silent app-attribution fallback
  (`STRICT_USER_ATTRIBUTION`). `runAs: 'USER'` requires `permissions.reddit.asUser` to be
  **provisioned by a fresh install**, not just declared in `devvit.json`.
- Styling targets native shreddit selftext (RPL neutral tokens, Reddit Sans, system CJK fallback);
  see the `--rz-*` token block in `public/reader.html`.

## Development

Requires **Node ≥ 22.6** (the test runner uses `--experimental-strip-types`).

```bash
npm install
npm run playtest r/<your-test-sub>   # watch + build + upload + install to a test subreddit
npm run build                        # build client + server bundles
npm run test                         # types (tsc) + lint (biome) + unit tests + build
npm run lint                         # biome check
npm run format                       # biome fix
```

`npm run playtest` must run from this directory against a subreddit you moderate. External fetch
domains declared in `devvit.json` require Reddit admin approval before they resolve at runtime.

## Legal

Privacy Policy and Terms are published at
[readzen-legal.pages.dev](https://readzen-legal.pages.dev/) and linked inside the app (required for
a fetch-enabled Devvit app).

## License

Application code: BSD-3-Clause (see `LICENSE`). Bundled Reddit Sans is under the SIL Open Font
License (`public/fonts/OFL.txt`). The Chan/Zen corpus it displays is fetched at runtime from its own
CC-licensed repositories and is not part of this repository.
