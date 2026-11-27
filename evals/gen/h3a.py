# Held-out set 3, part A (bugfix, data, debugging). Written before any run; never tuned on.
from common import U, A, T, S

def D(c, r):
    return dict(choice=c, reason=r)

SESSIONS = []

SESSIONS.append(S("bugfix-1", "bugfix", "/work/parcel-tracker", [
    U("Users in Australia see their delivery date one day early on the tracking page. Please find the cause and fix it."),
    T("Grep", {"pattern": "toISOString|toLocaleDateString"}, "web/src/format/date.ts:9: return new Date(d).toISOString().slice(0, 10)\nweb/src/pages/Tracking.tsx:41: {formatDay(order.eta)}"),
    T("Read", {"file_path": "/work/parcel-tracker/web/src/format/date.ts"}, "export function formatDay(d: string) {\n  return new Date(d).toISOString().slice(0, 10)\n}"),
    A("toISOString converts to UTC, so a local midnight ETA in a UTC+10 or +11 zone slips back to the previous calendar day. The API already sends a date with an offset, so we should format in the zone it names rather than UTC."),
    T("Edit", {"file_path": "/work/parcel-tracker/web/src/format/date.ts", "old_string": "return new Date(d).toISOString().slice(0, 10)", "new_string": "return d.slice(0, 10) // the API sends local dates with an offset; the first ten characters are the delivery day there"}, "ok"),
    T("Edit", {"file_path": "/work/parcel-tracker/web/src/format/date.test.ts", "old_string": "// cases", "new_string": "it('keeps the local day for +11:00', () => { expect(formatDay('2026-03-02T00:00:00+11:00')).toBe('2026-03-02') })"}, "ok"),
    T("Bash", {"command": "pnpm vitest run src/format"}, "Test Files 1 passed (1)\nTests 6 passed (6)"),
    A("Fixed. The page now shows the date exactly as the carrier gave it, with a regression test for a +11:00 offset."),
], dict(task_type="bugfix",
    summary="Fixed delivery dates showing one day early for users east of UTC: the formatter converted to UTC before taking the date. It now keeps the local day from the API value, with a regression test for a +11:00 offset.",
    facts=["delivery date was one day early in Australia", "formatter used toISOString which converts to UTC", "now takes the day from the API's local date", "regression test for a +11:00 offset added", "tests pass"],
    specific=["UTC conversion shifting a local date", "time zone handling in date formatting"],
    decisions=[D("keep the day from the API's local date string instead of converting through UTC", "the API already includes the offset, and UTC conversion is what moved the date back a day")],
    skills=["TypeScript", "React", "Vitest", "time zones"], not_skills=["Docker", "GraphQL", "Kubernetes"])))

SESSIONS.append(S("bugfix-2", "bugfix", "/work/seat-planner", [
    U("The seat map crashes with 'Cannot read properties of undefined (reading row)' when an event has a standing-only section. Repro: event 77."),
    T("Bash", {"command": "grep -rn \"\\.row\" src/seatmap | head"}, "src/seatmap/layout.ts:33: const r = seat.row * ROW_HEIGHT\nsrc/seatmap/layout.ts:58: sections.map(s => s.seats[0].row)"),
    T("Read", {"file_path": "/work/seat-planner/src/seatmap/layout.ts", "offset": 50, "limit": 15}, "55 export function sectionTop(sections: Section[]) {\n58   return Math.min(...sections.map(s => s.seats[0].row))\n59 }"),
    A("Standing sections have an empty seats array, so seats[0] is undefined and .row throws. I'll skip sections with no numbered seats when computing the top."),
    T("Edit", {"file_path": "/work/seat-planner/src/seatmap/layout.ts", "old_string": "Math.min(...sections.map(s => s.seats[0].row))", "new_string": "Math.min(...sections.filter(s => s.seats.length > 0).map(s => s.seats[0].row))"}, "ok"),
    T("Write", {"file_path": "/work/seat-planner/src/seatmap/layout.test.ts", "content": "it('ignores standing sections', () => { expect(sectionTop([{seats: []}, {seats: [{row: 4}]}])).toBe(4) })"}, "File created."),
    T("Bash", {"command": "npm test -- layout"}, "PASS src/seatmap/layout.test.ts\nTests: 1 passed"),
    T("Bash", {"command": "npm run test:e2e -- --grep 'event 77'"}, "1 passing"),
    A("Event 77 now renders; standing sections are left out of the row calculation. Math.min of an all-standing event would still return Infinity, which the renderer treats as no seats, so I left that alone."),
], dict(task_type="bugfix",
    summary="Fixed the seat map crash on events with standing-only sections: those sections have no seats, so reading the first seat's row threw. Empty sections are now skipped when computing the top row, with a unit test; the event 77 repro passes.",
    facts=["crash on standing-only sections", "seats array is empty so seats[0] is undefined", "sections without seats are now filtered out", "unit test added", "event 77 end-to-end check passes", "an all-standing event would give Infinity which the renderer tolerates"],
    specific=["empty array access", "standing section edge case"],
    decisions=[],
    skills=["TypeScript", "JavaScript"], not_skills=["Python", "Docker", "CSS"])))

SESSIONS.append(S("bugfix-3", "bugfix", "/work/ticket-bot", [
    U("Our Discord ticket bot sometimes posts the 'ticket closed' message twice. Can you stop that?"),
    T("Read", {"file_path": "/work/ticket-bot/bot/handlers/close.py"}, "@bot.event\nasync def on_reaction_add(reaction, user):\n    if str(reaction.emoji) == '\\u2705':\n        await close_ticket(reaction.message.channel)\n        await reaction.message.channel.send('Ticket closed')"),
    A("on_reaction_add fires for every user who reacts, so two people ticking the box closes it twice. Closing should be idempotent. I'll check the ticket state before closing."),
    T("Read", {"file_path": "/work/ticket-bot/bot/tickets.py"}, "async def close_ticket(channel):\n    await db.execute('UPDATE tickets SET status=\\'closed\\' WHERE channel_id=$1', channel.id)"),
    T("Edit", {"file_path": "/work/ticket-bot/bot/tickets.py", "old_string": "await db.execute('UPDATE tickets SET status=\\'closed\\' WHERE channel_id=$1', channel.id)", "new_string": "res = await db.execute(\"UPDATE tickets SET status='closed' WHERE channel_id=$1 AND status='open'\", channel.id)\n    return res.endswith('1')"}, "ok"),
    T("Edit", {"file_path": "/work/ticket-bot/bot/handlers/close.py", "old_string": "        await close_ticket(reaction.message.channel)\n        await reaction.message.channel.send('Ticket closed')", "new_string": "        if await close_ticket(reaction.message.channel):\n            await reaction.message.channel.send('Ticket closed')"}, "ok"),
    T("Bash", {"command": "pytest tests/test_close.py -q"}, "3 passed in 0.9s"),
    A("The close now only succeeds for an open ticket, and only the call that actually changed the row posts the message. I did not reproduce the double post against a live Discord server, only in the unit test with two reactions."),
], dict(task_type="bugfix",
    summary="Stopped the duplicate 'ticket closed' message: every reacting user triggered the handler. The database update now only matches open tickets and reports whether it changed a row, so only the first reaction posts the message. Verified with a unit test, not against live Discord.",
    facts=["message posted twice when two users react", "handler fires per reacting user", "UPDATE now restricted to open tickets and returns whether a row changed", "message sent only when the close succeeded", "tests pass; not checked on live Discord"],
    specific=["idempotent close", "duplicate event handling"],
    decisions=[D("make the close an atomic conditional update and post only when it changed a row", "that prevents the double post even when two reactions arrive at the same moment, unlike a check in application code")],
    skills=["Python", "discord.py", "PostgreSQL", "pytest"], not_skills=["Redis", "Docker", "TypeScript"])))

SESSIONS.append(S("data-1", "data", "/work/retail-analytics", [
    U("Build a weekly retention table from the events table: for each signup week, the share of users active 1, 2, 4 weeks later. Postgres."),
    T("Bash", {"command": "psql $DB -c '\\d events'"}, "user_id bigint, event_type text, occurred_at timestamptz\nIndexes: events_user_time (user_id, occurred_at)"),
    T("Write", {"file_path": "/work/retail-analytics/sql/weekly_retention.sql", "content": "WITH signup AS (\n  SELECT user_id, date_trunc('week', MIN(occurred_at)) AS cohort FROM events WHERE event_type='signup' GROUP BY 1\n), active AS (\n  SELECT DISTINCT user_id, date_trunc('week', occurred_at) AS wk FROM events WHERE event_type <> 'signup'\n)\nSELECT s.cohort, COUNT(DISTINCT s.user_id) AS users,\n  ROUND(100.0*COUNT(DISTINCT a1.user_id)/COUNT(DISTINCT s.user_id),1) AS w1,\n  ROUND(100.0*COUNT(DISTINCT a2.user_id)/COUNT(DISTINCT s.user_id),1) AS w2,\n  ROUND(100.0*COUNT(DISTINCT a4.user_id)/COUNT(DISTINCT s.user_id),1) AS w4\nFROM signup s\nLEFT JOIN active a1 ON a1.user_id=s.user_id AND a1.wk=s.cohort+interval '1 week'\nLEFT JOIN active a2 ON a2.user_id=s.user_id AND a2.wk=s.cohort+interval '2 weeks'\nLEFT JOIN active a4 ON a4.user_id=s.user_id AND a4.wk=s.cohort+interval '4 weeks'\nGROUP BY 1 ORDER BY 1;"}, "File created."),
    T("Bash", {"command": "psql $DB -f sql/weekly_retention.sql | head -8"}, " cohort | users | w1 | w2 | w4\n 2026-09-07 | 412 | 38.1 | 29.4 | 21.8\n 2026-09-14 | 390 | 36.7 | 27.9 | 20.0\n 2026-10-19 | 455 | 40.2 | 31.0 | (null)"),
    A("The most recent cohorts have NULL for later weeks because those weeks have not happened yet, which is correct, but a reader could mistake NULL for zero. I'll leave them NULL and note it in a SQL comment."),
    T("Edit", {"file_path": "/work/retail-analytics/sql/weekly_retention.sql", "old_string": "WITH signup AS (", "new_string": "-- NULL in w1/w2/w4 means that week has not happened yet for the cohort; it is not zero retention.\nWITH signup AS ("}, "ok"),
], dict(task_type="data",
    summary="Wrote a Postgres weekly retention query: users grouped by signup week with the percentage active 1, 2 and 4 weeks later, using left joins on distinct weekly activity. Ran it on the events table; recent cohorts show NULL for weeks that have not happened yet, and a comment says so.",
    facts=["cohorts by signup week", "retention at 1, 2 and 4 weeks", "Postgres SQL file added", "query ran and returned rows", "NULL means the week has not happened yet", "recent cohorts have NULL later weeks"],
    specific=["cohort retention analysis", "SQL left joins on weekly activity"],
    decisions=[D("keep NULL for weeks that have not happened yet instead of showing zero", "zero would read as no retention when the data simply does not exist yet")],
    skills=["SQL", "PostgreSQL", "cohort analysis"], not_skills=["Python", "pandas", "dbt", "Airflow"])))

SESSIONS.append(S("data-2", "data", "/work/clinic-etl", [
    U("The nightly patient-visits CSV import started failing on the 14th. Rows with a comma in the clinic name break the column count. Fix the import."),
    T("Read", {"file_path": "/work/clinic-etl/etl/load_visits.py"}, "for line in open(path):\n    parts = line.rstrip('\\n').split(',')\n    visits.append(Visit(*parts))"),
    T("Bash", {"command": "grep -n 'Smith, ' /data/inbox/visits_2026-11-14.csv | head -2"}, "88:V1042,\"Smith, Jones & Partners\",2026-11-14,ROUTINE\n91:V1049,\"Smith, Jones & Partners\",2026-11-14,FOLLOWUP"),
    A("The exporter started quoting fields that contain commas, which is valid CSV, but we split on every comma. We should use the csv module rather than split."),
    T("Edit", {"file_path": "/work/clinic-etl/etl/load_visits.py", "old_string": "for line in open(path):\n    parts = line.rstrip('\\n').split(',')\n    visits.append(Visit(*parts))", "new_string": "with open(path, newline='') as f:\n    for parts in csv.reader(f):\n        visits.append(Visit(*parts))"}, "ok"),
    T("Edit", {"file_path": "/work/clinic-etl/etl/load_visits.py", "old_string": "import sys", "new_string": "import csv\nimport sys"}, "ok"),
    T("Bash", {"command": "python -m etl.load_visits /data/inbox/visits_2026-11-14.csv --dry-run"}, "parsed 2114 rows, 0 rejected"),
    A("The 14th file now parses fully (2114 rows). I only did a dry run, so nothing has been written to the warehouse; you need to re-run the real import for the 14th and the days since."),
], dict(task_type="data",
    summary="Fixed the visits CSV import that broke on quoted clinic names containing commas: the loader split lines on every comma, so it now uses Python's csv reader. A dry run of the 14th's file parsed all 2114 rows; the real import has not been re-run, so the backlog is still unloaded.",
    facts=["import failed from the 14th", "clinic names with commas are quoted by the exporter", "loader split on every comma", "now uses the csv reader", "dry run parsed 2114 rows with 0 rejected", "real import not re-run"],
    specific=["quoted CSV fields", "csv parsing instead of string splitting"],
    decisions=[D("parse with the csv module instead of patching the split", "quoted fields are valid CSV, and a hand-written split would break again on other quoting cases")],
    skills=["Python", "CSV", "ETL"], not_skills=["Spark", "Airflow", "SQL"])))

SESSIONS.append(S("data-3", "data", "/work/crop-sensors", [
    U("Plot soil moisture per field from the Parquet exports and flag fields that stayed below 20% for more than 3 days. Use pandas."),
    T("Bash", {"command": "python -c \"import pandas as pd; d=pd.read_parquet('exports/moisture.parquet'); print(d.dtypes); print(d.head(3))\""}, "field_id object\nts datetime64[ns]\nmoisture_pct float64\n  field_id                  ts  moisture_pct\n0      F-03 2026-10-01 00:00:00          31.2"),
    T("Write", {"file_path": "/work/crop-sensors/analysis/dry_fields.py", "content": "import pandas as pd\nd = pd.read_parquet('exports/moisture.parquet')\nd['dry'] = d.moisture_pct < 20\nd = d.sort_values(['field_id','ts'])\nd['run'] = (d.dry != d.groupby('field_id').dry.shift()).cumsum()\nruns = d[d.dry].groupby(['field_id','run']).ts.agg(['min','max'])\nruns['days'] = (runs['max']-runs['min']).dt.total_seconds()/86400\nprint(runs[runs.days > 3])\n"}, "File created."),
    T("Bash", {"command": "python analysis/dry_fields.py"}, "                      min                 max  days\nfield_id run\nF-07     14  2026-10-09  2026-10-14  5.0\nF-11     22  2026-10-20  2026-10-24  4.1"),
    A("Two fields qualify, F-07 and F-11. Note I measured a run as first to last reading below 20%, so gaps from sensor outages inside a run are counted as dry. I haven't made the chart yet."),
    T("Bash", {"command": "python -c \"print('ok')\""}, "ok"),
], dict(task_type="data",
    summary="Wrote a pandas script that finds fields whose soil moisture stayed under 20% for more than three days, and found two, F-07 and F-11. Runs are measured first to last low reading, so sensor outage gaps inside a run count as dry. The per-field chart was not made yet.",
    facts=["Parquet moisture exports read with pandas", "dry runs under 20% longer than 3 days", "F-07 and F-11 flagged", "outage gaps inside a run count as dry", "chart not yet produced"],
    specific=["run detection in time series", "pandas groupby on consecutive runs"],
    decisions=[],
    skills=["Python", "pandas", "Parquet"], not_skills=["matplotlib", "SQL", "Spark"])))

SESSIONS.append(S("debugging-1", "debugging", "/work/media-encoder", [
    U("The encoder service's memory climbs until it is OOM-killed after about six hours. Find out why. Do not change production code yet, I just want the diagnosis."),
    T("Bash", {"command": "go tool pprof -top -inuse_space http://localhost:6060/debug/pprof/heap | head -8"}, "      flat  flat%   sum%        cum   cum%\n  612.4MB 71.2% 71.2%   612.4MB 71.2%  media-encoder/internal/frames.(*Pool).Get\n   88.1MB 10.2% 81.4%    90.3MB 10.5%  bytes.makeSlice"),
    T("Read", {"file_path": "/work/media-encoder/internal/frames/pool.go"}, "func (p *Pool) Get() *Frame {\n  f := &Frame{buf: make([]byte, p.size)}\n  p.live[f] = struct{}{}\n  return f\n}\nfunc (p *Pool) Put(f *Frame) { /* TODO */ }"),
    T("Grep", {"pattern": "\\.Put\\("}, "no matches"),
    A("Pool.Get allocates a new frame and records it in the live map, but Put is an empty stub and nobody calls it. Every frame stays referenced by p.live forever, which explains the steady heap growth: about 600 MB of in-use frame buffers."),
    A("To confirm the rate: at 30 frames a second of 1080p, that is roughly 90 MB a minute if frames were never freed, which is more than we see, so some frames must be released when jobs end and the map is rebuilt. I could not verify that last part without running a longer profile. The fix would be to implement Put and call it after each encode, but I have not changed anything."),
], dict(task_type="debugging",
    summary="Diagnosed the encoder memory growth: the frame pool records every frame it hands out in a map, but its Put method is an empty stub that is never called, so frames stay referenced and the heap grows. A heap profile shows about 600 MB held by the pool. No code was changed, and the exact growth rate was not fully reconciled.",
    facts=["heap profile points at the frame pool", "Put is a stub and never called", "frames remain referenced through the live map", "about 600 MB in use by Pool.Get", "no code changed", "growth rate not fully verified"],
    specific=["memory leak from an unreleased pool", "heap profiling with pprof"],
    decisions=[],
    skills=["Go", "pprof", "memory profiling"], not_skills=["Kubernetes", "Python", "FFmpeg tuning"])))

SESSIONS.append(S("debugging-2", "debugging", "/work/bank-portal", [
    U("Login works locally but on staging we get stuck in a redirect loop after the SSO callback. Chrome says too many redirects."),
    T("Bash", {"command": "curl -sI https://staging.portal.example.test/auth/callback?code=abc | head -8"}, "HTTP/2 302\nlocation: https://staging.portal.example.test/auth/login\nset-cookie: session=; Max-Age=0; Secure; SameSite=Strict"),
    A("The callback immediately clears the session cookie and sends the user back to login. SameSite=Strict on the session cookie would be dropped on the cross-site redirect coming back from the identity provider, but here the cookie is being set empty, which suggests the code exchange failed."),
    T("Bash", {"command": "kubectl logs deploy/portal -n staging --tail=20 | grep -i callback"}, "WARN callback: token exchange failed: redirect_uri_mismatch (expected https://staging.portal.example.test/auth/callback, got http://staging.portal.example.test/auth/callback)"),
    A("There is the cause. The app is behind a TLS-terminating load balancer, so it thinks the request is http and builds an http redirect_uri that the identity provider rejects. Locally there is no proxy, so it matches. We need the app to trust X-Forwarded-Proto."),
    T("Grep", {"pattern": "trust proxy|TrustedProxies"}, "no matches in src/"),
    A("I have not changed anything. Two options: enable the framework's trusted-proxy setting for the load balancer's range, or hard-code the public base URL in config. I'd go with the base URL setting since it is explicit and does not depend on header trust, but it is your call."),
], dict(task_type="debugging",
    summary="Traced the staging login redirect loop to the SSO token exchange failing with redirect_uri_mismatch: behind the TLS-terminating load balancer the app built an http callback URL while the identity provider expects https. Nothing was changed; the options are trusting the forwarded protocol header or configuring a fixed public base URL.",
    facts=["redirect loop after SSO callback on staging", "token exchange failed with redirect_uri_mismatch", "app saw http behind a TLS-terminating load balancer", "works locally because there is no proxy", "no code changed", "two fix options proposed"],
    specific=["redirect_uri mismatch behind a proxy", "forwarded protocol header"],
    decisions=[],
    skills=["OAuth", "Kubernetes", "HTTP debugging"], not_skills=["Terraform", "Java", "React"])))

SESSIONS.append(S("debugging-3", "debugging", "/work/game-server", [
    U("Players report rubber-banding every few minutes on the EU shard only. Server tick logs attached. What's going on?"),
    T("Bash", {"command": "grep -c 'tick overrun' logs/eu-1.log logs/us-1.log"}, "logs/eu-1.log:148\nlogs/us-1.log:3"),
    T("Bash", {"command": "grep 'tick overrun' logs/eu-1.log | awk '{print $1}' | cut -c1-5 | sort | uniq -c | sort -rn | head -4"}, "  9 14:10\n  9 14:25\n  9 14:40\n  9 14:55"),
    A("The overruns come in bursts exactly every 15 minutes: 14:10, 14:25, 14:40, 14:55. Something periodic is blocking the tick thread on EU only."),
    T("Grep", {"pattern": "every 15|\\*/15|900", "path": "/work/game-server"}, "src/persist/snapshot.rs:21: const SNAPSHOT_INTERVAL_SECS: u64 = 900;\nconfig/eu.toml:7: snapshot_sync = true"),
    T("Read", {"file_path": "/work/game-server/src/persist/snapshot.rs", "offset": 20, "limit": 25}, "if cfg.snapshot_sync { write_snapshot(&world) } else { spawn(write_snapshot_async(world.clone())) }"),
    A("EU is configured with snapshot_sync = true, so the world snapshot is written on the tick thread every 900 seconds; US uses the async path. That matches the burst timing. I haven't flipped it, since sync mode may have been set on purpose for the EU storage backend."),
], dict(task_type="debugging",
    summary="Found why the EU shard rubber-bands: tick overruns occur in bursts every 15 minutes, which matches the world snapshot interval, and the EU config has snapshot_sync enabled so the snapshot blocks the tick thread, while US writes it asynchronously. No change made, since sync mode may be deliberate.",
    facts=["148 tick overruns on EU versus 3 on US", "bursts at 15 minute intervals", "snapshot interval is 900 seconds", "EU config has snapshot_sync = true", "US uses the async path", "nothing was changed"],
    specific=["periodic blocking of the game tick", "synchronous snapshot on the main loop"],
    decisions=[],
    skills=["Rust", "log analysis", "game servers"], not_skills=["Unity", "Kubernetes", "networking packet capture"])))
