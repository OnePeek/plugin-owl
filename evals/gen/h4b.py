# Held-out set 4, part B (docs, feature, infra, migration). Written before any run; never tuned on.
from common import U, A, T, S
from h4a import D

SESSIONS = []

SESSIONS.append(S("docs-1", "docs", "/work/gardenlog", [
    U("Write a CONTRIBUTING guide: how to set up the dev environment (Elixir 1.17, Postgres), run tests, and what a good PR looks like."),
    T("Bash", {"command": "cat mix.exs | grep -n 'elixir:'; ls; cat .tool-versions"}, "elixir: \"~> 1.17\"\nREADME.md  lib  mix.exs  test  docker-compose.yml\nelixir 1.17.2\nerlang 27.0"),
    T("Read", {"file_path": "/work/gardenlog/docker-compose.yml"}, "services:\n  db:\n    image: postgres:16\n    ports: ['5432:5432']"),
    T("Write", {"file_path": "/work/gardenlog/CONTRIBUTING.md", "content": "# Contributing\n\n## Setup\nInstall Elixir and Erlang with asdf (versions are pinned in .tool-versions), then `docker compose up -d db`, `mix deps.get`, `mix ecto.setup`.\n\n## Tests\n`mix test`. Tests need the database container running.\n\n## Pull requests\nOne change per PR, with a test, and a description that says why. Run `mix format` first.\n"}, "File created."),
    A("The guide is written from what the repo shows: the tool versions file, the compose database and the mix commands. I did not run the setup steps from scratch, and the repo has no CI file, so I left out any CI claims."),
], dict(task_type="docs",
    summary="Wrote a contributing guide for an Elixir project covering environment setup from the pinned tool versions and the compose database, running tests, and what a good pull request looks like. The setup steps were not run from scratch, and CI is not mentioned because the repo has none.",
    facts=["CONTRIBUTING guide added", "setup via pinned tool versions and docker compose database", "mix test needs the database running", "pull request expectations", "steps not run from scratch", "no CI claims"],
    specific=["contributor onboarding documentation"],
    decisions=[], skills=["technical writing", "Elixir tooling"], not_skills=["Phoenix development", "Docker image building", "CI configuration"])))

SESSIONS.append(S("docs-2", "docs", "/work/tide-api", [
    U("The OpenAPI descriptions for the /forecast endpoints are one-word placeholders. Write real descriptions and an example response for each."),
    T("Read", {"file_path": "/work/tide-api/openapi/forecast.yaml"}, "/forecast/{station}:\n  get:\n    description: forecast\n    parameters:\n      - name: horizon\n        in: query\n        description: hours"),
    T("Read", {"file_path": "/work/tide-api/src/forecast/handler.ts", "limit": 30}, "const MAX_HORIZON = 72\nconst heights = await model.predict(station, horizon)\nreturn { station, unit: 'm', heights }"),
    T("Edit", {"file_path": "/work/tide-api/openapi/forecast.yaml", "old_string": "    description: forecast", "new_string": "    description: Predicted tide heights in metres for one station, hour by hour, up to 72 hours ahead.\n    responses:\n      '200':\n        content:\n          application/json:\n            example: { station: ST-0042, unit: m, heights: [1.2, 1.4, 1.7] }"}, "ok"),
    T("Bash", {"command": "npx redocly lint openapi/forecast.yaml"}, "Woohoo! Your API description is valid."),
    A("The descriptions now match the handler, including the 72 hour limit, and the spec passes lint. Only the station forecast endpoint had enough in the code to document; the other two forecast endpoints are still placeholders because I couldn't tell their response shape."),
], dict(task_type="docs",
    summary="Replaced placeholder OpenAPI text for the forecast endpoint with a real description and an example response taken from the handler, including the 72 hour limit; the spec passes lint. The other two forecast endpoints remain placeholders because their response shape was unclear.",
    facts=["description and example added for the station forecast endpoint", "72 hour maximum horizon documented", "spec lints clean", "two other endpoints still placeholders"],
    specific=["OpenAPI documentation from handler behaviour"],
    decisions=[], skills=["OpenAPI", "technical writing", "API documentation"], not_skills=["TypeScript development", "Swagger UI hosting", "GraphQL"])))

SESSIONS.append(S("docs-3", "docs", "/work/lab-notebooks", [
    U("Turn my messy notes in notes/ph-calibration.txt into a clean runbook for calibrating the pH probe. Keep every step, fix the order."),
    T("Read", {"file_path": "/work/lab-notebooks/notes/ph-calibration.txt"}, "rinse w/ DI water\nbuffer 7 first!! then 4\nwait til stable (~30s)\nstore in KCl never water\nif slope < 95% replace probe\nbuffer 10 only if sample > 8"),
    T("Write", {"file_path": "/work/lab-notebooks/runbooks/ph-probe-calibration.md", "content": "# pH probe calibration\n1. Rinse the probe with deionised water.\n2. Calibrate in pH 7 buffer first, then pH 4. Wait about 30 seconds for the reading to stabilise each time.\n3. Add pH 10 buffer only when samples will be above pH 8.\n4. Check the slope. Below 95%, replace the probe.\n5. Store in KCl storage solution, never in water.\n"}, "File created."),
    A("All six notes are kept and ordered as a procedure. I read the note about KCl as storage solution; if it means something else, that step is wrong."),
], dict(task_type="docs",
    summary="Turned rough lab notes into a numbered runbook for calibrating a pH probe, keeping every step and putting them in the order they would be done. One interpretation, that KCl means the storage solution, was flagged for confirmation.",
    facts=["runbook created from notes", "all notes kept", "buffers pH 7 then 4, 10 only for samples above 8", "replace the probe if slope is under 95%", "KCl interpretation flagged"],
    specific=["runbook from informal notes"],
    decisions=[], skills=["technical writing"], not_skills=["Python", "laboratory automation", "data analysis"])))

SESSIONS.append(S("feature-1", "feature", "/work/club-booker", [
    U("Add a waitlist: when a class is full, people can join a waitlist and get the spot automatically if someone cancels. Node + Postgres."),
    T("Read", {"file_path": "/work/club-booker/src/bookings.ts"}, "export async function cancel(id: string) { await db.query('DELETE FROM bookings WHERE id=$1', [id]) }"),
    T("Write", {"file_path": "/work/club-booker/migrations/014_waitlist.sql", "content": "CREATE TABLE waitlist (class_id int, user_id int, joined_at timestamptz default now(), PRIMARY KEY (class_id, user_id));"}, "File created."),
    T("Edit", {"file_path": "/work/club-booker/src/bookings.ts", "old_string": "export async function cancel(id: string) { await db.query('DELETE FROM bookings WHERE id=$1', [id]) }", "new_string": "export async function cancel(id: string) {\n  await db.tx(async t => {\n    const { class_id } = await t.one('DELETE FROM bookings WHERE id=$1 RETURNING class_id', [id])\n    const next = await t.oneOrNone('DELETE FROM waitlist WHERE ctid = (SELECT ctid FROM waitlist WHERE class_id=$1 ORDER BY joined_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING user_id', [class_id])\n    if (next) await t.none('INSERT INTO bookings (class_id, user_id) VALUES ($1,$2)', [class_id, next.user_id])\n  })\n}"}, "ok"),
    T("Write", {"file_path": "/work/club-booker/test/waitlist.test.ts", "content": "it('gives the freed spot to the first person waiting', async () => { /* two waiting, one cancels */ })"}, "File created."),
    T("Bash", {"command": "npm test -- waitlist"}, "1 passed"),
    A("Cancelling now hands the spot to the longest-waiting person inside the same transaction, using SKIP LOCKED so two simultaneous cancellations don't pick the same person. Notification emails to the promoted person are not sent yet."),
], dict(task_type="feature",
    summary="Added a class waitlist: a waitlist table, and cancellation now promotes the longest-waiting person in the same transaction, using row locking that skips locked rows so concurrent cancellations don't pick the same person. The test passes; emails telling the promoted person are not built.",
    facts=["waitlist table migration", "cancel promotes first in line within a transaction", "SKIP LOCKED avoids picking the same person twice", "test passes", "notification emails not sent"],
    specific=["waitlist promotion in a transaction", "row locking with SKIP LOCKED"],
    decisions=[], skills=["Node.js", "PostgreSQL", "TypeScript"], not_skills=["Redis", "React", "Docker"])))

SESSIONS.append(S("feature-2", "feature", "/work/kiosk-ui", [
    U("Add a high-contrast mode toggle to the kiosk app, persisted across restarts. It's a Qt/QML app."),
    T("Read", {"file_path": "/work/kiosk-ui/qml/Theme.qml"}, "pragma Singleton\nQtObject { property color bg: '#ffffff'; property color fg: '#1a1a1a'; property color accent: '#2a6fdb' }"),
    T("Edit", {"file_path": "/work/kiosk-ui/qml/Theme.qml", "old_string": "QtObject { property color bg: '#ffffff'; property color fg: '#1a1a1a'; property color accent: '#2a6fdb' }", "new_string": "QtObject {\n  property bool highContrast: settings.highContrast\n  property color bg: highContrast ? '#000000' : '#ffffff'\n  property color fg: highContrast ? '#ffffff' : '#1a1a1a'\n  property color accent: highContrast ? '#ffd400' : '#2a6fdb'\n}"}, "ok"),
    T("Write", {"file_path": "/work/kiosk-ui/qml/Settings.qml", "content": "Settings { id: settings; property bool highContrast: false }"}, "File created."),
    T("Edit", {"file_path": "/work/kiosk-ui/qml/SettingsPage.qml", "old_string": "// toggles", "new_string": "Switch { text: qsTr('High contrast'); checked: Theme.highContrast; onToggled: settings.highContrast = checked }"}, "ok"),
    T("Bash", {"command": "ctest --output-on-failure -R ui_smoke"}, "1/1 Test #1: ui_smoke ... Passed"),
    A("The toggle changes the three theme colours through one property and QML Settings stores it between runs. I haven't run it on the kiosk hardware, only the smoke test."),
], dict(task_type="feature",
    summary="Added a persisted high-contrast mode to the Qt QML kiosk app: the theme singleton switches its colours from one setting, a switch on the settings page toggles it, and QML Settings keeps it across restarts. Only the UI smoke test was run, not the kiosk hardware.",
    facts=["theme colours switch on a highContrast property", "toggle on settings page", "persisted with QML Settings", "ui smoke test passes", "not tested on the hardware"],
    specific=["theme switching in QML", "persisted settings"],
    decisions=[], skills=["Qt", "QML", "CMake"], not_skills=["C++ memory management", "React", "Android"])))

SESSIONS.append(S("feature-3", "feature", "/work/cargo-tracker", [
    U("Add an endpoint GET /shipments/export.csv that streams all of a customer's shipments as CSV. Some customers have 500k rows. Go."),
    T("Read", {"file_path": "/work/cargo-tracker/internal/http/shipments.go"}, "func (h *H) List(w http.ResponseWriter, r *http.Request) { rows, _ := h.db.Query(ctx, q, cust(r)); ... json.NewEncoder(w).Encode(all) }"),
    A("Loading 500k rows into a slice would hold them all in memory, so I'll stream: query with a cursor and write each row to a csv.Writer that flushes as it goes."),
    T("Write", {"file_path": "/work/cargo-tracker/internal/http/export.go", "content": "func (h *H) Export(w http.ResponseWriter, r *http.Request) {\n  w.Header().Set(\"Content-Type\", \"text/csv\")\n  cw := csv.NewWriter(w)\n  rows, err := h.db.Query(r.Context(), exportQ, cust(r))\n  if err != nil { http.Error(w, \"error\", 500); return }\n  defer rows.Close()\n  for rows.Next() { var s Shipment; rows.Scan(&s.ID, &s.Status, &s.ETA); cw.Write(s.Record()); if n++; n%1000 == 0 { cw.Flush() } }\n  cw.Flush()\n}"}, "File created."),
    T("Write", {"file_path": "/work/cargo-tracker/internal/http/export_test.go", "content": "func TestExportStreams(t *testing.T) { /* 5000 rows, check header and count */ }"}, "File created."),
    T("Bash", {"command": "go test ./internal/http -run Export"}, "ok  \tcargo-tracker/internal/http 0.41s"),
    A("The export writes in batches of 1000 rows, so memory stays flat. If the query fails after the first rows are sent, the client gets a truncated CSV with status 200, which I noted but didn't handle."),
], dict(task_type="feature",
    summary="Added a streaming CSV export endpoint for a customer's shipments in Go: rows are read from the database and written through a CSV writer flushed every 1000 rows, so half a million rows don't sit in memory. The test passes; a failure after streaming starts would still produce a truncated file with a 200 status.",
    facts=["export endpoint added", "rows streamed and flushed every 1000", "avoids loading all rows into memory", "test passes", "mid-stream failure gives truncated CSV with 200", "not handled"],
    specific=["streaming response", "CSV export of large result sets"],
    decisions=[D("stream rows through a flushing CSV writer instead of loading all rows into a slice", "customers can have 500k rows, which would all be held in memory")],
    skills=["Go", "HTTP streaming", "CSV"], not_skills=["Python", "Kafka", "Kubernetes"])))

SESSIONS.append(S("infra-1", "infra", "/work/edge-gateway", [
    U("Our Dockerfile produces a 1.4 GB image for a small Go service. Shrink it."),
    T("Read", {"file_path": "/work/edge-gateway/Dockerfile"}, "FROM golang:1.23\nWORKDIR /src\nCOPY . .\nRUN go build -o /gw ./cmd/gw\nCMD [\"/gw\"]"),
    T("Write", {"file_path": "/work/edge-gateway/Dockerfile", "content": "FROM golang:1.23 AS build\nWORKDIR /src\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /gw ./cmd/gw\n\nFROM gcr.io/distroless/static-debian12:nonroot\nCOPY --from=build /gw /gw\nENTRYPOINT [\"/gw\"]\n"}, "File written."),
    T("Bash", {"command": "docker build -t gw:test . && docker images gw:test --format '{{.Size}}'"}, "23.6MB"),
    T("Bash", {"command": "docker run --rm gw:test --version"}, "gw 2.8.1"),
    A("The image went from 1.4 GB to about 24 MB with a multi-stage build and a distroless static base. It has no shell, so debugging in the container needs an ephemeral debug container."),
], dict(task_type="infra",
    summary="Shrank a Go service's Docker image from 1.4 GB to about 24 MB using a multi-stage build with a static binary and a distroless base, and confirmed the image runs. The image has no shell, so debugging in it needs a separate debug container.",
    facts=["image went from 1.4 GB to about 24 MB", "multi-stage Dockerfile", "static build with CGO disabled", "distroless base", "image runs and prints its version", "no shell in the image"],
    specific=["multi-stage Docker build", "distroless base image"],
    decisions=[], skills=["Docker", "Go build flags"], not_skills=["Kubernetes", "Terraform", "GitHub Actions"])))

SESSIONS.append(S("infra-2", "infra", "/work/data-platform", [
    U("Add an S3 lifecycle rule in Terraform: move raw/ objects to Glacier after 90 days and delete after 400. Don't touch the processed/ prefix."),
    T("Read", {"file_path": "/work/data-platform/s3.tf"}, "resource \"aws_s3_bucket\" \"lake\" { bucket = \"lake-prod\" }"),
    T("Edit", {"file_path": "/work/data-platform/s3.tf", "old_string": "resource \"aws_s3_bucket\" \"lake\" { bucket = \"lake-prod\" }", "new_string": "resource \"aws_s3_bucket\" \"lake\" { bucket = \"lake-prod\" }\n\nresource \"aws_s3_bucket_lifecycle_configuration\" \"lake\" {\n  bucket = aws_s3_bucket.lake.id\n  rule {\n    id     = \"raw-archive\"\n    status = \"Enabled\"\n    filter { prefix = \"raw/\" }\n    transition { days = 90, storage_class = \"GLACIER\" }\n    expiration { days = 400 }\n  }\n}"}, "ok"),
    T("Bash", {"command": "terraform validate && terraform plan -out=tf.plan | tail -6"}, "Success! The configuration is valid.\n  + aws_s3_bucket_lifecycle_configuration.lake will be created\nPlan: 1 to add, 0 to change, 0 to destroy."),
    A("The plan adds only the lifecycle configuration and touches nothing else. Because the rule filters on the raw/ prefix, processed/ objects are unaffected. I did not apply it."),
], dict(task_type="infra",
    summary="Added a Terraform S3 lifecycle rule that moves raw-prefix objects to Glacier after 90 days and expires them after 400, leaving the processed prefix alone. Validate passes and the plan shows one resource added with no changes elsewhere; it was not applied.",
    facts=["lifecycle rule on the raw prefix", "Glacier after 90 days, expire after 400", "processed prefix not covered", "validate passes", "plan adds 1 resource", "not applied"],
    specific=["S3 lifecycle policy in Terraform"],
    decisions=[], skills=["Terraform", "AWS S3"], not_skills=["Kubernetes", "Python", "IAM policy design"])))

SESSIONS.append(S("infra-3", "infra", "/work/shop-deploy", [
    U("Deploys to Kubernetes cause a few seconds of 503s. Make rollouts zero downtime."),
    T("Read", {"file_path": "/work/shop-deploy/k8s/deployment.yaml"}, "spec:\n  replicas: 3\n  template:\n    spec:\n      containers:\n      - name: web\n        image: shop/web:latest"),
    A("There is no readiness probe, so new pods receive traffic as soon as they start, and no preStop delay, so terminating pods drop in-flight requests while the load balancer is still sending to them. I'll add a readiness probe, a preStop sleep and a rolling update that never removes a pod before its replacement is ready."),
    T("Edit", {"file_path": "/work/shop-deploy/k8s/deployment.yaml", "old_string": "spec:\n  replicas: 3", "new_string": "spec:\n  replicas: 3\n  strategy:\n    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }"}, "ok"),
    T("Edit", {"file_path": "/work/shop-deploy/k8s/deployment.yaml", "old_string": "        image: shop/web:latest", "new_string": "        image: shop/web:latest\n        readinessProbe:\n          httpGet: { path: /healthz, port: 8080 }\n          periodSeconds: 3\n        lifecycle:\n          preStop:\n            exec: { command: [\"sleep\", \"10\"] }"}, "ok"),
    T("Bash", {"command": "kubectl apply --dry-run=server -f k8s/deployment.yaml"}, "deployment.apps/web configured (server dry run)"),
    A("Only a server-side dry run so far; I haven't done a live rollout under load to see the 503s disappear."),
], dict(task_type="infra",
    summary="Changed the Kubernetes deployment toward zero-downtime rollouts: a readiness probe, a preStop delay so terminating pods keep serving while the load balancer drains, and a rolling update with no unavailable pods. Only a server dry run was done, so the effect under load is unverified.",
    facts=["no readiness probe before", "readiness probe added", "preStop sleep of 10 seconds", "maxUnavailable 0 and maxSurge 1", "server dry run only", "not verified under load"],
    specific=["readiness probes and graceful termination", "rolling update settings"],
    decisions=[], skills=["Kubernetes", "YAML"], not_skills=["Helm", "Terraform", "Istio"])))

SESSIONS.append(S("migration-1", "migration", "/work/legacy-portal", [
    U("Port the Python 2 script scripts/export_members.py to Python 3. It's about 200 lines."),
    T("Bash", {"command": "2to3 scripts/export_members.py | head -40"}, "-print 'exporting', n\n+print('exporting', n)\n-for k, v in d.iteritems():\n+for k, v in d.items():\n-except Exception, e:\n+except Exception as e:"),
    T("Bash", {"command": "2to3 -w scripts/export_members.py && python3 scripts/export_members.py --dry-run"}, "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9 in position 11"),
    A("The script reads a latin-1 file. Python 2 read it as bytes silently, but Python 3 decodes as UTF-8 by default and fails on accented names. The file needs an explicit encoding."),
    T("Edit", {"file_path": "/work/legacy-portal/scripts/export_members.py", "old_string": "open(src)", "new_string": "open(src, encoding='latin-1')"}, "ok"),
    T("Bash", {"command": "python3 scripts/export_members.py --dry-run | tail -2"}, "exported 1432 members (dry run)"),
], dict(task_type="migration",
    summary="Ported a Python 2 export script to Python 3 using the automatic converter, then fixed the one thing it missed: a latin-1 input file that Python 3 tried to read as UTF-8. The dry run now exports all 1432 members.",
    facts=["2to3 conversion applied", "print, iteritems and except syntax converted", "UnicodeDecodeError on accented names", "file opened with latin-1 encoding", "dry run exports 1432 members"],
    specific=["Python 2 to 3 port", "text encoding differences"],
    decisions=[], skills=["Python", "2to3", "text encoding"], not_skills=["Django", "SQL", "Docker"])))
