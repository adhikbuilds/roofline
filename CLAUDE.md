# Roofline: working rules for Claude Code

Roofline is an original product built by adhikbuilds. CasaSetu is the reference we studied (docs/recon/), not something we copy:
never use their name, logo, copy, mascot or data in the product.

## Source of truth
- `PLAN.md`: the phased build plan. Execute phases in order; tick the acceptance checklist in PLAN.md as each item passes.
- `docs/recon/*-notes.md`: teardown of CasaSetu: what to replicate, what to beat, legal scope. Re-read before UI or data work.
- `docs/recon/shots/`: their screens (reference only, gitignored).

## Agents: ECC only
Never use general-purpose, Explore or Plan agents, and do not use the Workflow tool (its agents default to general-purpose).
- `planner`: break a phase into tasks before starting it (read-only)
- `architect`: schema, package-boundary and data-flow decisions (read-only)
- `code-explorer`: trace existing code before changing it (read-only)
- `tdd-guide`: writes tests first, then the code; the main builder for engine/ingest/agent packages
- `security-reviewer`: mandatory on every phase that touches auth, user input, PII, uploads, webhooks or API routes, and before every push
- `doc-updater`: README, docs/CODEMAPS at the end of each phase
Run independent agents in parallel. ECC agents have no web access: verify any vendor/API claim yourself (WebFetch) before relying on it.
Load the `frontend-design` skill before any UI work, and `claude-api` before any LLM code
(default model `claude-sonnet-5-5`, `claude-haiku-5-5` for bulk extraction; the app must still work with no API key).

## Phase loop
1. `planner` → task list for the phase. 2. Build (tdd-guide for logic, you for UI wiring). 3. `pnpm verify` green
(tests + typecheck + lint). 4. Run the app and screenshot to `docs/screens/phase-N.png` (headless Chrome:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1440,2400 --screenshot=<path> <url>`),
plus a 390px-wide mobile shot. 5. `security-reviewer` when applicable. 6. `doc-updater`. 7. Commit (conventional commits) and
`git push`. Then continue to the next phase without waiting, unless blocked on a decision only the user can make.

## Environment
- Web dev server: http://localhost:3000. Postgres (docker compose): host port 5432. The sibling project uses the other ports;
  don't change these.
- pnpm workspace, Node 24, TypeScript strict, Next.js 15 App Router, React 19, Tailwind v4, Drizzle, vitest, Playwright.
- Secrets live in `.env.local` (gitignored); keep `.env.example` current. Never commit keys or real resumes/PII.
- GitHub: `origin` = github.com/adhikbuilds/roofline (private). The active gh account on this machine is a work account, so never run
  `gh auth switch`; scope commands with `GH_TOKEN=$(gh auth token -u adhikbuilds) gh ...`. Commits use the repo-local
  adhikbuilds noreply identity, and `git push` authenticates through a repo-local credential helper; both are already configured.

## Legal guardrails
- No scraping or hot-linking of NoBroker, MagicBricks, Nestaway, Housing or any portal, and no calls to casasetu.com/api.casasetu.com.
  Data = synthetic Bangalore seed + `SourceAdapter` for licensed feeds / owner submissions. Images must be license-free or generated.

## When PLAN.md and this file disagree
This file wins on process: who builds what, the agent roster, git, ports. PLAN.md wins on product scope and acceptance criteria.
UI is built by the main session after loading `frontend-design`; `tdd-guide` owns logic plus its tests.
