# Held-out set 3, part B (docs, feature, infra, migration). Written before any run; never tuned on.
from common import U, A, T, S
from h3a import D

SESSIONS = []

SESSIONS.append(S("docs-1", "docs", "/work/pdf-toolkit", [
    U("Our README's install section is out of date, we moved from setup.py to pyproject with uv. Update it and add a short troubleshooting section for the poppler error."),
    T("Read", {"file_path": "/work/pdf-toolkit/README.md"}, "## Install\n\n    pip install -r requirements.txt\n    python setup.py install\n\n## Usage\n..."),
    T("Read", {"file_path": "/work/pdf-toolkit/pyproject.toml"}, "[project]\nname = \"pdf-toolkit\"\nrequires-python = \">=3.11\"\n[project.scripts]\npdftk-lite = \"pdf_toolkit.cli:main\""),
    T("Grep", {"pattern": "poppler|PDFInfoNotInstalledError", "path": "/work/pdf-toolkit"}, "src/pdf_toolkit/render.py:12: from pdf2image import convert_from_path  # needs poppler"),
    T("Edit", {"file_path": "/work/pdf-toolkit/README.md", "old_string": "    pip install -r requirements.txt\n    python setup.py install", "new_string": "    uv sync\n    uv run pdftk-lite --help\n\nPython 3.11 or newer is required."}, "ok"),
    T("Edit", {"file_path": "/work/pdf-toolkit/README.md", "old_string": "## Usage", "new_string": "## Troubleshooting\n\n**`PDFInfoNotInstalledError: Unable to get page count`**: the page renderer needs the poppler utilities. Install them with `brew install poppler` (macOS) or `apt install poppler-utils` (Debian/Ubuntu), then retry.\n\n## Usage"}, "ok"),
    A("README now uses uv for install, states the Python 3.11 requirement taken from pyproject, and has a troubleshooting entry for the poppler error. I did not run the commands in a clean environment."),
], dict(task_type="docs",
    summary="Updated the README install section from setup.py and pip to uv with the Python 3.11 requirement, and added a troubleshooting entry explaining the poppler error and how to install it on macOS and Debian. The instructions were not tried in a clean environment.",
    facts=["install switched to uv", "Python 3.11 or newer stated", "troubleshooting section for the poppler error", "install commands for macOS and Debian/Ubuntu", "not run in a clean environment"],
    specific=["README install instructions", "poppler dependency of pdf2image"],
    decisions=[],
    skills=["technical writing", "Python packaging", "uv"], not_skills=["Sphinx", "CI configuration", "Docker"])))

SESSIONS.append(S("docs-2", "docs", "/work/payments-api", [
    U("Write an ADR for why we chose idempotency keys stored in Redis with a 24 hour TTL for the charge endpoint instead of a unique constraint in Postgres. Look at the docs/adr folder for our format."),
    T("Bash", {"command": "ls docs/adr && sed -n 1,25p docs/adr/0007-event-bus.md"}, "0001-monorepo.md ... 0007-event-bus.md\n# 0007. Event bus\nStatus: accepted\n## Context\n## Decision\n## Consequences"),
    T("Grep", {"pattern": "Idempotency-Key", "path": "/work/payments-api/src"}, "src/charges/middleware.ts:14: const key = req.header('Idempotency-Key')\nsrc/charges/middleware.ts:19: const hit = await redis.set(`idem:${key}`, 'pending', 'EX', 86400, 'NX')"),
    T("Write", {"file_path": "/work/payments-api/docs/adr/0008-idempotency-keys-in-redis.md", "content": "# 0008. Idempotency keys in Redis\n\nStatus: accepted\n\n## Context\nClients retry charge requests on timeouts. A repeated request with the same Idempotency-Key must not charge twice.\n\n## Decision\nStore each key in Redis with SET NX and a 24 hour TTL. The first request wins; later requests with the same key return the stored response or 409 while it is pending.\n\n## Alternatives\nA unique constraint in Postgres would be durable but adds a write to the hot path and keeps keys forever, which needs a cleanup job.\n\n## Consequences\nKeys expire after 24 hours, so retries later than that are treated as new charges. A Redis outage disables the check; the endpoint then fails closed with 503.\n"}, "File created."),
    A("The ADR is written in the same section layout as 0007. One thing I could not confirm from the code is the fail-closed 503 on Redis outage: the middleware I read does not show that branch, so please check it before merging or tell me to drop the sentence."),
], dict(task_type="docs",
    summary="Wrote ADR 0008 on storing idempotency keys in Redis with a 24 hour TTL rather than a Postgres unique constraint, following the format of the existing ADRs. It flags that the fail-closed 503 on Redis outage was not confirmed in the code and needs checking.",
    facts=["ADR 0008 added in docs/adr", "uses the existing ADR section format", "Redis SET NX with a 24 hour TTL", "Postgres unique constraint considered as the alternative", "retries after 24 hours count as new charges", "fail-closed 503 behaviour unverified"],
    specific=["architecture decision record", "idempotency key design"],
    decisions=[D("Redis keys with a 24 hour TTL instead of a Postgres unique constraint", "it avoids an extra write on the hot path and the need for a cleanup job, at the cost of keys expiring")],
    skills=["technical writing", "Redis", "API design"], not_skills=["TypeScript refactoring", "load testing", "Terraform"])))

SESSIONS.append(S("docs-3", "docs", "/work/design-tokens", [
    U("Add JSDoc comments to the public functions in src/color/ so the generated API docs make sense. Don't change behaviour."),
    T("Read", {"file_path": "/work/design-tokens/src/color/contrast.ts"}, "export function contrastRatio(a: string, b: string): number {\n  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x)\n  return (la + 0.05) / (lb + 0.05)\n}\nexport function meetsAA(fg: string, bg: string, large = false) { return contrastRatio(fg, bg) >= (large ? 3 : 4.5) }"),
    T("Edit", {"file_path": "/work/design-tokens/src/color/contrast.ts", "old_string": "export function contrastRatio(", "new_string": "/**\n * WCAG 2 contrast ratio between two colours, from 1 (identical) to 21 (black on white).\n * @param a Any CSS hex colour, e.g. \"#336699\".\n * @param b Any CSS hex colour.\n */\nexport function contrastRatio("}, "ok"),
    T("Edit", {"file_path": "/work/design-tokens/src/color/contrast.ts", "old_string": "export function meetsAA(", "new_string": "/**\n * Whether the pair meets WCAG 2 level AA: 4.5 for normal text, 3 for large text.\n * @param large Set for text of 24px or more, or 19px and bold.\n */\nexport function meetsAA("}, "ok"),
    T("Bash", {"command": "npx typedoc --emit none"}, "Warning: contrastRatio, luminance is not exported\n0 errors, 1 warning"),
    A("Both public functions are documented and typedoc runs with no errors. The one warning is that luminance is internal and not exported, so I left it undocumented. I only documented contrast.ts; the other files in src/color/ (blend, palette) still have no comments."),
], dict(task_type="docs",
    summary="Added JSDoc to the two public functions in the colour contrast module, describing the WCAG contrast ratio range and the AA thresholds, without changing behaviour. typedoc runs clean apart from an unexported helper; the other files in the colour folder were not documented.",
    facts=["JSDoc added to contrastRatio and meetsAA", "describes ratio from 1 to 21 and AA thresholds 4.5 and 3", "no behaviour change", "typedoc runs with 0 errors", "blend and palette files still undocumented"],
    specific=["JSDoc API documentation", "WCAG contrast"],
    decisions=[],
    skills=["TypeScript", "JSDoc", "typedoc", "WCAG"], not_skills=["Storybook", "React", "CSS"])))

SESSIONS.append(S("feature-1", "feature", "/work/recipe-box", [
    U("Add a 'scale servings' control to the recipe page: pick 2, 4, 6, 8 and the ingredient amounts update. We use SvelteKit."),
    T("Read", {"file_path": "/work/recipe-box/src/routes/recipes/[id]/+page.svelte"}, "<script lang=\"ts\">\n  export let data\n</script>\n<h1>{data.recipe.title}</h1>\n<ul>{#each data.recipe.ingredients as i}<li>{i.qty} {i.unit} {i.name}</li>{/each}</ul>"),
    T("Write", {"file_path": "/work/recipe-box/src/lib/scale.ts", "content": "export function scaleQty(qty: number, base: number, target: number): number {\n  const v = (qty * target) / base\n  return Math.round(v * 4) / 4 // quarters read better than 0.333\n}\n"}, "File created."),
    T("Edit", {"file_path": "/work/recipe-box/src/routes/recipes/[id]/+page.svelte", "old_string": "<ul>{#each data.recipe.ingredients as i}<li>{i.qty} {i.unit} {i.name}</li>{/each}</ul>", "new_string": "<select bind:value={servings}>{#each [2,4,6,8] as n}<option value={n}>{n} servings</option>{/each}</select>\n<ul>{#each data.recipe.ingredients as i}<li>{scaleQty(i.qty, data.recipe.servings, servings)} {i.unit} {i.name}</li>{/each}</ul>"}, "ok"),
    T("Write", {"file_path": "/work/recipe-box/src/lib/scale.test.ts", "content": "it('rounds to quarters', () => { expect(scaleQty(1, 3, 4)).toBe(1.25) })\nit('doubles', () => { expect(scaleQty(2, 4, 8)).toBe(4) })"}, "File created."),
    T("Bash", {"command": "pnpm vitest run"}, "2 passed"),
    A("The control works and ingredient amounts update. Rounding to quarters means a 1 egg recipe scaled by 1.5 shows 1.5, fine, but small amounts like a pinch (0.1) round to 0. I noted that rather than special-casing it."),
], dict(task_type="feature",
    summary="Added a servings selector (2, 4, 6, 8) to the SvelteKit recipe page that rescales ingredient quantities through a small helper, with unit tests. Quantities are rounded to quarters for readability, which rounds very small amounts to zero; that edge case was noted, not handled.",
    facts=["servings dropdown with 2, 4, 6, 8", "ingredient amounts scale from the recipe's base servings", "rounded to the nearest quarter", "unit tests pass", "tiny amounts round to 0"],
    specific=["recipe quantity scaling", "reactive Svelte binding"],
    decisions=[D("round scaled quantities to quarters", "quarters are easier to read in a kitchen than values like 0.333")],
    skills=["SvelteKit", "TypeScript", "Vitest"], not_skills=["React", "Python", "database migration"])))

SESSIONS.append(S("feature-2", "feature", "/work/helpdesk", [
    U("Support agents want to snooze a ticket until a time of their choosing, and have it reappear in their inbox then. Rails app. Keep it simple."),
    T("Read", {"file_path": "/work/helpdesk/app/models/ticket.rb"}, "class Ticket < ApplicationRecord\n  enum status: { open: 0, pending: 1, solved: 2 }\n  scope :inbox, -> { where(status: :open) }\nend"),
    T("Write", {"file_path": "/work/helpdesk/db/migrate/20261126_add_snoozed_until_to_tickets.rb", "content": "class AddSnoozedUntilToTickets < ActiveRecord::Migration[7.1]\n  def change\n    add_column :tickets, :snoozed_until, :datetime\n    add_index :tickets, :snoozed_until, where: 'snoozed_until IS NOT NULL'\n  end\nend\n"}, "File created."),
    T("Edit", {"file_path": "/work/helpdesk/app/models/ticket.rb", "old_string": "scope :inbox, -> { where(status: :open) }", "new_string": "scope :inbox, -> { where(status: :open).where('snoozed_until IS NULL OR snoozed_until <= ?', Time.current) }\n  def snooze!(until_time) = update!(snoozed_until: until_time)"}, "ok"),
    T("Write", {"file_path": "/work/helpdesk/spec/models/ticket_snooze_spec.rb", "content": "RSpec.describe Ticket do\n  it 'hides a snoozed ticket until its time' do\n    t = create(:ticket, status: :open); t.snooze!(1.hour.from_now)\n    expect(Ticket.inbox).not_to include(t)\n    travel_to(2.hours.from_now) { expect(Ticket.inbox).to include(t) }\n  end\nend"}, "File created."),
    T("Bash", {"command": "bundle exec rspec spec/models/ticket_snooze_spec.rb"}, "1 example, 0 failures"),
    A("Snoozing is implemented as a timestamp that the inbox scope checks, so no background job is needed: the ticket simply starts matching again when the time passes. The UI button and the controller action are not built yet."),
], dict(task_type="feature",
    summary="Added ticket snoozing to the Rails helpdesk: a snoozed_until column with a partial index, a snooze! method, and an inbox scope that hides tickets until their time, covered by a model spec that passes. It avoids a background job; the controller action and the button are not built yet.",
    facts=["migration adds snoozed_until with a partial index", "snooze! method added", "inbox scope excludes snoozed tickets until the time passes", "no background job", "model spec passes", "controller and UI not built"],
    specific=["snooze via timestamp filter", "Rails model scope"],
    decisions=[D("filter on a snoozed_until timestamp in the inbox scope instead of a scheduled job that wakes tickets", "no job to fail or schedule, the ticket reappears by itself when the time passes")],
    skills=["Ruby on Rails", "ActiveRecord", "RSpec", "PostgreSQL"], not_skills=["Sidekiq", "React", "Docker"])))

SESSIONS.append(S("feature-3", "feature", "/work/field-notes-app", [
    U("Add offline note drafts to the Android app: if there's no connection, save the note locally and upload it when we're back online."),
    T("Read", {"file_path": "/work/field-notes-app/app/src/main/java/app/notes/data/NoteRepository.kt"}, "class NoteRepository(private val api: NotesApi) {\n  suspend fun save(note: Note) = api.create(note)\n}"),
    T("Write", {"file_path": "/work/field-notes-app/app/src/main/java/app/notes/data/DraftDao.kt", "content": "@Dao interface DraftDao {\n  @Insert suspend fun insert(d: DraftEntity)\n  @Query(\"SELECT * FROM drafts ORDER BY createdAt\") suspend fun all(): List<DraftEntity>\n  @Delete suspend fun delete(d: DraftEntity)\n}"}, "File created."),
    T("Write", {"file_path": "/work/field-notes-app/app/src/main/java/app/notes/data/UploadDraftsWorker.kt", "content": "class UploadDraftsWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {\n  override suspend fun doWork(): Result { for (d in dao.all()) { api.create(d.toNote()); dao.delete(d) }; return Result.success() }\n}"}, "File created."),
    T("Edit", {"file_path": "/work/field-notes-app/app/src/main/java/app/notes/data/NoteRepository.kt", "old_string": "suspend fun save(note: Note) = api.create(note)", "new_string": "suspend fun save(note: Note) = try { api.create(note) } catch (e: IOException) {\n    dao.insert(note.toDraft())\n    WorkManager.getInstance(ctx).enqueueUniqueWork(\"drafts\", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<UploadDraftsWorker>().setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED)).build())\n  }"}, "ok"),
    T("Bash", {"command": "./gradlew testDebugUnitTest"}, "BUILD SUCCESSFUL\n14 tests completed"),
    A("Notes that fail with an IOException are stored in a Room table and a WorkManager job uploads them once the network is connected. I haven't tested on a device in airplane mode, and a draft whose upload fails halfway could be uploaded twice because the server has no idempotency key."),
], dict(task_type="feature",
    summary="Added offline drafts to the Android notes app: a failed save is stored in a Room table and a WorkManager job uploads it when the network returns. Unit tests pass; it was not tried on a device offline, and a draft interrupted mid-upload could be sent twice since the server has no idempotency key.",
    facts=["Room DAO for drafts added", "WorkManager worker uploads drafts when connected", "save falls back to a draft on IOException", "unit tests pass", "not tested on a device in airplane mode", "possible duplicate upload without an idempotency key"],
    specific=["offline queue with WorkManager", "local persistence with Room"],
    decisions=[],
    skills=["Kotlin", "Android", "Room", "WorkManager"], not_skills=["Flutter", "Firebase", "Swift"])))

SESSIONS.append(S("infra-1", "infra", "/work/platform-infra", [
    U("Our Terraform plan for the staging VPC wants to recreate the NAT gateway every time. Make it stop."),
    T("Bash", {"command": "terraform plan -target=aws_nat_gateway.main 2>&1 | grep -B2 -A8 'forces replacement'"}, "  # aws_nat_gateway.main must be replaced\n  ~ allocation_id = \"eipalloc-0a1b\" -> (known after apply) # forces replacement"),
    T("Read", {"file_path": "/work/platform-infra/staging/network.tf", "offset": 30, "limit": 20}, "resource \"aws_eip\" \"nat\" {\n  domain = \"vpc\"\n  lifecycle { create_before_destroy = true }\n}\nresource \"aws_nat_gateway\" \"main\" {\n  allocation_id = aws_eip.nat.id"),
    A("The elastic IP is being replaced each plan, so the gateway that depends on it is replaced too. Check why the EIP changes."),
    T("Bash", {"command": "terraform plan -target=aws_eip.nat 2>&1 | grep -A6 'aws_eip.nat'"}, "  # aws_eip.nat will be updated in-place... tags_all changes (default_tags provider block)"),
    T("Bash", {"command": "git log -3 --format=%s -- staging/providers.tf"}, "add default_tags to providers\nbump aws provider to 5.70"),
    A("The recent provider bump changed how tags_all is computed. That alone should be in-place, not a replacement; the forced replacement comes from allocation_id being 'known after apply' because the EIP resource is flagged as changing. I'll ignore the tag drift on the EIP."),
    T("Edit", {"file_path": "/work/platform-infra/staging/network.tf", "old_string": "lifecycle { create_before_destroy = true }", "new_string": "lifecycle {\n    create_before_destroy = true\n    ignore_changes        = [tags_all]\n  }"}, "ok"),
    T("Bash", {"command": "terraform plan 2>&1 | tail -3"}, "No changes. Your infrastructure matches the configuration."),
], dict(task_type="infra",
    summary="Stopped Terraform from recreating the staging NAT gateway on every plan. The elastic IP showed perpetual tag drift after a provider bump, which marked the gateway's allocation id as changing; ignoring tags_all on the EIP made the plan clean (no changes). Applied to staging config only.",
    facts=["plan replaced the NAT gateway every time", "elastic IP showed tags_all changes after the provider bump", "added ignore_changes for tags_all on the EIP", "plan now reports no changes", "staging only"],
    specific=["Terraform lifecycle ignore_changes", "provider default_tags drift"],
    decisions=[D("ignore tags_all on the elastic IP instead of removing default_tags", "the default tags are wanted everywhere else, and only this resource's drift forced the replacement")],
    skills=["Terraform", "AWS", "VPC networking"], not_skills=["Kubernetes", "Ansible", "Docker"])))

SESSIONS.append(S("infra-2", "infra", "/work/web-shop", [
    U("Speed up our GitHub Actions pipeline, it takes 14 minutes. Most of it is npm install and the Docker build."),
    T("Read", {"file_path": "/work/web-shop/.github/workflows/ci.yml"}, "steps:\n  - uses: actions/checkout@v4\n  - uses: actions/setup-node@v4\n    with: { node-version: 20 }\n  - run: npm ci\n  - run: npm test\n  - run: docker build -t shop:${{ github.sha }} ."),
    T("Edit", {"file_path": "/work/web-shop/.github/workflows/ci.yml", "old_string": "    with: { node-version: 20 }", "new_string": "    with: { node-version: 20, cache: npm }"}, "ok"),
    T("Edit", {"file_path": "/work/web-shop/.github/workflows/ci.yml", "old_string": "  - run: docker build -t shop:${{ github.sha }} .", "new_string": "  - uses: docker/setup-buildx-action@v3\n  - uses: docker/build-push-action@v6\n    with:\n      context: .\n      tags: shop:${{ github.sha }}\n      cache-from: type=gha\n      cache-to: type=gha,mode=max"}, "ok"),
    T("Read", {"file_path": "/work/web-shop/Dockerfile"}, "FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm ci\nRUN npm run build"),
    T("Write", {"file_path": "/work/web-shop/Dockerfile", "content": "FROM node:20 AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n"}, "File written."),
    A("I cached the npm download, switched the image build to buildx with the GitHub Actions layer cache, and reordered the Dockerfile so the dependency layer is only rebuilt when package files change. I can't run the workflow from here, so the timing improvement is expected but unmeasured."),
], dict(task_type="infra",
    summary="Reworked the CI pipeline for speed: npm caching in setup-node, a buildx Docker build with the GitHub Actions layer cache, and a Dockerfile reordered so dependencies install in their own cached layer. The workflow could not be run here, so the speed-up is unmeasured.",
    facts=["npm cache enabled in setup-node", "docker build moved to buildx with gha cache", "Dockerfile copies package files before the source", "workflow not run", "speed-up not measured"],
    specific=["Docker layer caching", "GitHub Actions caching"],
    decisions=[],
    skills=["GitHub Actions", "Docker", "buildx", "CI"], not_skills=["Kubernetes", "Terraform", "Jenkins"])))

SESSIONS.append(S("infra-3", "infra", "/work/ops-scripts", [
    U("Write a Prometheus alert for when the queue depth of our email-sender stays above 5000 for 10 minutes, and wire a runbook link to it."),
    T("Bash", {"command": "grep -rn 'queue_depth' monitoring/ | head -4"}, "monitoring/rules/queues.yml:6:  - record: queue:depth:max5m"),
    T("Read", {"file_path": "/work/ops-scripts/monitoring/rules/queues.yml"}, "groups:\n- name: queues\n  rules:\n  - record: queue:depth:max5m\n    expr: max_over_time(queue_depth{service=\"email-sender\"}[5m])"),
    T("Edit", {"file_path": "/work/ops-scripts/monitoring/rules/queues.yml", "old_string": "    expr: max_over_time(queue_depth{service=\"email-sender\"}[5m])", "new_string": "    expr: max_over_time(queue_depth{service=\"email-sender\"}[5m])\n  - alert: EmailQueueBacklog\n    expr: queue_depth{service=\"email-sender\"} > 5000\n    for: 10m\n    labels: { severity: page }\n    annotations:\n      summary: Email queue above 5000 for 10 minutes\n      runbook_url: https://wiki.example.test/runbooks/email-queue-backlog"}, "ok"),
    T("Bash", {"command": "promtool check rules monitoring/rules/queues.yml"}, "SUCCESS: 2 rules found"),
    T("Bash", {"command": "promtool test rules monitoring/tests/queues_test.yml"}, "Unit Testing: monitoring/tests/queues_test.yml\n  SUCCESS"),
    A("The alert fires on the raw gauge with for: 10m rather than the existing 5-minute max recording rule, because the max would hold the alert on for 5 extra minutes after recovery. The runbook page itself does not exist yet, so the link will 404."),
], dict(task_type="infra",
    summary="Added a Prometheus alert for the email-sender queue staying above 5000 for 10 minutes, with severity page and a runbook link; promtool validation and the existing rule tests pass. The runbook page it links to does not exist yet.",
    facts=["EmailQueueBacklog alert added", "threshold 5000 for 10 minutes", "uses the raw gauge, not the 5 minute max recording rule", "promtool check and tests pass", "runbook page missing"],
    specific=["Prometheus alerting rule", "for-duration on a gauge"],
    decisions=[D("alert on the raw queue depth instead of the existing max over 5 minutes recording rule", "the max would keep the alert firing for 5 extra minutes after the queue recovered")],
    skills=["Prometheus", "promtool", "alerting"], not_skills=["Grafana dashboards", "Terraform", "PagerDuty configuration"])))

SESSIONS.append(S("migration-1", "migration", "/work/crm-web", [
    U("Move our React class components in src/forms to function components with hooks. There are 5 of them. Keep behaviour and tests."),
    T("Bash", {"command": "grep -ln 'extends React.Component' src/forms/*.tsx"}, "src/forms/AddressForm.tsx\nsrc/forms/ContactForm.tsx\nsrc/forms/NoteForm.tsx\nsrc/forms/TagPicker.tsx\nsrc/forms/UploadField.tsx"),
    T("Read", {"file_path": "/work/crm-web/src/forms/TagPicker.tsx"}, "class TagPicker extends React.Component<Props, State> {\n  state = { open: false }\n  componentDidMount() { document.addEventListener('keydown', this.onKey) }\n  componentWillUnmount() { document.removeEventListener('keydown', this.onKey) }"),
    T("Write", {"file_path": "/work/crm-web/src/forms/TagPicker.tsx", "content": "export function TagPicker(props: Props) {\n  const [open, setOpen] = useState(false)\n  useEffect(() => {\n    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }\n    document.addEventListener('keydown', onKey)\n    return () => document.removeEventListener('keydown', onKey)\n  }, [])\n  ..."}, "File written."),
    T("Bash", {"command": "npx jest src/forms/TagPicker"}, "PASS src/forms/TagPicker.test.tsx\nTests: 7 passed"),
    A("TagPicker is converted and its 7 tests still pass. I only did this one as the template; the other four have refs and an error boundary (UploadField) that need care, so I stopped here rather than convert all five blindly."),
], dict(task_type="migration",
    summary="Converted one of five class components in the forms folder, TagPicker, to a function component with hooks, moving its mount and unmount listeners into a useEffect cleanup; its 7 tests pass. The other four were not converted, since UploadField uses refs and an error boundary that need careful handling.",
    facts=["five class components found", "TagPicker converted to hooks", "lifecycle listeners moved to useEffect with cleanup", "7 tests pass", "four components not converted", "UploadField uses refs and an error boundary"],
    specific=["class to function component migration", "lifecycle methods to useEffect"],
    decisions=[],
    skills=["React", "TypeScript", "Jest", "hooks"], not_skills=["Redux", "Next.js", "CSS modules"])))
