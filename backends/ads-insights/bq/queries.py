"""SQL テンプレートコレクション（GA4 BigQuery 用）

12種のクエリテンプレートを提供:
1. pv: PV分析（日別PV・ユーザー・セッション）
2. traffic: 流入分析（チャネル別セッション・PV）
3. cv: CV分析（コンバージョンイベント別件数）
4. search: 検索クエリ分析（サイト内検索キーワード）
5. anomaly: 異常検知（Z-scoreベース日別異常検知）
6. landing: LP分析（ランディングページ別セッション・直帰率）
7. device: デバイス分析（デバイスカテゴリ別セッション・PV）
8. hourly: 時間帯分析（時間帯別アクセス傾向）
9. user_attr: ユーザー属性（新規/リピーター・地域別分析）
10. engagement: エンゲージメント時間分析
11. auction_proxy: 流入構成の変化分析
12. campaign: GA4キャンペーン別セッション・ユーザー・CV分析

全テンプレートは {dataset}、{start_date}/{end_date}、{timezone} と
{cv_events_sql} のプレースホルダを必要に応じて使用。
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_DATASET_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,1023}$")
_DATE_SUFFIX_RE = re.compile(r"^\d{8}$")
_EVENT_NAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$")

DEFAULT_CV_EVENTS = (
    "purchase",
    "generate_lead",
    "sign_up",
    "begin_checkout",
    "add_to_cart",
    "submit_form",
    "contact",
    "conversion",
)


def normalize_dataset_ref(dataset: str) -> str:
    """BigQuery dataset ref を検証して正規化する。

    Accepts either ``dataset`` or ``project.dataset``. The returned string is
    safe to interpolate inside a backticked BigQuery table reference.
    """
    value = str(dataset or "").strip()
    if not value:
        raise ValueError("dataset_id が空です。")
    parts = value.split(".")
    if len(parts) == 1:
        dataset_id = parts[0]
        if not _DATASET_ID_RE.fullmatch(dataset_id):
            raise ValueError(f"不正な dataset_id です: {dataset}")
        return dataset_id
    if len(parts) == 2:
        project_id, dataset_id = parts
        if not _PROJECT_ID_RE.fullmatch(project_id) or not _DATASET_ID_RE.fullmatch(dataset_id):
            raise ValueError(f"不正な dataset_id です: {dataset}")
        return f"{project_id}.{dataset_id}"
    raise ValueError(f"不正な dataset_id です: {dataset}")


def split_dataset_ref(dataset: str, default_project: str) -> tuple[str, str]:
    """Return (project_id, dataset_id) after validating a dataset ref."""
    normalized = normalize_dataset_ref(dataset)
    if "." in normalized:
        project_id, dataset_id = normalized.split(".", 1)
        return project_id, dataset_id
    return default_project, normalized


def validate_date_suffix(value: str, *, label: str) -> str:
    suffix = str(value or "").strip()
    if not _DATE_SUFFIX_RE.fullmatch(suffix):
        raise ValueError(f"{label} は YYYYMMDD 形式で指定してください。")
    return suffix


def get_cv_event_names(cv_events: Sequence[str] | str | None = None) -> tuple[str, ...]:
    """Return validated case-specific CV event names.

    Explicit ``cv_events`` takes precedence over the environment/default list.
    """
    if cv_events is None:
        raw = os.getenv("ADS_CV_EVENTS", "")
        values = [item.strip() for item in raw.split(",") if item.strip()] if raw else list(DEFAULT_CV_EVENTS)
    elif isinstance(cv_events, str):
        values = [item.strip() for item in cv_events.split(",") if item.strip()]
    else:
        values = [str(item).strip() for item in cv_events if str(item).strip()]
    if not values:
        raise ValueError("cv_events は1件以上指定してください。")
    invalid = [item for item in values if not _EVENT_NAME_RE.fullmatch(item)]
    if invalid:
        raise ValueError("ADS_CV_EVENTS に不正なイベント名があります: " + ", ".join(invalid[:5]))
    return tuple(dict.fromkeys(values))


def _format_sql_string_list(values: tuple[str, ...]) -> str:
    return ", ".join("'" + value.replace("'", "\\'") + "'" for value in values)


def validate_timezone(value: str) -> str:
    """Validate and return an IANA timezone name safe for SQL interpolation."""
    timezone = str(value or "").strip()
    if not timezone:
        raise ValueError("timezone が空です。")
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"不正な IANA timezone です: {timezone}") from exc
    return timezone


def _build_query(
    template: str,
    dataset: str,
    start_date: str,
    end_date: str,
    cv_events: Sequence[str] | str | None = None,
    timezone: str = "Asia/Tokyo",
) -> str:
    """テンプレートにパラメータを埋め込む。"""
    safe_dataset = normalize_dataset_ref(dataset)
    safe_start = validate_date_suffix(start_date, label="start_date")
    safe_end = validate_date_suffix(end_date, label="end_date")
    safe_timezone = validate_timezone(timezone)
    if safe_start > safe_end:
        raise ValueError("start_date は end_date 以前にしてください。")
    return template.format(
        dataset=safe_dataset,
        start_date=safe_start,
        end_date=safe_end,
        cv_events_sql=_format_sql_string_list(get_cv_event_names(cv_events)),
        timezone=safe_timezone,
    )


# ========== 1. PV分析 ==========
_PV_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    event_name,
    user_pseudo_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title') AS page_title,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
),
daily_metrics AS (
  SELECT
    event_date,
    COUNT(DISTINCT user_pseudo_id) AS daily_users,
    COUNT(DISTINCT session_key) AS daily_sessions,
    COUNTIF(event_name = 'page_view') AS daily_page_views
  FROM base
  GROUP BY event_date
),
period_metrics AS (
  SELECT
    COUNT(DISTINCT user_pseudo_id) AS period_users,
    COUNT(DISTINCT session_key) AS period_sessions,
    COUNTIF(event_name = 'page_view') AS period_page_views
  FROM base
),
page_metrics AS (
  SELECT
    event_date,
    page_title,
    page_location,
    COUNT(*) AS page_views,
    COUNT(DISTINCT user_pseudo_id) AS page_users,
    COUNT(DISTINCT session_key) AS page_sessions
  FROM base
  WHERE event_name = 'page_view'
  GROUP BY event_date, page_title, page_location
),
ranked_pages AS (
  SELECT
    p.*,
    d.daily_users,
    d.daily_sessions,
    d.daily_page_views,
    ROW_NUMBER() OVER (PARTITION BY p.event_date ORDER BY p.page_views DESC, p.page_location) AS daily_rank
  FROM page_metrics p
  JOIN daily_metrics d USING (event_date)
)
SELECT
  event_date,
  IF(daily_rank = 1, daily_users, NULL) AS users,
  IF(daily_rank = 1, daily_sessions, NULL) AS sessions,
  page_views,
  page_title,
  page_location,
  page_users,
  page_sessions,
  daily_users,
  daily_sessions,
  daily_page_views,
  period_users,
  period_sessions,
  period_page_views
FROM ranked_pages
CROSS JOIN period_metrics
ORDER BY
  event_date, page_views DESC
"""

# ========== 2. 流入分析（V3.3: event_date付き日別化） ==========
_TRAFFIC_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    event_name,
    user_pseudo_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    COALESCE(traffic_source.source, '(direct)') AS source,
    COALESCE(traffic_source.medium, '(none)') AS medium
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
),
daily_channel AS (
  SELECT
    event_date,
    source,
    medium,
    COUNT(DISTINCT user_pseudo_id) AS users,
    COUNT(DISTINCT session_key) AS sessions,
    COUNTIF(event_name = 'page_view') AS page_views
  FROM base
  GROUP BY event_date, source, medium
),
channel_period AS (
  SELECT
    source,
    medium,
    COUNT(DISTINCT user_pseudo_id) AS channel_period_users
  FROM base
  GROUP BY source, medium
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_users
  FROM base
)
SELECT
  d.*,
  c.channel_period_users,
  p.period_users
FROM daily_channel d
JOIN channel_period c USING (source, medium)
CROSS JOIN period_metrics p
ORDER BY
  event_date, sessions DESC
"""

# ========== 3. CV分析 ==========
_CV_TEMPLATE = """
WITH base AS (
  SELECT event_date, event_name, user_pseudo_id
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name IN ({cv_events_sql})
),
daily_event AS (
  SELECT
    event_name,
    COUNT(*) AS event_count,
    COUNT(DISTINCT user_pseudo_id) AS unique_users,
    event_date
  FROM base
  GROUP BY event_name, event_date
),
event_period AS (
  SELECT
    event_name,
    COUNT(DISTINCT user_pseudo_id) AS event_period_users
  FROM base
  GROUP BY event_name
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_unique_users
  FROM base
)
SELECT
  d.*,
  e.event_period_users,
  p.period_unique_users
FROM daily_event d
JOIN event_period e USING (event_name)
CROSS JOIN period_metrics p
ORDER BY
  event_date, event_count DESC
"""

# ========== 4. 検索クエリ分析（V3.3: event_date付き日別化） ==========
_SEARCH_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    user_pseudo_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'search_term') AS search_term
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'view_search_results'
),
configured_searches AS (
  SELECT * FROM base WHERE search_term IS NOT NULL
),
daily_term AS (
  SELECT
    event_date,
    search_term,
    COUNT(*) AS search_count,
    COUNT(DISTINCT user_pseudo_id) AS unique_searchers
  FROM configured_searches
  GROUP BY event_date, search_term
),
term_period AS (
  SELECT
    search_term,
    COUNT(DISTINCT user_pseudo_id) AS term_period_searchers
  FROM configured_searches
  GROUP BY search_term
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_unique_searchers
  FROM configured_searches
)
SELECT
  d.*,
  t.term_period_searchers,
  p.period_unique_searchers
FROM daily_term d
JOIN term_period t USING (search_term)
CROSS JOIN period_metrics p
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
    COUNTIF(event_name IN ({cv_events_sql})) AS conversions
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
WITH page_views AS (
  SELECT
    event_date,
    event_timestamp,
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'page_view'
),
session_rollup AS (
  SELECT
    MIN(event_date) AS event_date,
    session_key,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp ASC LIMIT 1)[SAFE_OFFSET(0)] AS landing_page,
    COUNT(*) AS page_count
  FROM page_views
  WHERE session_id IS NOT NULL
  GROUP BY session_key
)
SELECT
  event_date,
  landing_page,
  COUNT(*) AS sessions,
  AVG(page_count) AS avg_pages_per_session,
  COUNTIF(page_count = 1) AS bounce_sessions,
  SAFE_DIVIDE(COUNTIF(page_count = 1), COUNT(*)) AS bounce_rate
FROM session_rollup
WHERE landing_page IS NOT NULL
GROUP BY event_date, landing_page
ORDER BY event_date, sessions DESC
"""

# ========== 7. デバイス分析（V3.3: event_date付き日別化） ==========
_DEVICE_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    event_name,
    user_pseudo_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    COALESCE(device.category, '(not set)') AS device_category,
    COALESCE(device.operating_system, '(not set)') AS os
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
),
daily_device AS (
  SELECT
    event_date,
    device_category,
    os,
    COUNT(DISTINCT user_pseudo_id) AS users,
    COUNT(DISTINCT session_key) AS sessions,
    COUNTIF(event_name = 'page_view') AS page_views
  FROM base
  GROUP BY event_date, device_category, os
),
device_period AS (
  SELECT
    device_category,
    COUNT(DISTINCT user_pseudo_id) AS device_period_users
  FROM base
  GROUP BY device_category
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_users
  FROM base
)
SELECT
  d.*,
  dp.device_period_users,
  p.period_users
FROM daily_device d
JOIN device_period dp USING (device_category)
CROSS JOIN period_metrics p
ORDER BY
  event_date, sessions DESC
"""

# ========== 8. 時間帯分析 ==========
_HOURLY_TEMPLATE = """
WITH base AS (
  SELECT
    event_name,
    user_pseudo_id,
    EXTRACT(HOUR FROM DATETIME(TIMESTAMP_MICROS(event_timestamp), "{timezone}")) AS hour_of_day,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
),
hourly_metrics AS (
  SELECT
    hour_of_day,
    COUNT(DISTINCT user_pseudo_id) AS users,
    COUNT(DISTINCT session_key) AS sessions,
    COUNTIF(event_name = 'page_view') AS page_views
  FROM base
  GROUP BY hour_of_day
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_users
  FROM base
)
SELECT h.*, p.period_users
FROM hourly_metrics h
CROSS JOIN period_metrics p
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
    COALESCE(geo.country, '(not set)') AS country,
    COALESCE(geo.city, '(not set)') AS city
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'session_start'
),
attribute_metrics AS (
  SELECT
    country,
    city,
    CASE WHEN session_number = 1 THEN 'new' ELSE 'returning' END AS user_type,
    COUNT(DISTINCT user_pseudo_id) AS users,
    COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(session_id AS STRING))) AS sessions
  FROM session_info
  WHERE session_id IS NOT NULL
    AND user_pseudo_id IS NOT NULL
  GROUP BY country, city, user_type
),
user_type_metrics AS (
  SELECT
    CASE WHEN session_number = 1 THEN 'new' ELSE 'returning' END AS user_type,
    COUNT(DISTINCT user_pseudo_id) AS user_type_period_users
  FROM session_info
  WHERE session_id IS NOT NULL
  GROUP BY user_type
),
city_metrics AS (
  SELECT
    country,
    city,
    COUNT(DISTINCT user_pseudo_id) AS city_period_users
  FROM session_info
  WHERE session_id IS NOT NULL
  GROUP BY country, city
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_users
  FROM session_info
  WHERE session_id IS NOT NULL
)
SELECT
  a.*,
  u.user_type_period_users,
  c.city_period_users,
  p.period_users
FROM attribute_metrics a
JOIN user_type_metrics u USING (user_type)
JOIN city_metrics c USING (country, city)
CROSS JOIN period_metrics p
ORDER BY sessions DESC
LIMIT 500
"""


# ========== V3.3: エンゲージメント時間分析 ==========
_ENGAGEMENT_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    user_pseudo_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec') AS engagement_time_msec
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
    AND event_name = 'user_engagement'
),
daily_metrics AS (
  SELECT
    event_date,
    COUNT(DISTINCT user_pseudo_id) AS engaged_users,
    COUNT(DISTINCT session_key) AS engaged_sessions,
    SUM(engagement_time_msec) / 1000.0 AS total_engagement_sec,
    AVG(engagement_time_msec) / 1000.0 AS avg_engagement_sec
  FROM base
  GROUP BY event_date
),
period_metrics AS (
  SELECT COUNT(DISTINCT user_pseudo_id) AS period_engaged_users
  FROM base
)
SELECT d.*, p.period_engaged_users
FROM daily_metrics d
CROSS JOIN period_metrics p
ORDER BY
  event_date
"""

# ========== V3.3: 流入集中の参考値 ==========
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

# ========== V3.4: GA4キャンペーン分析 ==========
_CAMPAIGN_TEMPLATE = """
WITH base AS (
  SELECT
    event_date,
    event_timestamp,
    event_name,
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    CONCAT(
      user_pseudo_id, '-',
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    COALESCE(
      NULLIF(collected_traffic_source.manual_campaign_name, ''),
      NULLIF(traffic_source.name, ''),
      '(not set)'
    ) AS campaign_name,
    COALESCE(
      NULLIF(collected_traffic_source.manual_source, ''),
      NULLIF(traffic_source.source, ''),
      '(not set)'
    ) AS source,
    COALESCE(
      NULLIF(collected_traffic_source.manual_medium, ''),
      NULLIF(traffic_source.medium, ''),
      '(not set)'
    ) AS medium
  FROM
    `{dataset}.events_*`
  WHERE
    _TABLE_SUFFIX BETWEEN '{start_date}' AND '{end_date}'
),
session_rollup AS (
  SELECT
    session_key,
    ANY_VALUE(user_pseudo_id) AS user_pseudo_id,
    MIN(event_date) AS event_date,
    ARRAY_AGG(campaign_name ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,
    ARRAY_AGG(source ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS source,
    ARRAY_AGG(medium ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS medium,
    COUNTIF(event_name = 'page_view') AS page_views,
    COUNTIF(event_name IN ({cv_events_sql})) AS conversions
  FROM base
  WHERE session_id IS NOT NULL
    AND user_pseudo_id IS NOT NULL
  GROUP BY session_key
),
daily_campaign AS (
  SELECT
    event_date,
    campaign_name,
    source,
    medium,
    COUNT(DISTINCT user_pseudo_id) AS daily_users,
    COUNT(*) AS sessions,
    SUM(page_views) AS page_views,
    SUM(conversions) AS conversions
  FROM session_rollup
  GROUP BY event_date, campaign_name, source, medium
),
campaign_period AS (
  SELECT
    campaign_name,
    source,
    medium,
    COUNT(DISTINCT user_pseudo_id) AS campaign_period_users
  FROM session_rollup
  GROUP BY campaign_name, source, medium
),
period_metrics AS (
  SELECT
    COUNT(DISTINCT user_pseudo_id) AS period_users,
    COUNT(*) AS period_sessions,
    SUM(page_views) AS period_page_views,
    SUM(conversions) AS period_conversions
  FROM session_rollup
)
SELECT
  d.event_date,
  d.campaign_name,
  d.source,
  d.medium,
  d.daily_users AS users,
  d.sessions,
  d.page_views,
  d.conversions,
  cp.campaign_period_users,
  p.period_users,
  p.period_sessions,
  p.period_page_views,
  p.period_conversions
FROM daily_campaign d
JOIN campaign_period cp USING (campaign_name, source, medium)
CROSS JOIN period_metrics p
ORDER BY d.event_date, d.sessions DESC, d.campaign_name
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
        "name": "流入集中の参考値",
        "description": "訪問元の構成比と流入先の偏りを確認する参考値",
        "template": _AUCTION_PROXY_TEMPLATE,
    },
    "campaign": {
        "name": "キャンペーン分析",
        "description": "GA4キャンペーン別の期間ユーザー・セッション・PV・CV",
        "template": _CAMPAIGN_TEMPLATE,
    },
}


def get_query(
    query_type: str,
    dataset: str,
    start_date: str,
    end_date: str,
    cv_events: Sequence[str] | str | None = None,
    timezone: str = "Asia/Tokyo",
) -> str:
    """指定タイプのSQLクエリを生成する。

    Args:
        query_type: クエリタイプ（pv/traffic/cv/search/anomaly/landing）
        dataset: BigQuery データセットID
        start_date: 開始日（YYYYMMDD形式）
        end_date: 終了日（YYYYMMDD形式）
        cv_events: 案件別CVイベント名。未指定時は環境変数/既定値。
        timezone: IANA timezone 名。

    Returns:
        SQLクエリ文字列
    """
    if query_type not in QUERIES:
        available = ", ".join(QUERIES.keys())
        raise ValueError(f"未知のクエリタイプ: {query_type}（利用可能: {available}）")

    return _build_query(
        QUERIES[query_type]["template"],
        dataset,
        start_date,
        end_date,
        cv_events=cv_events,
        timezone=timezone,
    )


def list_query_types() -> list[dict]:
    """利用可能なクエリタイプの一覧を返す。"""
    return [
        {"key": k, "name": v["name"], "description": v["description"]}
        for k, v in QUERIES.items()
    ]
