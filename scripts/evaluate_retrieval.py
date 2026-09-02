#!/usr/bin/env python3
"""Offline, dependency-free before/after retrieval evaluation.

This does not replace the online end-to-end evaluation in the admin console. It
provides a reproducible regression signal even before model credentials exist.
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "data/seed/demo-product.md").read_text(encoding="utf-8")
CASES = json.loads((ROOT / "data/evaluation/questions.json").read_text(encoding="utf-8"))


def chunks() -> list[str]:
    sections = re.split(r"(?=^# )", SOURCE, flags=re.MULTILINE)
    return [item.strip() for item in sections if item.strip()]


def words(text: str) -> list[str]:
    text = re.sub(r"\s+", "", text.lower())
    return re.findall(r"[a-z0-9_-]+|[\u4e00-\u9fff]", text)


def ngrams(text: str) -> list[str]:
    clean = re.sub(r"[^a-z0-9\u4e00-\u9fff_-]", "", text.lower())
    return words(text) + [clean[index : index + 2] for index in range(max(0, len(clean) - 1))]


def baseline_score(question: str, document: str) -> float:
    q, d = set(words(question)), set(words(document))
    return len(q & d) / max(1, len(q))


EXPANSIONS = {
    "怎么": ["步骤", "接入", "调用", "检查"],
    "报错": ["错误", "排障", "检查"],
    "错误": ["报错", "排障", "检查"],
    "哪些": ["包括", "支持", "能力"],
    "重试": ["退避", "幂等", "Retry-After"],
}


def optimized_score(question: str, document: str) -> float:
    expanded = question + "".join(value for key, values in EXPANSIONS.items() if key in question for value in values)
    q, d = Counter(ngrams(expanded)), Counter(ngrams(document))
    dot = sum(value * d[token] for token, value in q.items())
    norm = math.sqrt(sum(value * value for value in q.values()) * sum(value * value for value in d.values())) or 1
    heading = document.splitlines()[0].removeprefix("# ")
    boost = 0.12 if any(token in heading.lower() for token in words(question) if len(token) > 1) else 0
    return dot / norm + boost


def evaluate(scorer, threshold: float, top_k: int = 1) -> dict:
    source_chunks = chunks()
    results = []
    for case in CASES:
        ranked = sorted(((scorer(case["question"], chunk), chunk) for chunk in source_chunks), reverse=True)
        score = ranked[0][0]
        answer = "\n".join(item[1] for item in ranked[:top_k])
        handoff = score < threshold
        expected = case.get("expected_keywords", [])
        passed = (
            handoff == case.get("expect_handoff", False)
            if not expected
            else (not handoff and any(key.lower() in answer.lower() for key in expected))
        )
        results.append({"id": case["id"], "category": case["category"], "passed": passed, "score": round(score, 4)})
    categories = sorted({case["category"] for case in CASES})
    return {
        "total": len(results),
        "passed": sum(row["passed"] for row in results),
        "accuracy": round(sum(row["passed"] for row in results) / len(results), 4),
        "by_category": {
            category: round(
                sum(row["passed"] for row in results if row["category"] == category)
                / sum(row["category"] == category for row in results),
                4,
            )
            for category in categories
        },
        "failed_ids": [row["id"] for row in results if not row["passed"]],
    }


if __name__ == "__main__":
    report = {
        "dataset": "data/evaluation/questions.json",
        "baseline": evaluate(baseline_score, 0.18),
        "optimized": evaluate(optimized_score, 0.055, top_k=5),
        "optimization": "中文字符 bigram + 词频余弦 + 查询扩展 + 标题加权 + Top-5 证据融合 + 未知问题阈值",
    }
    target = ROOT / "docs/evaluation-results.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
