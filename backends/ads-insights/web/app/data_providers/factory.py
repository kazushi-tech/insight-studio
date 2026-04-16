# factory.py
# データプロバイダーを生成するFactory

import os
from pathlib import Path
from typing import Optional
import sys

# 親ディレクトリをパスに追加
parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from data_providers.base import BaseDataProvider
from data_providers.excel_provider import ExcelProvider
from data_providers.mock_provider import MockProvider


def get_data_provider(
    provider_type: Optional[str] = None, base_dir: Optional[Path] = None
) -> BaseDataProvider:
    """
    環境変数またはパラメータからProviderを取得

    Args:
        provider_type: "excel", "mock", "ga4" (Noneなら環境変数 DATA_PROVIDER から)
        base_dir: データディレクトリ（Excelの場合）

    Returns:
        BaseDataProvider実装

    Raises:
        ValueError: 不明なprovider_typeの場合
    """
    provider_type = provider_type or os.getenv("DATA_PROVIDER", "excel")
    provider_type = provider_type.lower()

    if provider_type == "excel":
        # base_dirが指定されていない場合はデフォルトパスを使用
        if base_dir is None:
            # DRIVE_ROOT環境変数があればそれを使用（Google Driveフォルダ）
            drive_root = os.getenv("DRIVE_ROOT")
            if drive_root:
                base_dir = Path(drive_root)
            else:
                # プロジェクトルート/data を使用
                # backend_api.py の BASE_DIR を参照したいが循環インポートを避けるため直接計算
                project_root = Path(__file__).resolve().parents[3]  # web/app/data_providers → web/app → web → root
                base_dir = project_root / "data"
        return ExcelProvider(base_dir)

    elif provider_type == "mock":
        return MockProvider()

    elif provider_type == "ga4":
        # TODO: 将来実装
        raise NotImplementedError(
            "GA4Provider is not implemented yet. "
            "Set DATA_PROVIDER=mock or DATA_PROVIDER=excel in .env.local"
        )

    else:
        raise ValueError(
            f"Unknown provider type: {provider_type}. "
            f"Valid options: excel, mock, ga4"
        )
