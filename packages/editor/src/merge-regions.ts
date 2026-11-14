/**
 * The regions of a three-way merge, for resolving it with checkboxes as the
 * Visual Studio and VS Code merge editors do.
 *
 * Given the common ancestor (base), current (ours) and incoming (theirs), the
 * merge splits the text into stretches all three share and regions where one
 * or both sides changed: a change on one side, the same change on both, or a
 * conflict. Each region's text in the result comes from a choice (which sides,
 * in the order they were ticked), and the choice is read back from the text,
 * so editing the result by hand and ticking boxes stay in step.
 *
 * All texts here use LF line endings.
 */
import { findMergeConflicts } from './merge-conflicts.js';

export type MergeSide = 'ours' | 'theirs';

/**
 * A region's choice: the sides it takes, in order (none: the original for a
 * one-sided change), the original text, the conflict markers (unresolved), or
 * text written by hand.
 */
export type RegionChoice = MergeSide[] | 'base' | 'manual' | 'unresolved';

/** Changed in current only, incoming only, the same in both, or differently in both. */
export type RegionKind = 'ours' | 'theirs' | 'same' | 'conflict';

export interface MergeRegion {
  kind: RegionKind;
  /** Each version's text for the region, every line ending in a line break. */
  base: string;
  ours: string;
  theirs: string;
  /** Whether conflict markers for it include the original (diff3 style). */
  hasBase: boolean;
  /** The region's lines in each side's whole text, `[start, end)` from 0. */
  oursLines: [number, number];
  theirsLines: [number, number];
  /** Where it is in the result now. */
  from: number;
  to: number;
  choice: RegionChoice;
}

export interface MarkerStyle {
  size: number;
  ours: string;
  base: string;
  theirs: string;
}

interface Hunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

type Segment = { same: string[] } | { region: Omit<MergeRegion, 'from' | 'to' | 'choice'> };

/** Above this many changed lines the diff gives up and treats the whole text as one change. */
const MAX_EDIT_DISTANCE = 4000;

export class MergeModel {
  /** The result as it is now. */
  public text: string;
  public readonly regions: MergeRegion[];
  /** Each side's whole text, as the input panes show it. */
  public readonly sides: { ours: string; theirs: string; base: string | null };
  public readonly markers: MarkerStyle;
  /** Built from the three versions (one-sided changes included), not just conflict markers. */
  public readonly fromVersions: boolean;

  private constructor(text: string, regions: MergeRegion[], sides: MergeModel['sides'], markers: MarkerStyle, fromVersions: boolean) {
    this.text = text;
    this.regions = regions;
    this.sides = sides;
    this.markers = markers;
    this.fromVersions = fromVersions;
  }

  /**
   * From the three versions, finding each region in `result`. Null when the
   * result no longer lines up with them (text both sides share was edited).
   */
  public static fromVersions(result: string, base: string, ours: string, theirs: string): MergeModel | null {
    const markers = markerStyle(result);
    const segments = merge3(splitLines(base), splitLines(ours), splitLines(theirs));
    const resultLines = splitLines(result);
    const ranges = locate(resultLines, segments, markers);
    if (!ranges) return null;
    const offsets = lineOffsets(resultLines, result.length);
    const regions: MergeRegion[] = [];
    let index = 0;
    for (const segment of segments) {
      if (!('region' in segment)) continue;
      const [start, end] = ranges[index++];
      const region: MergeRegion = { ...segment.region, from: offsets[start], to: offsets[end], choice: 'unresolved' };
      region.choice = recognize(region, result.slice(region.from, region.to));
      regions.push(region);
    }
    return new MergeModel(result, regions, { ours, theirs, base }, markers, true);
  }

  /** From conflict markers alone: each block is a conflict region; the sides are the result with every block resolved one way. */
  public static fromMarkers(result: string): MergeModel {
    const markers = markerStyle(result);
    const conflicts = findMergeConflicts(result);
    const regions: MergeRegion[] = [];
    let ours = '';
    let theirs = '';
    let base = '';
    let at = 0;
    const hasBase = conflicts.length > 0 && conflicts.every((conflict) => conflict.base !== null);
    for (const conflict of conflicts) {
      const between = result.slice(at, conflict.start);
      ours += between;
      theirs += between;
      base += between;
      const oursStart = countLines(ours);
      const theirsStart = countLines(theirs);
      ours += conflict.ours;
      theirs += conflict.theirs;
      base += conflict.base ?? '';
      regions.push({
        kind: 'conflict',
        base: conflict.base ?? '',
        ours: conflict.ours,
        theirs: conflict.theirs,
        hasBase: conflict.base !== null,
        oursLines: [oursStart, countLines(ours)],
        theirsLines: [theirsStart, countLines(theirs)],
        from: conflict.start,
        to: conflict.end,
        choice: 'unresolved'
      });
      at = conflict.end;
    }
    const rest = result.slice(at);
    return new MergeModel(result, regions, { ours: ours + rest, theirs: theirs + rest, base: hasBase ? base + rest : null }, markers, false);
  }

  /** Conflict blocks left in the result. */
  public get remaining(): number {
    return findMergeConflicts(this.text).length;
  }

  /** The text region `index` gets for `choice`. */
  public generate(index: number, choice: RegionChoice): string {
    const region = this.regions[index];
    if (choice === 'unresolved') return this.markerText(region);
    if (choice === 'base') return region.base;
    if (choice === 'manual') return this.text.slice(region.from, region.to);
    if (region.kind === 'same') return choice.length ? region.ours : region.base;
    if (!choice.length) return region.kind === 'conflict' ? this.markerText(region) : region.base;
    return choice.map((side) => region[side]).join('');
  }

  /** The change that sets region `index` to `choice`. */
  public change(index: number, choice: RegionChoice): { from: number; to: number; insert: string } {
    const region = this.regions[index];
    return { from: region.from, to: region.to, insert: this.generate(index, choice) };
  }

  /** The choice after ticking or unticking `side` on region `index`. */
  public toggled(index: number, side: MergeSide): RegionChoice {
    const region = this.regions[index];
    const current = Array.isArray(region.choice) ? [...region.choice] : [];
    // Both sides made the same change: one text, so both boxes go together.
    if (region.kind === 'same') return current.length ? [] : ['ours', 'theirs'];
    const next = current.includes(side) ? current.filter((candidate) => candidate !== side) : [...current, side];
    if (!next.length && region.kind === 'conflict') return 'unresolved';
    return next;
  }

  /**
   * Takes the result's new text after an edit: moves each region with
   * `mapPos` (text typed at a region's edge joins it) and reads its choice
   * back from its text.
   */
  public update(text: string, mapPos: (pos: number, assoc: number) => number): void {
    for (const region of this.regions) {
      region.from = mapPos(region.from, -1);
      region.to = Math.max(region.from, mapPos(region.to, 1));
    }
    this.text = text;
    for (const region of this.regions) region.choice = recognize(region, text.slice(region.from, region.to));
  }

  /** Applies a change to the text directly (no editor). */
  public apply(change: { from: number; to: number; insert: string }): void {
    const delta = change.insert.length - (change.to - change.from);
    const text = this.text.slice(0, change.from) + change.insert + this.text.slice(change.to);
    this.update(text, (pos, assoc) => {
      if (pos < change.from || (pos === change.from && assoc < 0)) return pos;
      if (pos > change.to || (pos === change.to && assoc > 0)) return pos + delta;
      return assoc < 0 ? change.from : change.from + change.insert.length;
    });
  }

  /** The region holding offset `pos` of the result, or -1. */
  public regionAt(pos: number): number {
    return this.regions.findIndex((region) => pos >= region.from && (pos < region.to || (pos === region.from && region.from === region.to)));
  }

  private markerText(region: MergeRegion): string {
    const { size } = this.markers;
    const line = (char: string, label: string) => `${char.repeat(size)}${label ? ` ${label}` : ''}\n`;
    return line('<', this.markers.ours) + region.ours
      + (region.hasBase ? line('|', this.markers.base) + region.base : '')
      + line('=', '') + region.theirs + line('>', this.markers.theirs);
  }
}

/** A region's choice, read from its text in the result. */
export function recognize(region: Pick<MergeRegion, 'kind' | 'base' | 'ours' | 'theirs'>, text: string): RegionChoice {
  const blocks = findMergeConflicts(text);
  if (blocks.length === 1 && blocks[0].start === 0 && blocks[0].end === text.length) return 'unresolved';
  if (region.kind === 'same') {
    if (text === region.ours) return ['ours', 'theirs'];
    return text === region.base ? [] : 'manual';
  }
  if (region.kind === 'ours') {
    if (text === region.ours) return ['ours'];
    return text === region.base ? [] : 'manual';
  }
  if (region.kind === 'theirs') {
    if (text === region.theirs) return ['theirs'];
    return text === region.base ? [] : 'manual';
  }
  if (text === region.ours) return ['ours'];
  if (text === region.theirs) return ['theirs'];
  if (text === region.ours + region.theirs) return ['ours', 'theirs'];
  if (text === region.theirs + region.ours) return ['theirs', 'ours'];
  if (text === region.base) return 'base';
  return 'manual';
}

// ------------------------------------------------------------ the merge

/** Lines of a text; the last item is '' when it ends with a line break. */
function splitLines(text: string): string[] {
  return text.split('\n');
}

function joinRegion(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

function lineOffsets(lines: string[], length: number): number[] {
  const offsets = [0];
  for (const line of lines) offsets.push(Math.min(length, offsets[offsets.length - 1] + line.length + 1));
  return offsets;
}

function countLines(text: string): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}

/** Line diff (Myers): the runs of `a` replaced in `b`, as half-open line ranges. */
export function diffLines(a: string[], b: string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start;
  const m = endB - start;
  if (!n && !m) return [];
  if (!n || !m) return [{ aStart: start, aEnd: endA, bStart: start, bEnd: endB }];
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return [{ aStart: start, aEnd: endA, bStart: start, bEnd: endB }];

  // Walk back to collect the matching lines.
  const matches: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const previous = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : previous[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  matches.reverse();
  const hunks: Hunk[] = [];
  let lastA = -1;
  let lastB = -1;
  for (const [ma, mb] of [...matches, [n, m] as [number, number]]) {
    if (ma > lastA + 1 || mb > lastB + 1) {
      hunks.push({ aStart: start + lastA + 1, aEnd: start + ma, bStart: start + lastB + 1, bEnd: start + mb });
    }
    lastA = ma;
    lastB = mb;
  }
  return hunks;
}

/**
 * Three-way merge of line arrays. Changes that overlap or touch are one
 * region, as `git merge-file` groups them.
 */
function merge3(base: string[], ours: string[], theirs: string[]): Segment[] {
  const hunks = [
    ...diffLines(base, ours).map((hunk) => ({ ...hunk, side: 'ours' as const })),
    ...diffLines(base, theirs).map((hunk) => ({ ...hunk, side: 'theirs' as const }))
  ].sort((a, b) => a.aStart - b.aStart || a.aEnd - b.aEnd);
  const segments: Segment[] = [];
  let baseAt = 0;
  let deltaOurs = 0;
  let deltaTheirs = 0;
  let i = 0;
  while (i < hunks.length) {
    const group = [hunks[i]];
    let groupStart = hunks[i].aStart;
    let groupEnd = hunks[i].aEnd;
    i += 1;
    while (i < hunks.length && hunks[i].aStart <= groupEnd) {
      groupEnd = Math.max(groupEnd, hunks[i].aEnd);
      groupStart = Math.min(groupStart, hunks[i].aStart);
      group.push(hunks[i]);
      i += 1;
    }
    if (groupStart > baseAt) segments.push({ same: base.slice(baseAt, groupStart) });
    const sideRange = (side: MergeSide, delta: number): [number, number, number] => {
      const own = group.filter((hunk) => hunk.side === side);
      const grown = own.reduce((sum, hunk) => sum + (hunk.bEnd - hunk.bStart) - (hunk.aEnd - hunk.aStart), 0);
      return [groupStart + delta, groupEnd + delta + grown, delta + grown];
    };
    const [oursStart, oursEnd, nextOurs] = sideRange('ours', deltaOurs);
    const [theirsStart, theirsEnd, nextTheirs] = sideRange('theirs', deltaTheirs);
    const baseLines = base.slice(groupStart, groupEnd);
    const oursLines = ours.slice(oursStart, oursEnd);
    const theirsLines = theirs.slice(theirsStart, theirsEnd);
    const touchesOurs = group.some((hunk) => hunk.side === 'ours');
    const touchesTheirs = group.some((hunk) => hunk.side === 'theirs');
    const kind: RegionKind = touchesOurs && touchesTheirs
      ? (oursLines.join('\n') === theirsLines.join('\n') && oursLines.length === theirsLines.length ? 'same' : 'conflict')
      : touchesOurs ? 'ours' : 'theirs';
    segments.push({
      region: {
        kind,
        base: joinRegion(baseLines),
        ours: joinRegion(oursLines),
        theirs: joinRegion(theirsLines),
        hasBase: true,
        oursLines: [oursStart, oursEnd],
        theirsLines: [theirsStart, theirsEnd]
      }
    });
    deltaOurs = nextOurs;
    deltaTheirs = nextTheirs;
    baseAt = groupEnd;
  }
  if (baseAt < base.length) segments.push({ same: base.slice(baseAt) });
  return segments;
}

/**
 * Each region's line range in the result: the stretches all three share
 * must appear in order, and a region is whatever lies between them. Where a
 * shared stretch appears more than once, the place that makes the region read
 * as one of its known choices wins. Null when a stretch is missing.
 */
function locate(result: string[], segments: Segment[], markers: MarkerStyle): Array<[number, number]> | null {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  let pending: Extract<Segment, { region: unknown }>['region'] | null = null;
  const matchesAt = (at: number, lines: string[]) => {
    if (at + lines.length > result.length) return false;
    for (let j = 0; j < lines.length; j++) if (result[at + j] !== lines[j]) return false;
    return true;
  };
  for (const segment of segments) {
    if ('region' in segment) {
      pending = segment.region;
      continue;
    }
    const lines = segment.same;
    if (!pending) {
      if (!matchesAt(cursor, lines)) return null;
      cursor += lines.length;
      continue;
    }
    let chosen = -1;
    for (let at = cursor; at + lines.length <= result.length; at++) {
      if (!matchesAt(at, lines)) continue;
      if (chosen < 0) chosen = at;
      const text = joinRegion(result.slice(cursor, at));
      if (recognize(pending, text) !== 'manual' || isMarkerBlock(text, markers)) {
        chosen = at;
        break;
      }
    }
    if (chosen < 0) return null;
    ranges.push([cursor, chosen]);
    pending = null;
    cursor = chosen + lines.length;
  }
  if (pending) {
    ranges.push([cursor, result.length]);
  } else if (cursor !== result.length) {
    return null;
  }
  return ranges;
}

function isMarkerBlock(text: string, _markers: MarkerStyle): boolean {
  const blocks = findMergeConflicts(text);
  return blocks.length === 1 && blocks[0].start === 0 && blocks[0].end === text.length;
}

/** The marker size and labels the result's conflicts use, or Git's defaults. */
function markerStyle(text: string): MarkerStyle {
  const [first] = findMergeConflicts(text);
  if (!first) return { size: 7, ours: 'ours', base: 'base', theirs: 'theirs' };
  let size = 0;
  while (text[first.start + size] === '<') size += 1;
  return { size, ours: first.oursLabel, base: first.baseLabel ?? 'base', theirs: first.theirsLabel };
}
