from common import U, A, T, S

SESSIONS = []

# ---------------- review x3 ----------------
SESSIONS.append(S("review-1", "review", "/work/accounts-api", [
    U("Review this pull request that adds password reset by email. Focus on security."),
    T("Bash", {"command": "git diff origin/main --stat"}, "src/reset/request.ts | 44 ++\nsrc/reset/confirm.ts | 61 ++\nmigrations/..sql | 8 +"),
    T("Read", {"file_path": "/work/accounts-api/src/reset/request.ts"}, "const token = Math.random().toString(36).slice(2); await db.reset.insert({email, token}); await mail.send(email, link(token)); return res.status(user ? 200 : 404)"),
    T("Read", {"file_path": "/work/accounts-api/src/reset/confirm.ts"}, "const r = await db.reset.find({token}); if (!r) return 400; await users.setPassword(r.email, pw); // token not deleted, no expiry"),
    A("Findings: tokens come from Math.random, which is predictable, and are stored in plain text; they never expire and are not invalidated after use; the 404 for unknown emails lets an attacker enumerate accounts."),
    T("Write", {"file_path": "/work/accounts-api/REVIEW.md", "content": "Blocking: use crypto random tokens, store only a hash, expire after 30 minutes, single use, always return 200.\nNon-blocking: rate limit the request endpoint; log without the token.\n"}, "created"),
], dict(
    task_type="review",
    summary="Reviewed a password reset pull request and found predictable Math.random tokens stored in plain text, no expiry or single use, and a 404 response that enables account enumeration; wrote up blocking and non-blocking comments.",
    facts=["reviewed password reset by email", "tokens from a predictable random source stored in plain text", "no expiry and not invalidated after use", "different response for unknown emails allows enumeration", "review notes written"],
    specific=["account enumeration", "predictable reset tokens", "single use expiring tokens"],
    decisions=[dict(choice="mark token generation, storage, expiry and the 404 response as blocking", reason="each lets an attacker take over or discover accounts")],
    skills=["security review", "authentication", "TypeScript"], not_skills=["Docker", "Kubernetes", "React"])))

SESSIONS.append(S("review-2", "review", "/work/data-platform", [
    U("Look over this SQL migration before we run it on the 80 million row events table. Anything dangerous?"),
    T("Read", {"file_path": "/work/data-platform/migrations/0042_add_source.sql"}, "ALTER TABLE events ADD COLUMN source text NOT NULL DEFAULT 'web';\nCREATE INDEX idx_events_source ON events(source);"),
    A("On the Postgres version we run, adding a column with a constant default is a metadata change, so that part is cheap. The plain CREATE INDEX takes a lock that blocks writes for the whole build on 80 million rows; it should be CREATE INDEX CONCURRENTLY, outside a transaction."),
    T("Bash", {"command": "psql -c \"select version()\""}, "PostgreSQL 15.4"),
    T("Write", {"file_path": "/work/data-platform/migrations/0042_add_source.review.md", "content": "Keep the ADD COLUMN. Change the index to CREATE INDEX CONCURRENTLY and move it to its own migration without a transaction wrapper.\n"}, "created"),
], dict(
    task_type="review",
    summary="Reviewed a migration for an 80 million row table: the column add with a constant default is cheap on Postgres 15, but the plain index build would block writes, so it should be created concurrently in its own non-transactional migration.",
    facts=["migration on an 80 million row table", "Postgres 15", "column with constant default is a metadata change", "plain index creation blocks writes", "recommend concurrent index in its own migration"],
    specific=["blocking lock during index build", "concurrent index creation"],
    decisions=[dict(choice="recommend CREATE INDEX CONCURRENTLY in a separate migration", reason="a plain index build blocks writes on a very large table")],
    skills=["PostgreSQL", "SQL", "database migrations"], not_skills=["React", "Docker", "Terraform"])))

SESSIONS.append(S("review-3", "review", "/work/web-shell", [
    U("Can you review the diff for the new modal component? Accessibility is what I care about."),
    T("Bash", {"command": "git diff origin/main -- src/ui/Modal.tsx"}, "+<div className='modal' onClick={close}>\n+  <div className='box'>{children}</div>\n+</div>"),
    A("Missing: role dialog and aria-modal, an accessible name, focus moved into the dialog on open and restored on close, focus trapped inside, and Escape to close. Clicking the backdrop closes it but keyboard users have no equivalent."),
    T("Read", {"file_path": "/work/web-shell/src/ui/Modal.test.tsx"}, "it('renders children')"),
    T("Write", {"file_path": "/work/web-shell/review-notes.md", "content": "Use the native dialog element or add role/aria-modal, focus trap, Escape handling, focus restore. Add tests for keyboard behaviour.\n"}, "created"),
], dict(
    task_type="review",
    summary="Reviewed a modal component for accessibility and found no dialog role, no focus management or trap, and no keyboard close; recommended the native dialog element and keyboard tests.",
    facts=["reviewed a modal component", "missing dialog role and aria-modal", "no focus trap or restore", "no escape key handling", "only a render test exists"],
    specific=["focus management", "dialog semantics"],
    decisions=[dict(choice="recommend the native dialog element", reason="it provides focus handling and escape behaviour by default")],
    skills=["accessibility", "React", "code review"], not_skills=["SQL", "Docker", "Terraform"])))

# ---------------- docs x3 ----------------
SESSIONS.append(S("docs-1", "docs", "/work/sdk-js", [
    U("Write a getting started guide for our JavaScript SDK. Someone should go from install to first successful API call in five minutes."),
    T("Read", {"file_path": "/work/sdk-js/README.md"}, "# sdk-js\nSee the API reference."),
    T("Read", {"file_path": "/work/sdk-js/src/client.ts"}, "export class Client { constructor(opts:{apiKey:string, baseUrl?:string}){...} async projects.list(){...} }"),
    T("Bash", {"command": "node -e \"const {Client}=require('./dist');new Client({apiKey:process.env.KEY}).projects.list().then(console.log)\""}, "[ { id: 'p_1', name: 'demo' } ]"),
    A("I ran the example against the sandbox first so every snippet in the guide is known to work. The guide covers install, creating a client, listing projects and the common 401 error when the key is missing."),
    T("Write", {"file_path": "/work/sdk-js/docs/getting-started.md", "content": "# Getting started\n1. npm install sdk-js\n2. Create a client with your API key\n3. List projects\nTroubleshooting: 401 means the key is missing or wrong.\n"}, "created"),
    T("Edit", {"file_path": "/work/sdk-js/README.md", "old_string": "See the API reference.", "new_string": "See docs/getting-started.md to make your first call in five minutes."}, "edited"),
], dict(
    task_type="docs",
    summary="Wrote a getting started guide for the JavaScript SDK covering install, client creation, a first call and the missing-key 401 error, after running the snippet against the sandbox to confirm it works, and linked it from the readme.",
    facts=["getting started guide", "install, client, list projects", "snippet verified against the sandbox", "401 troubleshooting", "readme links to the guide"],
    specific=["verified code samples", "task-oriented onboarding documentation"],
    decisions=[dict(choice="run the example against the sandbox before documenting it", reason="every snippet in the guide should be known to work")],
    skills=["technical writing", "JavaScript", "documentation"], not_skills=["Docker", "SQL", "Terraform"])))

SESSIONS.append(S("docs-2", "docs", "/work/platform-docs", [
    U("We changed how deploys work (blue green instead of rolling). Update the runbook so on-call knows how to roll back."),
    T("Read", {"file_path": "/work/platform-docs/runbooks/deploy.md"}, "Deploys roll one pod at a time. To roll back run `helm rollback`."),
    T("Read", {"file_path": "/work/platform-docs/adr/0031-blue-green.md"}, "Two identical environments; traffic switched at the load balancer; the old environment stays warm for 30 minutes."),
    A("Rollback is now a traffic switch back to the warm environment, not a helm rollback, and it only works for 30 minutes; after that the old environment is gone and a redeploy of the previous version is needed. The runbook must say both."),
    T("Write", {"file_path": "/work/platform-docs/runbooks/deploy.md", "content": "Blue green deploy. Rollback within 30 minutes: switch traffic back at the load balancer. After 30 minutes: redeploy the previous version. Check the health dashboard after switching.\n"}, "created"),
    T("Bash", {"command": "markdownlint runbooks/deploy.md"}, "ok"),
], dict(
    task_type="docs",
    summary="Rewrote the deploy runbook for the move from rolling to blue green deployments: rollback is now a traffic switch to the warm environment within 30 minutes, with a redeploy of the previous version after that.",
    facts=["runbook update for blue green", "rollback is a traffic switch", "old environment stays warm 30 minutes", "after that redeploy previous version", "markdown lint passes"],
    specific=["blue green deployment rollback"],
    decisions=[dict(choice="document the 30 minute window and the redeploy fallback", reason="the warm environment disappears after 30 minutes so a switch back no longer works")],
    skills=["technical writing", "runbooks", "blue green deployment"], not_skills=["Python", "SQL", "React"])))

SESSIONS.append(S("docs-3", "docs", "/work/open-source-lib", [
    U("Add docstrings to the public functions in the parser module and generate the API docs."),
    T("Grep", {"pattern": "^def [a-z]"}, "parser.py:12: def parse(text, strict=False)\nparser.py:58: def tokens(text)\nparser.py:97: def validate(tree)"),
    T("Read", {"file_path": "/work/open-source-lib/parser.py"}, "def parse(text, strict=False):\n    ...  # raises ParseError on invalid input when strict"),
    T("Edit", {"file_path": "/work/open-source-lib/parser.py", "old_string": "def parse(text, strict=False):", "new_string": "def parse(text, strict=False):\n    \"\"\"Parse text into a tree. Raises ParseError on invalid input when strict is true.\"\"\""}, "edited"),
    T("Edit", {"file_path": "/work/open-source-lib/parser.py", "old_string": "def tokens(text):", "new_string": "def tokens(text):\n    \"\"\"Yield tokens lazily.\"\"\""}, "edited"),
    T("Edit", {"file_path": "/work/open-source-lib/parser.py", "old_string": "def validate(tree):", "new_string": "def validate(tree):\n    \"\"\"Return a list of problems found in a tree.\"\"\""}, "edited"),
    T("Bash", {"command": "sphinx-build -W docs docs/_build"}, "build succeeded."),
    T("Bash", {"command": "python -m doctest parser.py"}, ""),
], dict(
    task_type="docs",
    summary="Added docstrings to the three public functions of the parser module and built the API documentation with Sphinx with warnings treated as errors; doctests pass.",
    facts=["docstrings for three public functions", "Sphinx build with warnings as errors succeeded", "doctests run"],
    specific=["docstrings and generated API reference"],
    decisions=[],
    skills=["Python", "Sphinx", "documentation"], not_skills=["Docker", "React", "Terraform"])))

# ---------------- data x3 ----------------
SESSIONS.append(S("data-1", "data", "/work/growth-analytics", [
    U("Weekly active users in the dashboard dropped 15% last week. Is that real or a tracking problem?"),
    T("Bash", {"command": "bq query 'select date, count(distinct user_id) from events group by 1 order by 1 desc limit 14'"}, "last week avg 41k, week before 48k"),
    T("Bash", {"command": "bq query 'select app_version, count(*) from events where date>=\"2026-11-12\" group by 1'"}, "4.18: 1.9M, 4.19: 0.2M  (4.19 shipped Nov 14)"),
    A("The drop starts exactly when version 4.19 shipped. Events from 4.19 are far fewer per user, suggesting the event is not fired. Active users are counted by a login event; I will check if 4.19 sends it."),
    T("Bash", {"command": "bq query 'select event_name, count(*) from events where app_version=\"4.19\" group by 1'"}, "session_start: 210k, login: 0"),
    A("Version 4.19 sends no login event, so those users are not counted as active; the drop is a tracking regression, not a real fall in usage. Counting distinct users on any event instead of login shows 47k for last week."),
    T("Write", {"file_path": "/work/growth-analytics/notes/wau-drop.md", "content": "Cause: login event missing in 4.19. Adjusted WAU on any event: 47k. Fix: restore login event; backfill is not possible.\n"}, "created"),
], dict(
    task_type="data",
    summary="Investigated a 15 percent drop in weekly active users with BigQuery and showed it was a tracking regression: app version 4.19 stopped sending the login event used to count activity, and counting on any event gives about 47k.",
    facts=["weekly active users dropped 15 percent", "drop starts with version 4.19", "4.19 sends no login event", "counting any event gives 47k", "tracking regression not real usage drop"],
    specific=["tracking regression", "cohorting by app version"],
    decisions=[dict(choice="compare event counts by app version", reason="the drop started on the day the new version shipped")],
    skills=["BigQuery", "SQL", "product analytics"], not_skills=["Docker", "React", "Terraform"])))

SESSIONS.append(S("data-2", "data", "/work/ml-churn", [
    U("Train a churn model on the last 12 months of data and tell me how good it is. Be careful about leakage."),
    T("Read", {"file_path": "/work/ml-churn/features.py"}, "features = [... 'days_since_last_login', 'cancellation_reason', 'support_tickets_30d' ...]"),
    A("cancellation_reason only exists after someone has churned, so it leaks the label. I will drop it and split by time (train on the first 9 months, test on the last 3) instead of a random split, because random splits leak the future into training for time dependent behaviour."),
    T("Edit", {"file_path": "/work/ml-churn/features.py", "old_string": "'cancellation_reason', ", "new_string": ""}, "edited"),
    T("Bash", {"command": "python train.py --split time --model xgboost"}, "AUC 0.81, precision@10% 0.46"),
    T("Bash", {"command": "python train.py --split random --model xgboost"}, "AUC 0.88 (optimistic)"),
    T("Bash", {"command": "python calibrate.py"}, "Brier 0.14 before, 0.11 after isotonic calibration"),
], dict(
    task_type="data",
    summary="Trained a gradient boosted churn model after removing a label-leaking feature and using a time based split; time split AUC was 0.81 versus an optimistic 0.88 for a random split, and isotonic calibration improved the Brier score from 0.14 to 0.11.",
    facts=["cancellation reason leaked the label and was dropped", "time based split", "AUC 0.81 on time split, 0.88 random", "isotonic calibration improved Brier from 0.14 to 0.11"],
    specific=["target leakage", "temporal train test split", "probability calibration"],
    decisions=[dict(choice="split by time instead of randomly", reason="random splits leak future behaviour into training and overstate performance")],
    skills=["Python", "XGBoost", "machine learning", "model evaluation"], not_skills=["Docker", "React", "Terraform"])))

SESSIONS.append(S("data-3", "data", "/work/warehouse", [
    U("The daily revenue dbt model got slow, 40 minutes now. Make it fast again."),
    T("Read", {"file_path": "/work/warehouse/models/daily_revenue.sql"}, "select ... from orders o join order_items i on ... join customers c on ... where date(o.created_at) = date(current_date - 1)"),
    A("The filter wraps the timestamp column in a function, which prevents partition pruning, so the whole orders table is scanned every day. A range predicate on the raw column lets the warehouse prune partitions, and the model can be incremental."),
    T("Edit", {"file_path": "/work/warehouse/models/daily_revenue.sql", "old_string": "where date(o.created_at) = date(current_date - 1)", "new_string": "where o.created_at >= current_date - 1 and o.created_at < current_date"}, "edited"),
    T("Edit", {"file_path": "/work/warehouse/models/daily_revenue.sql", "old_string": "select ...", "new_string": "{{ config(materialized='incremental', unique_key='day') }}\nselect ..."}, "edited"),
    T("Bash", {"command": "dbt run --select daily_revenue"}, "Completed in 2m 10s"),
    T("Bash", {"command": "dbt test --select daily_revenue"}, "Done. PASS=4"),
], dict(
    task_type="data",
    summary="Cut a dbt revenue model from 40 minutes to about two by replacing a function wrapped date filter with a range predicate so partitions can be pruned and making the model incremental; dbt tests pass.",
    facts=["model took 40 minutes", "function on the filter column blocked partition pruning", "range predicate", "incremental materialisation", "runs in 2m10s", "tests pass"],
    specific=["partition pruning", "incremental models"],
    decisions=[dict(choice="use a range predicate on the raw timestamp", reason="a function around the column prevents partition pruning and forces a full scan")],
    skills=["dbt", "SQL", "data warehousing"], not_skills=["Docker", "React", "Terraform"])))

# ---------------- migration x3 ----------------
SESSIONS.append(S("migration-1", "migration", "/work/portal", [
    U("Migrate the portal from Express 4 to Fastify. Keep the routes and behaviour."),
    T("Glob", {"pattern": "src/routes/*.ts"}, "src/routes/users.ts\nsrc/routes/orders.ts\nsrc/routes/health.ts"),
    T("Read", {"file_path": "/work/portal/src/routes/users.ts"}, "router.get('/users/:id', auth, async (req,res)=>{ res.json(await users.get(req.params.id)) })"),
    A("Express middleware like auth maps to Fastify hooks, and handlers return values instead of calling res.json. I will migrate route by route behind the existing integration tests."),
    T("Bash", {"command": "npm install fastify@5 @fastify/cors"}, "added 41 packages"),
    T("Edit", {"file_path": "/work/portal/src/routes/users.ts", "old_string": "router.get('/users/:id', auth, async (req,res)=>{ res.json(await users.get(req.params.id)) })", "new_string": "app.get('/users/:id', { preHandler: auth }, async (req) => users.get(req.params.id))"}, "edited"),
    T("Edit", {"file_path": "/work/portal/src/routes/orders.ts", "old_string": "router.post('/orders', auth, validate(schema), handler)", "new_string": "app.post('/orders', { preHandler: auth, schema: { body: schema } }, handler)"}, "edited"),
    T("Bash", {"command": "npm run test:integration"}, "37 passed, 2 failed: health returns 204 expected 200", True),
    T("Edit", {"file_path": "/work/portal/src/routes/health.ts", "old_string": "return reply.send()", "new_string": "return reply.code(200).send({ ok: true })"}, "edited"),
    T("Bash", {"command": "npm run test:integration"}, "39 passed"),
], dict(
    task_type="migration",
    summary="Migrated the portal routes from Express to Fastify, mapping middleware to preHandler hooks and request validation to Fastify schemas, with the integration suite guarding behaviour and one health check status difference fixed.",
    facts=["Express to Fastify", "middleware became hooks", "validation moved to schemas", "integration tests used as safety net", "health endpoint status code fixed", "39 tests pass"],
    specific=["framework migration", "middleware to hooks mapping"],
    decisions=[dict(choice="migrate route by route behind the existing integration tests", reason="behaviour must stay the same and the tests detect differences such as the health status")],
    skills=["Node.js", "Fastify", "Express", "TypeScript"], not_skills=["Docker", "SQL", "Terraform"])))

SESSIONS.append(S("migration-2", "migration", "/work/legacy-api", [
    U("Move the users table from MySQL to Postgres. About 12 million rows. Minimal downtime please."),
    T("Read", {"file_path": "/work/legacy-api/schema/users.sql"}, "CREATE TABLE users (id INT AUTO_INCREMENT, email VARCHAR(255), created DATETIME, flags TINYINT(1) ...)"),
    A("Type differences to handle: AUTO_INCREMENT becomes an identity column, DATETIME has no time zone so it must be interpreted as UTC explicitly, and TINYINT(1) flags become booleans. For minimal downtime I will bulk load a snapshot, then replay changes from the binlog until cutover."),
    T("Write", {"file_path": "/work/legacy-api/migrate/users_pg.sql", "content": "CREATE TABLE users (id BIGINT GENERATED ALWAYS AS IDENTITY, email text, created timestamptz, is_active boolean);\n"}, "created"),
    T("Bash", {"command": "pgloader mysql://old pgsql://new --with 'workers=8'"}, "12,004,311 rows copied, 0 errors"),
    T("Bash", {"command": "python verify_counts.py users"}, "mysql 12004311 postgres 12004311; checksum sample 10k ok"),
    T("Write", {"file_path": "/work/legacy-api/migrate/cutover.md", "content": "1. Pause writes 2. Replay final binlog 3. Verify counts 4. Switch connection string 5. Keep MySQL read-only for a week\n"}, "created"),
], dict(
    task_type="migration",
    summary="Prepared a MySQL to Postgres migration of a 12 million row users table: mapped types, bulk loaded with pgloader with matching counts and a checksum sample, and wrote a cutover plan with change replay and a week of read-only fallback.",
    facts=["MySQL to Postgres for the users table", "12 million rows copied with no errors", "type mapping for identity, time zone and booleans", "counts and checksum sample verified", "cutover plan written"],
    specific=["type mapping between databases", "snapshot plus change replay cutover"],
    decisions=[dict(choice="bulk load a snapshot then replay changes before cutover", reason="it keeps the downtime window short")],
    skills=["PostgreSQL", "MySQL", "pgloader", "database migration"], not_skills=["React", "Docker", "Terraform"])))

SESSIONS.append(S("migration-3", "migration", "/work/frontend-app", [
    U("Upgrade React from 17 to 18 and fix whatever breaks."),
    T("Bash", {"command": "npm install react@18 react-dom@18"}, "added 3 packages"),
    T("Bash", {"command": "npm run build"}, "error: ReactDOM.render is no longer supported in React 18", True),
    T("Edit", {"file_path": "/work/frontend-app/src/index.tsx", "old_string": "ReactDOM.render(<App />, root)", "new_string": "createRoot(root).render(<App />)"}, "edited"),
    T("Bash", {"command": "npm test"}, "3 failed: act warnings, state updates not wrapped; Test 'autosave' fails because effects now run twice in strict mode", True),
    A("Strict mode in React 18 mounts, unmounts and remounts components in development, exposing an effect without cleanup: the autosave subscribes twice. The effect needs a cleanup rather than disabling strict mode."),
    T("Edit", {"file_path": "/work/frontend-app/src/hooks/useAutosave.ts", "old_string": "useEffect(() => { bus.on('change', save) }, [])", "new_string": "useEffect(() => { bus.on('change', save); return () => bus.off('change', save) }, [])"}, "edited"),
    T("Bash", {"command": "npm test"}, "58 passed"),
], dict(
    task_type="migration",
    summary="Upgraded the app from React 17 to 18: switched to the createRoot API and fixed an autosave effect that subscribed twice under strict mode by adding cleanup, rather than disabling strict mode; all 58 tests pass.",
    facts=["React 17 to 18", "render replaced by createRoot", "strict mode runs effects twice in development", "autosave effect lacked cleanup", "58 tests pass"],
    specific=["createRoot migration", "effect cleanup under strict mode"],
    decisions=[dict(choice="add effect cleanup instead of disabling strict mode", reason="strict mode exposed a real missing cleanup that would leak subscriptions")],
    skills=["React", "TypeScript", "dependency upgrades"], not_skills=["SQL", "Docker", "Terraform"])))
