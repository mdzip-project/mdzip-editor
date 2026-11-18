// Validation for JSON entries in the editor (#68): any `.json` file, and the
// archive's `manifest.json` checked against the MDZip spec (Sections 6.2–6.4).
// Pure functions with source positions, so the editor can underline problems
// and hosts can draw their own validity indicator.
import { checkManifest, type MdzManifest } from '@mdzip/core-js';

export type MdzipJsonProblemSeverity = 'error' | 'warning' | 'info';

export interface MdzipJsonProblem {
  severity: MdzipJsonProblemSeverity;
  message: string;
  /** Offsets in the text the problem covers. */
  from: number;
  to: number;
  /** The manifest field it's about (`spec.version`, `title`, …), when there is one. */
  field?: string;
  /**
   * The kind of problem: `'syntax'` (not JSON, or the manifest isn't an
   * object), `'duplicate'` (a property name used twice), or `'field'` (a
   * field's value). The manifest form can't show the text in the first two cases.
   */
  code?: 'syntax' | 'duplicate' | 'field';
}

export interface MdzipJsonValidity {
  /** `'manifest'` for the archive's root `manifest.json`, `'json'` for any other `.json` entry. */
  kind: 'manifest' | 'json';
  /** `'invalid'` with any error, `'warnings'` with warnings only, else `'valid'`. */
  status: 'valid' | 'warnings' | 'invalid';
  problems: MdzipJsonProblem[];
  errorCount: number;
  warningCount: number;
  /**
   * Manifest fields the spec doesn't define, at the top level. Allowed
   * (Section 6.3): every MDZip tool keeps them. Empty for other JSON.
   */
  customFields: string[];
  /**
   * Whether the editor saves this text. Always `true` for other JSON (the
   * file is saved as typed, even when it doesn't parse); for the manifest,
   * `false` while there's an error, since a manifest a consumer would reject
   * or partly ignore must not be written.
   */
  canSave: boolean;
  /** The parsed value, when the text is valid JSON. */
  value?: unknown;
}

export interface MdzipManifestValidationOptions {
  /** The archive's file paths, to check that `entryPoint` and `cover` name files in it. */
  archivePaths?: readonly string[];
  /**
   * The manifest as stored, to warn when `producer` or `spec.version` is
   * edited: both are normally written by the tool that saves the archive.
   */
  stored?: MdzManifest | null;
}

// --- JSON with positions --------------------------------------------------------

interface JsonNode {
  from: number;
  to: number;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  members?: JsonMember[];
  items?: JsonNode[];
}

interface JsonMember {
  key: string;
  keyFrom: number;
  keyTo: number;
  value: JsonNode;
}

class JsonSyntaxError extends Error {
  public constructor(message: string, public readonly from: number, public readonly to: number) {
    super(message);
  }
}

interface ParsedJson {
  root: JsonNode;
  duplicates: Array<{ path: string; key: string; from: number; to: number }>;
}

const MAX_DEPTH = 512;

/** Parses JSON (RFC 8259) keeping each key's and value's position; throws {@link JsonSyntaxError}. */
function parseJsonWithPositions(text: string): ParsedJson {
  let pos = 0;
  const duplicates: ParsedJson['duplicates'] = [];
  // A UTF-8 byte order mark isn't JSON; JSON.parse rejects it too.
  const describe = (at: number): string => (at >= text.length ? 'end of text' : `'${text[at]}'`);
  const fail = (message: string, from = pos, to = Math.min(pos + 1, text.length)): never => {
    throw new JsonSyntaxError(message, from, Math.max(to, from));
  };
  const skipWhitespace = (): void => {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '\n' || text[pos] === '\r')) pos += 1;
  };
  const parseString = (): { value: string; from: number; to: number } => {
    const from = pos;
    pos += 1;
    let value = '';
    while (pos < text.length) {
      const ch = text[pos]!;
      if (ch === '"') {
        pos += 1;
        return { value, from, to: pos };
      }
      if (ch === '\\') {
        const next = text[pos + 1];
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (next !== undefined && next in simple) {
          value += simple[next];
          pos += 2;
        } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
          value += String.fromCharCode(parseInt(text.slice(pos + 2, pos + 6), 16));
          pos += 6;
        } else {
          fail('Invalid escape in a string.', pos, pos + 2);
        }
        continue;
      }
      if (ch < ' ') {
        fail(ch === '\n' ? 'A string can\'t span lines: close it with " or write \\n.' : 'Control characters must be escaped in a string.');
      }
      value += ch;
      pos += 1;
    }
    return fail('This string is never closed with ".', from, text.length);
  };
  const parseValue = (path: string, depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail('Nested too deeply.');
    skipWhitespace();
    const from = pos;
    const ch = text[pos];
    if (ch === '{') {
      pos += 1;
      const members: JsonMember[] = [];
      const seen = new Set<string>();
      skipWhitespace();
      if (text[pos] === '}') {
        pos += 1;
        return { from, to: pos, type: 'object', members };
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] !== '"') {
          fail(text[pos] === '}' ? 'Remove the comma before }: JSON has no trailing commas.' : `Expected a "quoted" property name, found ${describe(pos)}.`);
        }
        const key = parseString();
        skipWhitespace();
        if (text[pos] !== ':') fail(`Expected : after the property name, found ${describe(pos)}.`);
        pos += 1;
        const memberPath = path ? `${path}.${key.value}` : key.value;
        const value = parseValue(memberPath, depth + 1);
        if (seen.has(key.value)) {
          duplicates.push({ path: memberPath, key: key.value, from: key.from, to: key.to });
        }
        seen.add(key.value);
        members.push({ key: key.value, keyFrom: key.from, keyTo: key.to, value });
        skipWhitespace();
        if (text[pos] === ',') {
          pos += 1;
          continue;
        }
        if (text[pos] === '}') {
          pos += 1;
          return { from, to: pos, type: 'object', members };
        }
        fail(`Expected , or } after a property, found ${describe(pos)}.`);
      }
    }
    if (ch === '[') {
      pos += 1;
      const items: JsonNode[] = [];
      skipWhitespace();
      if (text[pos] === ']') {
        pos += 1;
        return { from, to: pos, type: 'array', items };
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] === ']') fail('Remove the comma before ]: JSON has no trailing commas.');
        items.push(parseValue(`${path}[${items.length}]`, depth + 1));
        skipWhitespace();
        if (text[pos] === ',') {
          pos += 1;
          continue;
        }
        if (text[pos] === ']') {
          pos += 1;
          return { from, to: pos, type: 'array', items };
        }
        fail(`Expected , or ] after an item, found ${describe(pos)}.`);
      }
    }
    if (ch === '"') {
      const string = parseString();
      return { from, to: string.to, type: 'string' };
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(pos, pos + 400));
    if (number && (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9'))) {
      pos += number[0].length;
      return { from, to: pos, type: 'number' };
    }
    for (const [word, type] of [['true', 'boolean'], ['false', 'boolean'], ['null', 'null']] as const) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return { from, to: pos, type };
      }
    }
    if (ch === "'") return fail('Use double quotes: JSON strings are written "like this".');
    return fail(pos >= text.length ? 'Expected a value, but the text ends here.' : `Expected a value, found ${describe(pos)}.`);
  };

  if (text.charCodeAt(0) === 0xfeff) fail('Remove the byte order mark at the start.', 0, 1);
  const root = parseValue('', 0);
  skipWhitespace();
  if (pos < text.length) fail(`Unexpected ${describe(pos)} after the end of the JSON value.`, pos, text.length);
  return { root, duplicates };
}

function member(node: JsonNode | undefined, key: string): JsonMember | undefined {
  // The last occurrence wins, as in JSON.parse (Section 6.4).
  return node?.members?.filter((m) => m.key === key).pop();
}

// --- Results ------------------------------------------------------------------------

function result(kind: MdzipJsonValidity['kind'], problems: MdzipJsonProblem[], extra: Partial<MdzipJsonValidity> = {}): MdzipJsonValidity {
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const warningCount = problems.filter((p) => p.severity === 'warning').length;
  return {
    kind,
    status: errorCount ? 'invalid' : warningCount ? 'warnings' : 'valid',
    problems,
    errorCount,
    warningCount,
    customFields: [],
    canSave: kind === 'json' || errorCount === 0,
    ...extra
  };
}

/**
 * Checks any JSON text: syntax errors (with where they are) and duplicate
 * property names. The file is saved as typed either way (`canSave` is `true`).
 */
export function validateMdzipJsonText(text: string): MdzipJsonValidity {
  let parsed: ParsedJson;
  try {
    parsed = parseJsonWithPositions(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return result('json', [{ severity: 'error', code: 'syntax', message: error.message, from: error.from, to: error.to }]);
    }
    throw error;
  }
  const problems: MdzipJsonProblem[] = parsed.duplicates.map((d) => ({
    severity: 'warning',
    code: 'duplicate',
    message: `"${d.key}" appears more than once in this object; readers use the last one.`,
    from: d.from,
    to: d.to
  }));
  return result('json', problems, { value: JSON.parse(text) });
}

/** Top-level fields defined by the spec (Section 6.2). */
const SPEC_FIELDS = new Set([
  'spec', 'mode', 'entryPoint', 'title', 'description', 'author', 'language', 'keywords',
  'license', 'version', 'created', 'modified', 'cover', 'producer'
]);

// What each descriptive field should look like, for its error message.
const DESCRIPTIVE_FIELD_HELP: Record<string, string> = {
  title: 'title must be text, and not empty.',
  description: 'description must be text, in quotes.',
  language: 'language must be text, a language tag like "en" or "fr-CA".',
  license: 'license must be text, like "MIT", "CC-BY-4.0" or a link.',
  version: 'version must be text, like "1.0.0".',
  keywords: 'keywords must be a list of text values, like ["birds", "field notes"].',
  author: 'author must be an object, like {"name": "Sam Lee"}.',
  producer: 'producer must be an object, like {"application": {"name": "…"}}.',
  created: 'created must be a date and time like "2026-01-31T09:00:00Z", or an object with "when".',
  modified: 'modified must be a date and time like "2026-01-31T09:00:00Z", or an object with "when".',
  cover: 'cover must be the path of a file in the archive, like "images/cover.png".'
};

const MARKDOWN_PATH = /\.(?:md|markdown)$/i;

const stripDotSlash = (path: string): string => (path.startsWith('./') ? path.slice(2) : path);

function coreMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // core-js messages start with their ERR_ code; the code is for logs, not people.
  return message.replace(/^ERR_[A-Z_]+:\s*/, '');
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Checks the text of an archive's `manifest.json` the way a consumer would
 * read it (Section 6.4), plus what a producer must not write (Section 14.1):
 *
 * - not JSON, not an object, or a property name used twice: error;
 * - a critical field (`spec`, `spec.version`, `mode`, `entryPoint`) with a
 *   wrong value, or an `entryPoint` that names no Markdown file in the
 *   archive: error, since it changes how the archive opens;
 * - a descriptive field (`title`, `language`, …) with a wrong type or value:
 *   error, since consumers would ignore it and producers must not write it;
 * - a `cover` that names no file in the archive: warning (the archive still opens);
 * - an edited `producer` or `spec.version`: warning;
 * - fields the spec doesn't define: never a problem, listed in `customFields`.
 */
export function validateMdzipManifestText(text: string, options: MdzipManifestValidationOptions = {}): MdzipJsonValidity {
  let parsed: ParsedJson;
  try {
    parsed = parseJsonWithPositions(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return result('manifest', [{
        severity: 'error',
        code: 'syntax',
        message: `Not valid JSON, so consumers can't read the manifest: ${error.message}`,
        from: error.from,
        to: error.to
      }]);
    }
    throw error;
  }
  const { root } = parsed;
  if (root.type !== 'object') {
    return result('manifest', [{ severity: 'error', code: 'syntax', message: 'The manifest must be a JSON object ({ … }).', from: root.from, to: root.to }]);
  }
  const value = JSON.parse(text) as Record<string, unknown>;
  const problems: MdzipJsonProblem[] = [];
  const at = (field: string): { from: number; to: number } => {
    const [top, sub] = field.split('.');
    const topMember = member(root, top!);
    const subMember = sub ? member(topMember?.value, sub) : undefined;
    const target = subMember ?? topMember;
    return target ? { from: target.keyFrom, to: target.value.to } : { from: root.from, to: Math.min(root.from + 1, root.to) };
  };
  const add = (severity: MdzipJsonProblemSeverity, field: string, message: string): void => {
    problems.push({ severity, code: 'field', message, field, ...at(field) });
  };

  for (const duplicate of parsed.duplicates) {
    problems.push({
      severity: 'error',
      code: 'duplicate',
      message: `"${duplicate.key}" appears more than once. A manifest must not repeat a property name; remove one.`,
      from: duplicate.from,
      to: duplicate.to,
      field: duplicate.path
    });
  }

  // Critical fields, one at a time so every problem shows, not just the first.
  for (const field of ['spec', 'mode', 'entryPoint'] as const) {
    if (!(field in value)) continue;
    try {
      checkManifest({ [field]: value[field] });
    } catch (error) {
      const located = field === 'spec' && typeof value.spec === 'object' && value.spec !== null && 'version' in value.spec
        ? 'spec.version'
        : field;
      add('error', located, `${capitalize(coreMessage(error))}.`.replace(/\.\.$/, '.'));
    }
  }
  const paths = options.archivePaths;
  const entryPoint = value.entryPoint;
  if (paths && typeof entryPoint === 'string' && !problems.some((p) => p.field === 'entryPoint')) {
    if (!paths.includes(stripDotSlash(entryPoint))) {
      add('error', 'entryPoint', `entryPoint names "${entryPoint}", which isn't in the archive (paths are case-sensitive). The archive would open a different document, or none.`);
    } else if (!MARKDOWN_PATH.test(entryPoint)) {
      add('error', 'entryPoint', `entryPoint must name a Markdown file; "${entryPoint}" isn't one.`);
    }
  }

  // Descriptive fields: wrong values are ignored by consumers, and producers must not write them.
  const descriptive = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'spec' && key !== 'mode' && key !== 'entryPoint'));
  for (const field of checkManifest(descriptive)) {
    add('error', field, `${DESCRIPTIVE_FIELD_HELP[field] ?? `${field} has the wrong type or format (see Section 6.2 of the spec).`} Consumers would ignore it; fix or remove it to save.`);
  }
  const cover = value.cover;
  if (paths && typeof cover === 'string' && !problems.some((p) => p.field === 'cover') && !paths.includes(stripDotSlash(cover))) {
    add('warning', 'cover', `cover names "${cover}", which isn't in the archive, so there's no cover image.`);
  }

  const stored = options.stored as Record<string, unknown> | null | undefined;
  if (stored) {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    if ('producer' in value && !same(value.producer, stored.producer)) {
      add('warning', 'producer', 'producer describes the tools that wrote the archive; tools normally set it themselves.');
    }
    const version = (manifest: Record<string, unknown>): unknown =>
      (typeof manifest.spec === 'object' && manifest.spec !== null ? (manifest.spec as Record<string, unknown>).version : undefined);
    if (version(value) !== undefined && !same(version(value), version(stored)) && !problems.some((p) => p.field === 'spec.version')) {
      add('warning', 'spec.version', 'spec.version is the spec version the archive follows; tools normally set it themselves.');
    }
  }

  problems.sort((a, b) => a.from - b.from);
  return result('manifest', problems, {
    value,
    customFields: Object.keys(value).filter((key) => !SPEC_FIELDS.has(key))
  });
}

/**
 * Sets one value in JSON text, leaving the rest of the text as it is: other
 * keys, their order and formatting, numbers and strings. `path` names the
 * member, `['title']` or `['author', 'name']`; objects on the way are added
 * when missing (or replace a value that isn't an object). The new member
 * goes after the object's last one, indented like its siblings. `undefined`
 * removes the member (and its comma). With a repeated key, the last one is
 * the one changed, as JSON readers use it.
 *
 * Returns `null` when the text isn't valid JSON or isn't an object.
 */
export function setMdzipJsonMember(text: string, path: readonly string[], value: unknown): string | null {
  let parsed: ParsedJson;
  try {
    parsed = parseJsonWithPositions(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) return null;
    throw error;
  }
  if (parsed.root.type !== 'object' || path.length === 0) return null;

  const lineIndent = (at: number): string => {
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    return /^[ \t]*/.exec(text.slice(lineStart))![0];
  };
  const serialize = (v: unknown, indent: string): string =>
    JSON.stringify(v, null, 2).replace(/\n/g, `\n${indent}`);
  const splice = (from: number, to: number, insert: string): string => text.slice(0, from) + insert + text.slice(to);

  // Walk down to the deepest existing object on the path.
  let node = parsed.root;
  let depth = 0;
  for (; depth < path.length - 1; depth += 1) {
    const next = member(node, path[depth]!);
    if (!next) break;
    if (next.value.type !== 'object') {
      // Replace a non-object on the way (e.g. `"author": "Kim"`) with the new object.
      if (value === undefined) return text;
      const nested = path.slice(depth + 1).reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
      return splice(next.value.from, next.value.to, serialize(nested, lineIndent(next.keyFrom)));
    }
    node = next.value;
  }

  const key = path[depth]!;
  const existing = depth === path.length - 1 ? member(node, key) : undefined;
  const members = node.members ?? [];

  if (value === undefined) {
    if (!existing) return text;
    const index = members.lastIndexOf(existing);
    if (members.length === 1) return splice(node.from + 1, node.to - 1, '');
    if (index > 0) return splice(members[index - 1]!.value.to, existing.value.to, '');
    return splice(existing.keyFrom, members[1]!.keyFrom, '');
  }

  if (existing) {
    return splice(existing.value.from, existing.value.to, serialize(value, lineIndent(existing.keyFrom)));
  }

  // Add the member, with any missing objects below it.
  const newValue = path.slice(depth + 1).reduceRight<unknown>((inner, k) => ({ [k]: inner }), value);
  if (members.length > 0) {
    const last = members[members.length - 1]!;
    const between = text.slice(members.length > 1 ? members[members.length - 2]!.value.to : node.from + 1, last.keyFrom);
    const multiline = between.includes('\n');
    const indent = multiline ? lineIndent(last.keyFrom) : '';
    const separator = multiline ? `,\n${indent}` : ', ';
    return splice(last.value.to, last.value.to, `${separator}${JSON.stringify(key)}: ${serialize(newValue, indent)}`);
  }
  const outer = lineIndent(node.from);
  const inner = `${outer}  `;
  return splice(node.from + 1, node.to - 1, `\n${inner}${JSON.stringify(key)}: ${serialize(newValue, inner)}\n${outer}`);
}

/**
 * Re-indents JSON text (2 spaces by default), changing only the whitespace
 * between tokens: keys, strings (escapes included) and numbers (`1.0`,
 * `1e3`, integers too large for a double) stay exactly as typed, in their
 * order, repeated keys too. An empty object or array stays `{}` / `[]`.
 * Returns `null` when the text isn't valid JSON, since there's nothing
 * reliable to indent.
 */
export function formatMdzipJsonText(text: string, indent = '  '): string | null {
  try {
    parseJsonWithPositions(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      return null;
    }
    throw error;
  }
  let out = '';
  let depth = 0;
  const newline = (): string => `\n${indent.repeat(depth)}`;
  const nextSignificant = (from: number): string | undefined => {
    for (let j = from; j < text.length; j += 1) {
      if (!/\s/.test(text[j]!)) return text[j];
    }
    return undefined;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      // Copy the string verbatim, escapes and all.
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      if (nextSignificant(i + 1) === close) {
        out += ch + close;
        i = text.indexOf(close, i + 1);
      } else {
        depth += 1;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      out += newline() + ch;
    } else if (ch === ',') {
      out += `,${newline()}`;
    } else if (ch === ':') {
      out += ': ';
    } else if (!/\s/.test(ch)) {
      out += ch;
    }
  }
  return /\n\s*$/.test(text) ? `${out}\n` : out;
}

/** Whether `path` is the archive's own manifest: `manifest.json` at the root (not one in a folder). */
export function isMdzipRootManifestPath(path: string): boolean {
  return path.toLowerCase() === 'manifest.json';
}

/** Whether `path` is a JSON entry the editor validates. */
export function isMdzipJsonPath(path: string): boolean {
  return /\.json$/i.test(path);
}

/** A one-line summary of a validity, as the editor's status chip shows it. */
export function describeMdzipJsonValidity(validity: MdzipJsonValidity): string {
  const noun = validity.kind === 'manifest' ? 'Manifest' : 'JSON';
  if (validity.status === 'invalid') {
    const first = validity.problems.find((p) => p.severity === 'error');
    const more = validity.errorCount > 1 ? ` (+${validity.errorCount - 1} more)` : '';
    return `${noun} error: ${first?.message ?? ''}${more}`;
  }
  if (validity.status === 'warnings') {
    return `${noun}: ${validity.warningCount} warning${validity.warningCount === 1 ? '' : 's'}`;
  }
  return validity.kind === 'manifest' ? 'Valid manifest' : 'Valid JSON';
}
