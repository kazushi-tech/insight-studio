# mock_provider.py
# 固定JSONデータを返すMock Provider（テスト・デモ用）

from typing import Optional, List, Tuple, Dict, Any, TYPE_CHECKING
import sys
from pathlib import Path
import datetime as dt

# 親ディレクトリをパスに追加
parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from data_providers.base import BaseDataProvider

if TYPE_CHECKING:
    import report_data


# サンプルデータ（固定JSON）
# 月次データ3ヶ月分 + 週次データ2週分
MOCK_DATA: Dict[str, Dict[str, Any]] = {
    # 月次データ
    "2025-10": {
        "kpis": {
            "cost": 450000.0,
            "impr": 90000.0,
            "click": 4500.0,
            "cv": 225.0,
            "conversion_value": 675000.0,
            "revenue": 720000.0,
            "ctr": 0.05,
            "cvr": 0.05,
            "cpa": 2000.0,
            "cpc": 100.0,
        },
        "period_tag": "2025-10",
        "period_type": "monthly",
        "period_start": "2025-10-01",
        "period_end": "2025-10-31",
        "media_breakdown": [
            {"media_name": "Google検索", "kpis": {"cost": 180000.0, "impr": 30000.0, "click": 1800.0, "cv": 108.0}},
            {"media_name": "Facebook", "kpis": {"cost": 135000.0, "impr": 36000.0, "click": 1350.0, "cv": 67.0}},
            {"media_name": "LINE", "kpis": {"cost": 90000.0, "impr": 18000.0, "click": 900.0, "cv": 36.0}},
            {"media_name": "Instagram", "kpis": {"cost": 45000.0, "impr": 6000.0, "click": 450.0, "cv": 14.0}},
        ],
    },
    "2025-11": {
        "kpis": {
            "cost": 500000.0,
            "impr": 100000.0,
            "click": 5000.0,
            "cv": 250.0,
            "conversion_value": 750000.0,
            "revenue": 800000.0,
            "ctr": 0.05,
            "cvr": 0.05,
            "cpa": 2000.0,
            "cpc": 100.0,
        },
        "period_tag": "2025-11",
        "period_type": "monthly",
        "period_start": "2025-11-01",
        "period_end": "2025-11-30",
        "media_breakdown": [
            {"media_name": "Google検索", "kpis": {"cost": 200000.0, "impr": 35000.0, "click": 2100.0, "cv": 125.0}},
            {"media_name": "Facebook", "kpis": {"cost": 150000.0, "impr": 40000.0, "click": 1500.0, "cv": 65.0}},
            {"media_name": "LINE", "kpis": {"cost": 100000.0, "impr": 20000.0, "click": 1000.0, "cv": 40.0}},
            {"media_name": "Instagram", "kpis": {"cost": 50000.0, "impr": 5000.0, "click": 400.0, "cv": 20.0}},
        ],
    },
    "2025-12": {
        "kpis": {
            "cost": 600000.0,
            "impr": 120000.0,
            "click": 6000.0,
            "cv": 300.0,
            "conversion_value": 900000.0,
            "revenue": 960000.0,
            "ctr": 0.05,
            "cvr": 0.05,
            "cpa": 2000.0,
            "cpc": 100.0,
        },
        "period_tag": "2025-12",
        "period_type": "monthly",
        "period_start": "2025-12-01",
        "period_end": "2025-12-31",
        "media_breakdown": [
            {"media_name": "Google検索", "kpis": {"cost": 240000.0, "impr": 42000.0, "click": 2520.0, "cv": 156.0}},
            {"media_name": "Facebook", "kpis": {"cost": 180000.0, "impr": 48000.0, "click": 1800.0, "cv": 72.0}},
            {"media_name": "LINE", "kpis": {"cost": 120000.0, "impr": 24000.0, "click": 1200.0, "cv": 48.0}},
            {"media_name": "Instagram", "kpis": {"cost": 60000.0, "impr": 6000.0, "click": 480.0, "cv": 24.0}},
        ],
    },
    # 週次データ
    "2025-W47": {
        "kpis": {
            "cost": 120000.0,
            "impr": 25000.0,
            "click": 1250.0,
            "cv": 62.0,
            "conversion_value": 186000.0,
            "revenue": 198000.0,
            "ctr": 0.05,
            "cvr": 0.0496,
            "cpa": 1935.48,
            "cpc": 96.0,
        },
        "period_tag": "2025-W47",
        "period_type": "weekly",
        "period_start": "2025-11-17",
        "period_end": "2025-11-23",
    },
    "2025-W48": {
        "kpis": {
            "cost": 130000.0,
            "impr": 26000.0,
            "click": 1300.0,
            "cv": 65.0,
            "conversion_value": 195000.0,
            "revenue": 208000.0,
            "ctr": 0.05,
            "cvr": 0.05,
            "cpa": 2000.0,
            "cpc": 100.0,
        },
        "period_tag": "2025-W48",
        "period_type": "weekly",
        "period_start": "2025-11-24",
        "period_end": "2025-11-30",
    },
}


class MockProvider(BaseDataProvider):
    """固定JSONデータを返すMock Provider（テスト・デモ用）"""

    def extract_single(self, identifier: str, **kwargs):
        """
        identifier: 期間タグ（例: "2025-11", "2025-W48"）
        """
        if identifier not in MOCK_DATA:
            raise ValueError(
                f"Mock data not found for: {identifier}. "
                f"Available: {list(MOCK_DATA.keys())}"
            )

        import report_data as rd

        data = MOCK_DATA[identifier]
        meta = rd.ExtractMeta(
            file=f"mock://{identifier}",
            sheet="mock",
            method="mock",
            refs={},
            rows=0,
            cols=0,
            file_hash="mock_hash",
            file_size=0,
            file_modified=dt.datetime.now().isoformat(),
        )

        report = rd.ReportData(
            kpis=data["kpis"].copy(),
            meta=meta,
            evidence={k: "Mock固定値" for k in data["kpis"].keys()},
            month_tag=identifier,  # 月次・週次両対応のため汎用的に使用
        )

        # period_type等のフィールドが追加されたら設定
        if hasattr(report, "period_type"):
            report.period_type = data.get("period_type", "monthly")
            report.period_start = data.get("period_start", "")
            report.period_end = data.get("period_end", "")

        # 媒体別データを追加
        if hasattr(report, "media_breakdown") and "media_breakdown" in data:
            for mb_data in data["media_breakdown"]:
                kpis = mb_data["kpis"].copy()
                media_kpi = rd.MediaKPIs(
                    media_name=mb_data["media_name"],
                    kpis=kpis,
                    evidence={k: "Mock固定値" for k in kpis.keys()},
                )
                # 派生KPIを計算（CTR, CVR, CPA, CPC）
                media_kpi.compute_derived_kpis()
                report.media_breakdown.append(media_kpi)

        return report

    def extract_pair(
        self, current_identifier: str, base_identifier: Optional[str], **kwargs
    ):
        """当月とベースの2件を抽出"""
        current = self.extract_single(current_identifier)
        base = self.extract_single(base_identifier) if base_identifier else None
        return current, base

    def list_available(self, **kwargs) -> List[str]:
        """利用可能なモックデータ一覧"""
        return list(MOCK_DATA.keys())

    def list_periods(self, **kwargs) -> List[Dict[str, Any]]:
        """利用可能な期間情報一覧を返す"""
        periods = []
        for identifier, data in MOCK_DATA.items():
            periods.append(
                {
                    "identifier": identifier,
                    "period_tag": data.get("period_tag", identifier),
                    "period_type": data.get("period_type", "monthly"),
                    "period_start": data.get("period_start", ""),
                    "period_end": data.get("period_end", ""),
                    "filename": f"mock_{identifier}.xlsx",
                }
            )
        # 新しい順にソート
        periods.sort(key=lambda x: x["period_start"], reverse=True)
        return periods

    def supports_weekly(self) -> bool:
        """週次レポートに対応"""
        return True  # Mockは月次・週次両対応
