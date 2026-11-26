"""Writes evals/dev/<id>.json from the session definitions in evals/gen/sessions*.py. Run: python3 evals/gen/make.py"""
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import sessions1  # noqa: E402
import sessions2  # noqa: E402
import sessions3  # noqa: E402

out = os.path.join(here, "..", "dev")
os.makedirs(out, exist_ok=True)
allS = sessions1.SESSIONS + sessions2.SESSIONS + sessions3.SESSIONS
for s in allS:
    with open(os.path.join(out, s["id"] + ".json"), "w") as f:
        json.dump(s, f, indent=1)
        f.write("\n")
print(len(allS), "dev")
