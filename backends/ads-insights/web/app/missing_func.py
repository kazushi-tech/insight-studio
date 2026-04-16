
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
        elif f['mimeType'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            # Download XLSX
            try:
                content, _, _ = await download_file(access_token, f['id'])
                file_path = save_dir / safe_name
                file_path.write_bytes(content)
                downloaded_files.append(str(file_path))
                print(f"[gdrive] Downloaded: {file_path}")
            except Exception as e:
                print(f"[gdrive] Failed to download {name}: {e}")
