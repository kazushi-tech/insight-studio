import requests
import json
import os
import sys
from pathlib import Path

# Config
BASE_URL = "http://127.0.0.1:8001"
FOLDER_PATH = "data/愛眼/オンライン"
MONTHS = ["2025-10", "2025-09", "2025-08", "2025-07"]

def run():
    print("--- 1. Generate Multi Report ---")
    uri = f"{BASE_URL}/api/generate_multi_report"
    payload = {
        "folder_path": FOLDER_PATH,
        "months": MONTHS
    }
    
    print(f"POST {uri}")
    try:
        res = requests.post(uri, json=payload)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        print(f"Generate report failed: {e}")
        if 'res' in locals():
            print(res.text)
        sys.exit(1)

    if not data.get("ok"):
        print(f"Generate report failed: {data.get('error')}")
        sys.exit(1)
        
    pp_path = data.get("path")
    print(f"Report generated at: {pp_path}")

    print("\n--- 2. Generate Insights ---")
    uri_insights = f"{BASE_URL}/api/generate_insights"
    payload_insights = {
        "point_pack_path": pp_path,
        "message": "Verification Request"
    }
    
    print(f"POST {uri_insights}")
    try:
        res = requests.post(uri_insights, json=payload_insights)
        res.raise_for_status()
        data_i = res.json()
        print(f"Insights API called. OK: {data_i.get('ok')}")
        if data_i.get("ok"):
            text = data_i.get("text", "")
            print(f"Text preview: {text[:100]}...")
        else:
            print(f"Error: {data_i.get('error')}")
    except Exception as e:
        print(f"Insights API failed: {e}")
        if 'res' in locals():
            print(res.text)

    print("\n--- 3. Check Logs ---")
    # repo root from current file
    repo_root = Path(__file__).resolve().parent.parent
    log_path = repo_root / ".logs" / "backend_latest.log"

    if log_path.exists():
        print(f"Reading last 50 lines of log: {log_path}")
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                for line in lines[-50:]:
                    if "[gi]" in line:
                        print(line.strip())
        except Exception as e:
            print(f"Failed to read log: {e}")
    else:
        print(f"Log file not found at {log_path}")

if __name__ == "__main__":
    run()
