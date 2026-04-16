# report_data.py
# 数値抽出結果のデータモデル定義
# 監査可能性のためEvidenceを含む構造

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from pathlib import Path
import json
import hashlib
import datetime as dt


@dataclass
class ExtractMeta:
    """抽出メタ情報（監査用）"""
    file: str                     # ファイルパス
    sheet: str                    # シート名
    method: str                   # 抽出方式 ("table" or "cells")
    refs: Dict[str, str]          # KPIキー -> 抽出元参照（列名 or セル位置）
    rows: int                     # 抽出元の行数
    cols: int                     # 抽出元の列数
    file_hash: str = ""           # ファイルハッシュ（整合性検証用）
    file_size: int = 0            # ファイルサイズ
    file_modified: str = ""       # ファイル更新日時


@dataclass
class MediaKPIs:
    """
    媒体別KPIデータ
    - media_name: 媒体名（例: "Google検索", "Facebook", "LINE"）
    - kpis: KPI名 -> 値 のマップ（集計と同じ構造）
    - evidence: KPI名 -> 根拠説明 のマップ
    """
    media_name: str
    kpis: Dict[str, Optional[float]]
    evidence: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """JSON変換用辞書を返す"""
        import math

        def sanitize(v):
            if v is None:
                return None
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return None
            return v

        return {
            "media_name": self.media_name,
            "kpis": {k: sanitize(v) for k, v in self.kpis.items()},
            "evidence": self.evidence,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MediaKPIs":
        """辞書からMediaKPIsを復元"""
        return cls(
            media_name=data.get("media_name", ""),
            kpis=data.get("kpis", {}),
            evidence=data.get("evidence", {}),
        )

    def compute_derived_kpis(self) -> None:
        """
        基本KPIから派生指標を計算してkpisに追加
        - CTR = click / impr
        - CVR = cv / click
        - CPA = cost / cv
        - CPC = cost / click
        """
        impr = self.kpis.get('impr')
        click = self.kpis.get('click')
        cost = self.kpis.get('cost')
        cv = self.kpis.get('cv')

        # CTR (Click Through Rate)
        if 'ctr' not in self.kpis or self.kpis['ctr'] is None:
            if impr and impr > 0 and click is not None:
                self.kpis['ctr'] = click / impr
                self.evidence['ctr'] = f"計算: {click} / {impr}"

        # CVR (Conversion Rate)
        if 'cvr' not in self.kpis or self.kpis['cvr'] is None:
            if click and click > 0 and cv is not None:
                self.kpis['cvr'] = cv / click
                self.evidence['cvr'] = f"計算: {cv} / {click}"

        # CPA (Cost Per Acquisition)
        if 'cpa' not in self.kpis or self.kpis['cpa'] is None:
            if cv and cv > 0 and cost is not None:
                self.kpis['cpa'] = cost / cv
                self.evidence['cpa'] = f"計算: {cost} / {cv}"

        # CPC (Cost Per Click)
        if 'cpc' not in self.kpis or self.kpis['cpc'] is None:
            if click and click > 0 and cost is not None:
                self.kpis['cpc'] = cost / click
                self.evidence['cpc'] = f"計算: {cost} / {click}"

        # ROAS (Return on Ad Spend)
        if 'roas' not in self.kpis or self.kpis['roas'] is None:
            revenue_or_cv_value = self.kpis.get('revenue') or self.kpis.get('conversion_value')
            if cost and cost > 0 and revenue_or_cv_value is not None:
                self.kpis['roas'] = (revenue_or_cv_value / cost) * 100
                self.evidence['roas'] = f"計算: {revenue_or_cv_value} / {cost} * 100"

        # Revenue per CV (売上単価)
        if 'revenue_per_cv' not in self.kpis or self.kpis['revenue_per_cv'] is None:
            revenue_or_cv_value = self.kpis.get('revenue') or self.kpis.get('conversion_value')
            if cv and cv > 0 and revenue_or_cv_value is not None:
                self.kpis['revenue_per_cv'] = revenue_or_cv_value / cv
                self.evidence['revenue_per_cv'] = f"計算: {revenue_or_cv_value} / {cv}"


@dataclass
class ReportData:
    """
    抽出済みレポートデータ
    - kpis: KPI名 -> 値 のマップ
    - meta: 抽出メタ情報
    - evidence: KPI名 -> 根拠説明 のマップ
    - period_type: 期間タイプ（"monthly" or "weekly"）
    - period_start: 期間開始日（YYYY-MM-DD）
    - period_end: 期間終了日（YYYY-MM-DD）
    """
    kpis: Dict[str, Optional[float]]
    meta: ExtractMeta
    evidence: Dict[str, str] = field(default_factory=dict)
    month_tag: str = ""
    extracted_at: str = ""
    period_type: str = "monthly"  # "monthly" or "weekly"
    period_start: str = ""  # YYYY-MM-DD
    period_end: str = ""  # YYYY-MM-DD
    media_breakdown: List[MediaKPIs] = field(default_factory=list)  # 媒体別KPIデータ

    def __post_init__(self):
        if not self.extracted_at:
            self.extracted_at = dt.datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """JSON変換用辞書を返す（nan/infはNoneに変換）"""
        import math

        def sanitize(v):
            if v is None:
                return None
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return None
            return v

        return {
            "kpis": {k: sanitize(v) for k, v in self.kpis.items()},
            "meta": {
                "file": self.meta.file,
                "sheet": self.meta.sheet,
                "method": self.meta.method,
                "refs": self.meta.refs,
                "rows": self.meta.rows,
                "cols": self.meta.cols,
                "file_hash": self.meta.file_hash,
                "file_size": self.meta.file_size,
                "file_modified": self.meta.file_modified,
            },
            "evidence": self.evidence,
            "month_tag": self.month_tag,
            "extracted_at": self.extracted_at,
            "period_type": self.period_type,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "media_breakdown": [m.to_dict() for m in self.media_breakdown],
        }
    
    def to_json(self) -> str:
        """JSON文字列を返す"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReportData":
        """辞書からReportDataを復元"""
        meta_data = data.get("meta", {})
        meta = ExtractMeta(
            file=meta_data.get("file", ""),
            sheet=meta_data.get("sheet", ""),
            method=meta_data.get("method", ""),
            refs=meta_data.get("refs", {}),
            rows=meta_data.get("rows", 0),
            cols=meta_data.get("cols", 0),
            file_hash=meta_data.get("file_hash", ""),
            file_size=meta_data.get("file_size", 0),
            file_modified=meta_data.get("file_modified", ""),
        )
        # 媒体別データの復元
        media_breakdown_data = data.get("media_breakdown", [])
        media_breakdown = [MediaKPIs.from_dict(m) for m in media_breakdown_data]

        return cls(
            kpis=data.get("kpis", {}),
            meta=meta,
            evidence=data.get("evidence", {}),
            month_tag=data.get("month_tag", ""),
            extracted_at=data.get("extracted_at", ""),
            period_type=data.get("period_type", "monthly"),
            period_start=data.get("period_start", ""),
            period_end=data.get("period_end", ""),
            media_breakdown=media_breakdown,
        )
    
    def get_kpi(self, key: str) -> Optional[float]:
        """KPI値を取得"""
        return self.kpis.get(key)
    
    def has_kpi(self, key: str) -> bool:
        """KPIが取得済みかどうか"""
        return key in self.kpis and self.kpis[key] is not None
    
    def missing_kpis(self, required: List[str]) -> List[str]:
        """欠損KPIリストを返す"""
        return [k for k in required if not self.has_kpi(k)]
    
    def compute_derived_kpis(self) -> None:
        """
        基本KPIから派生指標を計算してkpisに追加
        - CTR = click / impr
        - CVR = cv / click
        - CPA = cost / cv
        - CPC = cost / click
        
        Excelから取得できなかった派生指標を再計算する
        """
        impr = self.kpis.get('impr')
        click = self.kpis.get('click')
        cost = self.kpis.get('cost')
        cv = self.kpis.get('cv')
        
        # CTR (Click Through Rate)
        if 'ctr' not in self.kpis or self.kpis['ctr'] is None:
            if impr and impr > 0 and click is not None:
                self.kpis['ctr'] = click / impr
                self.evidence['ctr'] = f"計算: {click} / {impr}"
        
        # CVR (Conversion Rate)
        if 'cvr' not in self.kpis or self.kpis['cvr'] is None:
            if click and click > 0 and cv is not None:
                self.kpis['cvr'] = cv / click
                self.evidence['cvr'] = f"計算: {cv} / {click}"
        
        # CPA (Cost Per Acquisition)
        if 'cpa' not in self.kpis or self.kpis['cpa'] is None:
            if cv and cv > 0 and cost is not None:
                self.kpis['cpa'] = cost / cv
                self.evidence['cpa'] = f"計算: {cost} / {cv}"
        
        # CPC (Cost Per Click)
        if 'cpc' not in self.kpis or self.kpis['cpc'] is None:
            if click and click > 0 and cost is not None:
                self.kpis['cpc'] = cost / click
                self.evidence['cpc'] = f"計算: {cost} / {click}"

        # ROAS (Return on Ad Spend)
        if 'roas' not in self.kpis or self.kpis['roas'] is None:
            revenue_or_cv_value = self.kpis.get('revenue') or self.kpis.get('conversion_value')
            if cost and cost > 0 and revenue_or_cv_value is not None:
                self.kpis['roas'] = (revenue_or_cv_value / cost) * 100
                self.evidence['roas'] = f"計算: {revenue_or_cv_value} / {cost} * 100"

        # Revenue per CV (売上単価)
        if 'revenue_per_cv' not in self.kpis or self.kpis['revenue_per_cv'] is None:
            revenue_or_cv_value = self.kpis.get('revenue') or self.kpis.get('conversion_value')
            if cv and cv > 0 and revenue_or_cv_value is not None:
                self.kpis['revenue_per_cv'] = revenue_or_cv_value / cv
                self.evidence['revenue_per_cv'] = f"計算: {revenue_or_cv_value} / {cv}"


def compute_file_hash(path: Path) -> str:
    """ファイルの先頭1MBのSHA256ハッシュを計算"""
    try:
        with open(path, "rb") as f:
            data = f.read(1024 * 1024)  # 1MB
        return hashlib.sha256(data).hexdigest()[:16]
    except Exception:
        return ""


def get_file_meta(path: Path) -> Dict[str, Any]:
    """ファイルメタ情報を取得"""
    try:
        stat = path.stat()
        return {
            "file_hash": compute_file_hash(path),
            "file_size": stat.st_size,
            "file_modified": dt.datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }
    except Exception:
        return {"file_hash": "", "file_size": 0, "file_modified": ""}
