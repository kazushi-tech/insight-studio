# excel_provider.py
# Excel/Google Sheets ファイルからKPIを抽出するProvider

from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any, TYPE_CHECKING
import sys

# 親ディレクトリをパスに追加
parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from data_providers.base import BaseDataProvider
import kpi_extractor

if TYPE_CHECKING:
    import report_data


class ExcelProvider(BaseDataProvider):
    """Excel/Google Sheets ファイルからKPIを抽出するProvider"""

    def __init__(self, base_dir: Optional[Path] = None):
        """
        Args:
            base_dir: データディレクトリ（Noneの場合は絶対パスを期待）
        """
        self.base_dir = Path(base_dir) if base_dir else None

    def extract_single(self, identifier: str, **kwargs):
        """
        identifier: ファイルパス（相対 or 絶対）
        kwargs:
            - fail_fast: bool (必須KPIが欠けている場合にエラーを投げるか)
        """
        path = self._resolve_path(identifier)
        fail_fast = kwargs.get("fail_fast", True)
        return kpi_extractor.extract_from_excel(path, fail_fast=fail_fast)

    def extract_pair(
        self, current_identifier: str, base_identifier: Optional[str], **kwargs
    ):
        """
        当月とベースの2件を抽出

        identifier: ファイルパス（相対 or 絶対）
        kwargs:
            - fail_fast: bool
        """
        current_path = self._resolve_path(current_identifier)
        base_path = (
            self._resolve_path(base_identifier) if base_identifier else None
        )
        fail_fast = kwargs.get("fail_fast", True)
        return kpi_extractor.extract_pair(current_path, base_path, fail_fast=fail_fast)

    def list_available(self, **kwargs) -> List[str]:
        """
        base_dir配下のxlsxファイル一覧

        Returns:
            ファイルパスのリスト（base_dirからの相対パス）
        """
        if not self.base_dir or not self.base_dir.exists():
            return []

        files = []
        for f in self.base_dir.rglob("*.xlsx"):
            if f.name.startswith("~"):  # 一時ファイル除外
                continue
            try:
                files.append(str(f.relative_to(self.base_dir)))
            except ValueError:
                # relative_toが失敗した場合は絶対パス
                files.append(str(f))

        return files

    def list_periods(self, **kwargs) -> List[Dict[str, Any]]:
        """
        base_dir配下のExcelファイルから期間情報を抽出

        Returns:
            期間情報のリスト
        """
        if not self.base_dir or not self.base_dir.exists():
            return []

        periods = []
        for xlsx_file in self.base_dir.rglob("*.xlsx"):
            if xlsx_file.name.startswith("~"):
                continue

            try:
                # 期間タグを抽出（extract_period_tagで複数パターン対応）
                period_tag, period_type, period_start, period_end = kpi_extractor.extract_period_tag(xlsx_file.name)

                # デバッグ: 期間抽出結果をログ出力
                print(f"[期間抽出] {xlsx_file.name} -> {period_tag} ({period_type}) [{period_start} ~ {period_end}]")

                periods.append(
                    {
                        "identifier": str(xlsx_file.relative_to(self.base_dir)),
                        "period_tag": period_tag,
                        "period_type": period_type,
                        "period_start": period_start,
                        "period_end": period_end,
                        "filename": xlsx_file.name,
                    }
                )
            except Exception as e:
                # 認識できないファイルはスキップ（エラーログは出力）
                print(f"[期間抽出エラー] {xlsx_file.name}: {e}")
                continue

        # 期間でソート（新しい順、同じ期間の場合はファイル名でソート）
        periods.sort(key=lambda x: (x["period_start"], x["filename"]), reverse=True)

        # 重複する期間を排除（同じperiod_tagの場合は最初の1つだけ残す）
        seen_periods = set()
        unique_periods = []
        for period in periods:
            period_key = period["period_tag"]
            if period_key not in seen_periods:
                seen_periods.add(period_key)
                unique_periods.append(period)

        return unique_periods

    def supports_weekly(self) -> bool:
        """週次レポートに対応"""
        return True  # extract_period_tag実装済み

    def _resolve_path(self, identifier: str) -> Path:
        """相対パスを絶対パスに解決"""
        path = Path(identifier)
        if path.is_absolute():
            return path
        if self.base_dir:
            return self.base_dir / path
        return path
