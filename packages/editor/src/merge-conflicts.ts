/**
 * Git conflict blocks in a text, as a merge leaves them (`git merge`, or
 * `mdz merge` inside an `.mdz`):
 *
 * ```
 * <<<<<<< ours
 * our lines
 * ||||||| base        (only with merge.conflictStyle=diff3 / zdiff3)
 * the original lines
 * =======
 * their lines
 * >>>>>>> theirs
 * ```
 *
 * Markers are at least seven characters (Git's `conflict-marker-size` can
 * make them longer) and the four in one block are the same length.
 */

/** One conflict block in a text. */
export interface MergeConflict {
  /** Position among the text's conflicts, from 0. */
  index: number;
  /** Offset of the block's first marker in the text. */
  start: number;
  /** Offset just past the block's last marker line (and its line ending). */
  end: number;
  /** Line number of the first marker, from 1. */
  line: number;
  /** Our side's lines, with their line endings. */
  ours: string;
  /** The common ancestor's lines, or null when the markers don't include them. */
  base: string | null;
  /** Their side's lines, with their line endings. */
  theirs: string;
  /** The text after `<<<<<<<` (e.g. `HEAD`, `ours:index.md`). */
  oursLabel: string;
  /** The text after `|||||||`, or null. */
  baseLabel: string | null;
  /** The text after `>>>>>>>` (e.g. a branch name). */
  theirsLabel: string;
}

/** How to resolve a conflict: keep one side, both (ours first), the original, or new text. */
export type MergeConflictResolution = 'ours' | 'theirs' | 'both' | 'base' | { text: string };

interface Line {
  text: string;
  /** Offset of the line's first character. */
  start: number;
  /** Offset just past its line ending. */
  end: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline + 1;
    const raw = text.slice(start, newline < 0 ? text.length : newline);
    lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start, end });
    start = end;
  }
  return lines;
}

/** The marker's label when `line` is `char` repeated exactly `size` times, then nothing or a space and a label. */
function markerLabel(line: string, char: string, size: number): string | null {
  if (line.length < size) return null;
  for (let i = 0; i < size; i += 1) if (line[i] !== char) return null;
  if (line.length === size) return '';
  return line[size] === ' ' ? line.slice(size + 1) : null;
}

/** The size of an opening marker (`<<<<<<<`, seven or more), or 0. */
function openingSize(line: string): number {
  let size = 0;
  while (line[size] === '<') size += 1;
  if (size < 7) return 0;
  return line.length === size || line[size] === ' ' ? size : 0;
}

/** Every complete conflict block in `text`, in order. An unfinished block is left alone. */
export function findMergeConflicts(text: string): MergeConflict[] {
  const lines = splitLines(text);
  const conflicts: MergeConflict[] = [];
  let i = 0;
  while (i < lines.length) {
    const size = openingSize(lines[i].text);
    if (!size) {
      i += 1;
      continue;
    }
    const open = i;
    let baseAt = -1;
    let separator = -1;
    let close = -1;
    for (let j = open + 1; j < lines.length; j += 1) {
      const line = lines[j].text;
      if (separator < 0) {
        if (baseAt < 0 && markerLabel(line, '|', size) !== null) baseAt = j;
        else if (markerLabel(line, '=', size) === '') separator = j;
        else if (openingSize(line) === size) break; // another block opens first: this one is unfinished
      } else if (markerLabel(line, '>', size) !== null) {
        close = j;
        break;
      }
    }
    if (separator < 0 || close < 0) {
      i += 1;
      continue;
    }
    const slice = (from: number, to: number) => (from >= to ? '' : text.slice(lines[from].start, lines[to - 1].end));
    conflicts.push({
      index: conflicts.length,
      start: lines[open].start,
      end: lines[close].end,
      line: open + 1,
      ours: slice(open + 1, baseAt >= 0 ? baseAt : separator),
      base: baseAt >= 0 ? slice(baseAt + 1, separator) : null,
      theirs: slice(separator + 1, close),
      oursLabel: markerLabel(lines[open].text, '<', size) ?? '',
      baseLabel: baseAt >= 0 ? markerLabel(lines[baseAt].text, '|', size) : null,
      theirsLabel: markerLabel(lines[close].text, '>', size) ?? ''
    });
    i = close + 1;
  }
  return conflicts;
}

/** Whether `text` has at least one complete conflict block. */
export function hasMergeConflicts(text: string): boolean {
  return findMergeConflicts(text).length > 0;
}

/** The text that replaces a conflict block for a resolution. */
export function mergeConflictReplacement(conflict: MergeConflict, resolution: MergeConflictResolution): string {
  if (typeof resolution === 'object') return resolution.text;
  switch (resolution) {
    case 'ours': return conflict.ours;
    case 'theirs': return conflict.theirs;
    case 'base': return conflict.base ?? '';
    case 'both': {
      // Keep a line break between the two when ours doesn't end with one.
      const joiner = conflict.ours && !conflict.ours.endsWith('\n') ? '\n' : '';
      return conflict.ours + joiner + conflict.theirs;
    }
  }
}

/**
 * `text` with its conflict number `index` replaced by the resolution. Throws
 * when there is no such conflict.
 */
export function resolveMergeConflict(text: string, index: number, resolution: MergeConflictResolution): string {
  const conflict = findMergeConflicts(text)[index];
  if (!conflict) throw new RangeError(`There is no conflict ${index + 1} in this text.`);
  return text.slice(0, conflict.start) + mergeConflictReplacement(conflict, resolution) + text.slice(conflict.end);
}
