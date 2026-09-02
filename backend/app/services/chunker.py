import re
from dataclasses import dataclass


@dataclass(slots=True)
class TextChunk:
    ordinal: int
    heading: str
    content: str
    token_count: int


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
SENTENCE_RE = re.compile(r"(?<=[。！？.!?；;])\s*|\n+")


def split_text(text: str, target_chars: int = 850, overlap_chars: int = 120) -> list[TextChunk]:
    """Structure-aware Chinese/English chunking with a small semantic overlap."""
    sections: list[tuple[str, str]] = []
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        sections = [("正文", text)]
    else:
        if matches[0].start() > 0 and text[: matches[0].start()].strip():
            sections.append(("简介", text[: matches[0].start()].strip()))
        for index, match in enumerate(matches):
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            sections.append((match.group(2).strip(), text[start:end].strip()))

    chunks: list[TextChunk] = []
    ordinal = 0
    for heading, body in sections:
        if not body:
            continue
        sentences = [part.strip() for part in SENTENCE_RE.split(body) if part.strip()]
        current: list[str] = []
        current_len = 0
        for sentence in sentences:
            if current and current_len + len(sentence) > target_chars:
                content = "\n".join(current)
                chunks.append(TextChunk(ordinal, heading, content, estimate_tokens(content)))
                ordinal += 1
                overlap: list[str] = []
                overlap_len = 0
                for previous in reversed(current):
                    if overlap_len + len(previous) > overlap_chars:
                        break
                    overlap.insert(0, previous)
                    overlap_len += len(previous)
                current, current_len = overlap, overlap_len
            current.append(sentence)
            current_len += len(sentence)
        if current:
            content = "\n".join(current)
            chunks.append(TextChunk(ordinal, heading, content, estimate_tokens(content)))
            ordinal += 1
    return chunks


def estimate_tokens(text: str) -> int:
    chinese = len(re.findall(r"[\u4e00-\u9fff]", text))
    other = len(re.findall(r"[A-Za-z0-9_]+", text))
    return chinese + int(other * 1.3)
