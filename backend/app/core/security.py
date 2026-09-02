import hashlib
import hmac

from app.core.config import settings
from fastapi import Header, HTTPException, status


async def require_admin(x_admin_key: str = Header(default="")) -> None:
    if not x_admin_key or not hmac.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="管理密钥无效")


def anonymize_ip(ip: str | None) -> str:
    if not ip:
        return "unknown"
    return hashlib.sha256(f"{settings.secret_key}:{ip}".encode()).hexdigest()[:16]
