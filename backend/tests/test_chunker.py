from app.services.chunker import estimate_tokens, split_text


def test_chunker_preserves_headings_and_ordinals() -> None:
    text = "# 接入指南\n\n" + "这是第一条说明。" * 120 + "\n\n# 排障\n\n检查请求 ID。"
    chunks = split_text(text, target_chars=180, overlap_chars=30)
    assert len(chunks) > 2
    assert chunks[0].heading == "接入指南"
    assert chunks[-1].heading == "排障"
    assert [chunk.ordinal for chunk in chunks] == list(range(len(chunks)))


def test_estimate_tokens_counts_chinese_and_words() -> None:
    assert estimate_tokens("接口 API request") >= 3
