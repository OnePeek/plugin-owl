# Source of evals/sessions/*.json (run: python3 evals/gen/make.py). Realistic synthetic sessions with reference answers (AIP-I1).
from common import U, A, T, S

SESSIONS = []

# ---------------- bugfix x3 ----------------
SESSIONS.append(S("bugfix-1", "bugfix", "/work/storefront", [
    U("Prices on the product page are sometimes stale right after our nightly bulk price update. Find out why and fix it."),
    A("I'll look at how the price cache is filled and when it is invalidated."),
    T("Read", {"file_path": "/work/storefront/src/pricing/cache.ts"}, "export async function getPrice(id){ const hit=await redis.get('price:'+id); if(hit) return hit; const p=await db.price(id); await redis.set('price:'+id,p,'EX',3600); return p }\nexport async function invalidate(ids){ await redis.del(ids.map(i=>'price:'+i)) }"),
    T("Read", {"file_path": "/work/storefront/src/jobs/bulkPriceUpdate.ts"}, "await db.tx(async t=>{ for (const u of updates) await t.setPrice(u.id,u.price) }); await invalidate(updates.map(u=>u.id))"),
    A("Found it: invalidate runs right after the transaction, but a reader that missed the cache just before the commit can refill the key with the old price after the delete. That is a classic race between invalidation and refill."),
    T("Edit", {"file_path": "/work/storefront/src/pricing/cache.ts", "old_string": "const hit=await redis.get('price:'+id);", "new_string": "const ver=await redis.get('pricever:'+id)||'0';\n  const hit=await redis.get('price:'+id+':'+ver);"}, "edited"),
    T("Edit", {"file_path": "/work/storefront/src/pricing/cache.ts", "old_string": "export async function invalidate(ids){ await redis.del(ids.map(i=>'price:'+i)) }", "new_string": "export async function invalidate(ids){ await Promise.all(ids.map(i=>redis.incr('pricever:'+i))) }"}, "edited"),
    T("Bash", {"command": "npm test -- pricing"}, "FAIL cache.test.ts expected version key", True),
    T("Edit", {"file_path": "/work/storefront/src/pricing/cache.test.ts", "old_string": "expect(await redis.get('price:1')).toBe('10')", "new_string": "expect(await redis.get('price:1:0')).toBe('10')"}, "edited"),
    T("Bash", {"command": "npm test -- pricing"}, "12 passed"),
    A("Fixed: entries are now keyed by a version counter that invalidation increments, so a late refill writes under the old version and is never read."),
], dict(
    task_type="bugfix",
    summary="Fixed stale prices after bulk updates, caused by a race where a reader refilled the cache with the old price after invalidation; cache entries are now versioned so invalidation bumps a counter instead of deleting keys.",
    facts=["stale prices after a nightly bulk update", "race between cache invalidation and refill", "cache keys now carry a version that invalidation increments", "pricing tests pass at the end", "a test expectation was updated for the versioned key"],
    specific=["race condition between invalidation and refill", "cache versioning"],
    decisions=[dict(choice="version the cache key instead of deleting it on invalidation", reason="a late refill with the old value can no longer overwrite fresh data because it lands under the old version")],
    skills=["Redis", "TypeScript", "cache invalidation", "race condition debugging"], not_skills=["Docker", "Kubernetes", "GraphQL"])))

SESSIONS.append(S("bugfix-2", "bugfix", "/work/ledger-api", [
    U("Invoice totals are off by a cent for some customers. Example: three lines of 3.33 should total 9.99 but we show 10.00."),
    T("Grep", {"pattern": "toFixed|Math.round"}, "src/invoice/total.ts:18: total += Number((line.qty*line.price).toFixed(2))\nsrc/invoice/total.ts:25: return Math.round(total*100)/100"),
    T("Read", {"file_path": "/work/ledger-api/src/invoice/total.ts"}, "let total=0; for (const line of lines) total += Number((line.qty*line.price).toFixed(2)); return Math.round(total*100)/100"),
    A("The totals are computed with binary floating point and rounded per line, then again at the end, so rounding errors accumulate. Money should be summed as integer minor units."),
    T("Write", {"file_path": "/work/ledger-api/src/invoice/money.ts", "content": "export const toMinor = (v: string) => Math.round(parseFloat(v) * 100);\nexport const fromMinor = (m: number) => (m / 100).toFixed(2);\n"}, "created"),
    T("Edit", {"file_path": "/work/ledger-api/src/invoice/total.ts", "old_string": "let total=0; for (const line of lines) total += Number((line.qty*line.price).toFixed(2)); return Math.round(total*100)/100", "new_string": "let minor=0; for (const line of lines) minor += line.qty * toMinor(line.price); return fromMinor(minor)"}, "edited"),
    T("Edit", {"file_path": "/work/ledger-api/src/invoice/total.test.ts", "old_string": "// TODO regression", "new_string": "it('sums three 3.33 lines to 9.99', () => { expect(total(lines)).toBe('9.99') })"}, "edited"),
    T("Bash", {"command": "npx vitest run src/invoice"}, "Tests 9 passed"),
], dict(
    task_type="bugfix",
    summary="Fixed invoice totals that were off by a cent by replacing per-line floating point rounding with integer minor-unit arithmetic, and added a regression test for the three-line case.",
    facts=["totals off by one cent", "floating point rounding accumulated per line", "now summed as integer minor units", "regression test added", "tests pass"],
    specific=["floating point rounding in money arithmetic", "integer minor units"],
    decisions=[dict(choice="sum money as integer minor units instead of rounding floats", reason="binary floating point plus per-line rounding accumulates error, integers are exact")],
    skills=["TypeScript", "Vitest", "money arithmetic"], not_skills=["Redis", "SQL", "Docker"])))

SESSIONS.append(S("bugfix-3", "bugfix", "/work/mobile-app", [
    U("The Android app crashes on the settings screen when the user rotates the phone. Stack trace says NullPointerException in SettingsFragment."),
    T("Read", {"file_path": "/work/mobile-app/app/src/main/java/ui/SettingsFragment.kt"}, "class SettingsFragment: Fragment(){ var adapter: SettingsAdapter? = null\n override fun onCreateView(...){ adapter = SettingsAdapter(viewModel.items) ... }\n fun refresh(){ adapter!!.notifyDataSetChanged() } }"),
    T("Grep", {"pattern": "refresh\\("}, "viewModel.kt:44: callback = { fragment.refresh() }"),
    A("The ViewModel keeps a callback to the old fragment instance. After rotation the fragment is recreated, but the callback still calls refresh on the destroyed one, whose adapter is null. It is a lifecycle leak, not a simple null check problem."),
    T("Edit", {"file_path": "/work/mobile-app/app/src/main/java/ui/viewModel.kt", "old_string": "callback = { fragment.refresh() }", "new_string": "val items = MutableLiveData<List<Item>>()"}, "edited"),
    T("Edit", {"file_path": "/work/mobile-app/app/src/main/java/ui/SettingsFragment.kt", "old_string": "fun refresh(){ adapter!!.notifyDataSetChanged() }", "new_string": "override fun onViewCreated(v: View, s: Bundle?){ viewModel.items.observe(viewLifecycleOwner){ adapter?.submit(it) } }"}, "edited"),
    T("Bash", {"command": "./gradlew testDebugUnitTest"}, "BUILD SUCCESSFUL"),
    A("The settings screen now observes LiveData with the view lifecycle, so rotation recreates the observer and no stale fragment is referenced."),
], dict(
    task_type="bugfix",
    summary="Fixed an Android crash on rotating the settings screen: the view model held a callback to a destroyed fragment; replaced it with lifecycle-aware LiveData observation.",
    facts=["crash on rotation", "NullPointerException in the settings fragment", "view model kept a callback to the destroyed fragment", "replaced by LiveData observed with the view lifecycle", "unit tests pass"],
    specific=["lifecycle leak after configuration change", "LiveData observation"],
    decisions=[dict(choice="observe LiveData with the view lifecycle instead of adding a null check", reason="the callback referenced a destroyed fragment so a null check would hide the leak")],
    skills=["Kotlin", "Android", "LiveData", "Gradle"], not_skills=["Redis", "React", "PostgreSQL"])))

# ---------------- feature x3 ----------------
SESSIONS.append(S("feature-1", "feature", "/work/helpdesk", [
    U("Add CSV export to the tickets list. It should respect the current filters and handle 100k rows without blowing up memory."),
    T("Read", {"file_path": "/work/helpdesk/src/routes/tickets.ts"}, "router.get('/tickets', async (req,res)=>{ const rows = await repo.list(req.query); res.json(rows) })"),
    T("Read", {"file_path": "/work/helpdesk/src/repo/tickets.ts"}, "list(filters){ return db('tickets').where(build(filters)) }"),
    A("Loading everything into an array would not survive 100k rows. I will stream rows from the database cursor straight into the response through a CSV stringifier."),
    T("Bash", {"command": "npm install csv-stringify"}, "added 1 package"),
    T("Edit", {"file_path": "/work/helpdesk/src/repo/tickets.ts", "old_string": "list(filters){ return db('tickets').where(build(filters)) }", "new_string": "list(filters){ return db('tickets').where(build(filters)) }\nstream(filters){ return db('tickets').where(build(filters)).stream() }"}, "edited"),
    T("Edit", {"file_path": "/work/helpdesk/src/routes/tickets.ts", "old_string": "router.get('/tickets'", "new_string": "router.get('/tickets.csv', (req,res)=>{ res.setHeader('Content-Type','text/csv'); pipeline(repo.stream(req.query), stringify({header:true}), res, ()=>{}) })\nrouter.get('/tickets'"}, "edited"),
    T("Write", {"file_path": "/work/helpdesk/src/routes/tickets.csv.test.ts", "content": "it('streams 100k rows with flat memory', async () => { /* ... */ })\nit('applies the status filter', async () => { /* ... */ })\n"}, "created"),
    T("Bash", {"command": "npm test -- tickets.csv"}, "2 passed"),
], dict(
    task_type="feature",
    summary="Added a CSV export for the tickets list that honours the active filters and streams rows from a database cursor through a CSV stringifier so 100k rows do not load into memory.",
    facts=["CSV export of tickets", "respects the current filters", "streams from a database cursor", "a CSV library was added", "tests for streaming and filtering pass"],
    specific=["streaming export", "database cursor"],
    decisions=[dict(choice="stream rows from the database cursor instead of building an array", reason="100k rows would not fit comfortably in memory")],
    skills=["Node.js", "streams", "CSV", "SQL"], not_skills=["Docker", "Kubernetes", "Redis"])))

SESSIONS.append(S("feature-2", "feature", "/work/dashboard-web", [
    U("Add a dark mode toggle to the dashboard. It should follow the OS setting by default and remember the person's choice."),
    T("Read", {"file_path": "/work/dashboard-web/src/theme/tokens.css"}, ":root{ --bg:#fff; --fg:#111; --accent:#5b3df5 }"),
    T("Write", {"file_path": "/work/dashboard-web/src/theme/dark.css", "content": ":root[data-theme='dark']{ --bg:#111; --fg:#eee; --accent:#8f7bff }\n@media (prefers-color-scheme: dark){ :root:not([data-theme='light']){ --bg:#111; --fg:#eee; --accent:#8f7bff } }\n"}, "created"),
    T("Write", {"file_path": "/work/dashboard-web/src/theme/useTheme.ts", "content": "export function useTheme(){ const [t,setT]=useState(localStorage.getItem('theme')); useEffect(()=>{ if(t) document.documentElement.dataset.theme=t; else delete document.documentElement.dataset.theme },[t]); return [t,setT] }\n"}, "created"),
    A("Using a data attribute with a prefers-color-scheme fallback means the OS setting applies until the person chooses, and the choice only needs one stored value."),
    T("Edit", {"file_path": "/work/dashboard-web/src/layout/Header.tsx", "old_string": "<Avatar />", "new_string": "<ThemeToggle /><Avatar />"}, "edited"),
    T("Bash", {"command": "npm run lint"}, "no problems"),
    T("Bash", {"command": "npm test"}, "31 passed"),
], dict(
    task_type="feature",
    summary="Added a dark mode toggle to the dashboard that follows the operating system preference by default and stores an explicit choice, implemented with CSS variables switched by a data attribute.",
    facts=["dark mode toggle", "follows OS setting by default", "choice remembered in local storage", "CSS variables with a data attribute", "lint and tests pass"],
    specific=["CSS custom properties theming", "prefers-color-scheme"],
    decisions=[dict(choice="switch theme with a data attribute plus a prefers-color-scheme fallback", reason="the OS setting applies until the person chooses and only one value needs storing")],
    skills=["React", "CSS", "TypeScript"], not_skills=["Docker", "SQL", "Redis"])))

SESSIONS.append(S("feature-3", "feature", "/work/notifier", [
    U("We need rate limiting on the public API: 100 requests per minute per API key, with proper 429 responses and a Retry-After header."),
    T("Read", {"file_path": "/work/notifier/src/middleware/index.ts"}, "app.use(auth); app.use(routes)"),
    A("A fixed window counter allows bursts at window edges. A sliding window log is exact but costly. I will use a token bucket per key in Redis with an atomic Lua script, which gives smooth limits and one round trip."),
    T("Write", {"file_path": "/work/notifier/src/middleware/rateLimit.ts", "content": "const script = `local t=redis.call('time') ... return {allowed, retry}`\nexport const rateLimit = (limit=100, per=60) => async (req,res,next)=>{ const [ok,retry]=await redis.eval(script,1,'rl:'+req.apiKey,limit,per); if(!ok){ res.set('Retry-After',String(retry)); return res.status(429).json({error:'rate_limited'}) } next() }\n"}, "created"),
    T("Edit", {"file_path": "/work/notifier/src/middleware/index.ts", "old_string": "app.use(auth);", "new_string": "app.use(auth); app.use(rateLimit());"}, "edited"),
    T("Write", {"file_path": "/work/notifier/src/middleware/rateLimit.test.ts", "content": "it('returns 429 with Retry-After after 100 calls', async()=>{})\nit('isolates keys', async()=>{})\n"}, "created"),
    T("Bash", {"command": "npm test -- rateLimit"}, "2 passed"),
], dict(
    task_type="feature",
    summary="Added per-API-key rate limiting of 100 requests per minute to the public API, using a Redis token bucket in an atomic Lua script, returning 429 with a Retry-After header.",
    facts=["100 requests per minute per API key", "429 with Retry-After", "token bucket in Redis with a Lua script", "tests for limit and key isolation pass"],
    specific=["token bucket rate limiting", "atomic Redis script"],
    decisions=[dict(choice="token bucket in an atomic Lua script over a fixed window counter", reason="fixed windows allow bursts at the edges while the script gives smooth limits in one round trip")],
    skills=["Redis", "Lua", "Express", "rate limiting"], not_skills=["Docker", "GraphQL", "React"])))

# ---------------- refactor x3 ----------------
SESSIONS.append(S("refactor-1", "refactor", "/work/billing", [
    U("The PaymentService class is 1,200 lines and does everything. Split it up without changing behaviour."),
    T("Read", {"file_path": "/work/billing/src/PaymentService.ts"}, "class PaymentService { charge(){...} refund(){...} sendReceipt(){...} calcTax(){...} syncLedger(){...} ... }"),
    T("Bash", {"command": "npm test"}, "148 passed"),
    A("Tests are green before I start, so I can use them as the safety net. Tax calculation and receipts have no shared state with charging, so they extract cleanly; ledger sync shares the transaction object, so I will pass it in rather than reach for a global."),
    T("Write", {"file_path": "/work/billing/src/tax/TaxCalculator.ts", "content": "export class TaxCalculator { calc(order){} }\n"}, "created"),
    T("Write", {"file_path": "/work/billing/src/receipts/ReceiptSender.ts", "content": "export class ReceiptSender { send(payment){} }\n"}, "created"),
    T("Write", {"file_path": "/work/billing/src/ledger/LedgerSync.ts", "content": "export class LedgerSync { sync(tx, payment){} }\n"}, "created"),
    T("Edit", {"file_path": "/work/billing/src/PaymentService.ts", "old_string": "calcTax(){...} sendReceipt(){...} syncLedger(){...}", "new_string": "constructor(private tax: TaxCalculator, private receipts: ReceiptSender, private ledger: LedgerSync){}"}, "edited"),
    T("Bash", {"command": "npm test"}, "148 passed"),
    A("Same 148 tests pass; PaymentService is now about 400 lines and delegates to three collaborators injected through the constructor."),
], dict(
    task_type="refactor",
    summary="Split a 1,200 line payment service into tax, receipt and ledger collaborators injected through the constructor, keeping behaviour identical as shown by the same 148 passing tests before and after.",
    facts=["payment service split", "tax receipts and ledger extracted", "constructor injection", "148 tests passed before and after"],
    specific=["extract class", "dependency injection"],
    decisions=[dict(choice="pass the transaction into the ledger collaborator instead of using shared global state", reason="ledger sync shares the transaction object with charging")],
    skills=["TypeScript", "refactoring", "dependency injection"], not_skills=["Redis", "Docker", "GraphQL"])))

SESSIONS.append(S("refactor-2", "refactor", "/work/analytics-ui", [
    U("Convert our class components in src/charts to function components with hooks. No visual changes."),
    T("Glob", {"pattern": "src/charts/**/*.tsx"}, "src/charts/LineChart.tsx\nsrc/charts/BarChart.tsx\nsrc/charts/Legend.tsx"),
    T("Read", {"file_path": "/work/analytics-ui/src/charts/LineChart.tsx"}, "class LineChart extends React.Component { state={hover:null}; componentDidMount(){ window.addEventListener('resize', this.onResize) } componentWillUnmount(){ window.removeEventListener('resize', this.onResize) } ... }"),
    T("Edit", {"file_path": "/work/analytics-ui/src/charts/LineChart.tsx", "old_string": "class LineChart extends React.Component { state={hover:null};", "new_string": "function LineChart(props){ const [hover,setHover]=useState(null); useEffect(()=>{ window.addEventListener('resize', onResize); return ()=>window.removeEventListener('resize', onResize) },[]);"}, "edited"),
    T("Edit", {"file_path": "/work/analytics-ui/src/charts/BarChart.tsx", "old_string": "class BarChart extends React.Component {", "new_string": "function BarChart(props){ const ref=useRef(null);"}, "edited"),
    T("Edit", {"file_path": "/work/analytics-ui/src/charts/Legend.tsx", "old_string": "class Legend extends React.PureComponent {", "new_string": "const Legend = React.memo(function Legend(props){"}, "edited"),
    T("Bash", {"command": "npm run test:snapshots"}, "Snapshots: 14 passed, 0 updated"),
    T("Bash", {"command": "npm run typecheck"}, "ok"),
], dict(
    task_type="refactor",
    summary="Converted three chart class components to function components with hooks, moving resize listener setup into effects with cleanup and using memo for the pure legend; snapshot tests show no visual change.",
    facts=["three chart components converted", "hooks with effect cleanup for resize listener", "snapshots unchanged", "typecheck passes"],
    specific=["class to function component migration", "effect cleanup"],
    decisions=[],
    skills=["React", "TypeScript", "hooks"], not_skills=["Redis", "SQL", "Docker"])))

SESSIONS.append(S("refactor-3", "refactor", "/work/etl-service", [
    U("Our three importers each copy-paste the same retry-with-backoff code. Pull it into one helper."),
    T("Grep", {"pattern": "attempt <"}, "import/shopify.py:41\nimport/stripe.py:38\nimport/hubspot.py:52"),
    T("Read", {"file_path": "/work/etl-service/import/stripe.py"}, "for attempt in range(5):\n    try: return call()\n    except Timeout: time.sleep(2**attempt)\nraise"),
    A("The three copies differ slightly: one retries on HTTP 429 as well, and one has no jitter. A shared helper should take the retryable exceptions as a parameter and add jitter, otherwise concurrent workers retry in lockstep."),
    T("Write", {"file_path": "/work/etl-service/common/retry.py", "content": "def retry(call, retry_on=(Timeout,), attempts=5, base=1.0):\n    for n in range(attempts):\n        try: return call()\n        except retry_on:\n            time.sleep(base * 2**n * random.uniform(0.5, 1.5))\n    raise\n"}, "created"),
    T("Edit", {"file_path": "/work/etl-service/import/stripe.py", "old_string": "for attempt in range(5):\n    try: return call()\n    except Timeout: time.sleep(2**attempt)\nraise", "new_string": "return retry(call)"}, "edited"),
    T("Edit", {"file_path": "/work/etl-service/import/shopify.py", "old_string": "for attempt in range(5): ...", "new_string": "return retry(call, retry_on=(Timeout, RateLimited))"}, "edited"),
    T("Edit", {"file_path": "/work/etl-service/import/hubspot.py", "old_string": "for attempt in range(5): ...", "new_string": "return retry(call)"}, "edited"),
    T("Bash", {"command": "pytest tests/import -q"}, "27 passed"),
], dict(
    task_type="refactor",
    summary="Replaced three copy-pasted retry loops in the importers with one shared retry helper that takes the retryable exceptions as a parameter and adds jitter to the backoff; the import tests still pass.",
    facts=["three importers had duplicated retry code", "one helper", "retryable exceptions are a parameter", "jitter added", "tests pass"],
    specific=["exponential backoff with jitter", "extract shared helper"],
    decisions=[dict(choice="add jitter and make retryable exceptions a parameter", reason="concurrent workers would otherwise retry in lockstep and one importer also retries on rate limits")],
    skills=["Python", "pytest", "retry with backoff"], not_skills=["Docker", "React", "Kubernetes"])))
