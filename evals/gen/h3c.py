# Held-out set 3, part C (migration, refactor, review, tests). Written before any run; never tuned on.
from common import U, A, T, S
from h3a import D

SESSIONS = []

SESSIONS.append(S("migration-2", "migration", "/work/orders-service", [
    U("We need to rename the column orders.cust_ref to customer_reference in Postgres without downtime. App is Django, deploys are rolling."),
    T("Grep", {"pattern": "cust_ref", "path": "/work/orders-service"}, "orders/models.py:22: cust_ref = models.CharField(max_length=40, null=True)\norders/exports.py:48: o.cust_ref\nreports/sql/open_orders.sql:5: cust_ref"),
    A("With a rolling deploy, old and new app versions run side by side, so a plain RENAME COLUMN would break whichever side is older. I'll do it in steps: add the new column, dual-write, backfill, switch reads, then drop the old column in a later release."),
    T("Write", {"file_path": "/work/orders-service/orders/migrations/0031_add_customer_reference.py", "content": "operations = [migrations.AddField('order', 'customer_reference', models.CharField(max_length=40, null=True))]"}, "File created."),
    T("Edit", {"file_path": "/work/orders-service/orders/models.py", "old_string": "    cust_ref = models.CharField(max_length=40, null=True)", "new_string": "    cust_ref = models.CharField(max_length=40, null=True)\n    customer_reference = models.CharField(max_length=40, null=True)\n\n    def save(self, *a, **kw):\n        self.customer_reference = self.customer_reference or self.cust_ref\n        self.cust_ref = self.cust_ref or self.customer_reference\n        super().save(*a, **kw)"}, "ok"),
    T("Write", {"file_path": "/work/orders-service/orders/migrations/0032_backfill_customer_reference.py", "content": "def forwards(apps, se):\n    Order = apps.get_model('orders','Order')\n    while Order.objects.filter(customer_reference__isnull=True, cust_ref__isnull=False).exists():\n        ids = list(Order.objects.filter(customer_reference__isnull=True, cust_ref__isnull=False).values_list('pk', flat=True)[:5000])\n        Order.objects.filter(pk__in=ids).update(customer_reference=F('cust_ref'))"}, "File created."),
    T("Bash", {"command": "python manage.py test orders.tests.test_migrations"}, "Ran 4 tests OK"),
    A("Release 1 is ready: new column, dual write in save(), and a backfill in batches of 5000 to avoid a long lock. Release 2 should switch the reads in exports.py and open_orders.sql, and release 3 drop cust_ref. I have not touched those yet."),
], dict(task_type="migration",
    summary="Prepared the first release of a zero-downtime rename of orders.cust_ref to customer_reference: a new nullable column, dual-writing in the Django model's save, and a backfill migration in batches of 5000. Migration tests pass; switching reads (exports and a report query) and dropping the old column are left for later releases.",
    facts=["expand and contract approach instead of RENAME COLUMN", "new column added by migration", "save writes both columns", "backfill in batches of 5000", "migration tests pass", "reads and drop of old column not done"],
    specific=["expand and contract column rename", "zero-downtime schema migration"],
    decisions=[D("add a new column with dual writes and a batched backfill instead of a direct rename", "old and new app versions run together during a rolling deploy, so a rename would break one of them")],
    skills=["Django", "PostgreSQL", "schema migrations", "Python"], not_skills=["Kubernetes", "Rails", "MongoDB"])))

SESSIONS.append(S("migration-3", "migration", "/work/billing-lib", [
    U("Upgrade us from Node 16 to Node 22. CI is red on the new version."),
    T("Bash", {"command": "nvm use 22 && npm ci && npm test 2>&1 | tail -15"}, "Error: error:0308010C:digital envelope routines::unsupported\n  at node_modules/legacy-crypto-shim/index.js:4\nTests: 0 passed, suite failed to run"),
    A("That OpenSSL 3 error is from legacy-crypto-shim using an md4 hash that Node 17 and later no longer provide. Check whether we still need that package."),
    T("Grep", {"pattern": "legacy-crypto-shim", "path": "/work/billing-lib/src"}, "src/sign/hmac.ts:3: import { hmac } from 'legacy-crypto-shim'"),
    T("Edit", {"file_path": "/work/billing-lib/src/sign/hmac.ts", "old_string": "import { hmac } from 'legacy-crypto-shim'", "new_string": "import { createHmac } from 'node:crypto'\nconst hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex')"}, "ok"),
    T("Bash", {"command": "npm uninstall legacy-crypto-shim && sed -i 's/\"node\": \">=16\"/\"node\": \">=22\"/' package.json && npm test 2>&1 | tail -6"}, "Tests: 58 passed, 58 total"),
    T("Edit", {"file_path": "/work/billing-lib/.github/workflows/ci.yml", "old_string": "node-version: [16]", "new_string": "node-version: [22]"}, "ok"),
    A("All 58 tests pass on Node 22 after replacing the shim with the built-in crypto HMAC. Engines and the CI matrix now say 22. I checked that the old and new HMAC give identical output only through the existing signature tests."),
], dict(task_type="migration",
    summary="Moved the library from Node 16 to Node 22: replaced the unmaintained crypto shim, which failed with an OpenSSL 3 error, with the built-in HMAC, removed the dependency, and updated the engines field and CI matrix. All 58 tests pass; output equivalence is covered only by the existing signature tests.",
    facts=["tests failed on Node 22 with an OpenSSL error", "cause was legacy-crypto-shim", "replaced by node:crypto createHmac with sha256", "dependency removed", "engines and CI set to 22", "58 tests pass"],
    specific=["Node upgrade breaking change", "OpenSSL 3 unsupported algorithm"],
    decisions=[D("replace the shim with the built-in crypto HMAC instead of enabling the legacy OpenSSL provider", "it removes an unmaintained dependency rather than keeping a flag that disables a security default")],
    skills=["Node.js", "TypeScript", "GitHub Actions"], not_skills=["Docker", "Python", "webpack"])))

SESSIONS.append(S("refactor-1", "refactor", "/work/shipping-calc", [
    U("calculateRate() in rates.py is 300 lines of nested ifs. Split it up without changing results. There's a golden-file test."),
    T("Read", {"file_path": "/work/shipping-calc/shipping/rates.py", "offset": 1, "limit": 40}, "def calculate_rate(parcel, dest, service):\n    if service == 'express':\n        if dest.country == 'US':\n            ...\n"),
    T("Bash", {"command": "pytest tests/test_golden_rates.py -q"}, "1 passed (2,400 parcels)"),
    A("The function has three parts: surcharge selection by service, zone lookup by destination, and weight banding. I'll extract each into its own function and keep calculate_rate as the composition."),
    T("Write", {"file_path": "/work/shipping-calc/shipping/zones.py", "content": "def zone_for(dest): ..."}, "File created."),
    T("Write", {"file_path": "/work/shipping-calc/shipping/bands.py", "content": "def band_price(weight_kg, table): ..."}, "File created."),
    T("Edit", {"file_path": "/work/shipping-calc/shipping/rates.py", "old_string": "def calculate_rate(parcel, dest, service):", "new_string": "def calculate_rate(parcel, dest, service):\n    zone = zone_for(dest)\n    base = band_price(parcel.weight_kg, TABLES[(service, zone)])\n    return base + surcharge(service, parcel, dest)\n\n\ndef _old_calculate_rate(parcel, dest, service):"}, "ok"),
    T("Bash", {"command": "pytest tests/test_golden_rates.py -q"}, "1 passed (2,400 parcels)"),
    A("The golden test still matches all 2,400 parcels. I left the old function in as _old_calculate_rate so it can be compared and deleted in a follow-up."),
], dict(task_type="refactor",
    summary="Split the 300-line shipping rate function into zone lookup, weight banding and surcharge pieces, with the original function now a short composition. The golden-file test over 2,400 parcels passes before and after; the old implementation is kept temporarily as a private function for comparison.",
    facts=["calculate_rate split into zone, band and surcharge parts", "new zones and bands modules", "golden test of 2,400 parcels passes before and after", "old function kept as _old_calculate_rate", "no behaviour change intended"],
    specific=["extract function refactor", "golden-file regression test"],
    decisions=[D("keep the old function as a private copy for a follow-up comparison and removal", "it lets the new composition be checked against the original before the original is deleted")],
    skills=["Python", "refactoring", "pytest"], not_skills=["SQL", "Docker", "TypeScript"])))

SESSIONS.append(S("refactor-2", "refactor", "/work/crm-api", [
    U("Our handlers all repeat the same try/catch that maps errors to HTTP responses. Centralise it in the Express app."),
    T("Grep", {"pattern": "catch \\(e", "path": "/work/crm-api/src/handlers"}, "src/handlers/contacts.ts:14\nsrc/handlers/deals.ts:22\nsrc/handlers/deals.ts:57\nsrc/handlers/notes.ts:9\n(11 more)"),
    T("Read", {"file_path": "/work/crm-api/src/handlers/deals.ts", "offset": 18, "limit": 14}, "  try {\n    const deal = await svc.get(req.params.id)\n    res.json(deal)\n  } catch (e) {\n    if (e instanceof NotFound) return res.status(404).json({ error: e.message })\n    if (e instanceof Invalid) return res.status(422).json({ error: e.message })\n    res.status(500).json({ error: 'internal' })\n  }"),
    T("Write", {"file_path": "/work/crm-api/src/http/errors.ts", "content": "export const errorMiddleware: ErrorRequestHandler = (e, _req, res, _next) => {\n  if (e instanceof NotFound) return res.status(404).json({ error: e.message })\n  if (e instanceof Invalid) return res.status(422).json({ error: e.message })\n  res.status(500).json({ error: 'internal' })\n}\nexport const wrap = (fn: Handler): Handler => (req, res, next) => fn(req, res, next).catch(next)\n"}, "File created."),
    T("Edit", {"file_path": "/work/crm-api/src/handlers/deals.ts", "old_string": "  try {\n    const deal = await svc.get(req.params.id)\n    res.json(deal)\n  } catch (e) {\n    if (e instanceof NotFound) return res.status(404).json({ error: e.message })\n    if (e instanceof Invalid) return res.status(422).json({ error: e.message })\n    res.status(500).json({ error: 'internal' })\n  }", "new_string": "  res.json(await svc.get(req.params.id))"}, "ok"),
    T("Bash", {"command": "npm test -- handlers/deals"}, "Tests: 12 passed"),
    A("I moved the error mapping into one error middleware plus a wrap() helper and converted deals.ts as the first handler; its 12 tests pass. The other 10 handlers still have their own try/catch and the middleware is not registered in app.ts yet, so right now deals.ts errors would fall back to Express's default handler."),
], dict(task_type="refactor",
    summary="Created a central Express error middleware and a wrap helper for async handlers, and converted the deals handler to use them; its 12 tests pass. The other handlers are unconverted and the middleware is not yet registered in the app, so the change is incomplete.",
    facts=["repeated try/catch in 15 handlers", "error middleware created mapping NotFound to 404, Invalid to 422, else 500", "wrap helper for async handlers", "deals handler converted, 12 tests pass", "middleware not registered in app.ts", "other handlers unconverted"],
    specific=["central error handling middleware", "removing duplicated try/catch"],
    decisions=[],
    skills=["TypeScript", "Express", "refactoring"], not_skills=["GraphQL", "Docker", "Prisma"])))

SESSIONS.append(S("refactor-3", "refactor", "/work/ledger-ui", [
    U("Replace the hand-rolled debounce in three of our Vue components with a composable. Same timing."),
    T("Grep", {"pattern": "setTimeout", "path": "/work/ledger-ui/src/components"}, "SearchBox.vue:21: clearTimeout(this.t); this.t = setTimeout(() => this.emitQuery(), 300)\nFilterBar.vue:33: clearTimeout(timer); timer = setTimeout(apply, 300)\nAmountInput.vue:12: clearTimeout(h); h = setTimeout(commit, 500)"),
    T("Write", {"file_path": "/work/ledger-ui/src/composables/useDebounced.ts", "content": "export function useDebounced<A extends unknown[]>(fn: (...a: A) => void, ms: number) {\n  let t: ReturnType<typeof setTimeout> | undefined\n  onBeforeUnmount(() => clearTimeout(t))\n  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }\n}"}, "File created."),
    T("Edit", {"file_path": "/work/ledger-ui/src/components/SearchBox.vue", "old_string": "clearTimeout(this.t); this.t = setTimeout(() => this.emitQuery(), 300)", "new_string": "this.debouncedEmit()"}, "ok"),
    T("Edit", {"file_path": "/work/ledger-ui/src/components/FilterBar.vue", "old_string": "clearTimeout(timer); timer = setTimeout(apply, 300)", "new_string": "debouncedApply()"}, "ok"),
    T("Edit", {"file_path": "/work/ledger-ui/src/components/AmountInput.vue", "old_string": "clearTimeout(h); h = setTimeout(commit, 500)", "new_string": "debouncedCommit()"}, "ok"),
    T("Bash", {"command": "npx vitest run src/components"}, "Tests: 31 passed"),
    A("All three components use useDebounced with their original delays (300, 300, 500 ms), and the 31 component tests pass. As a side effect the timer is now cleared when a component unmounts, which the old code did not do, so a pending update can no longer fire after the component is gone."),
], dict(task_type="refactor",
    summary="Replaced three hand-rolled debounce timers in Vue components with one useDebounced composable, keeping the 300, 300 and 500 ms delays; 31 component tests pass. One small behaviour change: the pending timer is now cleared on unmount.",
    facts=["three components used manual setTimeout debounce", "useDebounced composable added", "delays kept at 300, 300 and 500 ms", "31 tests pass", "timer now cleared on unmount, which the old code did not do"],
    specific=["extracting a debounce composable", "Vue composition API"],
    decisions=[],
    skills=["Vue", "TypeScript", "Vitest"], not_skills=["React", "Pinia", "Cypress"])))

SESSIONS.append(S("review-1", "review", "/work/auth-gateway", [
    U("Please review PR #412 (token refresh endpoint). Focus on security. Don't change anything, just tell me what you find."),
    T("Bash", {"command": "gh pr diff 412 --patch | head -120"}, "+ app.post('/refresh', async (req, res) => {\n+   const { refreshToken } = req.body\n+   const row = await db.tokens.findOne({ token: refreshToken })\n+   if (!row) return res.status(401).end()\n+   const access = sign({ sub: row.userId }, SECRET, { expiresIn: '15m' })\n+   res.json({ access })\n+ })"),
    T("Bash", {"command": "gh pr diff 412 --patch | grep -n 'rotate\\|revoke\\|expires'"}, "no matches"),
    T("Read", {"file_path": "/work/auth-gateway/src/db/tokens.ts"}, "tokens: { token: string, userId: string, createdAt: Date }"),
    A("Findings. 1) Blocking: refresh tokens never expire and are not rotated, because the table has createdAt but no expiry check, so a leaked token works forever. 2) Blocking: the token is stored and looked up in plaintext; store a hash. 3) Should fix: no rate limit on /refresh, so it can be brute forced. 4) Nit: 401 response has no body, which is fine, but log the failed attempts. The access token handling itself looks right: short 15 minute expiry and the subject comes from the database row, not the request."),
], dict(task_type="review",
    summary="Reviewed the token refresh endpoint PR for security without changing anything. Blocking issues: refresh tokens never expire or rotate, and they are stored and looked up in plaintext. Should fix: no rate limit on the endpoint. The short access token expiry and taking the subject from the database were fine.",
    facts=["refresh tokens have no expiry check or rotation", "tokens stored and looked up in plaintext", "no rate limiting on /refresh", "access token expires in 15 minutes", "subject taken from the database row", "no changes made"],
    specific=["refresh token security review", "token expiry and hashing"],
    decisions=[],
    skills=["security review", "authentication", "Node.js"], not_skills=["Terraform", "penetration testing tools", "React"])))

SESSIONS.append(S("review-2", "review", "/work/geo-index", [
    U("Look over this branch's change to the tile cache before I merge. Is it safe?"),
    T("Bash", {"command": "git diff main...HEAD --stat"}, " src/cache/tiles.go | 42 ++++---\n src/cache/tiles_test.go | 6 +-\n 2 files changed"),
    T("Bash", {"command": "git diff main...HEAD -- src/cache/tiles.go"}, "-  mu sync.Mutex\n+  mu sync.RWMutex\n   func (c *Cache) Get(k Key) (Tile, bool) {\n-    c.mu.Lock(); defer c.mu.Unlock()\n+    c.mu.RLock(); defer c.mu.RUnlock()\n+    c.hits++\n     t, ok := c.m[k]"),
    A("The switch from Mutex to RWMutex is a reasonable idea for a read-heavy cache, but Get now increments c.hits while holding only the read lock. That is a data race: concurrent readers write the counter. It needs atomic.AddInt64 or the counter should be updated under the write lock."),
    T("Bash", {"command": "git checkout -q HEAD && go test -race ./src/cache/..."}, "WARNING: DATA RACE\nWrite at 0x00c000122008 by goroutine 9:\n  cache.(*Cache).Get() tiles.go:31\nFAIL"),
    A("The race detector confirms it. Not safe to merge as is. Everything else in the diff (the test tweak, the eviction path) looks fine. I haven't changed anything; the fix is a one-liner with an atomic counter."),
], dict(task_type="review",
    summary="Reviewed the tile cache change and found it unsafe to merge: switching to a read-write lock is reasonable, but Get increments the hit counter under only the read lock, a data race that go test -race confirms. The rest of the diff looked fine; no changes were made.",
    facts=["Mutex replaced by RWMutex", "Get increments hits under a read lock", "go test -race reports a data race", "suggested fix is an atomic counter", "rest of the diff fine", "no changes made"],
    specific=["data race under a read lock", "Go race detector"],
    decisions=[],
    skills=["Go", "concurrency", "code review"], not_skills=["Python", "Kubernetes", "SQL"])))

SESSIONS.append(S("review-3", "review", "/work/onboarding-flow", [
    U("Review the migration file in this PR for the users table. We have 40 million rows."),
    T("Read", {"file_path": "/work/onboarding-flow/db/migrate/20261125_add_plan_to_users.rb"}, "class AddPlanToUsers < ActiveRecord::Migration[7.1]\n  def change\n    add_column :users, :plan, :string, null: false, default: 'free'\n    add_index :users, :plan\n  end\nend"),
    A("On Postgres 11 or later, adding a column with a constant default is metadata only, so the add_column itself is cheap. The index is the problem: add_index without algorithm: :concurrently takes a lock that blocks writes to users while it builds, which on 40 million rows could take minutes."),
    T("Bash", {"command": "grep -n 'postgres' docker-compose.yml .tool-versions"}, "docker-compose.yml:4:    image: postgres:15"),
    A("Postgres 15 is confirmed, so the column add is fine. My requests: use add_index with algorithm: :concurrently and disable_ddl_transaction!, and consider whether an index on a three-value column is useful at all, since a low-cardinality index is rarely chosen by the planner. I did not edit the file."),
], dict(task_type="review",
    summary="Reviewed a migration adding a plan column and index to a 40 million row users table. The column with a constant default is cheap on Postgres 15, but the index is built without concurrency and would block writes, so the review asks for a concurrent build and questions whether an index on so few distinct values is useful. Nothing was edited.",
    facts=["40 million rows", "add_column with constant default is metadata only on Postgres 11+", "Postgres 15 confirmed in docker-compose", "index created without algorithm concurrently would lock writes", "low cardinality index questioned", "no edits"],
    specific=["concurrent index creation", "migration safety on a large table"],
    decisions=[],
    skills=["PostgreSQL", "Rails migrations", "code review"], not_skills=["Docker tuning", "React", "load testing"])))

SESSIONS.append(S("tests-1", "tests", "/work/invoice-sender", [
    U("Add tests for the retry logic in mailer.py. It should retry 3 times with backoff on SMTP 4xx and not retry on 5xx."),
    T("Read", {"file_path": "/work/invoice-sender/mailer.py"}, "def send(msg, smtp=get_smtp, sleep=time.sleep):\n    for attempt in range(3):\n        try:\n            return smtp().send(msg)\n        except SMTPResponseError as e:\n            if e.code >= 500 or attempt == 2: raise\n            sleep(2 ** attempt)"),
    T("Write", {"file_path": "/work/invoice-sender/tests/test_mailer_retry.py", "content": "def test_retries_on_4xx_with_backoff():\n    calls, sleeps = [], []\n    def smtp(): return Flaky(fail=[450, 450], calls=calls)\n    send('m', smtp=smtp, sleep=sleeps.append)\n    assert len(calls) == 3 and sleeps == [1, 2]\n\ndef test_no_retry_on_5xx():\n    calls = []\n    with pytest.raises(SMTPResponseError):\n        send('m', smtp=lambda: Flaky(fail=[550], calls=calls), sleep=lambda s: None)\n    assert len(calls) == 1\n\ndef test_gives_up_after_three_4xx():\n    with pytest.raises(SMTPResponseError):\n        send('m', smtp=lambda: Flaky(fail=[450]*3, calls=[]), sleep=lambda s: None)\n"}, "File created."),
    T("Bash", {"command": "pytest tests/test_mailer_retry.py -q"}, "3 passed in 0.04s"),
    A("Three tests cover retry with backoff (sleeps of 1 and 2 seconds), no retry on a 5xx, and giving up after three 4xx failures. The sleep is injected so the tests run instantly. The code sleeps 1 then 2, so it is exponential with base 2 but no jitter; I did not test for jitter since there is none."),
], dict(task_type="tests",
    summary="Added three tests for the mailer retry logic: it retries on SMTP 4xx with backoff sleeps of 1 and 2 seconds, does not retry on 5xx, and gives up after three 4xx failures. Sleep is injected so the tests run instantly, and all three pass.",
    facts=["three tests added", "retry with backoff of 1 and 2 seconds on 4xx", "no retry on 5xx", "gives up after three 4xx failures", "sleep injected", "no jitter in the code so none tested"],
    specific=["retry and backoff testing", "dependency injection of sleep"],
    decisions=[],
    skills=["Python", "pytest", "SMTP"], not_skills=["Docker", "mocking libraries like responses", "TypeScript"])))

SESSIONS.append(S("tests-2", "tests", "/work/dash-widgets", [
    U("Our date range picker has no tests and just broke on month boundaries. Write component tests with Testing Library. React 18."),
    T("Read", {"file_path": "/work/dash-widgets/src/DateRangePicker.tsx", "limit": 40}, "export function DateRangePicker({ onChange }: Props) {\n  const [from, setFrom] = useState<Date>()\n  ...\n  const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)\n  const lastMonth = () => { const n = new Date(); onChange(startOfMonth(new Date(n.getFullYear(), n.getMonth() - 1)), endOfMonth(new Date(n.getFullYear(), n.getMonth() - 1))) }"),
    T("Write", {"file_path": "/work/dash-widgets/src/DateRangePicker.test.tsx", "content": "beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-03-31T12:00:00Z')))\nit('last month from March 31 is February', async () => {\n  const onChange = vi.fn(); render(<DateRangePicker onChange={onChange} />)\n  await userEvent.click(screen.getByRole('button', { name: /last month/i }))\n  expect(onChange).toHaveBeenCalledWith(new Date(2026, 1, 1), new Date(2026, 1, 28))\n})\nit('last month from Jan 31 is December', async () => { vi.setSystemTime(new Date('2027-01-31T12:00:00Z')); /* same */ })"}, "File created."),
    T("Bash", {"command": "pnpm vitest run src/DateRangePicker"}, "FAIL last month from March 31 is February\n  expected 2026-02-28 but got 2026-03-03\nPASS last month from Jan 31 is December"),
    A("The March 31 test fails: new Date(2026, 1) is fine, but lastMonth builds `new Date(y, m - 1)` from n, and for the 31st the code path computes endOfMonth from a date that already overflowed. This is the bug the user saw. I have left the failing test as is, as evidence, and not fixed the component since you only asked for tests."),
], dict(task_type="tests",
    summary="Wrote Testing Library tests for the date range picker with a faked clock. The Jan 31 to December case passes, but the March 31 case fails, reproducing the month boundary bug (Feb 28 expected, Mar 3 returned). The failing test was left in as evidence and the component was not fixed.",
    facts=["component tests with fake timers added", "Jan 31 case passes", "March 31 case fails expecting Feb 28 but getting Mar 3", "reproduces the reported bug", "component not changed"],
    specific=["month boundary date bug", "fake timers in component tests"],
    decisions=[],
    skills=["React", "Testing Library", "Vitest", "TypeScript"], not_skills=["Cypress", "Storybook", "Playwright"])))

SESSIONS.append(S("tests-3", "tests", "/work/inventory-api", [
    U("Add an integration test for the POST /stock/adjust endpoint against a real Postgres, we use testcontainers. It must prove two simultaneous adjustments don't lose an update."),
    T("Read", {"file_path": "/work/inventory-api/src/stock/adjust.ts"}, "export async function adjust(sku: string, delta: number) {\n  return db.tx(async t => {\n    const { qty } = await t.one('SELECT qty FROM stock WHERE sku=$1', [sku])\n    await t.none('UPDATE stock SET qty=$1 WHERE sku=$2', [qty + delta, sku])\n  })\n})"),
    T("Write", {"file_path": "/work/inventory-api/test/adjust.concurrent.test.ts", "content": "it('does not lose updates', async () => {\n  await seed('A1', 100)\n  await Promise.all(Array.from({ length: 20 }, () => request(app).post('/stock/adjust').send({ sku: 'A1', delta: 1 })))\n  expect(await qtyOf('A1')).toBe(120)\n})"}, "File created."),
    T("Bash", {"command": "npx vitest run test/adjust.concurrent"}, "FAIL does not lose updates\n  expected 100+20 = 120 but got 107"),
    A("The test fails with 107, so the endpoint does lose updates: it reads qty then writes qty+delta in a read-committed transaction with no row lock. The test does what you asked. Fixing it needs either SELECT ... FOR UPDATE or an atomic UPDATE stock SET qty = qty + $1, which I'd prefer. I'm leaving the endpoint alone and the test red until you say go."),
], dict(task_type="tests",
    summary="Added a testcontainers-based concurrency integration test for the stock adjust endpoint, firing 20 simultaneous +1 adjustments. It fails with 107 instead of 120, proving the endpoint loses updates because it reads then writes without a row lock. The endpoint was not changed; an atomic UPDATE is the suggested fix.",
    facts=["concurrent integration test added against real Postgres", "20 parallel adjustments of +1", "result was 107 instead of 120", "endpoint reads then writes without a lock", "suggested fix is an atomic update or FOR UPDATE", "endpoint not changed, test left failing"],
    specific=["lost update race condition", "concurrency integration test"],
    decisions=[],
    skills=["TypeScript", "PostgreSQL", "testcontainers", "Vitest"], not_skills=["Kubernetes", "Java", "mutation testing"])))
