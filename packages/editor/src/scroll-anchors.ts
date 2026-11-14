/**
 * Position-aware scroll sync between two panes: instead of one global ratio,
 * pairs of anchors (the same heading, block or line in each pane) pin
 * matching content together, and positions between two anchors are
 * interpolated. Panes stay aligned through the middle of a document even
 * where a stretch is much taller in one of them (an added section, an image,
 * a table).
 *
 * The merge view's rendered panes anchor on their headings. The split view's
 * source and preview could use the same mapping with source-line anchors
 * (mdzip-editor#13).
 */

/** The same content's offset in each pane (pixels from the top of its scrolled content). */
export type ScrollAnchor = readonly [from: number, to: number];

/**
 * Where the target should scroll so it shows what the source shows at
 * `scrollTop`. `anchors` pair offsets in the source with offsets in the
 * target; the tops and the ends of both pane contents are anchored too.
 */
export function mapScrollPosition(
  scrollTop: number,
  anchors: readonly ScrollAnchor[],
  source: { scrollHeight: number; clientHeight: number },
  target: { scrollHeight: number; clientHeight: number }
): number {
  const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
  // Scrolled to the end: the target too, whatever the anchors say.
  if (sourceMax > 0 && scrollTop >= sourceMax - 1) return targetMax;
  const points: ScrollAnchor[] = [[0, 0]];
  for (const [from, to] of [...anchors].sort((a, b) => a[0] - b[0])) {
    const last = points[points.length - 1];
    // Keep the mapping increasing: skip anchors that would run backwards.
    if (from > last[0] && to >= last[1]) points.push([from, to]);
  }
  const end: ScrollAnchor = [source.scrollHeight, target.scrollHeight];
  if (end[0] > points[points.length - 1][0] && end[1] >= points[points.length - 1][1]) points.push(end);
  let index = 1;
  while (index < points.length && points[index][0] <= scrollTop) index++;
  if (index >= points.length) return clamp(points[points.length - 1][1], targetMax);
  const [fromA, toA] = points[index - 1];
  const [fromB, toB] = points[index];
  const share = fromB > fromA ? (scrollTop - fromA) / (fromB - fromA) : 0;
  return clamp(Math.round(toA + share * (toB - toA)), targetMax);
}

/**
 * Pairs up equal items of two sequences in order (their longest common
 * subsequence): `[i, j]` for each `a[i] === b[j]` kept. Used to match
 * headings by level and text when one side added, removed or renamed some.
 */
export function matchSequences(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: the common subsequence of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}
