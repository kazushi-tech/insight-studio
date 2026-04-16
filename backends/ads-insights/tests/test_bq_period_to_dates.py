"""period_to_dates() のユニットテスト。

月次 / 日次 / 範囲 の 3 パターンを検証する。
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bq.reporter import period_to_dates


class TestPeriodToDates(unittest.TestCase):
    # ---- 月次 ----
    def test_monthly_normal(self):
        start, end = period_to_dates("2026-02")
        self.assertEqual(start, "20260201")
        self.assertEqual(end, "20260228")

    def test_monthly_leap_year(self):
        start, end = period_to_dates("2024-02")
        self.assertEqual(start, "20240201")
        self.assertEqual(end, "20240229")

    def test_monthly_december(self):
        start, end = period_to_dates("2025-12")
        self.assertEqual(start, "20251201")
        self.assertEqual(end, "20251231")

    # ---- 日次 ----
    def test_daily_single_day(self):
        start, end = period_to_dates("2026-02-26")
        self.assertEqual(start, "20260226")
        self.assertEqual(end, "20260226")

    def test_daily_first_of_month(self):
        start, end = period_to_dates("2026-03-01")
        self.assertEqual(start, "20260301")
        self.assertEqual(end, "20260301")

    def test_daily_last_of_month(self):
        start, end = period_to_dates("2026-01-31")
        self.assertEqual(start, "20260131")
        self.assertEqual(end, "20260131")

    # ---- 範囲 ----
    def test_range_same_month(self):
        start, end = period_to_dates("2026-02-01:2026-02-07")
        self.assertEqual(start, "20260201")
        self.assertEqual(end, "20260207")

    def test_range_cross_month(self):
        start, end = period_to_dates("2026-02-24:2026-03-02")
        self.assertEqual(start, "20260224")
        self.assertEqual(end, "20260302")


if __name__ == "__main__":
    unittest.main()
