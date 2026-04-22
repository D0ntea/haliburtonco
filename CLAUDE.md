# haliburtonco.com — operating notes for Claude

## What this project is

Marketing site for **Haliburton NDT Engineering Consultants, LLC** — a veteran-owned, aerospace-focused NDT consultancy. Built with Astro, deployed on Vercel, source at `D0ntea/haliburtonco` (private).

## Voice and positioning

- **Audience**: aerospace OEMs, MROs, defense primes, additive/composite shops. Engineering buyers, not marketers.
- **Tone**: spec-sheet editorial. Reads like trade-journal documentation, not startup marketing copy. Calm, exact, credential-forward.
- **Founder**: Dontea Haliburton. Public titles only — *FAA Accountable Manager, Quality Director, Responsible Level III*. Based in Denver, CO.
- **NEVER reference** Dontea's current employer (Intermountain Testing / Applied Technical Services / SGS) anywhere in site copy. Day-job stays off-site.
- **Legal name**: "Haliburton NDT Engineering Consultants, LLC". Magazine printed "Inc." — that was a print error. Always LLC.
- **Contact email**: `contact@haliburtonco.com`. The `info@haliburton-ndt.com` address that may appear in older Notion records is **outdated** — do not use.
- **No phone number on the site** (intentional, removed 2026-04-21).

## Design system — non-negotiable defaults

This site has a deliberate Swiss / spec-sheet editorial direction. Before any frontend edit, **read `src/styles/tokens.css`** and stay inside the system. Do not introduce new fonts, new accent colors, or new spacing values without a stated reason.

- **Typography**: `Inter` (variable) for everything text. `JetBrains Mono` for credential pills, eyebrow labels, button labels, and standards strings. **No serif.**
- **Color**: bone background `#F5F2EA`, near-black ink `#1A1A1A`, oxidized-red accent `#B34030`. The accent is used sparingly — eyebrow numerals, section dividers, current-page underline, hover states.
- **Spacing**: modular scale via `--space-1..8`. Sections separate with `--space-7` to `--space-8`.
- **Type scale**: fluid via `clamp()`. Headings use the tokens (`--text-h1`, `--text-h2`, etc.) — never hard-coded sizes.
- **Pattern language**: every section opens with a numbered eyebrow (`§ 01`) in mono with a red accent rule. Display H1 with tight tracking. Generous white space. Strong horizontal rules between sections. Body text capped at `--measure` (64ch).
- **Credential pills**: wrap any cert number, standard code, or technical identifier in `<span class="cred">` so it renders mono.

## Before any frontend change

State the design move in one sentence before editing. If you can't justify the change inside the system above, propose extending the tokens deliberately rather than one-off overrides. Do not ship default-looking CSS.

## Editing workflow

```sh
cd ~/Documents/haliburtonco
npm install         # first time only
npm run dev         # http://localhost:4321
# edit src/pages/*.astro
git add -A && git commit -m "..." && git push
# Vercel auto-deploys from main
```

Changes go live within ~30s of push. No manual deploy needed (GitHub integration is wired).

## Source-of-truth content

All page copy lives in `src/pages/*.astro` directly. There is **no headless CMS**. The user's content of record is in Notion (Mind Matrix OS / HNEC database) — pull from there for context, but the site copy is committed source.

When updating copy:
1. Read the relevant page file.
2. Edit only the strings being changed; do not refactor the layout in the same commit.
3. Build (`npm run build`) before pushing — surface any type or template errors locally.

## Service-line spec

Five canonical services (committed to `src/pages/services.astro`):

1. Ultrasonic & Phased-Array — PAUT / TFM / FMC
2. Magnetic-Particle & Penetrant — MT / PT
3. Eddy-Current & Eddy Current Array — ET / ECA
4. Level III Quality & Consulting — NAS 410, ISO 9712, NADCAP AC7114, AS9100, ISO 9001
5. Classroom Formal Training — ASNT SNT-TC-1A and NAS 410 (HNEC's primary current revenue stream)

Engagement models: Mobilized Field Crew · Embedded Technician · Data-Only Review · POD & Reliability · Training Engagement.

## What this site is NOT

- Not a blog or content marketing surface.
- Not a portfolio of past clients (NDA-bound).
- Not a sales-funnel / landing-page / lead-magnet site.
- Not a brochure with stock photography.

It's a credential-forward consultancy presence for buyers who already know what NDT is and are evaluating whether to work with HNEC.
