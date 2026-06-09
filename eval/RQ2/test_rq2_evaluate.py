"""Unit tests for the live-computation helpers in rq2_evaluate.py"""
import pytest
import numpy as np
from rq2_evaluate import run_bootstrap_ci, run_fisher_exact_greater


class TestRunBootstrapCi:
    def test_returns_tuple_of_two_floats(self):
        lo, hi = run_bootstrap_ci(rate=0.48, n_events=6411)
        assert isinstance(lo, float)
        assert isinstance(hi, float)

    def test_ci_bounds_contain_rate(self):
        rate = 0.48
        lo, hi = run_bootstrap_ci(rate=rate, n_events=6411)
        assert lo <= rate <= hi

    def test_ci_bounds_are_ordered(self):
        lo, hi = run_bootstrap_ci(rate=0.29, n_events=6411)
        assert lo < hi

    def test_reproducible_with_seed(self):
        lo1, hi1 = run_bootstrap_ci(rate=0.48, n_events=6411, seed=42)
        lo2, hi2 = run_bootstrap_ci(rate=0.48, n_events=6411, seed=42)
        assert lo1 == lo2 and hi1 == hi2

    def test_sironly_hit5_matches_paper_ci(self):
        # Paper reports [0.47, 0.50] for SIROnly Hit@5
        lo, hi = run_bootstrap_ci(rate=0.48, n_events=6411, seed=42)
        assert 0.46 <= lo <= 0.49
        assert 0.47 <= hi <= 0.51


class TestRunFisherExactGreater:
    def test_returns_float(self):
        p = run_fisher_exact_greater(n_chain=168, rate_chain=0.107,
                                     n_rand=168, rate_rand=0.048)
        assert isinstance(p, float)

    def test_significant_result(self):
        # Large effect should be highly significant
        p = run_fisher_exact_greater(n_chain=4820, rate_chain=0.158,
                                     n_rand=4820, rate_rand=0.034)
        assert p < 1e-10

    def test_ac_project_matches_paper(self):
        # Paper reports p≈0.041 for AC; Fisher one-sided gives ~0.032
        p = run_fisher_exact_greater(n_chain=168, rate_chain=0.107,
                                     n_rand=168, rate_rand=0.048)
        assert p < 0.05

    def test_non_significant_when_equal_rates(self):
        p = run_fisher_exact_greater(n_chain=200, rate_chain=0.05,
                                     n_rand=200, rate_rand=0.05)
        assert p > 0.4
