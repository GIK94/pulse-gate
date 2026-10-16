import { useSearchParams } from 'react-router-dom';
import { RANGES, type Range } from './types';

/** Analytics range kept in the URL (?range=24h) so views are shareable. */
export function useRangeParam(fallback: Range = '24h'): [Range, (r: Range) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const range = (RANGES as readonly string[]).includes(raw ?? '') ? (raw as Range) : fallback;
  const setRange = (r: Range) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('range', r);
        return next;
      },
      { replace: true },
    );
  return [range, setRange];
}
