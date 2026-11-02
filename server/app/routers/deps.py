from fastapi import HTTPException, UploadFile

from ..config import settings


async def read_upload(file: UploadFile) -> bytes:
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"حداکثر حجم فایل {settings.max_upload_mb} مگابایت است")
    return data
