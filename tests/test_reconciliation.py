from reconcile import reconcile


def example():
    return dict(activeSubscriptions=115, previousSubscriptions=100,
                sourceSnapshots=[dict(reportId='current', activeSubscriptions=115)],
                sourceReports=['current'], sourceComplete=True, sourcePeriodEnd='2026-10-04',
                previousSourceComplete=True, previousSourcePeriodEnd='2026-09-27',
                periodStart='2026-09-28', expectedPeriodEnd='2026-10-04',
                asOf='2026-10-06T12:00:00Z', ingestedAt='2026-10-06T03:00:00+00:00')


def test_complete_comparable_snapshots():
    result = reconcile(example())
    assert result['evidence']['growthPct'] == 15
    assert result['evidence']['sourceTotal'] == 115
    assert result['evidence']['reconciliationDelta'] == 0
    assert result['quality']['status'] == 'ready'


def test_missing_import_is_visible():
    evidence = example()
    evidence['ingestedAt'] = None
    assert reconcile(evidence)['quality']['status'] == 'insufficient'


def test_zero_baseline_has_no_percentage_growth():
    evidence = example()
    evidence['previousSubscriptions'] = 0
    assert reconcile(evidence)['evidence']['growthPct'] is None


def test_partial_current_snapshot_is_not_comparable_growth():
    evidence = example()
    evidence['sourceComplete'] = False
    evidence['sourcePeriodEnd'] = '2026-10-02'
    result = reconcile(evidence)
    assert result['evidence']['growthPct'] is None
    assert result['quality']['status'] == 'insufficient'
