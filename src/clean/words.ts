// Code identifiers made of dictionary words (IllegalStateException, KafkaConsumer, java.util.concurrent) are ordinary
// technical vocabulary, not key material. The entropy, host and open-extension file rules let a token pass when every one of
// its parts is a word from this list (or a short acronym or a small number), so a real exception or package name is never
// held while random key material, which never splits into words, still is.
//
// Server mirror: backend-service `leak_screen.py` must use the same list and the same rule (shared vectors in
// tests/fixtures/ai_plugin_text_vectors.json). Compared in lower case; a part may also be a listed word plus one suffix from
// SUFFIXES, or two listed words joined (keyboard, rolledback).
const LIST = `
abort about absolute abstract accept access account accumulator acknowledge action activate active activity actor adapter add
address admin advanced advice after agent aggregate alert algorithm alias align all allocate allocation allow already alternate
analysis analytics analyzer anchor android angular animation annotation answer any api app append apple application apply
approval archive area argument arithmetic array arrow artifact ascending aspect assert assertion asset assign assignment async
atomic attach attempt attribute audio audit auth author authorization authorize authority auto automatic available avatar await
back backend background backoff backup bad badge balance balancer bank bar base basic batch bean before begin behavior benchmark
best between big binary binding bit blank blob block blocking blue board body boolean boot bootstrap border bot bottom bound
bounds box branch break breaker bridge broadcast broken browser bucket buffer bug build builder bulk bundle burst bus business
button by byte cache calculate calendar call callback camera cancel canceled cancelled candidate canvas capacity capture card
cart case cast catalog catch category cause cell center certificate chain change channel char character chart chat check
checkout checkpoint child chunk circuit claim class classic clean cleanup clear click client clipboard clock clone close
closed cloud cluster code codec collection collector color column combine command comment commit common compact comparator
compare compile compiler complete completable completion component compose composite compress compute concurrent condition
config configuration configure confirm conflict connect connection connector console constant constraint consumer contact
container content context continue contract control controller convert converter cookie coordinator copy core count counter
course coverage crash create creation credential cron cross crypto css current cursor custom customer cycle daemon daily
dashboard data database date day dead deadline deadlock debug decimal decode decoder decorator default defer define delay
delegate delete deleted delivery demo denied dependency deploy deployment deprecated depth descending descriptor deserialize
design destination destroy detail detect device dialog dictionary diff digest digit direct direction directory disable
disabled discovery disk dispatch dispatcher display disposed distinct distributed division dns doc document domain done
double down download draft drag driver drop dummy duplicate duration dynamic dynamo each early edge edit editor effect element
email embedded empty enable enabled encode encoder encrypt end endpoint engine enqueue ensure enter entity entry enum
environment equal equals error event every evict exact example exceeded exception exchange exclude exec execute execution
executor exhausted exist exit expand expect expected expiry explicit export expression extend extension external extra
extract factory fail failed failure fallback false fast fatal feature fetch field file filter final finally find first fix
fixed flag flat float flow flush focus folder follow font footer for force foreign fork form format formatter forward found
fragment frame framework free from front full function future gateway general generate generator generic get global go good
graph graphql grid group guard guest gzip hand handle handler handshake hash hashed head header health heap height hello
help helper hibernate hidden high history hit hold home hook host hour html http https icon identifier identity idle ignore
illegal image immutable impl implementation import inbox include incoming increment index info inherit init initial
initialization initialize inline inner input insert inspect install instance integer integration integrity interceptor
interface internal interrupt interval invalid invocation invoke issue item iterator java javascript job join json jump
kafka keep kernel key keyboard kind label lambda language last latch latency launch layer layout lazy leader leak left
legacy length library lifecycle limit line link linked list listener literal load loader local locale location lock
log logger login logic logout long lookup loop low machine main manage manager map mapper mapping mark market marshal
master match math max media member memo memoized memory menu merge message meta metadata method metric middleware migration
min minute mirror miss missing mock mode model modification modify module mongo monitor month mount mouse move multi
mutable mutation mutex name named native navigation negative nested network new next node none normal not note notification
notify null number object observable observer offset old on once online open operation operator optimistic option optional
order origin outbox outer output overflow override owner package page pager pagination panel parallel param parameter
parent parse parser part partial partition pass password patch path pattern pause payload payment peer pending permission
persist persistence phase phone pipe pipeline pixel placeholder plan platform player plugin point pointer policy poll
pool pop popup port position post postgres power predicate preference prefix prepare preview primary print priority private
process processing processor produce producer product profile program progress project promise prompt property props
protocol provider proxy public publish publisher pull push query queue quick quota race random range rate raw reach react
read reader ready real receive receiver record recover recovery recursion recursive red redirect redis reduce reducer
reference refresh refused region register registry reject release reload remote remove render renderer repeat replace
replica reply report repository request require required reset resolve resolver resource response rest restore result
resume retry retryable return reverse review rolled role rollback root rotate round route router row rule run runner runtime
safe sample save scale scan schedule scheduled scheduler schema scope screen script scroll search second secure
security segment select selector send sender sequence serial serialize server service session set setting setup shadow
shape share shared shell shift short show shutdown side sign signal signature simple single singleton size skip slice slot
slow small snapshot socket sort source span spec split spring sql stack stage start state statement static status step
stop storage store strategy stream strict string struct style sub subject submit subscribe subscriber subscription success
such suite summary super supplier supported switch symbol sync synchronized system tab table tag target task team template
temp temporary tenant terminate test text theme thread throttle throw ticket tier time timeout timer timestamp title to
toggle token tool top topic total trace tracker transaction transform transient translate transport tree trigger trim true
trust try type typed unauthorized unbound undefined unique unit unknown unlock unread unsupported up update upload upsert url
usage use user util utility valid validate validation validator value var variable vector verify version view violation
virtual visible visitor void volume wait waiter warning watch watcher web webhook websocket week weight when where while
widget width window word work worker workflow wrapper write writer zero zone
elastic asyncio out did has can was are its per via non pre own off yes few far put net less more most next prev
`;

export const WORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter((w) => w !== ""));
// Short parts that are ordinary words in an identifier (OutOfMemoryError, getElementsByClassName, NoSuchMethodException).
const SHORT = new Set(["of", "by", "no", "to", "in", "on", "at", "is", "as", "up", "id", "or", "if", "do", "my", "db", "io", "ui", "os", "fs", "js", "ts", "go", "ok", "it", "be", "an", "re", "un"]);
const SUFFIXES = ["s", "es", "ed", "d", "ing", "er", "ers", "or", "ors", "ion", "ions", "able", "ment", "ments", "ness", "ity", "ive", "ly", "al", "ize", "izer"];
// camelCase parts: an acronym (XML in XMLParser, IO in IOException), a capitalised or lower-case word, digits.
const PART = /[A-Z]{2,}(?![a-z])|[A-Z]?[a-z]+|[0-9]+|[A-Z]/g;

function known(w: string): boolean {
  if (WORDS.has(w)) return true;
  for (const s of SUFFIXES) if (w.length - s.length >= 3 && w.endsWith(s) && WORDS.has(w.slice(0, -s.length))) return true;
  return false;
}

function wordPart(w: string): boolean {
  if (known(w)) return true;
  // two listed words joined (keyboard, rolledback), each at least 3 letters
  for (let i = 3; i <= w.length - 3; i++) if (known(w.slice(0, i)) && known(w.slice(i))) return true;
  return false;
}

/**
 * True when the token is a code identifier made only of dictionary words: camelCase or PascalCase parts each a listed word
 * (or a listed word plus a suffix, or two listed words joined), at most one acronym of 2 to 5 capitals, at most one number of
 * 1 or 2 digits, and at least two word parts. Random key material never splits this way.
 */
export function isWordIdentifier(tok: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tok)) return false;
  const parts = tok.match(PART) ?? [];
  let words = 0;
  let acronyms = 0;
  let numbers = 0;
  for (const p of parts) {
    if (/^[0-9]+$/.test(p)) {
      if (p.length > 2 || ++numbers > 1) return false;
      continue;
    }
    if (/^[A-Z]+$/.test(p)) {
      if (p.length < 2 || p.length > 5 || ++acronyms > 1) return false;
      continue;
    }
    const w = p.toLowerCase();
    if (w.length <= 2) {
      if (!SHORT.has(w)) return false;
      continue;
    }
    if (!wordPart(w)) return false;
    words++;
  }
  return words >= 2 || (words === 1 && parts.length <= 2);
}

/** True when every dot-separated label of the token is a dictionary word or word identifier (java.util.concurrent, org.junit.jupiter.api is not: junit). */
export function isWordDotted(tok: string): boolean {
  const labels = tok.split(".");
  if (labels.length < 2) return false;
  return labels.every((l) => l.length >= 2 && (SHORT.has(l.toLowerCase()) || isWordIdentifier(l)));
}
