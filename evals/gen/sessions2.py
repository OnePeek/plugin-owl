from common import U, A, T, S

SESSIONS = []

# ---------------- tests x3 ----------------
SESSIONS.append(S("tests-1", "tests", "/work/auth-service", [
    U("Our login flow has almost no tests. Please add integration tests that cover successful login, wrong password, locked account after 5 failures, and token expiry."),
    T("Read", {"file_path": "/work/auth-service/src/login.ts"}, "export async function login(email,pw){ const u=await users.byEmail(email); if(u.locked) throw new Locked(); if(!await verify(pw,u.hash)){ await users.fail(u.id); throw new BadCreds() } return sign({sub:u.id},{expiresIn:'15m'}) }"),
    T("Read", {"file_path": "/work/auth-service/test/helpers/db.ts"}, "export const withTestDb = async (fn) => { /* testcontainers postgres */ }"),
    A("The service talks to a real Postgres, so I will use the existing testcontainers helper rather than mocks, and a fake clock for the expiry test so it does not sleep."),
    T("Write", {"file_path": "/work/auth-service/test/login.int.test.ts", "content": "it('logs in with valid credentials')\nit('rejects a wrong password and counts the failure')\nit('locks the account after 5 failures')\nit('rejects an expired token using a fake clock')\n"}, "created"),
    T("Bash", {"command": "npx vitest run test/login.int.test.ts"}, "1 failed | 3 passed: locks the account after 5 failures expected 423 received 401", True),
    A("The lock test fails: the failure counter increments after the lock check, so the sixth attempt is the first to be refused. The test expectation is right according to the requirement of locking after 5 failures; this is a real off-by-one in login.ts."),
    T("Edit", {"file_path": "/work/auth-service/src/login.ts", "old_string": "if(u.locked) throw new Locked();", "new_string": "if(u.locked || u.failures >= 5) throw new Locked();"}, "edited"),
    T("Bash", {"command": "npx vitest run test/login.int.test.ts"}, "4 passed"),
], dict(
    task_type="tests",
    summary="Added integration tests for the login flow against a real Postgres container, with a fake clock for token expiry; the lockout test exposed an off-by-one that let a sixth attempt through, which was fixed.",
    facts=["integration tests for success, wrong password, lockout after 5 failures, token expiry", "real Postgres through testcontainers", "fake clock for expiry", "lockout test found an off-by-one", "four tests pass at the end"],
    specific=["integration testing with a real database container", "fake clock"],
    decisions=[dict(choice="use a real database container and a fake clock instead of mocks and sleeping", reason="the service depends on Postgres behaviour and sleeping would make the expiry test slow")],
    skills=["Vitest", "TypeScript", "PostgreSQL", "integration testing"], not_skills=["Kubernetes", "React", "Terraform"])))

SESSIONS.append(S("tests-2", "tests", "/work/pricing-lib", [
    U("The discount calculator keeps breaking in edge cases. Can you add property-based tests?"),
    T("Read", {"file_path": "/work/pricing-lib/src/discount.py"}, "def apply(price, rules): ... # percent rules first, then fixed amounts, floor at 0"),
    A("Properties that should always hold: the result is never negative, never higher than the input, and applying rules in a stable order gives the same result. I will use hypothesis with generated prices and rule lists."),
    T("Write", {"file_path": "/work/pricing-lib/tests/test_discount_props.py", "content": "@given(prices, rule_lists)\ndef test_never_negative(p, r): assert apply(p, r) >= 0\n@given(prices, rule_lists)\ndef test_never_exceeds_input(p, r): assert apply(p, r) <= p\n@given(prices, rule_lists)\ndef test_deterministic(p, r): assert apply(p, r) == apply(p, list(r))\n"}, "created"),
    T("Bash", {"command": "pytest tests/test_discount_props.py -q"}, "FAILED test_never_exceeds_input - Falsifying example: p=Decimal('0.00'), r=[Fixed(-5)]", True),
    A("Hypothesis found a negative fixed discount that increases the price, something no example test covered. Negative amounts should be rejected at rule construction."),
    T("Edit", {"file_path": "/work/pricing-lib/src/rules.py", "old_string": "class Fixed:\n    def __init__(self, amount): self.amount = amount", "new_string": "class Fixed:\n    def __init__(self, amount):\n        if amount < 0: raise ValueError('discount must not be negative')\n        self.amount = amount"}, "edited"),
    T("Edit", {"file_path": "/work/pricing-lib/tests/test_discount_props.py", "old_string": "rule_lists", "new_string": "rule_lists_valid"}, "edited"),
    T("Bash", {"command": "pytest tests/test_discount_props.py -q"}, "3 passed"),
], dict(
    task_type="tests",
    summary="Added property-based tests with hypothesis for the discount calculator (never negative, never above the input, deterministic); they found a negative fixed discount that raised prices, now rejected when the rule is created.",
    facts=["property-based tests with hypothesis", "three properties", "found a negative fixed discount increasing the price", "validation added to the rule constructor", "tests pass"],
    specific=["property-based testing", "falsifying example"],
    decisions=[dict(choice="reject negative amounts when a rule is constructed", reason="a negative fixed discount raised the price and no example test had covered it")],
    skills=["Python", "pytest", "Hypothesis", "property-based testing"], not_skills=["React", "Docker", "Redis"])))

SESSIONS.append(S("tests-3", "tests", "/work/checkout-web", [
    U("Our Playwright checkout test fails about one run in five on CI but passes locally. Stabilise it."),
    T("Read", {"file_path": "/work/checkout-web/e2e/checkout.spec.ts"}, "await page.click('#pay'); await page.waitForTimeout(2000); expect(await page.textContent('.status')).toBe('Paid')"),
    A("The fixed two second sleep is the flake: on a slow CI runner the payment mock sometimes takes longer. The test should wait for the condition instead of the clock."),
    T("Edit", {"file_path": "/work/checkout-web/e2e/checkout.spec.ts", "old_string": "await page.waitForTimeout(2000); expect(await page.textContent('.status')).toBe('Paid')", "new_string": "await expect(page.locator('.status')).toHaveText('Paid', { timeout: 15000 })"}, "edited"),
    T("Edit", {"file_path": "/work/checkout-web/e2e/checkout.spec.ts", "old_string": "await page.click('#pay');", "new_string": "await page.getByRole('button', { name: 'Pay' }).click();"}, "edited"),
    T("Bash", {"command": "npx playwright test checkout --repeat-each=20"}, "20 passed"),
], dict(
    task_type="tests",
    summary="Stabilised a flaky Playwright checkout test by replacing a fixed two second sleep with an auto-retrying assertion on the status text and a role-based locator; twenty repeated runs passed.",
    facts=["flaky checkout end to end test on CI", "fixed sleep removed", "auto-waiting assertion", "role-based locator", "twenty repeated runs pass"],
    specific=["flaky test from fixed sleep", "auto-waiting assertions"],
    decisions=[dict(choice="wait on the status text instead of a fixed sleep", reason="a slow CI runner sometimes takes longer than the sleep")],
    skills=["Playwright", "TypeScript", "end-to-end testing"], not_skills=["Python", "Kubernetes", "SQL"])))

# ---------------- infra x3 ----------------
SESSIONS.append(S("infra-1", "infra", "/work/platform", [
    U("Our Docker image for the API is 1.4 GB and builds take 9 minutes. Slim it down."),
    T("Read", {"file_path": "/work/platform/api/Dockerfile"}, "FROM node:22\nCOPY . .\nRUN npm install\nCMD [\"node\",\"dist/server.js\"]"),
    A("Single stage with dev dependencies and the full node image. I will switch to a multi-stage build: install and compile in a build stage, copy only production dependencies and the compiled output into a slim runtime image, and order layers so dependency install is cached."),
    T("Write", {"file_path": "/work/platform/api/Dockerfile", "content": "FROM node:22-slim AS build\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build && npm prune --omit=dev\nFROM gcr.io/distroless/nodejs22\nCOPY --from=build /app/dist ./dist\nCOPY --from=build /app/node_modules ./node_modules\nCMD [\"dist/server.js\"]\n"}, "created"),
    T("Bash", {"command": "docker build -t api:slim ."}, "Successfully built (74 s)"),
    T("Bash", {"command": "docker images api:slim --format {{.Size}}"}, "168MB"),
    T("Bash", {"command": "docker run --rm api:slim --version"}, "v22.11.0"),
    T("Edit", {"file_path": "/work/platform/.dockerignore", "old_string": "", "new_string": "node_modules\n.git\ncoverage\n"}, "edited"),
], dict(
    task_type="infra",
    summary="Cut the API Docker image from 1.4 GB to 168 MB and the build from nine minutes to about 74 seconds with a multi-stage build onto a distroless runtime, cached dependency install layer and a dockerignore.",
    facts=["image was 1.4 GB, now 168 MB", "multi-stage build", "distroless runtime image", "dependency layer cached", "dockerignore added", "build took 74 seconds"],
    specific=["multi-stage Docker build", "distroless image", "layer caching"],
    decisions=[dict(choice="multi-stage build with a distroless runtime", reason="the runtime only needs compiled output and production dependencies, not dev tooling")],
    skills=["Docker", "Node.js", "multi-stage builds"], not_skills=["Kubernetes", "Terraform", "Python"])))

SESSIONS.append(S("infra-2", "infra", "/work/infra-live", [
    U("Add a CloudWatch alarm and SNS email for when the queue depth stays above 1000 for 10 minutes. We use Terraform."),
    T("Glob", {"pattern": "modules/**/*.tf"}, "modules/queue/main.tf\nmodules/alerts/main.tf"),
    T("Read", {"file_path": "/work/infra-live/modules/alerts/main.tf"}, "resource \"aws_sns_topic\" \"alerts\" {...}"),
    A("There is already an alerts topic, so the alarm should publish to it rather than creating a second topic. A single breach would page on spikes, so I will require 10 consecutive one-minute periods above the threshold."),
    T("Edit", {"file_path": "/work/infra-live/modules/queue/main.tf", "old_string": "# alarms", "new_string": "resource \"aws_cloudwatch_metric_alarm\" \"depth\" {\n  metric_name = \"ApproximateNumberOfMessagesVisible\"\n  threshold = 1000\n  evaluation_periods = 10\n  period = 60\n  comparison_operator = \"GreaterThanThreshold\"\n  alarm_actions = [var.alerts_topic_arn]\n}"}, "edited"),
    T("Bash", {"command": "terraform fmt -check && terraform validate"}, "Success! The configuration is valid."),
    T("Bash", {"command": "terraform plan -out plan.out"}, "Plan: 1 to add, 0 to change, 0 to destroy."),
], dict(
    task_type="infra",
    summary="Added a Terraform CloudWatch alarm that fires when queue depth stays above 1000 for ten one-minute periods and notifies the existing alerts SNS topic; validate passes and the plan adds one resource.",
    facts=["alarm on queue depth above 1000", "ten consecutive one-minute periods", "published to the existing alerts topic", "terraform validate passes", "plan adds one resource"],
    specific=["CloudWatch metric alarm", "evaluation periods to avoid paging on spikes"],
    decisions=[dict(choice="require ten consecutive periods above the threshold", reason="a single breach would page on short spikes")],
    skills=["Terraform", "AWS CloudWatch", "Amazon SNS"], not_skills=["Docker", "React", "Python"])))

SESSIONS.append(S("infra-3", "infra", "/work/monorepo", [
    U("Our GitHub Actions pipeline takes 22 minutes. Most of it is install and tests that did not change. Speed it up."),
    T("Read", {"file_path": "/work/monorepo/.github/workflows/ci.yml"}, "jobs: test: steps: - uses: actions/checkout - run: npm ci - run: npm test -- --all"),
    A("Three things: cache the npm store keyed on the lockfile, run tests only for packages affected by the change, and split lint, test and build into parallel jobs."),
    T("Edit", {"file_path": "/work/monorepo/.github/workflows/ci.yml", "old_string": "- run: npm ci", "new_string": "- uses: actions/setup-node\n        with: { node-version: 22, cache: npm }\n      - run: npm ci"}, "edited"),
    T("Edit", {"file_path": "/work/monorepo/.github/workflows/ci.yml", "old_string": "npm test -- --all", "new_string": "npx nx affected -t test --base=origin/main"}, "edited"),
    T("Edit", {"file_path": "/work/monorepo/.github/workflows/ci.yml", "old_string": "jobs: test:", "new_string": "jobs: lint: {...}\n  build: {...}\n  test:"}, "edited"),
    T("Bash", {"command": "gh run list --limit 3"}, "completed success 7m41s\ncompleted success 8m02s\ncompleted success 7m55s"),
], dict(
    task_type="infra",
    summary="Reduced CI time from 22 minutes to about 8 by caching the npm store on the lockfile, running only affected package tests with Nx, and splitting lint, build and test into parallel jobs.",
    facts=["pipeline took 22 minutes", "npm cache keyed on lockfile", "only affected tests run", "lint build test run in parallel jobs", "recent runs about 8 minutes"],
    specific=["dependency caching", "affected-only test runs"],
    decisions=[dict(choice="run tests only for packages affected by the change", reason="most packages are unchanged in a typical pull request")],
    skills=["GitHub Actions", "Nx", "Node.js", "CI/CD"], not_skills=["Terraform", "Docker", "Python"])))

# ---------------- debugging x3 ----------------
SESSIONS.append(S("debugging-1", "debugging", "/work/search-api", [
    U("Memory of the search service climbs until it is OOM-killed after about two days. Find the leak."),
    T("Bash", {"command": "node --heapsnapshot-signal=SIGUSR2 dist/server.js & sleep 60; kill -USR2 $!"}, "Heap snapshot written"),
    T("Bash", {"command": "node scripts/diff-snapshots.js a.heapsnapshot b.heapsnapshot"}, "Closure x 48213 (+48000)\nEventEmitter listeners x 47990"),
    A("Tens of thousands of retained closures and listeners: something adds an event listener per request without removing it."),
    T("Grep", {"pattern": "\\.on\\('close'|\\.on\\(\"abort\""}, "src/stream/proxy.ts:31: upstream.on('error', onError)"),
    T("Read", {"file_path": "/work/search-api/src/stream/proxy.ts"}, "function proxy(req,res){ const upstream = pool.get(); upstream.on('error', onError); upstream.pipe(res); } // upstream returned to the pool, listener never removed"),
    A("The upstream socket is returned to a pool and reused, but each request adds a new error listener that is never removed. That is the leak. I have found the cause but this session ends with the diagnosis; the fix touches the shared pool code owned by another team."),
], dict(
    task_type="debugging",
    summary="Traced a two-day memory growth to an event listener added to a pooled upstream connection on every request and never removed, using heap snapshot diffs; the cause was found but not fixed because the pool code belongs to another team.",
    facts=["memory growth until OOM kill", "heap snapshot diff showed many retained closures and listeners", "listener added per request on a pooled connection", "never removed", "fix not made in this session"],
    specific=["heap snapshot diffing", "event listener leak on pooled connections"],
    decisions=[dict(choice="stop at the diagnosis and not change the pool code", reason="the pool code is shared and owned by another team")],
    skills=["Node.js", "heap profiling", "memory leak debugging"], not_skills=["Docker", "React", "SQL"])))

SESSIONS.append(S("debugging-2", "debugging", "/work/orders-svc", [
    U("Orders occasionally get created twice when the user double clicks Pay. Support has seen it a dozen times. Where does it come from? Just find the cause for now."),
    T("Read", {"file_path": "/work/orders-svc/src/createOrder.ts"}, "const existing = await db.order.findFirst({ where:{ cartId } }); if (existing) return existing; return db.order.create({ data:{ cartId, ... } })"),
    A("Check-then-insert without a unique constraint: two concurrent requests could both see no existing order and both insert. Let me check the schema and try to reproduce it."),
    T("Bash", {"command": "psql -c \"\\d orders\""}, "Indexes: orders_pkey PRIMARY KEY (id)   -- no unique index on cart_id"),
    T("Bash", {"command": "node scripts/repro-double-submit.js"}, "created 2 orders for cart 17"),
    T("Bash", {"command": "node scripts/repro-double-submit.js"}, "created 2 orders for cart 18"),
    A("Reproduced twice with two parallel submits for the same cart, so the cause is confirmed. The remedy would be a unique index on the cart plus handling of the unique violation, but you asked only for the cause, so I have changed nothing."),
], dict(
    task_type="debugging",
    summary="Found the cause of duplicate orders on double click: a check-then-insert race with no unique constraint on the cart, reproduced twice with parallel submits; nothing was changed because only the cause was requested.",
    facts=["duplicate orders on double click", "check then insert race", "no unique index on cart id", "reproduced twice with parallel submits", "no code changed"],
    specific=["check-then-insert race condition", "missing unique constraint"],
    decisions=[],
    skills=["PostgreSQL", "race condition debugging"], not_skills=["Docker", "Kubernetes", "React"])))

SESSIONS.append(S("debugging-3", "debugging", "/work/media-pipeline", [
    U("The video thumbnail job silently produces black images for some uploads. No errors in the logs and I do not know where to start. Find out why."),
    T("Bash", {"command": "ffprobe -v error -show_streams sample-ok.mp4 | head -12"}, "codec_name=h264\npix_fmt=yuv420p\ncolor_transfer=bt709"),
    T("Bash", {"command": "ffprobe -v error -show_streams sample-bad.mov | head -12"}, "codec_name=hevc\npix_fmt=yuv420p10le\ncolor_transfer=arib-std-b67"),
    A("The black ones are 10-bit HEVC with an HLG transfer, that is HDR; the good one is plain 8-bit SDR. Our command extracts a frame without tone mapping, so HDR values may collapse to near black in an 8-bit PNG."),
    T("Bash", {"command": "ffmpeg -i sample-bad.mov -frames:v 1 plain.png && python3 mean_brightness.py plain.png"}, "mean brightness 3 of 255"),
    T("Bash", {"command": "ffmpeg -i sample-bad.mov -vf zscale=t=linear,tonemap=hable,zscale=t=bt709,format=yuv420p -frames:v 1 tonemapped.png && python3 mean_brightness.py tonemapped.png"}, "mean brightness 96 of 255"),
    A("Confirmed: without tone mapping the frame is almost black (brightness 3), with a tone mapping filter chain it is normal (96). The thumbnail code needs to detect HDR and tone map. I have not changed the code yet."),
], dict(
    task_type="debugging",
    summary="Diagnosed black thumbnails as 10-bit HDR HEVC video extracted without tone mapping: ffprobe separated the HDR files from SDR ones and a tone mapped extraction raised mean brightness from 3 to 96; the code was not changed in this session.",
    facts=["black thumbnails for some uploads, no log errors", "bad files are 10-bit HEVC with HLG transfer", "good file is SDR", "extraction without tone mapping gives brightness 3", "with tone mapping brightness 96", "code not changed yet"],
    specific=["HDR to SDR tone mapping", "ffprobe inspection"],
    decisions=[],
    skills=["FFmpeg", "video processing"], not_skills=["Docker", "React", "SQL"])))
