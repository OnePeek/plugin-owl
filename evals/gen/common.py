def U(t):
    return {"u": t}


def A(t):
    return {"a": t}


def T(name, inp, result="ok", err=False):
    d = {"t": name, "i": inp, "r": result}
    if err:
        d["err"] = True
    return d


def S(id, type, cwd, steps, reference):
    return {"id": id, "type": type, "cwd": cwd, "steps": steps, "reference": reference}
