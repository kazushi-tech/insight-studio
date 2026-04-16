
@app.get("/api/debug/ls")
def debug_ls(path: str = ""):
    """Temporary debug endpoint to list data directory"""
    try:
        root = _get_data_dir()
        # Prevent path traversal slightly
        if ".." in path:
            return {"error": "Invalid path"}
            
        target = root
        if path:
            target = root / path
            
        if not target.exists():
            return {"error": f"{target} does not exist", "root": str(root)}
        
        items = []
        for p in target.iterdir():
            items.append({
                "name": p.name,
                "is_dir": p.is_dir(),
                "size": p.stat().st_size if p.is_file() else 0
            })
        return {"path": str(target), "items": items}
    except Exception as e:
        return {"error": str(e)}
