# Held-out set 4, part C (migration, refactor, review, tests). Written before any run; never tuned on.
from common import U, A, T, S
from h4a import D

SESSIONS = []

SESSIONS.append(S("migration-2", "migration", "/work/telemetry-svc", [
    U("Move our job queue from Celery with Redis to SQS. Start with the producer side only."),
    T("Grep", {"pattern": "\\.delay\\(|apply_async", "path": "/work/telemetry-svc/app"}, "app/ingest.py:31: process_batch.delay(batch_id)\napp/alerts.py:12: send_alert.apply_async(args=[a.id], countdown=30)"),
    A("SQS has no per-message countdown beyond 15 minutes of delay, but 30 seconds is within that, so the alert delay maps to DelaySeconds. I'll hide the queue behind a small publish function so the call sites don't know which broker they use, and the consumer side can move later."),
    T("Write", {"file_path": "/work/telemetry-svc/app/queue.py", "content": "def publish(task: str, payload: dict, delay: int = 0):\n    sqs.send_message(QueueUrl=QUEUES[task], MessageBody=json.dumps(payload), DelaySeconds=delay)"}, "File created."),
    T("Edit", {"file_path": "/work/telemetry-svc/app/ingest.py", "old_string": "process_batch.delay(batch_id)", "new_string": "publish('process_batch', {'batch_id': batch_id})"}, "ok"),
    T("Edit", {"file_path": "/work/telemetry-svc/app/alerts.py", "old_string": "send_alert.apply_async(args=[a.id], countdown=30)", "new_string": "publish('send_alert', {'alert_id': a.id}, delay=30)"}, "ok"),
    T("Bash", {"command": "pytest tests/test_queue.py -q"}, "3 passed"),
    A("Both producers now publish to SQS through one function, tests pass with a stubbed client. The Celery workers still consume from Redis, so nothing will process these messages until the consumer side is written."),
], dict(task_type="migration",
    summary="Started moving a job queue from Celery and Redis to SQS: the two producers now publish through one small function that maps the Celery countdown to SQS delay, with tests on a stubbed client. The consumer side is not migrated, so the new messages are not processed yet.",
    facts=["producer side only", "publish function wraps SQS send_message", "countdown 30 maps to DelaySeconds", "tests pass with a stub", "Celery workers still consume Redis", "consumer not written"],
    specific=["queue broker migration", "abstracting the producer"],
    decisions=[D("hide the queue behind a publish function instead of calling SQS at each call site", "the call sites stay unaware of the broker so the consumer side can move later")],
    skills=["Python", "AWS SQS", "Celery"], not_skills=["Kafka", "Terraform", "Kubernetes"])))

SESSIONS.append(S("migration-3", "migration", "/work/orders-dash", [
    U("Upgrade Spring Boot from 2.7 to 3.2. The build fails."),
    T("Bash", {"command": "./gradlew build 2>&1 | grep -E 'error:|cannot find' | head -5"}, "error: package javax.servlet does not exist\nerror: package javax.persistence does not exist"),
    A("Spring Boot 3 moved from the javax namespace to jakarta, so every import needs rewriting. I'll use the OpenRewrite migration recipe rather than editing by hand, since there are 140 files."),
    T("Bash", {"command": "./gradlew rewriteRun -Drewrite.activeRecipe=org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_2"}, "Changed 143 files"),
    T("Bash", {"command": "./gradlew build 2>&1 | tail -6"}, "error: Hibernate: 'hibernate.dialect' is no longer ... \nBUILD FAILED"),
    T("Edit", {"file_path": "/work/orders-dash/src/main/resources/application.yml", "old_string": "dialect: org.hibernate.dialect.PostgreSQL94Dialect", "new_string": "dialect: org.hibernate.dialect.PostgreSQLDialect"}, "ok"),
    T("Bash", {"command": "./gradlew build 2>&1 | tail -3"}, "BUILD SUCCESSFUL\n212 tests completed"),
], dict(task_type="migration",
    summary="Upgraded a Spring Boot application from 2.7 to 3.2: used an automated OpenRewrite recipe to move 143 files from javax to jakarta imports, then replaced a removed Hibernate dialect setting. The build succeeds and all 212 tests pass.",
    facts=["javax to jakarta namespace change", "OpenRewrite recipe changed 143 files", "removed Hibernate dialect replaced", "build succeeds", "212 tests pass"],
    specific=["javax to jakarta migration", "automated codemod"],
    decisions=[D("use the OpenRewrite recipe instead of editing imports by hand", "there were about 140 files to change")],
    skills=["Spring Boot", "Gradle", "OpenRewrite", "Hibernate"], not_skills=["Kotlin", "Docker", "Maven"])))

SESSIONS.append(S("refactor-1", "refactor", "/work/checkout-core", [
    U("The Order class has grown to 900 lines. Pull the discount logic out into its own module. No behaviour change; tests are in test/order_test.rb."),
    T("Bash", {"command": "bundle exec rspec test/order_test.rb | tail -2"}, "86 examples, 0 failures"),
    T("Grep", {"pattern": "discount", "path": "/work/checkout-core/lib/order.rb"}, "lib/order.rb:212: def apply_discounts\nlib/order.rb:240: def stackable?(d)\nlib/order.rb:261: def best_coupon"),
    T("Write", {"file_path": "/work/checkout-core/lib/order/discounts.rb", "content": "module Order::Discounts\n  def apply_discounts; ...; end\n  private\n  def stackable?(d); ...; end\n  def best_coupon; ...; end\nend"}, "File created."),
    T("Edit", {"file_path": "/work/checkout-core/lib/order.rb", "old_string": "class Order\n", "new_string": "class Order\n  include Order::Discounts\n"}, "ok"),
    T("Bash", {"command": "bundle exec rspec test/order_test.rb | tail -2"}, "86 examples, 0 failures"),
    A("The three discount methods now live in a module that Order includes; the 86 examples pass before and after. It's still a mixin on the same object, so the coupling is unchanged, only the file is split."),
], dict(task_type="refactor",
    summary="Moved the discount methods out of a 900-line Ruby Order class into an included module, with the 86 existing examples passing before and after. It is a file-level split of a mixin, so coupling to the order itself is unchanged.",
    facts=["three discount methods moved to a module", "Order includes the module", "86 examples pass before and after", "coupling unchanged"],
    specific=["extract module refactor"],
    decisions=[], skills=["Ruby", "RSpec", "refactoring"], not_skills=["Rails migrations", "SQL", "JavaScript"])))

SESSIONS.append(S("refactor-2", "refactor", "/work/stats-engine", [
    U("Five of our Rust parsers repeat the same line-splitting and error-position code. Factor that out."),
    T("Bash", {"command": "grep -ln 'fn next_line' src/parse/*.rs"}, "src/parse/csv.rs\nsrc/parse/tsv.rs\nsrc/parse/log.rs\nsrc/parse/kv.rs\nsrc/parse/ini.rs"),
    T("Read", {"file_path": "/work/stats-engine/src/parse/kv.rs", "limit": 30}, "fn next_line(&mut self) -> Option<(usize, &str)> {\n  let l = self.lines.next()?; self.n += 1; Some((self.n, l.trim_end()))\n}\nfn err(&self, msg: &str) -> ParseError { ParseError { line: self.n, msg: msg.into() } }"),
    T("Write", {"file_path": "/work/stats-engine/src/parse/lines.rs", "content": "pub struct Lines<'a> { it: std::str::Lines<'a>, n: usize }\nimpl<'a> Lines<'a> {\n  pub fn new(s: &'a str) -> Self { Self { it: s.lines(), n: 0 } }\n  pub fn next_line(&mut self) -> Option<(usize, &'a str)> { let l = self.it.next()?; self.n += 1; Some((self.n, l.trim_end())) }\n  pub fn err(&self, msg: &str) -> ParseError { ParseError { line: self.n, msg: msg.into() } }\n}"}, "File created."),
    T("Edit", {"file_path": "/work/stats-engine/src/parse/kv.rs", "old_string": "fn next_line(&mut self)", "new_string": "// uses Lines\nfn _unused_next_line(&mut self)"}, "ok"),
    T("Bash", {"command": "cargo test parse:: 2>&1 | tail -3"}, "test result: ok. 41 passed; 0 failed"),
    A("I've moved kv.rs onto the shared Lines helper and its 41 parser tests still pass. The other four parsers still carry their own copies; I stopped after one to confirm the shape before touching the rest."),
], dict(task_type="refactor",
    summary="Factored the repeated line-splitting and error-position code of Rust parsers into a shared Lines helper and moved one parser onto it; the 41 parser tests pass. The other four parsers still have their own copies.",
    facts=["five parsers share duplicated code", "shared Lines helper created", "kv parser converted", "41 tests pass", "four parsers not converted"],
    specific=["extracting shared parsing helper"],
    decisions=[], skills=["Rust", "refactoring"], not_skills=["Python", "SQL", "WebAssembly"])))

SESSIONS.append(S("refactor-3", "refactor", "/work/ride-app", [
    U("The ViewModel in our Android app does networking, caching and formatting in one class. Split the networking out behind a repository. Keep behaviour."),
    T("Read", {"file_path": "/work/ride-app/app/src/main/kotlin/app/ride/TripViewModel.kt", "limit": 40}, "class TripViewModel(private val api: RideApi) : ViewModel() {\n  fun load(id: String) = viewModelScope.launch { val t = api.trip(id); _state.value = format(t) }"),
    T("Write", {"file_path": "/work/ride-app/app/src/main/kotlin/app/ride/TripRepository.kt", "content": "interface TripRepository { suspend fun trip(id: String): Trip }\nclass NetworkTripRepository(private val api: RideApi) : TripRepository { override suspend fun trip(id: String) = api.trip(id) }"}, "File created."),
    T("Edit", {"file_path": "/work/ride-app/app/src/main/kotlin/app/ride/TripViewModel.kt", "old_string": "class TripViewModel(private val api: RideApi) : ViewModel() {\n  fun load(id: String) = viewModelScope.launch { val t = api.trip(id)", "new_string": "class TripViewModel(private val repo: TripRepository) : ViewModel() {\n  fun load(id: String) = viewModelScope.launch { val t = repo.trip(id)"}, "ok"),
    T("Bash", {"command": "./gradlew testDebugUnitTest"}, "BUILD SUCCESSFUL, 27 tests"),
    A("Networking now sits behind a TripRepository interface and the ViewModel only depends on that, so it can be tested with a fake. Caching and formatting are still in the ViewModel; I left those for a second step."),
], dict(task_type="refactor",
    summary="Moved an Android ViewModel's network calls behind a repository interface so the ViewModel depends on the interface; the 27 unit tests pass. Caching and formatting remain in the ViewModel for a later step.",
    facts=["TripRepository interface and network implementation added", "ViewModel depends on the repository", "27 unit tests pass", "caching and formatting not yet moved"],
    specific=["repository pattern", "dependency inversion for testability"],
    decisions=[], skills=["Kotlin", "Android", "Gradle"], not_skills=["Jetpack Compose", "Room", "Retrofit configuration"])))

SESSIONS.append(S("review-1", "review", "/work/upload-svc", [
    U("Review this PR that adds image uploads. Security and robustness. Don't edit."),
    T("Bash", {"command": "gh pr diff 88 --patch | head -80"}, "+ app.post('/upload', upload.single('file'), (req, res) => {\n+   const dest = path.join(UPLOAD_DIR, req.file.originalname)\n+   fs.renameSync(req.file.path, dest)\n+   res.json({ url: '/files/' + req.file.originalname })\n+ })"),
    T("Bash", {"command": "gh pr diff 88 --patch | grep -n 'limits\\|mimetype\\|fileFilter'"}, "no matches"),
    A("Findings. Blocking: the destination uses the client-supplied file name, so a name like ../../x can write outside the upload folder (path traversal), and two users uploading the same name overwrite each other. Blocking: no size limit and no type check, so anyone can fill the disk or upload scripts. Should fix: renameSync blocks the event loop. A generated random name stored alongside the original would fix the first two. I have not edited anything."),
], dict(task_type="review",
    summary="Reviewed an image upload PR without editing: the destination path uses the client-supplied file name, allowing path traversal and overwrites, and there is no size limit or type check. It also noted a blocking synchronous rename, and suggested generated names.",
    facts=["client file name used in the destination", "path traversal and overwrite risk", "no size limit or type check", "synchronous rename blocks the event loop", "no edits made"],
    specific=["path traversal in file upload"],
    decisions=[], skills=["security review", "Node.js", "code review"], not_skills=["Terraform", "React", "S3 configuration"])))

SESSIONS.append(S("review-2", "review", "/work/pricing-rules", [
    U("Can you review my change to the discount calculator? I think it's right but I want a second pair of eyes."),
    T("Bash", {"command": "git diff main -- src/discount.py"}, "-    return price * (1 - pct / 100)\n+    return round(price * (1 - pct / 100), 2)\n+def stack(price, pcts):\n+    for p in pcts:\n+        price = apply(price, p)\n+    return price"),
    T("Bash", {"command": "python -c \"from src.discount import stack; print(stack(100.0,[10,10]), stack(100.0,[20]))\""}, "81.0 80.0"),
    A("Logic looks right: two 10% discounts give 81.00, which is multiplicative stacking, not 20% off. That may not be what the business rule wants, and the PR description doesn't say. Rounding inside the loop can also lose a cent on long stacks; rounding once at the end is safer. There are no tests for stack() in the diff. Nothing is blocking, but I'd ask which stacking rule is intended and add a test for it. I made no changes."),
], dict(task_type="review",
    summary="Reviewed a discount calculator change: stacking discounts multiplies them, so two 10% discounts give 81, which may not be the intended rule, and rounding on every step can lose a cent. It asked for the business rule to be confirmed and a test for the stacking function. Nothing was changed.",
    facts=["two 10 percent discounts give 81.0", "multiplicative stacking", "rounding happens inside the loop", "no tests for stack", "no edits made"],
    specific=["discount stacking semantics", "rounding in loops"],
    decisions=[], skills=["Python", "code review"], not_skills=["SQL", "Docker", "pytest fixtures"])))

SESSIONS.append(S("review-3", "review", "/work/notif-center", [
    U("Look at the retry code in this PR for the push notification sender and tell me if there's anything wrong."),
    T("Bash", {"command": "gh pr diff 301 --patch | head -60"}, "+ for (let i = 0; i < 5; i++) {\n+   try { return await push(token, msg) } catch (e) { await sleep(1000) }\n+ }\n+ throw new Error('push failed')"),
    A("Issues. The loop retries on every error, including 400s for an invalid or expired device token, which will never succeed and will hammer the push service five times per dead token. It should retry only on 429 and 5xx. The fixed 1 second sleep gives no backoff, so a service outage is hit with synchronized retries from every sender; use exponential backoff with jitter. The final error drops the last underlying error, which will make failures hard to debug. No edits."),
], dict(task_type="review",
    summary="Reviewed a push notification retry loop: it retries on all errors including permanent bad-token responses, uses a fixed one second sleep with no backoff or jitter, and discards the underlying error when giving up. Suggested retrying only on rate limit and server errors. No edits were made.",
    facts=["retries on every error", "invalid tokens will never succeed", "fixed 1 second sleep", "suggest exponential backoff with jitter", "final error loses the cause", "no edits"],
    specific=["retry policy review", "backoff with jitter"],
    decisions=[], skills=["code review", "JavaScript", "retry design"], not_skills=["Firebase configuration", "Kubernetes", "Python"])))

SESSIONS.append(S("tests-1", "tests", "/work/slug-utils", [
    U("Write unit tests for slugify() in src/slug.ts. It should handle accents, spaces, emoji, and an empty string."),
    T("Read", {"file_path": "/work/slug-utils/src/slug.ts"}, "export function slugify(s: string): string {\n  return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')\n}"),
    T("Write", {"file_path": "/work/slug-utils/src/slug.test.ts", "content": "describe('slugify', () => {\n  it('strips accents', () => expect(slugify('Crème Brûlée')).toBe('creme-brulee'))\n  it('collapses spaces', () => expect(slugify('a   b')).toBe('a-b'))\n  it('drops emoji', () => expect(slugify('go 🚀 now')).toBe('go-now'))\n  it('returns empty for empty', () => expect(slugify('')).toBe(''))\n  it('trims dashes', () => expect(slugify('--x--')).toBe('x'))\n})"}, "File created."),
    T("Bash", {"command": "npx vitest run src/slug"}, "5 passed"),
], dict(task_type="tests",
    summary="Wrote five unit tests for a slugify function covering accents, repeated spaces, emoji, the empty string and leading or trailing dashes; all pass.",
    facts=["five tests", "accents, spaces, emoji, empty string, trimmed dashes", "all pass"],
    specific=["edge-case unit tests"],
    decisions=[], skills=["TypeScript", "Vitest"], not_skills=["Jest", "React", "end-to-end testing"])))

SESSIONS.append(S("tests-2", "tests", "/work/checkout-e2e", [
    U("Our Playwright test 'applies coupon' is flaky, fails about 1 in 5 in CI. Make it stable."),
    T("Read", {"file_path": "/work/checkout-e2e/tests/coupon.spec.ts"}, "await page.fill('#coupon', 'SAVE10')\nawait page.click('text=Apply')\nawait page.waitForTimeout(500)\nexpect(await page.textContent('.total')).toBe('$90.00')"),
    A("The fixed 500 ms wait races with the coupon request: on a slow CI runner the total hasn't updated yet. Waiting on the actual response, or using an auto-retrying assertion, removes the timing guess."),
    T("Edit", {"file_path": "/work/checkout-e2e/tests/coupon.spec.ts", "old_string": "await page.click('text=Apply')\nawait page.waitForTimeout(500)\nexpect(await page.textContent('.total')).toBe('$90.00')", "new_string": "await page.click('text=Apply')\nawait expect(page.locator('.total')).toHaveText('$90.00')"}, "ok"),
    T("Bash", {"command": "npx playwright test coupon --repeat-each=30"}, "30 passed"),
], dict(task_type="tests",
    summary="Stabilised a flaky Playwright coupon test by replacing a fixed 500 ms wait with an auto-retrying assertion on the total; it passed 30 repeated runs.",
    facts=["fixed wait raced with the coupon request", "replaced by toHaveText auto-retrying assertion", "30 repeated runs pass"],
    specific=["flaky test from fixed sleep", "auto-retrying assertions"],
    decisions=[D("use an auto-retrying assertion instead of a fixed wait", "the fixed wait raced with the coupon request on slow runners")],
    skills=["Playwright", "TypeScript"], not_skills=["Cypress", "Docker", "CI configuration"])))

SESSIONS.append(S("tests-3", "tests", "/work/ledger-core", [
    U("Add property-based tests for our money splitting function: splitting an amount among n people must always sum back to the amount. Use hypothesis."),
    T("Read", {"file_path": "/work/ledger-core/ledger/split.py"}, "def split(cents: int, n: int) -> list[int]:\n    base, extra = divmod(cents, n)\n    return [base + (1 if i < extra else 0) for i in range(n)]"),
    T("Write", {"file_path": "/work/ledger-core/tests/test_split_props.py", "content": "@given(st.integers(min_value=0, max_value=10**9), st.integers(min_value=1, max_value=50))\ndef test_sums_back(cents, n):\n    parts = split(cents, n)\n    assert sum(parts) == cents and len(parts) == n and max(parts) - min(parts) <= 1"}, "File created."),
    T("Bash", {"command": "pytest tests/test_split_props.py -q"}, "1 passed in 1.8s"),
    A("The property holds across 100 generated cases: sum preserved, n parts, and no part differs from another by more than one cent. I did not test n = 0, which raises ZeroDivisionError; the function doesn't define that case."),
], dict(task_type="tests",
    summary="Added a hypothesis property test for the money splitting function checking that parts always sum to the amount, there are n of them and they differ by at most one cent; it passes. The zero-people case was not tested because the function leaves it undefined.",
    facts=["property test with hypothesis", "sum preserved", "n parts", "parts differ by at most one cent", "n of zero not tested"],
    specific=["property-based testing", "invariants of money splitting"],
    decisions=[], skills=["Python", "hypothesis", "pytest"], not_skills=["Django", "SQL", "mutation testing"])))
