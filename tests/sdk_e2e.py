"""Runs the OFFICIAL typesafe-sdk (Python) against tools/jev-server.js.

    python -I tests/sdk_e2e.py PLAIN_URL KEYED_URL FLAKY_URL

tests/jev-api.js starts the three servers and runs this when an interpreter with `typesafe-sdk` is available
(set SDK_PYTHON, or install it: `uv venv v && VIRTUAL_ENV=v uv pip install typesafe-sdk`).
  PLAIN_URL  accepts any bearer token
  KEYED_URL  requires the key "secret-key"
  FLAKY_URL  answers the first two requests with 429 + retry-after-ms, then behaves normally
"""
import sys

from pydantic import BaseModel
from typesafe_sdk import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    RetryPolicy,
    Score,
    ScoreAnswer,
    SystemOneResponse,
    TypeSafeAuthenticationError,
    TypeSafeClient,
    TypeSafeNotFoundError,
    TypeSafeUnprocessableEntityError,
)

plain, keyed, flaky = sys.argv[1:4]
checks = 0


def check(cond, what):
    global checks
    checks += 1
    if not cond:
        raise AssertionError(what)


STATE = {"subject": "Charged twice this month", "body": "I see two charges of $49. Please fix this ASAP."}
QUESTIONS = {
    "billing": Noul(instructions="Is this ticket about billing?", criteria={"true": ["charged twice", "invoice", "refund"], "false": ["password", "feature request"]}),
    "tone": Choice(instructions="What is the tone?", criteria={"calm": ["thanks", "no rush"], "frustrated": ["please fix this", "again"], "angry": ["unacceptable", "furious"]}),
    "urgency": Score(instructions="How urgent is it?", criteria=["can wait", "this week", ["asap", "please fix this", "today"]]),
}

# --- models ---
with TypeSafeClient(api_key="anything", base_url=plain) as client:
    names = [m.name for m in client.models.list().models]
    check("jev-latest" in names, f"models: {names}")

    # --- typed answers ---
    r = client.system_one(STATE, QUESTIONS)
    check(isinstance(r, SystemOneResponse) and r.model == "jev-local-1", f"model {r.model}")
    check(isinstance(r.nouls["billing"], NoulAnswer) and 0 <= r.nouls["billing"].noul <= 1, "noul")
    check(r.nouls["billing"].noul > 0.5, f"billing should be yes: {r.nouls['billing'].noul}")
    tone = r.choices["tone"]
    check(isinstance(tone, ChoiceAnswer) and tone.choice in {"calm", "frustrated", "angry"}, "choice")
    check(abs(sum(tone.probabilities.values()) - 1) < 0.01 and 0 <= tone.confidence <= 1, "choice probabilities")
    urgency = r.scores["urgency"]
    check(isinstance(urgency, ScoreAnswer) and 0 <= urgency.score <= 2, "score range")
    check(set(urgency.probabilities) == {0, 1, 2} and abs(sum(urgency.probabilities.values()) - 1) < 0.01, "score probabilities keyed by level")
    check(urgency.legend[0] == "can wait" and urgency.legend[2] == ["asap", "please fix this", "today"], f"legend {urgency.legend}")
    check(r.usage.input_tokens and r.usage.input_tokens > 0 and r.usage.output_tokens == 3, f"usage {r.usage}")

    # --- raw dict questions, object criteria with examples, string state ---
    r = client.system_one(
        "move PTR to NUM",
        {
            "intent": {"type": "choice", "criteria": {"assign": {"meaning": "set a variable", "examples": ["move PTR to NUM"]}, "push": ["push NUM onto STK"]}},
            "neg": {"type": "noul", "criteria": {"true": "not", "false": "is"}},
        },
    )
    check(r.choices["intent"].choice == "assign", "object criteria with examples")
    check(r.nouls["neg"].noul <= 0.5, "noul with criteria only")
    check(client.system_one("x", {"q": {"type": "noul", "instructions": "Is it?"}}).nouls["q"].noul == 0.5, "instructions-only noul is 'unsure'")

    # --- response_model (pydantic) ---
    class Typed(SystemOneResponse):
        billing: NoulAnswer
        tone: ChoiceAnswer
        urgency: ScoreAnswer

    typed = client.system_one(STATE, QUESTIONS, response_model=Typed)
    check(typed.billing.noul == typed.nouls["billing"].noul and typed.urgency.score == typed.scores["urgency"].score, "response_model")

    # --- server-side errors surface as the SDK's typed exceptions ---
    try:
        client.system_one("x", {"a": {"type": "bogus"}})
        check(False, "bogus type should fail")
    except TypeSafeUnprocessableEntityError as e:
        check(e.status == 422 and "a" in str(e) and e.request_id, f"422: {e}")
        check(isinstance(e.body, dict) and e.body["detail"][0]["type"] == "union_tag_invalid", f"422 body: {e.body}")
    try:
        client.system_one("x", {"a": {"type": "score", "criteria": [None]}})
        check(False, "null score level should fail")
    except TypeSafeUnprocessableEntityError as e:
        check("criteria" in str(e), f"422 location: {e}")
    try:
        client.system_one("x", {"a": Noul(instructions="Is it?")}, model="no-such-model")
        check(False, "unknown model should fail")
    except TypeSafeNotFoundError as e:
        check(e.status == 404 and "no-such-model" in str(e), f"404: {e}")

# --- auth ---
with TypeSafeClient(api_key="wrong", base_url=keyed, retry=RetryPolicy(max_retries=0)) as client:
    try:
        client.models.list()
        check(False, "wrong key should fail")
    except TypeSafeAuthenticationError as e:
        check(e.status == 401, f"401: {e}")
with TypeSafeClient(api_key="secret-key", base_url=keyed) as client:
    check(client.system_one("hello", {"q": Choice(criteria={"a": None, "b": None})}).choices["q"].choice in {"a", "b"}, "keyed server accepts the key")

# --- retries: two 429s with retry-after-ms, then success ---
with TypeSafeClient(api_key="anything", base_url=flaky, retry=RetryPolicy(max_retries=3, backoff_initial=0.01, backoff_max=0.05)) as client:
    check(client.system_one("hello", {"q": Choice(criteria={"a": None, "b": None})}).choices["q"].choice in {"a", "b"}, "retried 429s")

print(f"sdk e2e ok ({checks} checks)")
