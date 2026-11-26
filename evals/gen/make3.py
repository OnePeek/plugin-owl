"""Writes evals/held-out-3/<id>.json from h3a/h3b/h3c. Run: python3 evals/gen/make3.py"""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import h3a, h3b, h3c
out = os.path.join(here, "..", "held-out-3")
os.makedirs(out, exist_ok=True)
allS = h3a.SESSIONS + h3b.SESSIONS + h3c.SESSIONS
assert len({s["id"] for s in allS}) == 30
for s in allS:
    with open(os.path.join(out, s["id"] + ".json"), "w") as f:
        json.dump(s, f, indent=1); f.write("\n")
print(len(allS), "held-out-3")
