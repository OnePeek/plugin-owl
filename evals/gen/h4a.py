# Held-out set 4, part A (bugfix, data, debugging). Written before any run; never tuned on.
from common import U, A, T, S

def D(c, r):
    return dict(choice=c, reason=r)

SESSIONS = []

SESSIONS.append(S("bugfix-1", "bugfix", "/work/playlist-sync", [
    U("Playlists with more than 100 tracks lose everything after track 100 when synced to the phone. Fix it."),
    T("Read", {"file_path": "/work/playlist-sync/sync/fetch.py"}, "def fetch_tracks(pid):\n    r = api.get(f'/playlists/{pid}/tracks', params={'limit': 100})\n    return r.json()['items']"),
    A("The call asks for one page of 100 and ignores the next-page link in the response, so anything beyond that is dropped. I'll follow the cursor until it is empty."),
    T("Edit", {"file_path": "/work/playlist-sync/sync/fetch.py", "old_string": "    r = api.get(f'/playlists/{pid}/tracks', params={'limit': 100})\n    return r.json()['items']", "new_string": "    items, cursor = [], None\n    while True:\n        r = api.get(f'/playlists/{pid}/tracks', params={'limit': 100, 'cursor': cursor}).json()\n        items += r['items']\n        cursor = r.get('next_cursor')\n        if not cursor:\n            return items"}, "ok"),
    T("Write", {"file_path": "/work/playlist-sync/tests/test_fetch.py", "content": "def test_follows_cursor(fake_api):\n    fake_api.pages = [list(range(100)), list(range(100, 130))]\n    assert len(fetch_tracks('p1')) == 130"}, "File created."),
    T("Bash", {"command": "pytest tests/test_fetch.py -q"}, "1 passed"),
    A("Fixed: all pages are now fetched, covered by a two-page test. I did not check what happens if the API repeats a cursor, so a bad server could loop forever."),
], dict(task_type="bugfix",
    summary="Fixed playlists over 100 tracks losing the rest on sync: the fetch read only the first page and ignored the next-page cursor. It now loops until the cursor is empty, with a two-page test that passes. A server returning a repeating cursor could still loop forever.",
    facts=["only the first 100 tracks were fetched", "next page cursor was ignored", "now loops until the cursor is empty", "two-page test passes", "repeating cursor not guarded"],
    specific=["pagination ignored", "cursor-based paging"],
    decisions=[], skills=["Python", "pytest", "REST pagination"], not_skills=["Docker", "Kotlin", "GraphQL"])))

SESSIONS.append(S("bugfix-2", "bugfix", "/work/timesheet-web", [
    U("The weekly total on the timesheet shows 7.499999 hours instead of 7.5. Please fix."),
    T("Grep", {"pattern": "reduce|toFixed", "path": "/work/timesheet-web/src"}, "src/totals.js:6: return entries.reduce((s, e) => s + e.minutes / 60, 0)"),
    A("Each entry's minutes are divided by 60 before summing, so floating point error builds up. Summing the minutes first and dividing once avoids it."),
    T("Edit", {"file_path": "/work/timesheet-web/src/totals.js", "old_string": "return entries.reduce((s, e) => s + e.minutes / 60, 0)", "new_string": "return entries.reduce((s, e) => s + e.minutes, 0) / 60"}, "ok"),
    T("Write", {"file_path": "/work/timesheet-web/src/totals.test.js", "content": "test('sums to exactly 7.5', () => { expect(weekHours(Array(15).fill({minutes: 30}))).toBe(7.5) })"}, "File created."),
    T("Bash", {"command": "npx jest src/totals"}, "Tests: 4 passed"),
], dict(task_type="bugfix",
    summary="Fixed a weekly timesheet total showing 7.499999 hours: each entry was converted to hours before summing, accumulating floating point error. Minutes are now summed first and divided once, with a regression test that passes.",
    facts=["total showed 7.499999 instead of 7.5", "per entry division before summing", "now sums minutes then divides once", "regression test passes"],
    specific=["floating point accumulation", "sum integers before dividing"],
    decisions=[], skills=["JavaScript", "Jest"], not_skills=["TypeScript", "React", "SQL"])))

SESSIONS.append(S("bugfix-3", "bugfix", "/work/mail-templates", [
    U("Emails with an apostrophe in the customer's name show &#39; in the greeting, e.g. Hi O&#39;Brien. Fix the template rendering."),
    T("Read", {"file_path": "/work/mail-templates/render.rb"}, "def greeting(user)\n  ERB::Util.html_escape(user.name)\nend\ndef build(user)\n  body = ERB::Util.html_escape(greeting(user)) + ..."),
    A("The name is HTML-escaped twice, once in greeting and again in build, so the entity written by the first pass is escaped into visible text by the second. It should be escaped once, at the point it is placed into the HTML."),
    T("Edit", {"file_path": "/work/mail-templates/render.rb", "old_string": "def greeting(user)\n  ERB::Util.html_escape(user.name)\nend", "new_string": "def greeting(user)\n  user.name\nend"}, "ok"),
    T("Bash", {"command": "bundle exec rspec spec/render_spec.rb"}, "FAIL greeting escapes script tags: expected &lt;script&gt;, got <script>"),
    T("Edit", {"file_path": "/work/mail-templates/spec/render_spec.rb", "old_string": "expect(greeting(user)).to include('&lt;script&gt;')", "new_string": "expect(build(user)).to include('&lt;script&gt;')"}, "ok"),
    T("Bash", {"command": "bundle exec rspec spec/render_spec.rb"}, "4 examples, 0 failures"),
    A("Escaping now happens once in build. I moved the spec's assertion from greeting to the final HTML, since greeting is no longer where escaping lives."),
], dict(task_type="bugfix",
    summary="Fixed apostrophes in customer names showing as an HTML entity in emails: the name was escaped twice. Escaping now happens once where the name is placed into the HTML, and the spec that checks script tags is escaped asserts on the built email; all specs pass.",
    facts=["apostrophe shown as an entity", "name escaped twice", "escaping kept only in build", "spec moved to assert on the built email", "specs pass"],
    specific=["double HTML escaping"],
    decisions=[D("escape once when building the HTML, not in the greeting helper", "escaping in the helper and again in build is what produced the visible entity")],
    skills=["Ruby", "RSpec", "HTML escaping"], not_skills=["Rails controllers", "JavaScript", "SMTP configuration"])))

SESSIONS.append(S("data-1", "data", "/work/fleet-metrics", [
    U("Compute the average fuel use per 100 km per vehicle model for October from the trips table, excluding trips under 5 km. BigQuery."),
    T("Bash", {"command": "bq show --schema fleet.trips | head -12"}, "vehicle_id STRING, model STRING, km FLOAT, litres FLOAT, started_at TIMESTAMP"),
    T("Write", {"file_path": "/work/fleet-metrics/sql/fuel_per_100km.sql", "content": "SELECT model, SUM(litres) / SUM(km) * 100 AS l_per_100km, COUNT(*) AS trips\nFROM `fleet.trips`\nWHERE km >= 5 AND started_at >= '2026-10-01' AND started_at < '2026-11-01'\nGROUP BY model ORDER BY l_per_100km"}, "File created."),
    T("Bash", {"command": "bq query --use_legacy_sql=false < sql/fuel_per_100km.sql"}, "model | l_per_100km | trips\nVan-A | 9.1 | 1840\nTruck-B | 24.7 | 612\nVan-C | 8.8 | 77"),
    A("I weighted by distance (total litres over total km) rather than averaging each trip's ratio, so a long trip counts more than a short one. Van-C has only 77 trips, so its figure is less reliable."),
], dict(task_type="data",
    summary="Wrote a BigQuery query for October fuel use per 100 km by vehicle model, excluding trips under 5 km, and ran it. It divides total litres by total distance rather than averaging per-trip ratios; one model has only 77 trips, so its figure is less reliable.",
    facts=["BigQuery query on the trips table", "October only, trips under 5 km excluded", "total litres over total km", "ran and returned three models", "one model has only 77 trips"],
    specific=["distance-weighted average", "aggregate ratio instead of mean of ratios"],
    decisions=[D("divide total litres by total km instead of averaging each trip's ratio", "so longer trips weigh more than short ones")],
    skills=["SQL", "BigQuery"], not_skills=["Python", "Airflow", "dbt"])))

SESSIONS.append(S("data-2", "data", "/work/survey-lab", [
    U("In the survey export, respondent_id has duplicates and I think it's inflating our counts. Find out and dedupe in the loader."),
    T("Bash", {"command": "python -c \"import pandas as pd; d=pd.read_csv('export.csv'); print(len(d), d.respondent_id.nunique()); print(d[d.respondent_id.duplicated(keep=False)].sort_values('respondent_id').head(4)[['respondent_id','submitted_at','q1']])\""}, "5230 5107\n  respondent_id         submitted_at q1\n  R-8841  2026-11-02 09:14:03  4\n  R-8841  2026-11-02 09:14:41  4"),
    A("123 rows are duplicate ids, and the pairs are seconds apart with the same answer, which looks like a double-clicked submit. I'll keep the latest submission per respondent."),
    T("Edit", {"file_path": "/work/survey-lab/load.py", "old_string": "d = pd.read_csv(path)", "new_string": "d = pd.read_csv(path)\nd = d.sort_values('submitted_at').drop_duplicates('respondent_id', keep='last')"}, "ok"),
    T("Bash", {"command": "python -m pytest tests/test_load.py -q"}, "2 passed"),
], dict(task_type="data",
    summary="Confirmed that 123 survey rows were duplicate respondent ids submitted seconds apart with identical answers, and changed the loader to keep only the latest submission per respondent. Loader tests pass.",
    facts=["5230 rows but 5107 unique ids", "duplicates seconds apart with the same answer", "loader keeps the latest per respondent", "tests pass"],
    specific=["deduplication of repeated submissions", "pandas drop_duplicates"],
    decisions=[], skills=["Python", "pandas", "pytest"], not_skills=["SQL", "Spark", "R"])))

SESSIONS.append(S("data-3", "data", "/work/ad-reports", [
    U("The conversion rate on the dashboard dropped from 4.1% to 2.9% on Nov 12. Is it real or a data problem? Query the events in Snowflake."),
    T("Bash", {"command": "snowsql -q \"select date(ts) d, count_if(event='purchase')/count_if(event='session_start') r from events where ts >= '2026-11-08' group by 1 order by 1\""}, "11-10 0.041\n11-11 0.040\n11-12 0.029\n11-13 0.029"),
    T("Bash", {"command": "snowsql -q \"select app_version, date(ts) d, count_if(event='purchase') p, count_if(event='session_start') s from events where date(ts) in ('2026-11-11','2026-11-12') group by 1,2\""}, "5.3.0 11-11 410 9800\n5.3.0 11-12 395 9400\n5.4.0 11-12 12 3100"),
    A("The drop comes entirely from the new app version 5.4.0 released that day: it has 3100 session starts but only 12 purchases, while 5.3.0 is unchanged at about 4.2%. A purchase rate of 0.4% in one version suggests the purchase event is not firing in 5.4.0 rather than customers buying less. I haven't confirmed that in the app code."),
], dict(task_type="data",
    summary="Traced a dashboard conversion rate drop to one app version: the new release has thousands of session starts but almost no purchase events while the previous version is unchanged, which points to a tracking regression rather than a real change. This was not confirmed in the app code.",
    facts=["rate fell from about 4.1% to 2.9% on Nov 12", "version 5.3.0 unchanged around 4.2%", "version 5.4.0 had 3100 sessions and 12 purchases", "suggests purchase event not firing", "not confirmed in app code"],
    specific=["segmenting a metric by app version", "tracking regression"],
    decisions=[], skills=["SQL", "Snowflake", "metric analysis"], not_skills=["Python", "Tableau", "A/B testing"])))

SESSIONS.append(S("debugging-1", "debugging", "/work/photo-resizer", [
    U("Our resize worker hangs forever on certain uploads, no crash, no log. Don't fix anything yet, I want to know why."),
    T("Bash", {"command": "py-spy dump --pid $(pgrep -f resize_worker)"}, "Thread 0 (idle): MainThread\n  decode (PIL/ImageFile.py:262)\n  load_exif (resize/meta.py:41)\n  while True: reader.read(1024)"),
    T("Read", {"file_path": "/work/photo-resizer/resize/meta.py", "offset": 35, "limit": 14}, "def load_exif(f):\n    while True:\n        chunk = f.read(1024)\n        if chunk[:2] == b'\\xff\\xe1':\n            return parse(chunk)"),
    A("The loop only ends when it finds an EXIF marker in a chunk. On images without EXIF, read returns empty bytes at end of file, the check never matches, and the loop spins forever. The stack dump shows the worker sitting in exactly that loop. I haven't changed it."),
], dict(task_type="debugging",
    summary="Diagnosed a resize worker hang: a stack dump showed it stuck in the metadata reader, whose loop only exits on finding an EXIF marker, so images without EXIF spin forever at end of file. No code was changed.",
    facts=["worker hung with no crash or log", "py-spy dump shows it in the EXIF loading loop", "loop exits only on an EXIF marker", "images without EXIF never end the loop", "nothing changed"],
    specific=["infinite loop at end of file", "live stack dump with py-spy"],
    decisions=[], skills=["Python", "py-spy"], not_skills=["Docker", "Go", "image processing algorithms"])))

SESSIONS.append(S("debugging-2", "debugging", "/work/api-edge", [
    U("About 1 in 500 requests to the API return a 502 from nginx. Dev can't reproduce. Find the cause, tell me before changing config."),
    T("Bash", {"command": "grep -c ' 502 ' /var/log/nginx/access.log; grep 'upstream prematurely closed' /var/log/nginx/error.log | tail -2"}, "311\n2026/11/25 10:02:11 [error] upstream prematurely closed connection while reading response header from upstream\n2026/11/25 10:07:40 [error] upstream prematurely closed connection while reading response header"),
    T("Bash", {"command": "grep -E 'keepalive' /etc/nginx/conf.d/upstream.conf; grep -E 'keepalive_timeout|timeout_keep_alive' app/gunicorn.conf.py"}, "keepalive 32;\nkeepalive_timeout = 5"),
    A("nginx keeps idle upstream connections open for reuse, but gunicorn closes idle keep-alive connections after 5 seconds. When nginx reuses one right as gunicorn closes it, the request fails with prematurely closed, which fits a rare, timing-dependent 502 that dev traffic would not hit. I haven't changed either side."),
], dict(task_type="debugging",
    summary="Found the likely cause of rare 502s: nginx reuses idle upstream connections while the application server closes idle ones after 5 seconds, so occasionally a reused connection is closed under the request. Evidence is the premature close errors and the two timeout settings; nothing was changed.",
    facts=["about 1 in 500 requests got 502", "error log shows upstream prematurely closed connection", "nginx upstream keepalive enabled", "gunicorn keepalive timeout is 5 seconds", "no config changed"],
    specific=["keep-alive timeout mismatch between proxy and upstream"],
    decisions=[], skills=["nginx", "gunicorn", "log analysis"], not_skills=["Kubernetes", "TLS", "load balancer provisioning"])))

SESSIONS.append(S("debugging-3", "debugging", "/work/search-indexer", [
    U("Indexing jobs are getting slower every night and the box runs out of disk by Friday. Why?"),
    T("Bash", {"command": "du -sh /var/lib/indexer/* | sort -h | tail -3"}, "2.1G /var/lib/indexer/cache\n38G /var/lib/indexer/segments\n61G /var/lib/indexer/tmp"),
    T("Bash", {"command": "ls /var/lib/indexer/tmp | head -3; ls /var/lib/indexer/tmp | wc -l"}, "merge-20261119-0412.tmp\nmerge-20261119-0412.lock\nmerge-20261119-0511.tmp\n1894"),
    T("Grep", {"pattern": "\\.tmp|unlink|remove", "path": "/work/search-indexer/src/merge.rs"}, "src/merge.rs:77: let tmp = dir.join(format!(\"merge-{}.tmp\", stamp));\n(no removal of tmp anywhere in the file)"),
    A("The tmp folder holds 1894 merge files and 61 GB, and the merge code creates a temp file per merge but never deletes it. That fills the disk and, as the folder grows, directory scans in each job get slower. I did not delete anything on the box or change the code."),
], dict(task_type="debugging",
    summary="Diagnosed the disk exhaustion and slowing nightly indexing: the merge step creates a temporary file per merge and never removes it, leaving about 1900 files and 61 GB in the temp folder. Nothing was deleted or changed.",
    facts=["61 GB in the tmp folder", "1894 merge temp files", "merge code never removes its temp file", "nothing deleted or changed"],
    specific=["leaked temporary files"],
    decisions=[], skills=["Rust", "Linux disk analysis"], not_skills=["Elasticsearch", "Kubernetes", "Python"])))
