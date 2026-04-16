"""Migrate file-based data to DB backend.

Reads existing file-based asset and creative review data,
then inserts into the DB tables.

Usage:
    python scripts/migrate_file_to_db.py [--db-url sqlite:///data/market_lens.db]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from web.app.db.engine import get_engine, get_session, create_tables
from web.app.db.tables import assets, asset_data, review_runs, review_outputs, export_records


def migrate_assets(session_factory, asset_dir: Path) -> int:
    """Migrate file-based assets to DB. Returns count migrated."""
    if not asset_dir.exists():
        print(f"  Asset directory not found: {asset_dir}")
        return 0

    count = 0
    with session_factory() as session:
        for sub in sorted(asset_dir.iterdir()):
            meta_path = sub / "metadata.json"
            if not meta_path.exists():
                continue

            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            asset_id = meta["asset_id"]

            # Find binary data
            binary_data = b""
            for f in sub.iterdir():
                if f.name.startswith("original"):
                    binary_data = f.read_bytes()
                    break

            with session.begin():
                session.execute(
                    assets.insert().values(
                        id=asset_id,
                        file_name=meta["file_name"],
                        mime_type=meta["mime_type"],
                        size_bytes=meta["size_bytes"],
                        width=meta.get("width"),
                        height=meta.get("height"),
                        asset_type=meta.get("asset_type", "banner"),
                        created_at=meta["created_at"],
                    )
                )
                session.execute(
                    asset_data.insert().values(
                        asset_id=asset_id,
                        data=binary_data,
                    )
                )
            count += 1
            print(f"  Migrated asset: {asset_id} ({meta['file_name']})")

    return count


def migrate_reviews(session_factory, review_dir: Path) -> int:
    """Migrate file-based creative reviews to DB. Returns count migrated."""
    if not review_dir.exists():
        print(f"  Review directory not found: {review_dir}")
        return 0

    count = 0
    with session_factory() as session:
        for sub in sorted(review_dir.iterdir()):
            run_path = sub / "run.json"
            if not run_path.exists():
                continue

            run = json.loads(run_path.read_text(encoding="utf-8"))
            run_id = run["run_id"]

            with session.begin():
                session.execute(
                    review_runs.insert().values(
                        id=run_id,
                        asset_id=run["asset_id"],
                        review_type=run["review_type"],
                        status=run.get("status", "pending"),
                        brand_info=run.get("brand_info") or None,
                        operator_memo=run.get("operator_memo") or None,
                        lp_url=run.get("lp_url"),
                        created_at=run["created_at"],
                        updated_at=run.get("completed_at"),
                    )
                )

            # Migrate output if exists
            output_path = sub / "output.json"
            if output_path.exists():
                output = json.loads(output_path.read_text(encoding="utf-8"))
                with session.begin():
                    session.execute(
                        review_outputs.insert().values(
                            run_id=output["run_id"],
                            output_json=json.dumps(output["output_json"]),
                            model_used=output.get("model_used"),
                            created_at=output.get("created_at"),
                        )
                    )

            # Migrate export records
            exports_dir = sub / "exports"
            if exports_dir.exists():
                for f in sorted(exports_dir.iterdir()):
                    if f.name.endswith(".meta.json"):
                        rec = json.loads(f.read_text(encoding="utf-8"))
                        with session.begin():
                            session.execute(
                                export_records.insert().values(
                                    id=rec["export_id"],
                                    run_id=rec["run_id"],
                                    format=rec["format"],
                                    file_name=rec.get("file_path", ""),
                                    file_size_bytes=rec.get("file_size_bytes"),
                                    created_at=rec["created_at"],
                                )
                            )

            count += 1
            print(f"  Migrated review run: {run_id}")

    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate file-based data to DB")
    parser.add_argument("--db-url", default=None, help="Database URL (default: from DATABASE_URL env or sqlite)")
    parser.add_argument("--asset-dir", default="data/assets", help="Path to file-based assets")
    parser.add_argument("--review-dir", default="data/creative_reviews", help="Path to file-based reviews")
    args = parser.parse_args()

    engine = get_engine(args.db_url)
    create_tables(engine)
    sf = get_session(engine)

    print("=== Market Lens AI: File → DB Migration ===")
    print()

    print("[1/2] Migrating assets...")
    asset_count = migrate_assets(sf, Path(args.asset_dir))
    print(f"  Done: {asset_count} asset(s) migrated.")
    print()

    print("[2/2] Migrating creative reviews...")
    review_count = migrate_reviews(sf, Path(args.review_dir))
    print(f"  Done: {review_count} review run(s) migrated.")
    print()

    print(f"=== Migration complete: {asset_count} assets, {review_count} reviews ===")


if __name__ == "__main__":
    main()
