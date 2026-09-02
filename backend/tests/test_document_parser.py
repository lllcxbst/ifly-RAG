import pytest
from app.services.document_parser import extract_text


def test_extract_markdown_keeps_structure() -> None:
    text = extract_text("guide.md", "# 标题\n\n正文  内容".encode())
    assert text == "# 标题\n\n正文 内容"


def test_rejects_unsupported_extension() -> None:
    with pytest.raises(ValueError, match="不支持"):
        extract_text("secret.exe", b"not really an exe")
