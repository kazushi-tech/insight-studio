"""SQL テンプレートコレクション（GA4 BigQuery 用）

9種のクエリテンプレートを提供:
1. pv: PV分析（日別PV・ユーザー・セッション）
2. traffic: 流入分析（チャネル別セッション・PV）
3. cv: CV分析（コンバージョンイベント別件数）
4. search: 検索クエリ分析（サイト内検索キーワード）
5. anomaly: 異常検知（Z-scoreベース日別異常検知）
6. landing: LP分析（ランディングページ別セッション・直帰率）
7. device: デバイス分析（デバイスカテゴリ別セッション・PV）
8. hourly: 時間帯分析（時間帯別アクセス傾向）
9. user_attr: ユーザー属性（新規/リピーター・地域別分析）

全テンプレートは {dataset} と {start_date}/{end_date} のプレースホルダを使用。
"""

from __future__ import annotations


def _build_query(template: str, dataset: str, start_date: str, end_date: str) -> str:
    """テンプレートにパラメータを埋め込む。"""
    return template.format(
        dataset=dataset,
        start_date=start_date,
        end_date=end_date,
    )


# ========== 1. PV分析 ==========
_PV_TEMPLATE = """
SELECT
  event_date,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
    )
  ) AS sessions,
  COUNTIF(event_name = 'page_view') AS page_views,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title') AS page_title,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
GROUP BY
  event_date, page_title, page_location
ORDER BY
  event_date, page_views DESC
"""

# ========== 2. 流入分析（V3.3: event_date付き日別化） ==========
_TRAFFIC_TEMPLATE = """
SELECT
  event_date,
  traffic_source.source AS source,
  traffic_source.medium AS medium,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
    )
  ) AS sessions,
  COUNTIF(event_name = 'page_view') AS page_views
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
GROUP BY
  event_date, source, medium
ORDER BY
  event_date, sessions DESC
"""

# ========== 3. CV分析 ==========
_CV_TEMPLATE = """
SELECT
  event_name,
  COUNT(*) AS event_count,
  COUNT(DISTINCT user_pseudo_id) AS unique_users,
  event_date
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
  AND event_name IN (
    'purchase', 'generate_lead', 'sign_up', 'begin_checkout',
    'add_to_cart', 'submit_form', 'contact', 'conversion'
  )
GROUP BY
  event_name, event_date
ORDER BY
  event_date, event_count DESC
"""

# ========== 4. 検索クエリ分析（V3.3: event_date付き日別化） ==========
_SEARCH_TEMPLATE = """
SELECT
  event_date,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'search_term') AS search_term,
  COUNT(*) AS search_count,
  COUNT(DISTINCT user_pseudo_id) AS unique_searchers
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
  AND event_name = 'view_search_results'
GROUP BY
  event_date, search_term
HAVING
  search_term IS NOT NULL
ORDER BY
  event_date, search_count DESC
"""

# ========== 5. 異常検知（Z-score用データ取得） ==========
_ANOMALY_TEMPLATE = """
WITH daily_metrics AS (
  SELECT
    event_date,
    COUNT(DISTINCT user_pseudo_id) AS users,
    COUNT(DISTINCT
      CONCAT(user_pseudo_id, '-',
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
      )
    ) AS sessions,
    COUNTIF(event_name = 'page_view') AS page_views,
    COUNTIF(event_name IN ('purchase', 'generate_lead', 'sign_up', 'submit_form', 'contact', 'conversion')) AS conversions
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
  GROUP BY
    event_date
),
with_rolling AS (
  SELECT
    *,
    AVG(users) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS users_7d_avg,
    STDDEV(users) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS users_7d_std,
    AVG(sessions) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS sessions_7d_avg,
    STDDEV(sessions) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS sessions_7d_std,
    AVG(page_views) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS pv_7d_avg,
    STDDEV(page_views) OVER (ORDER BY event_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS pv_7d_std
  FROM daily_metrics
)
SELECT
  event_date,
  users, sessions, page_views, conversions,
  users_7d_avg, users_7d_std,
  sessions_7d_avg, sessions_7d_std,
  pv_7d_avg, pv_7d_std,
  SAFE_DIVIDE(users - users_7d_avg, users_7d_std) AS users_zscore,
  SAFE_DIVIDE(sessions - sessions_7d_avg, sessions_7d_std) AS sessions_zscore,
  SAFE_DIVIDE(page_views - pv_7d_avg, pv_7d_std) AS pv_zscore
FROM with_rolling
ORDER BY event_date
"""

# ========== 6. LP分析（V3.3: event_date付き日別化） ==========
_LANDING_TEMPLATE = """
WITH session_starts AS (
  SELECT
    event_date,
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS landing_page,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'entrances') AS is_entrance
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'page_view'
),
session_pages AS (
  SELECT
    event_date,
    user_pseudo_id,
    session_id,
    landing_page,
    COUNT(*) AS page_count
  FROM session_starts
  WHERE is_entrance = 1
  GROUP BY event_date, user_pseudo_id, session_id, landing_page
)
SELECT
  event_date,
  landing_page,
  COUNT(*) AS sessions,
  AVG(page_count) AS avg_pages_per_session,
  COUNTIF(page_count = 1) AS bounce_sessions,
  SAFE_DIVIDE(COUNTIF(page_count = 1), COUNT(*)) AS bounce_rate
FROM session_pages
WHERE landing_page IS NOT NULL
GROUP BY event_date, landing_page
ORDER BY event_date, sessions DESC
"""

# ========== 7. デバイス分析（V3.3: event_date付き日別化） ==========
_DEVICE_TEMPLATE = """
SELECT
  event_date,
  device.category AS device_category,
  device.operating_system AS os,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
    )
  ) AS sessions,
  COUNTIF(event_name = 'page_view') AS page_views
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
GROUP BY
  event_date, device_category, os
ORDER BY
  event_date, sessions DESC
"""

# ========== 8. 時間帯分析 ==========
_HOURLY_TEMPLATE = """
SELECT
  EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp)) AS hour_of_day,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
    )
  ) AS sessions,
  COUNTIF(event_name = 'page_view') AS page_views
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
GROUP BY
  hour_of_day
ORDER BY
  hour_of_day
"""

# ========== 9. ユーザー属性分析 ==========
_USER_ATTR_TEMPLATE = """
WITH session_info AS (
  SELECT
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_number') AS session_number,
    geo.country AS country,
    geo.city AS city
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'session_start'
)
SELECT
  country,
  city,
  CASE WHEN session_number = 1 THEN 'new' ELSE 'returning' END AS user_type,
  COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(session_id AS STRING))) AS sessions
FROM session_info
WHERE session_id IS NOT NULL
GROUP BY country, city, user_type
ORDER BY sessions DESC
LIMIT 500
"""


# ========== V3.3: エンゲージメント時間分析 ==========
_ENGAGEMENT_TEMPLATE = """
SELECT
  event_date,
  COUNT(DISTINCT user_pseudo_id) AS engaged_users,
  COUNT(DISTINCT
    CONCAT(user_pseudo_id, '-',
      (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
    )
  ) AS engaged_sessions,
  SUM(
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec')
  ) / 1000.0 AS total_engagement_sec,
  AVG(
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec')
  ) / 1000.0 AS avg_engagement_sec
FROM
  `{dataset}.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
  AND event_name = 'user_engagement'
GROUP BY
  event_date
ORDER BY
  event_date
"""

# ========== V3.3: 推定オークション圧分析（GA4ベース） ==========
_AUCTION_PROXY_TEMPLATE = """
WITH channel_daily AS (
  SELECT
    event_date,
    CASE
      WHEN traffic_source.medium IN ('cpc', 'ppc', 'paid') THEN 'paid'
      WHEN traffic_source.medium LIKE '%organic%' THEN 'organic'
      WHEN traffic_source.medium = 'referral' THEN 'referral'
      WHEN traffic_source.medium = '(none)' THEN 'direct'
      ELSE 'other'
    END AS channel_group,
    COUNT(DISTINCT
      CONCAT(user_pseudo_id, '-',
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')
      )
    ) AS sessions
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
  GROUP BY
    event_date, channel_group
)
SELECT
  event_date,
  channel_group,
  sessions,
  SAFE_DIVIDE(sessions, SUM(sessions) OVER (PARTITION BY event_date)) AS session_share
FROM channel_daily
ORDER BY event_date, sessions DESC
"""

# クエリレジストリ
QUERIES = {
    "pv": {
        "name": "PV分析",
        "description": "日別PV・ユーザー・セッション",
        "template": _PV_TEMPLATE,
    },
    "traffic": {
        "name": "流入分析",
        "description": "チャネル別セッション・PV",
        "template": _TRAFFIC_TEMPLATE,
    },
    "cv": {
        "name": "CV分析",
        "description": "コンバージョンイベント別件数",
        "template": _CV_TEMPLATE,
    },
    "search": {
        "name": "検索クエリ分析",
        "description": "サイト内検索キーワード",
        "template": _SEARCH_TEMPLATE,
    },
    "anomaly": {
        "name": "異常検知",
        "description": "Z-scoreベース日別異常検知",
        "template": _ANOMALY_TEMPLATE,
    },
    "landing": {
        "name": "LP分析",
        "description": "ランディングページ別セッション・直帰率",
        "template": _LANDING_TEMPLATE,
    },
    "device": {
        "name": "デバイス分析",
        "description": "デバイスカテゴリ・OS別セッション・PV",
        "template": _DEVICE_TEMPLATE,
    },
    "hourly": {
        "name": "時間帯分析",
        "description": "時間帯別アクセス傾向（0-23時）",
        "template": _HOURLY_TEMPLATE,
    },
    "user_attr": {
        "name": "ユーザー属性",
        "description": "新規/リピーター・地域別分析",
        "template": _USER_ATTR_TEMPLATE,
    },
    "engagement": {
        "name": "エンゲージメント時間",
        "description": "日別エンゲージメント秒数・セッション平均",
        "template": _ENGAGEMENT_TEMPLATE,
    },
    "auction_proxy": {
        "name": "オークション圧分析（推定）",
        "description": "有料/自然流入バランスとチャネル集中度（GA4ベース推定値）",
        "template": _AUCTION_PROXY_TEMPLATE,
    },
}


def get_query(query_type: str, dataset: str, start_date: str, end_date: str) -> str:
    """指定タイプのSQLクエリを生成する。

    Args:
        query_type: クエリタイプ（pv/traffic/cv/search/anomaly/landing）
        dataset: BigQuery データセットID
        start_date: 開始日（YYYYMMDD形式）
        end_date: 終了日（YYYYMMDD形式）

    Returns:
        SQLクエリ文字列
    """
    if query_type not in QUERIES:
        available = ", ".join(QUERIES.keys())
        raise ValueError(f"未知のクエリタイプ: {query_type}（利用可能: {available}）")

    return _build_query(QUERIES[query_type]["template"], dataset, start_date, end_date)


def list_query_types() -> list[dict]:
    """利用可能なクエリタイプの一覧を返す。"""
    return [
        {"key": k, "name": v["name"], "description": v["description"]}
        for k, v in QUERIES.items()
    ]
