# MoodlePRO — in-flight work plan

Working notes for picking this back up in a fresh session. Run `git status --short` first —
everything below is currently **uncommitted**.

## ✅ Done (implemented + tests passing)

1. **Download buttons** — summary modal (`extension/src/content/result-modal.js`) and live
   transcript sidebar (`extension/src/content/sidebar.js`) each got a client-side "Download"
   button (Blob + `<a download>`, no server round-trip). Tests: `result-modal.test.js`,
   new `sidebar.test.js`. `npm test` in `extension/` → 86/86 passing.

2. **Referral bonus system** (server):
   - `server/app/core/config.py` — `referral_bonus_lectures: int = 3`.
   - `server/app/db/models.py` — `UserReward` gained `username`, `referred_by`,
     `referral_credits` columns.
   - `server/app/schemas.py` — `UsageResponse.referral_credits`, new `ReviewClaimRequest`
     (`username`, `referred_by`).
   - `server/app/services/usage.py` — `grant_review_bonus()` now takes `username`/
     `referred_by`; on a valid (non-self) referral, both accounts get
     `+referral_bonus_lectures` once each. `get_usage()` returns `referral_credits`.
   - `server/app/api/users.py` — `POST /users/{user_id}/review` accepts the new body.
   - `server/app/db/session.py` — Postgres `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` nudges
     for the 3 new `user_rewards` columns + an index on `username`.
   - `server/tests/test_usage.py` — added referral tests (credits both sides, claimed once,
     self-referral ignored). `pytest` → 8/8 in that file, 58/58 server-wide.

3. **Referral UI** (extension):
   - `extension/src/shared/api-client.js` — `claimReview(userId, { username, referredBy })`
     now POSTs a JSON body.
   - `extension/src/content/quota-prompt.js` — redesigned: bigger review CTA, a referral
     callout line, two optional inputs ("your Moodle username" / "who invited you"), success
     message distinguishes plain review bonus vs. review+referral bonus.
   - `extension/src/content/inject.js` — `onReviewed` now forwards `{username, referredBy}`
     to `api.claimReview` and returns the usage payload back to the prompt.
   - All wired end-to-end; `inject.test.js`'s quota-prompt test still passes unmodified.

4. **Feedback button copy** — `extension/src/content/feedback.js` button text is now the
   exact verbatim copy requested: `קבלו עוד הרצאות ע"י השארת ביקורת ⭐`.

5. **Unlimited-quota allowlist** — self-reported usernames `leonovt`/`prives`
   (case-insensitive, honor system) are never quota-gated, from the first lecture:
   - Server: `usage.set_username()`, `_is_unlimited()`, `check_and_reserve()` skips the quota
     check when unlimited, `get_usage()` returns `unlimited: bool`.
   - `schemas.UsageResponse.unlimited`, new `POST /users/{user_id}/username` endpoint.
   - Extension: `api-client.setUsername()`, new `username-setup.js` (one-time dismissible
     prompt, gated on a `moodlepro_username` localStorage key, wired into `inject.js`'s
     `main()`), `usage-badge.js` renders `🎓 ∞` when unlimited.
   - Tests: `test_usage.py` (+3 tests, 61/61 server-wide), `username-setup.test.js` +
     `api-client.test.js` (90/90 extension-wide).

6. **Real review URL** — the hub02 review link (`.../tools/6413fd4c-...`) replaced the
   temporary placeholder in `feedback.js` (also used by `quota-prompt.js`); `feedback.test.js`
   now imports `REVIEW_URL` instead of hardcoding it, so it can't drift again.

7. **Landing page review button** — `index.html` hero now has a secondary "⭐ השאירו ביקורת"
   button (`.cta-secondary` style) next to the install CTA, linking to the same hub02 URL.

## 🚧 Not started — landing page review/referral section

User asked to make the review CTA "clearer/bigger" on the landing page; a button now exists
(see #7) but there's no dedicated section explaining the incentive yet. Still needed:
- A section near the hero or reviews mentioning both bonuses explicitly (leave a review →
  +5 lectures; name who invited you → +3 for both), mirroring the extension's copy.

## ❓ Needs clarification before starting

- User's message: *"can we improve the solve button better model and look in the internet
  for more context to use"* — never clarified. Unclear which button ("solve"?) or which model
  (quiz/summary LLM?) this refers to. Ask the user directly what this means before touching
  anything.

## 📋 Backlog ideas (discussed, not committed to — revisit only if asked)

- Per-chapter summaries (build on `chapters.js`).
- Click a transcript line in the sidebar to seek the video (reverse of current sync).
- Spaced-repetition re-asking of previously-missed quiz questions (`gradeAdvice`'s `missed`).
- Multi-lecture / whole-course summary digest.
- Resume-playback-position memory per lecture.
- Cross-video transcript search (previously discussed as the top pick, not started).

## Useful context for whoever resumes this

- No alembic — schema changes ship via `Base.metadata.create_all` + manual
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` nudges in `server/app/db/session.py::init_db`
  (Postgres only; SQLite test DBs start fresh each run).
- Whole review/referral/unlimited system is **honor system by design** — no verification
  that a typed username is real. Matches the existing review-bonus trust model.
- Run extension tests: `cd extension && npm test`. Run server tests:
  `cd server && python -m pytest -q`.
