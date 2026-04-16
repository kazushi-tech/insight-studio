"""
Google Drive API クライアントモジュール

ユーザーのGoogleドライブからファイルをダウンロードし、
考察スタジオで処理できるようにする機能を提供します。
"""
from __future__ import annotations

import httpx
import tempfile
from pathlib import Path
from typing import Optional

DRIVE_API_V3 = "https://www.googleapis.com/drive/v3"

# 一時ファイル保存用ディレクトリ
TEMP_GDRIVE_DIR = Path(tempfile.gettempdir()) / "ads_insights_gdrive"


def _ensure_temp_dir() -> Path:
    """一時ディレクトリを確保"""
    TEMP_GDRIVE_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_GDRIVE_DIR


async def get_file_metadata(access_token: str, file_id: str) -> dict:
    """
    ファイルのメタデータを取得
    
    Args:
        access_token: OAuth2アクセストークン
        file_id: Google DriveファイルID
        
    Returns:
        ファイルメタデータ（name, mimeType, size等）
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{DRIVE_API_V3}/files/{file_id}",
            params={"fields": "id,name,mimeType,size,createdTime,modifiedTime,shortcutDetails"},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        resp.raise_for_status()
        return resp.json()


async def download_file(access_token: str, file_id: str) -> tuple[bytes, str, str]:
    """
    ファイルをダウンロード
    
    Args:
        access_token: OAuth2アクセストークン
        file_id: Google DriveファイルID
        
    Returns:
        (ファイル内容のバイト列, ファイル名, MIMEタイプ)
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        # まずメタデータを取得
        meta = await get_file_metadata(access_token, file_id)
        filename = meta.get("name", f"unknown_{file_id}")
        mime_type = meta.get("mimeType", "application/octet-stream")
        
        # Google Sheetsの場合、XLSXとしてエクスポート
        if mime_type == 'application/vnd.google-apps.spreadsheet':
            export_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            resp = await client.get(
                f"{DRIVE_API_V3}/files/{file_id}/export",
                params={"mimeType": export_mime},
                headers={"Authorization": f"Bearer {access_token}"}
            )
            resp.raise_for_status()
            
            # 拡張子がない場合は追加
            if not filename.lower().endswith('.xlsx'):
                filename += '.xlsx'
                
            return resp.content, filename, export_mime
        
        # 通常のファイルをダウンロード
        resp = await client.get(
            f"{DRIVE_API_V3}/files/{file_id}",
            params={"alt": "media"},
            headers={"Authorization": f"Bearer {access_token}"}
        )
        resp.raise_for_status()
        
        return resp.content, filename, mime_type


async def download_file_to_temp(access_token: str, file_id: str) -> tuple[Path, str]:
    """
    ファイルをダウンロードして一時ファイルに保存
    
    Args:
        access_token: OAuth2アクセストークン
        file_id: Google DriveファイルID
        
    Returns:
        (保存先パス, ファイル名)
    """
    content, filename, _ = await download_file(access_token, file_id)
    
    temp_dir = _ensure_temp_dir()
    file_path = temp_dir / filename
    file_path.write_bytes(content)
    
    return file_path, filename


async def list_folder_files(
    access_token: str, 
    folder_id: str,
    mime_types: Optional[list[str]] = None
) -> list[dict]:
    """
    フォルダ内のファイル一覧を取得
    
    Args:
        access_token: OAuth2アクセストークン
        folder_id: Google DriveフォルダID
        mime_types: フィルタするMIMEタイプのリスト（Noneですべて）
        
    Returns:
        ファイル情報のリスト
    """
    query_parts = [f"'{folder_id}' in parents", "trashed = false"]
    
    if mime_types:
        mime_conditions = " or ".join([f"mimeType = '{mt}'" for mt in mime_types])
        query_parts.append(f"({mime_conditions})")
    
    query = " and ".join(query_parts)
    
    files: list[dict] = []
    page_token: Optional[str] = None
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            params = {
                "q": query,
                "fields": "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,shortcutDetails)",
                "pageSize": 100,
                "includeItemsFromAllDrives": "true",
                "supportsAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
                
            resp = await client.get(
                f"{DRIVE_API_V3}/files",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"}
            )
            resp.raise_for_status()
            data = resp.json()
            
            files.extend(data.get("files", []))
            
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    
    return files


async def download_folder_xlsx_files(
    access_token: str, 
    folder_id: str
) -> list[tuple[Path, str]]:
    """
    フォルダ内のすべてのExcelファイル(.xlsx)をダウンロード
    
    Args:
        access_token: OAuth2アクセストークン
        folder_id: Google DriveフォルダID
        
    Returns:
        [(保存先パス, ファイル名), ...] のリスト
    """
    # Excelファイルのみを取得
    xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    files = await list_folder_files(access_token, folder_id, [xlsx_mime])
    
    downloaded: list[tuple[Path, str]] = []
    
    for f in files:
        try:
            path, name = await download_file_to_temp(access_token, f["id"])
            downloaded.append((path, name))
        except Exception as e:
            print(f"[gdrive] Failed to download {f.get('name')}: {e}")
            continue
    
    return downloaded


def cleanup_temp_files() -> int:
    """
    一時ファイルをクリーンアップ
    
    Returns:
        削除したファイル数
    """
    if not TEMP_GDRIVE_DIR.exists():
        return 0
    
    count = 0
    for f in TEMP_GDRIVE_DIR.iterdir():
        try:
            if f.is_file():
                f.unlink()
                count += 1
        except Exception:
            pass
    
    return count

async def download_files_in_folder(
    access_token: str, 
    folder_id: str, 
    save_dir: Path, 
    downloaded_files: list
) -> None:
    """
    Recursively download files from a Google Drive folder.
    
    Args:
        access_token: OAuth2 access token
        folder_id: Google Drive folder ID
        save_dir: Local directory to save files
        downloaded_files: List to append downloaded file paths to
    """
    if not save_dir.exists():
        save_dir.mkdir(parents=True, exist_ok=True)
        
    query = f"'{folder_id}' in parents and trashed = false"
    
    files = []
    page_token = None
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            params = {
                "q": query,
                "fields": "nextPageToken,files(id,name,mimeType)",
                "pageSize": 100,
                "includeItemsFromAllDrives": "true",
                "supportsAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
                
            resp = await client.get(
                f"{DRIVE_API_V3}/files", 
                params=params, 
                headers={"Authorization": f"Bearer {access_token}"}
            )
            # If 404 or other error, simple return (folder might be empty or inaccessible)
            if resp.status_code != 200:
                print(f"[gdrive] List files error: {resp.status_code} {resp.text}")
                return

            data = resp.json()
            files.extend(data.get("files", []))
            
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    
    for f in files:
        name = f.get("name", "untitled")
        # Sanitize name for Windows
        safe_name = "".join(c for c in name if c not in '<>:"/\\|?*')
        
        if f['mimeType'] == 'application/vnd.google-apps.folder':
            # Recursive
            await download_files_in_folder(access_token, f['id'], save_dir / safe_name, downloaded_files)
        elif f['mimeType'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or \
             f['mimeType'] == 'application/vnd.google-apps.spreadsheet':
            # Download XLSX or Google Sheet (exported as XLSX)
            try:
                content, clean_name, _ = await download_file(access_token, f['id'])
                # Sanitize new filename (in case extension was added)
                safe_name = "".join(c for c in clean_name if c not in '<>:"/\\|?*')
                
                file_path = save_dir / safe_name
                file_path.write_bytes(content)
                downloaded_files.append(str(file_path))
                print(f"[gdrive] Downloaded: {file_path}")
            except Exception as e:
                print(f"[gdrive] Failed to download {name}: {e}")
