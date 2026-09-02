import hashlib
import json
import math
import re
from typing import Any

import httpx
from app.core.config import settings
from tenacity import retry, stop_after_attempt, wait_exponential


class EmbeddingProvider:
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not settings.embedding_api_key:
            return [self._local_hash_embedding(text) for text in texts]
        headers = {"Authorization": f"Bearer {settings.embedding_api_key}"}
        payload: dict[str, Any] = {"model": settings.embedding_model, "input": texts}
        if settings.embedding_model.startswith("text-embedding-3"):
            payload["dimensions"] = settings.embedding_dimensions
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{settings.embedding_base_url.rstrip('/')}/embeddings", headers=headers, json=payload
            )
            response.raise_for_status()
            records = sorted(response.json()["data"], key=lambda item: item["index"])
            embeddings = [record["embedding"] for record in records]
            invalid_dimensions = {len(embedding) for embedding in embeddings if len(embedding) != settings.embedding_dimensions}
            if invalid_dimensions:
                actual = ", ".join(str(value) for value in sorted(invalid_dimensions))
                raise ValueError(
                    f"嵌入模型返回维度 {actual}，但数据库配置为 {settings.embedding_dimensions} 维"
                )
            return embeddings

    @staticmethod
    def _local_hash_embedding(text: str) -> list[float]:
        """Dependency-free demo embedding. Production should configure a real embedding API."""
        dimensions = settings.embedding_dimensions
        vector = [0.0] * dimensions
        normalized = re.sub(r"\s+", "", text.lower())
        tokens = re.findall(r"[a-z0-9_-]+|[\u4e00-\u9fff]", normalized)
        tokens.extend(normalized[index : index + 2] for index in range(max(0, len(normalized) - 1)))
        for token in tokens:
            digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
            position = int.from_bytes(digest[:4], "little") % dimensions
            sign = 1 if digest[4] & 1 else -1
            vector[position] += sign
        magnitude = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / magnitude for value in vector]


class ChatProvider:
    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=8))
    async def complete_text(
        self,
        system: str,
        user: str,
        history_messages: list[dict[str, str]] | None = None,
        model: str | None = None,
    ) -> str:
        if not settings.llm_api_key:
            raise RuntimeError("知识图谱抽取需要配置大模型密钥")
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.extend(history_messages or [])
        messages.append({"role": "user", "content": user})
        # LightRAG's extraction prompts request structured JSON.  A hard output
        # budget is important for reasoning-capable OpenAI-compatible models:
        # without it they can keep generating until LightRAG's worker timeout.
        payload: dict[str, Any] = {
            "model": model or settings.llm_model,
            "temperature": 0.1,
            "max_tokens": 1800,
            "enable_thinking": False,
            "messages": messages,
        }
        # Normal structured extraction finishes in seconds on the configured
        # lightweight model. Fail fast enough for the adaptive layer to retry
        # or fall back to semantic retrieval instead of leaving the UI waiting.
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions", headers=headers, json=payload
            )
            # Providers differ in support for optional OpenAI-compatible hints.
            # Keep the output cap even when retrying the portable request shape.
            if response.status_code == 400:
                payload.pop("enable_thinking", None)
                response = await client.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions", headers=headers, json=payload
                )
            response.raise_for_status()
            content = str(response.json()["choices"][0]["message"]["content"])
            # A few compatible models prefix the final answer with a dangling
            # closing reasoning tag even when thinking is disabled.
            return re.sub(r"^\s*</think>\s*", "", content, flags=re.IGNORECASE)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
        payload = {
            "model": settings.llm_model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions", headers=headers, json=payload
            )
            # Some OpenAI-compatible providers (including selected SiliconFlow
            # models) reject response_format even though they reliably follow a
            # JSON-only system prompt. Retry once without that optional hint.
            if response.status_code == 400:
                payload.pop("response_format", None)
                response = await client.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions", headers=headers, json=payload
                )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if not match:
                raise ValueError("模型未返回有效 JSON") from None
            return json.loads(match.group(0))


embedding_provider = EmbeddingProvider()
chat_provider = ChatProvider()
