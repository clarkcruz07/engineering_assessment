"""Weekly source-to-mart reconciliation. JSON evidence in, evidence + quality out."""
import json
import sys
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP


def reconcile(evidence):
    evidence = dict(evidence)
    current, previous = evidence['activeSubscriptions'], evidence['previousSubscriptions']
    source_total = sum(row['activeSubscriptions'] for row in evidence['sourceSnapshots'])
    evidence['sourceTotal'] = source_total
    evidence['reconciliationDelta'] = None if current is None else current - source_total
    current_complete = bool(evidence.get('sourceComplete')) and \
        evidence.get('sourcePeriodEnd') == evidence.get('expectedPeriodEnd')
    comparable = current_complete and bool(evidence.get('previousSourceComplete'))
    # Growth is only reported between complete, comparable weekly snapshots.
    evidence['growthPct'] = (
        float(((Decimal(current) / Decimal(previous) - 1) * 100).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP))
        if comparable and current is not None and previous is not None and previous > 0 else None
    )
    reasons = []
    imported = evidence['ingestedAt']
    age = ((datetime.fromisoformat(evidence['asOf']) - datetime.fromisoformat(imported)).total_seconds()
           if imported else float('inf'))
    if age > 48 * 3600:
        reasons.append('Latest import is unavailable or older than 48 hours.')
    if current is None or not current_complete:
        reasons.append('Current snapshot is missing or partial; it is not comparable weekly growth.')
    if previous is None or not evidence.get('previousSourceComplete'):
        reasons.append('Comparison-week snapshot is missing or partial.')
    quality = {'status': 'insufficient' if reasons else 'ready', 'reasons': reasons}
    return {'evidence': evidence, 'quality': quality}


if __name__ == '__main__':
    json.dump(reconcile(json.load(sys.stdin)), sys.stdout, allow_nan=False)
