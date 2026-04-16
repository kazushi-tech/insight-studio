# base.py
# データプロバイダーの抽象クラス定義

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any, TYPE_CHECKING

# TYPE_CHECKINGを使って循環インポートを回避
if TYPE_CHECKING:
    import sys
    parent_dir = Path(__file__).parent.parent
    if str(parent_dir) not in sys.path:
        sys.path.insert(0, str(parent_dir))
    import report_data


class BaseDataProvider(ABC):
    """データソース抽象クラス"""

    @abstractmethod
    def extract_single(self, identifier: str, **kwargs) -> "report_data.ReportData":
        """
        単一レポートを抽出

        Args:
            identifier: データ識別子（Excelならパス、Mockならタグ名）
            **kwargs: プロバイダー固有のパラメータ

        Returns:
            ReportData
        """
        pass

    @abstractmethod
    def extract_pair(
        self,
        current_identifier: str,
        base_identifier: Optional[str],
        **kwargs
    ) -> Tuple["report_data.ReportData", Optional["report_data.ReportData"]]:
        """
        当月とベースの2件を抽出

        Args:
            current_identifier: 当月データの識別子
            base_identifier: ベースデータの識別子（Noneの場合はベースなし）
            **kwargs: プロバイダー固有のパラメータ

        Returns:
            (current_report, base_report) - baseがない場合はNone
        """
        pass

    @abstractmethod
    def list_available(self, **kwargs) -> List[str]:
        """
        利用可能なデータ識別子一覧を返す

        Returns:
            識別子のリスト
        """
        pass

    @abstractmethod
    def list_periods(self, **kwargs) -> List[Dict[str, Any]]:
        """
        利用可能な期間情報一覧を返す

        Returns:
            期間情報のリスト: [
                {
                    "identifier": "...",
                    "period_tag": "2025-11",
                    "period_type": "monthly",
                    "period_start": "2025-11-01",
                    "period_end": "2025-11-30"
                },
                ...
            ]
        """
        pass

    @abstractmethod
    def supports_weekly(self) -> bool:
        """週次レポートに対応しているか"""
        pass
