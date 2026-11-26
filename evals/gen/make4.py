"""Writes evals/held-out-4/<id>.json from h4a/h4b/h4c. Run: python3 evals/gen/make4.py"""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import h4a, h4b, h4c
out = os.path.join(here, "..", "held-out-4")
os.makedirs(out, exist_ok=True)
allS = h4a.SESSIONS + h4b.SESSIONS + h4c.SESSIONS
assert len({s["id"] for s in allS}) == 30 and len(allS) == 30
for s in allS:
    with open(os.path.join(out, s["id"] + ".json"), "w") as f:
        json.dump(s, f, indent=1); f.write("\n")
print(len(allS), "held-out-4")
