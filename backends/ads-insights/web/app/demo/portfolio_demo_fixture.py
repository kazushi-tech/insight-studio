"""Pure, deterministic fixture data for the public portfolio demo.

Nothing in this module reads environment variables, customer files, Google
credentials, BigQuery, or an AI provider.  The values are intentionally
fictional and use the reserved ``.example`` top-level domain.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


DEMO_CASE_ID = "demo"
DEMO_DATASET_ID = "demo_portfolio_dataset"
DEMO_DATASET_LABEL = "完全架空データ"
DEMO_DATA_SOURCE = "demo_fixture"
DEMO_SITE_NAME = "こもれび工房"
DEMO_SITE_DISPLAY_NAME = "こもれび工房（完全架空サイト）"
DEMO_SITE_URL = "https://komorebi-studio.example"
DEMO_CURRENT_PERIOD = "2026-06"
DEMO_COMPARISON_PERIOD = "2026-05"
DEMO_PERIODS = (DEMO_CURRENT_PERIOD, DEMO_COMPARISON_PERIOD)


QUERY_TYPES: tuple[dict[str, str], ...] = (
    {"key": "pv", "name": "閲覧・訪問分析", "description": "利用者、訪問、見られた回数"},
    {"key": "traffic", "name": "流入元分析", "description": "どこから訪問されたか"},
    {"key": "cv", "name": "問い合わせ分析", "description": "問い合わせ件数と問い合わせ率"},
    {"key": "search", "name": "サイト内検索", "description": "サイト内で検索された語句"},
    {"key": "anomaly", "name": "前月比チェック", "description": "主要指標の前月比"},
    {"key": "landing", "name": "上位ページ分析", "description": "よく見られたページ"},
    {"key": "device", "name": "デバイス分析", "description": "端末別の訪問"},
    {"key": "hourly", "name": "時間帯分析", "description": "時間帯別の訪問"},
    {"key": "user_attr", "name": "利用者分析", "description": "利用者数の推移"},
    {"key": "engagement", "name": "関心度分析", "description": "エンゲージメント率"},
    {"key": "auction_proxy", "name": "流入集中の参考値", "description": "訪問元の構成比"},
    {"key": "campaign", "name": "キャンペーン分析", "description": "GA4キャンペーン名別の訪問と成果（広告費なし）"},
)
QUERY_TYPE_KEYS = tuple(item["key"] for item in QUERY_TYPES)
QUERY_TYPE_INFO = {item["key"]: item for item in QUERY_TYPES}


PERIOD_DATA: dict[str, dict[str, Any]] = {
    DEMO_CURRENT_PERIOD: {
        "label": "2026年6月",
        "period_start": "2026-06-01",
        "period_end": "2026-06-30",
        "users": 2480,
        "sessions": 3120,
        "page_views": 4860,
        "inquiries": 47,
        "inquiry_rate": 1.51,
        "engagement_rate": 63.4,
    },
    DEMO_COMPARISON_PERIOD: {
        "label": "2026年5月",
        "period_start": "2026-05-01",
        "period_end": "2026-05-31",
        "users": 2180,
        "sessions": 2760,
        "page_views": 4210,
        "inquiries": 42,
        "inquiry_rate": 1.52,
        "engagement_rate": 61.8,
    },
}


MONTH_OVER_MONTH = {
    "users_percent": 13.8,
    "sessions_percent": 13.0,
    "page_views_percent": 15.4,
    "inquiries_percent": 11.9,
    "inquiry_rate_points": -0.02,
    "engagement_rate_points": 1.6,
}


TRAFFIC_SOURCES: tuple[dict[str, Any], ...] = (
    {"label": "google / organic", "sessions": 1420},
    {"label": "direct", "sessions": 780},
    {"label": "referral", "sessions": 520},
    {"label": "social", "sessions": 400},
)

TRAFFIC_SOURCES_BY_PERIOD: dict[str, tuple[dict[str, Any], ...]] = {
    DEMO_CURRENT_PERIOD: TRAFFIC_SOURCES,
    DEMO_COMPARISON_PERIOD: (
        {"label": "google / organic", "sessions": 1210},
        {"label": "direct", "sessions": 700},
        {"label": "referral", "sessions": 480},
        {"label": "social", "sessions": 370},
    ),
}

SEARCH_TERMS_BY_PERIOD: dict[str, tuple[dict[str, Any], ...]] = {
    DEMO_CURRENT_PERIOD: (
        {"label": "料金", "searches": 48},
        {"label": "制作事例", "searches": 31},
        {"label": "納期", "searches": 19},
    ),
    DEMO_COMPARISON_PERIOD: (
        {"label": "料金", "searches": 42},
        {"label": "制作事例", "searches": 25},
        {"label": "納期", "searches": 17},
    ),
}

WEEKLY_SESSIONS_BY_PERIOD: dict[str, tuple[int, ...]] = {
    DEMO_CURRENT_PERIOD: (720, 760, 800, 840),
    DEMO_COMPARISON_PERIOD: (650, 680, 700, 730),
}


TOP_PAGES: tuple[dict[str, Any], ...] = (
    {"path": "/service", "page_views": 1420},
    {"path": "/column/guide", "page_views": 980},
    {"path": "/about", "page_views": 620},
    {"path": "/contact", "page_views": 310},
)

TOP_PAGES_BY_PERIOD: dict[str, tuple[dict[str, Any], ...]] = {
    DEMO_CURRENT_PERIOD: TOP_PAGES,
    DEMO_COMPARISON_PERIOD: (
        {"path": "/service", "page_views": 1180},
        {"path": "/column/guide", "page_views": 820},
        {"path": "/about", "page_views": 590},
        {"path": "/contact", "page_views": 270},
    ),
}

DEVICE_SESSIONS_BY_PERIOD: dict[str, tuple[dict[str, Any], ...]] = {
    DEMO_CURRENT_PERIOD: (
        {"label": "mobile", "sessions": 2100},
        {"label": "desktop", "sessions": 900},
        {"label": "tablet", "sessions": 120},
    ),
    DEMO_COMPARISON_PERIOD: (
        {"label": "mobile", "sessions": 1830},
        {"label": "desktop", "sessions": 820},
        {"label": "tablet", "sessions": 110},
    ),
}

HOURLY_SESSIONS_BY_PERIOD: dict[str, tuple[int, ...]] = {
    DEMO_CURRENT_PERIOD: (260, 430, 610, 720, 650, 450),
    DEMO_COMPARISON_PERIOD: (240, 390, 550, 630, 570, 380),
}

CAMPAIGNS_BY_PERIOD: dict[str, tuple[dict[str, Any], ...]] = {
    DEMO_CURRENT_PERIOD: (
        {"label": "service_campaign · google / cpc", "sessions": 740, "users": 610, "page_views": 1180, "conversions": 15},
        {"label": "newsletter · email / email", "sessions": 420, "users": 350, "page_views": 680, "conversions": 9},
        {"label": "direct_brand · direct / none", "sessions": 310, "users": 260, "page_views": 470, "conversions": 5},
    ),
    DEMO_COMPARISON_PERIOD: (
        {"label": "service_campaign · google / cpc", "sessions": 650, "users": 530, "page_views": 990, "conversions": 13},
        {"label": "newsletter · email / email", "sessions": 360, "users": 300, "page_views": 570, "conversions": 8},
        {"label": "direct_brand · direct / none", "sessions": 290, "users": 240, "page_views": 430, "conversions": 4},
    ),
}


DATA_GAPS: tuple[dict[str, str], ...] = (
    {
        "key": "phone_tap_unmeasured",
        "label": "電話タップは未計測",
        "impact": "電話経由の成果は判断保留です。未計測を0件として扱いません。",
    },
)


NEXT_ACTIONS: tuple[dict[str, str], ...] = (
    {
        "priority": "P1",
        "title": "/service の主要CTAを1つに絞る",
        "reason": "問い合わせ率がほぼ横ばいのため、次の行動を分かりやすくします。",
    },
    {
        "priority": "P1",
        "title": "コラムからサービスページへの内部リンクを追加する",
        "reason": "よく見られているコラムからサービス案内へ移りやすくします。",
    },
    {
        "priority": "P1",
        "title": "電話タップの計測設定を確認する",
        "reason": "未計測の電話経由成果を0件と誤認しないためです。",
    },
)


_GREEN = "#0B6B49"
_GREEN_SOFT = "rgba(11, 107, 73, 0.28)"
_GOLD = "#B88921"
_GOLD_SOFT = "rgba(184, 137, 33, 0.28)"


def period_metadata(period: str) -> dict[str, Any] | None:
    data = PERIOD_DATA.get(period)
    if data is None:
        return None
    return {
        "period_tag": period,
        "period_type": "monthly",
        "label": data["label"],
        "period_start": data["period_start"],
        "period_end": data["period_end"],
    }


def period_data(period: str) -> dict[str, Any] | None:
    data = PERIOD_DATA.get(period)
    return deepcopy(data) if data is not None else None


def _dataset(label: str, data: list[float | int], *, color: str = _GREEN, soft: str = _GREEN_SOFT) -> dict[str, Any]:
    return {
        "label": label,
        "data": list(data),
        "backgroundColor": soft,
        "borderColor": color,
        "borderWidth": 2,
    }


def _group(
    query_type: str,
    title: str,
    chart_type: str,
    labels: list[str],
    datasets: list[dict[str, Any]],
    *,
    selection_label: str = "",
) -> dict[str, Any]:
    group = {
        "queryType": query_type,
        "title": title,
        "chartType": chart_type,
        "labels": list(labels),
        "datasets": deepcopy(datasets),
        "isDemo": True,
        "dataSource": DEMO_DATA_SOURCE,
        "metadata": {
            "queryType": query_type,
            "isDemo": True,
            "dataSource": DEMO_DATA_SOURCE,
        },
    }
    if selection_label:
        group["selectionLabel"] = selection_label
        group["metadata"]["selectionLabel"] = selection_label
    return group


def chart_groups_for(query_type: str, period: str) -> list[dict[str, Any]]:
    """Return chart groups in a stable order for one query and period."""
    data = PERIOD_DATA.get(period)
    if data is None:
        return []

    if query_type == "pv":
        return [
            _group(
                "pv",
                "サイト全体 — 主要指標",
                "bar_horizontal",
                ["利用者", "訪問", "見られた回数"],
                [_dataset(data["label"], [data["users"], data["sessions"], data["page_views"]])],
            )
        ]

    if query_type == "traffic":
        traffic_sources = TRAFFIC_SOURCES_BY_PERIOD[period]
        return [
            _group(
                "traffic",
                "流入元 — 訪問",
                "bar_horizontal",
                [item["label"] for item in traffic_sources],
                [_dataset("訪問", [item["sessions"] for item in traffic_sources])],
                selection_label="訪問数上位4流入元を表示",
            )
        ]

    if query_type == "cv":
        return [
            _group(
                "cv",
                "問い合わせ — 件数",
                "bar_horizontal",
                [data["label"]],
                [_dataset("問い合わせ", [data["inquiries"]], color=_GOLD, soft=_GOLD_SOFT)],
            ),
            _group(
                "cv",
                "問い合わせ — 率",
                "bar_horizontal",
                [data["label"]],
                [_dataset("問い合わせ率 (%)", [data["inquiry_rate"]], color=_GOLD, soft=_GOLD_SOFT)],
            ),
        ]

    if query_type == "search":
        search_terms = SEARCH_TERMS_BY_PERIOD[period]
        return [
            _group(
                "search",
                "サイト内検索 — 検索回数上位3語",
                "bar_horizontal",
                [item["label"] for item in search_terms],
                [_dataset("検索回数", [item["searches"] for item in search_terms])],
                selection_label="検索回数上位3語を表示",
            )
        ]

    if query_type == "anomaly":
        groups = [
            _group(
                "anomaly",
                "変化確認 — 週別の訪問",
                "line",
                ["第1週", "第2週", "第3週", "第4週"],
                [_dataset("訪問", list(WEEKLY_SESSIONS_BY_PERIOD[period]))],
            )
        ]
        if period == DEMO_CURRENT_PERIOD:
            groups.extend([
                _group(
                    "anomaly",
                    "前月比 — 主要指標",
                    "bar_horizontal",
                    ["利用者", "訪問", "見られた回数", "問い合わせ"],
                    [
                        _dataset(
                            "前月比 (%)",
                            [
                                MONTH_OVER_MONTH["users_percent"],
                                MONTH_OVER_MONTH["sessions_percent"],
                                MONTH_OVER_MONTH["page_views_percent"],
                                MONTH_OVER_MONTH["inquiries_percent"],
                            ],
                        )
                    ],
                ),
                _group(
                    "anomaly",
                    "前月比 — 率の変化",
                    "bar_horizontal",
                    ["問い合わせ率", "エンゲージメント率"],
                    [
                        _dataset(
                            "前月差 (ポイント)",
                            [
                                MONTH_OVER_MONTH["inquiry_rate_points"],
                                MONTH_OVER_MONTH["engagement_rate_points"],
                            ],
                            color=_GOLD,
                            soft=_GOLD_SOFT,
                        )
                    ],
                ),
            ])
        return groups

    if query_type == "landing":
        top_pages = TOP_PAGES_BY_PERIOD[period]
        return [
            _group(
                "landing",
                "上位ページ — 見られた回数",
                "bar_horizontal",
                [item["path"] for item in top_pages],
                [_dataset("見られた回数", [item["page_views"] for item in top_pages])],
                selection_label="見られた回数上位4ページを表示",
            )
        ]

    if query_type == "device":
        devices = DEVICE_SESSIONS_BY_PERIOD[period]
        return [
            _group(
                "device",
                "デバイス — 訪問",
                "bar_horizontal",
                [item["label"] for item in devices],
                [_dataset("訪問", [item["sessions"] for item in devices])],
            )
        ]

    if query_type == "hourly":
        return [
            _group(
                "hourly",
                "時間帯 — 訪問",
                "line",
                ["0-3時", "4-7時", "8-11時", "12-15時", "16-19時", "20-23時"],
                [_dataset("訪問", list(HOURLY_SESSIONS_BY_PERIOD[period]))],
            )
        ]

    if query_type == "user_attr":
        return [
            _group(
                "user_attr",
                "利用者 — 月次",
                "bar_horizontal",
                [data["label"]],
                [_dataset("利用者", [data["users"]])],
            )
        ]

    if query_type == "engagement":
        return [
            _group(
                "engagement",
                "エンゲージメント率",
                "bar_horizontal",
                [data["label"]],
                [_dataset("エンゲージメント率 (%)", [data["engagement_rate"]])],
            )
        ]

    if query_type == "auction_proxy":
        traffic_sources = TRAFFIC_SOURCES_BY_PERIOD[period]
        return [
            _group(
                "auction_proxy",
                "流入集中の参考値 — 訪問元構成",
                "bar_horizontal",
                [item["label"] for item in traffic_sources],
                [_dataset("訪問", [item["sessions"] for item in traffic_sources])],
                selection_label="訪問数上位4流入元を表示",
            )
        ]

    if query_type == "campaign":
        campaigns = CAMPAIGNS_BY_PERIOD[period]
        labels = [item["label"] for item in campaigns]
        return [
            _group(
                "campaign",
                "キャンペーン — 訪問・利用者・閲覧",
                "bar_horizontal",
                labels,
                [
                    _dataset("訪問", [item["sessions"] for item in campaigns]),
                    _dataset("利用者", [item["users"] for item in campaigns], color=_GOLD, soft=_GOLD_SOFT),
                    _dataset("見られた回数", [item["page_views"] for item in campaigns]),
                ],
                selection_label="訪問数上位3キャンペーンを表示",
            ),
            _group(
                "campaign",
                "キャンペーン — 問い合わせ",
                "bar_horizontal",
                labels,
                [_dataset("問い合わせ", [item["conversions"] for item in campaigns], color=_GOLD, soft=_GOLD_SOFT)],
                selection_label="訪問数上位3キャンペーンを表示",
            ),
        ]

    return []


def report_markdown(period: str) -> str:
    selected = PERIOD_DATA.get(period)
    if selected is None:
        return ""
    if period == DEMO_COMPARISON_PERIOD:
        return f"""# {DEMO_SITE_DISPLAY_NAME} Web成果レポート

> このレポートはポートフォリオ公開用の完全架空データです。

- サイト: [{DEMO_SITE_DISPLAY_NAME}]({DEMO_SITE_URL})
- 表示対象: {selected['label']}
- 位置づけ: 比較に使用する基準期間

## 基準値

| 指標 | {selected['label']} |
|---|---:|
| 利用者 | {selected['users']:,} |
| 訪問 | {selected['sessions']:,} |
| 見られた回数 | {selected['page_views']:,} |
| 問い合わせ | {selected['inquiries']:,} |
| 問い合わせ率 | {selected['inquiry_rate']:.2f}% |
| エンゲージメント率 | {selected['engagement_rate']:.1f}% |

## 読み方

- この期間は比較の基準値として扱います。
- 増減や改善効果は、この期間だけでは判断しません。

## 判断保留

- 電話タップは未計測です。
- 電話経由の成果は判断保留です。未計測項目を0件として扱いません。
"""

    current = PERIOD_DATA[DEMO_CURRENT_PERIOD]
    comparison = PERIOD_DATA[DEMO_COMPARISON_PERIOD]
    return f"""# {DEMO_SITE_DISPLAY_NAME} Web成果レポート

> このレポートはポートフォリオ公開用の完全架空データです。

- サイト: [{DEMO_SITE_DISPLAY_NAME}]({DEMO_SITE_URL})
- 表示対象: {selected['label']}
- 対象期間: {current['label']}
- 比較期間: {comparison['label']}

## 主要な変化

| 指標 | {comparison['label']} | {current['label']} | 前月比 |
|---|---:|---:|---:|
| 利用者 | {comparison['users']:,} | {current['users']:,} | +13.8% |
| 訪問 | {comparison['sessions']:,} | {current['sessions']:,} | +13.0% |
| 見られた回数 | {comparison['page_views']:,} | {current['page_views']:,} | +15.4% |
| 問い合わせ | {comparison['inquiries']:,} | {current['inquiries']:,} | +11.9% |
| 問い合わせ率 | {comparison['inquiry_rate']:.2f}% | {current['inquiry_rate']:.2f}% | -0.02ポイント |
| エンゲージメント率 | {comparison['engagement_rate']:.1f}% | {current['engagement_rate']:.1f}% | +1.6ポイント |

## 流入元

- google / organic: 1,420
- direct: 780
- referral: 520
- social: 400
- 合計: 3,120訪問

## 上位ページ

- /service: 1,420
- /column/guide: 980
- /about: 620
- /contact: 310

## 判断保留

- 電話タップは未計測です。
- 電話経由の成果は判断保留です。未計測項目を0件として扱いません。

## 次アクション

1. /service の主要CTAを1つに絞る
2. コラムからサービスページへの内部リンクを追加する
3. 電話タップの計測設定を確認する
"""
