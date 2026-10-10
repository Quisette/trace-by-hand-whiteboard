"""Validates what src/jev.js emits against the OFFICIAL generated wire models (typesafe_sdk._schemas.models,
generated from https://api.typesafe.ai/openapi.json).

    python -I tests/conformance.py < fixtures.json > report.json

stdin  {requests: [...valid bodies], responses: [...], errors: [...422 bodies], models: {...}, invalid: [...bodies]}
stdout {ok: [...problems], invalid: [{accepted: bool, errors: [[type, ...loc]]}]}

tests/jev-api.js builds the fixtures, runs this with an interpreter that has `typesafe-sdk` installed
(SDK_PYTHON), and compares the pydantic error lists with the ones the server returns.
"""
import json
import sys

from pydantic import ValidationError
from typesafe_sdk._schemas import models as wire

data = json.load(sys.stdin)
problems = []
ANSWER_MODELS = {"noul": wire.NoulAnswer, "choice": wire.ChoiceAnswer, "score": wire.ScoreAnswer}


def attempt(label, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        problems.append(f"{label}: {type(e).__name__}: {str(e)[:300]}")


for i, req in enumerate(data["requests"]):
    attempt(f"request[{i}]", lambda req=req: wire.SystemOneRequest.model_validate(req))

for i, resp in enumerate(data["responses"]):
    attempt(f"response[{i}]", lambda resp=resp: wire.SystemOneResponse.model_validate(resp))
    if set(resp) != {"model", "answers", "usage"}:
        problems.append(f"response[{i}]: top-level keys {sorted(resp)}")
    for name, answer in resp["answers"].items():
        model = ANSWER_MODELS[answer["type"]]
        if set(answer) != set(model.model_fields):
            problems.append(f"response[{i}].{name}: keys {sorted(answer)} != {sorted(model.model_fields)}")
        probs = answer.get("probabilities")
        if probs is not None and abs(sum(probs.values()) - 1) > 0.01:
            problems.append(f"response[{i}].{name}: probabilities sum to {sum(probs.values())}")
        if answer["type"] == "noul" and not 0 <= answer["noul"] <= 1:
            problems.append(f"response[{i}].{name}: noul out of range")
        if answer["type"] == "score":
            levels = len(answer["legend"])
            if not 0 <= answer["score"] <= levels - 1 or set(answer["legend"]) != {str(k) for k in range(levels)} or set(answer["probabilities"]) != set(answer["legend"]):
                problems.append(f"response[{i}].{name}: score/legend/probabilities inconsistent")
            expected = sum(int(k) * p for k, p in answer["probabilities"].items())
            if abs(expected - answer["score"]) > 0.01:
                problems.append(f"response[{i}].{name}: score {answer['score']} is not the probability-weighted level {expected}")

for i, body in enumerate(data["errors"]):
    attempt(f"error[{i}]", lambda body=body: wire.HTTPValidationError.model_validate(body))
    for j, detail in enumerate(body["detail"]):
        attempt(f"error[{i}].detail[{j}]", lambda detail=detail: wire.ValidationError.model_validate(detail))

attempt("models", lambda: wire.ModelMetadataList.model_validate(data["models"]))

invalid = []
for body in data["invalid"]:
    try:
        wire.SystemOneRequest.model_validate(body)
        invalid.append({"accepted": True, "errors": []})
    except ValidationError as e:
        invalid.append({"accepted": False, "errors": [[err["type"], "body", *err["loc"]] for err in e.errors()]})

json.dump({"ok": problems, "invalid": invalid}, sys.stdout)
