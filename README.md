# haliburtonco.com

Marketing site for Haliburton NDT Engineering Consultants, LLC.

Built with [Astro](https://astro.build) — static HTML, vanilla CSS, deployed on Vercel.

## Local development

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # output to ./dist
npm run preview      # preview the production build
```

## Structure

```
src/
├── components/      # Header, Footer, Eyebrow
├── layouts/         # Layout shell
├── pages/           # one .astro per route
└── styles/          # tokens.css, base.css
public/              # favicon and other static assets
```

## Editing content

All page copy lives directly in `src/pages/*.astro`. Edit, save, the dev server hot-reloads. Commit and push — Vercel auto-deploys on push to `main`.

## Design tokens

`src/styles/tokens.css` holds the design system: bone background, near-black ink, oxidized-red accent, Inter + JetBrains Mono pairing, fluid typography scale, modular spacing.
