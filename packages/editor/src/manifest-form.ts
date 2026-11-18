// The manifest as a form (the View layout of manifest.json): the friendly
// way to edit an archive's title, description, author and so on, beside the
// JSON editor (Edit) and with it (Split). The JSON text stays the single
// source of truth: the form shows the parsed text, and each change sets one
// value in the text (setMdzipJsonMember), so key order, custom fields and
// formatting are kept, and both views share validation and undo.
import { describeMdzipJsonValidity, type MdzipJsonProblem, type MdzipJsonValidity } from './json-validation.js';

export interface MdzipManifestFormOptions {
  /** `false` shows the values without letting them be changed. */
  editable: boolean;
  /** The archive's Markdown files, offered for the entry point. */
  markdownPaths: readonly string[];
  /** Sets one value (`undefined` removes it): `['title']`, `['author', 'name']`. */
  onChange: (path: readonly string[], value: unknown) => void;
  /** Opens the JSON editor (Edit layout). */
  onEditJson: () => void;
}

type FieldKind = 'text' | 'textarea' | 'keywords' | 'select';

interface FieldSpec {
  path: readonly string[];
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  inputType?: string;
  options?: () => Array<{ value: string; label: string }>;
}

const DETAIL_LABELS: Array<[string, string]> = [
  ['spec.version', 'Spec version'],
  ['created', 'Created'],
  ['modified', 'Modified'],
  ['cover', 'Cover image'],
  ['producer', 'Made with']
];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function valueAt(root: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    node = asRecord(node)?.[key];
  }
  return node;
}

function displayDate(value: unknown): string {
  const when = typeof value === 'string' ? value : asRecord(value)?.when;
  if (typeof when !== 'string') return '';
  const date = new Date(when);
  return Number.isNaN(date.getTime()) ? when : date.toLocaleString();
}

function displayProducer(value: unknown): string {
  const producer = asRecord(value);
  if (!producer) return '';
  return ['application', 'core']
    .map((part) => asRecord(producer[part]))
    .filter((part): part is Record<string, unknown> => !!part && typeof part.name === 'string')
    .map((part) => (typeof part.version === 'string' ? `${String(part.name)} ${part.version}` : String(part.name)))
    .join(', ');
}

export class MdzipManifestForm {
  public readonly root: HTMLElement;
  private readonly doc: Document;
  private readonly options: MdzipManifestFormOptions;
  private readonly summary: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly body: HTMLElement;
  private readonly details: HTMLDListElement;
  private readonly custom: HTMLElement;
  private readonly controls = new Map<string, { input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; error: HTMLElement; spec: FieldSpec }>();
  private value: Record<string, unknown> = {};

  public constructor(doc: Document, options: MdzipManifestFormOptions) {
    this.doc = doc;
    this.options = options;
    this.root = this.el('form', 'mdzip-manifest-form');
    this.root.setAttribute('aria-label', 'Document properties');
    this.root.addEventListener('submit', (event) => event.preventDefault());

    const header = this.el('div', 'mmf-header');
    const heading = this.el('h2', 'mmf-title');
    heading.textContent = 'Document properties';
    const editJson = this.button('Edit as JSON', () => this.options.onEditJson());
    editJson.classList.add('mmf-link');
    header.append(heading, editJson);
    this.summary = this.el('p', 'mmf-summary');
    this.summary.setAttribute('role', 'status');
    this.notice = this.el('div', 'mmf-notice');
    this.notice.hidden = true;
    this.body = this.el('div', 'mmf-body');
    this.root.append(header, this.summary, this.notice, this.body);

    this.section('Basics', [
      { path: ['title'], label: 'Title', kind: 'text', hint: 'Shown instead of the file name. Leave empty to use the first heading.' },
      { path: ['description'], label: 'Description', kind: 'textarea', hint: 'A sentence or two about the document.' },
      { path: ['author', 'name'], label: 'Author', kind: 'text' },
      { path: ['author', 'email'], label: 'Author email', kind: 'text', inputType: 'email' },
      { path: ['author', 'url'], label: 'Author website', kind: 'text', inputType: 'url', placeholder: 'https://' },
      { path: ['keywords'], label: 'Keywords', kind: 'keywords', hint: 'Separate with commas.' }
    ]);
    this.section('Publishing', [
      { path: ['language'], label: 'Language', kind: 'text', placeholder: 'en', hint: 'A language tag, like en, fr-CA or pt-BR.' },
      { path: ['license'], label: 'License', kind: 'text', placeholder: 'CC-BY-4.0', hint: 'A license name, like MIT or CC-BY-4.0, or a link to the license.' },
      { path: ['version'], label: 'Document version', kind: 'text', placeholder: '1.0.0' }
    ]);
    const advanced = this.doc.createElement('details');
    advanced.className = 'mmf-section mmf-advanced';
    const advancedSummary = this.doc.createElement('summary');
    advancedSummary.textContent = 'Advanced';
    advanced.append(advancedSummary);
    this.body.append(advanced);
    this.fields(advanced, [
      {
        path: ['entryPoint'], label: 'Opens with', kind: 'select',
        hint: 'The Markdown file shown first when the archive opens.',
        options: () => this.entryPointOptions()
      },
      {
        path: ['mode'], label: 'Kind of archive', kind: 'select',
        hint: 'One document (possibly split across files), or a collection of separate documents.',
        options: () => [
          { value: 'document', label: 'Document' },
          { value: 'project', label: 'Project (a collection of documents)' }
        ]
      }
    ]);

    const detailsSection = this.el('section', 'mmf-section');
    const detailsHeading = this.el('h3', 'mmf-section-title');
    detailsHeading.textContent = 'Details';
    this.details = this.doc.createElement('dl');
    this.details.className = 'mmf-details';
    this.custom = this.el('div', 'mmf-custom');
    detailsSection.append(detailsHeading, this.details, this.custom);
    this.body.append(detailsSection);
  }

  /** Shows `text` (the manifest as typed) and its validity. Fields being edited are left alone. */
  public update(validity: MdzipJsonValidity): void {
    const unreadable = validity.problems.find((p) => p.severity === 'error' && (p.code === 'syntax' || p.code === 'duplicate'));
    this.summary.textContent = validity.canSave
      ? describeMdzipJsonValidity(validity)
      : `${describeMdzipJsonValidity(validity)} Saving is blocked until it's fixed.`;
    this.summary.dataset.status = validity.status;
    this.notice.replaceChildren();
    this.notice.hidden = !unreadable;
    this.body.hidden = !!unreadable;
    if (unreadable) {
      const message = this.el('p', '');
      message.textContent = unreadable.code === 'duplicate'
        ? 'The manifest repeats a property name, so the form can\'t tell which value to show.'
        : 'The manifest isn\'t valid JSON right now, so the form can\'t show it.';
      this.notice.append(message, this.button('Fix in JSON', () => this.options.onEditJson()));
      return;
    }
    this.value = asRecord(validity.value) ?? {};
    const active = this.doc.activeElement;
    for (const [key, { input, error, spec }] of this.controls) {
      if (spec.kind === 'select' && spec.options) {
        this.fillSelect(input as HTMLSelectElement, spec);
      }
      if (input !== active) {
        input.value = this.displayValue(spec);
      }
      const problems = validity.problems.filter((p) => this.problemField(p) === key);
      error.textContent = problems.map((p) => p.message).join(' ');
      error.hidden = problems.length === 0;
      error.dataset.severity = problems.some((p) => p.severity === 'error') ? 'error' : 'warning';
      input.setAttribute('aria-invalid', String(problems.some((p) => p.severity === 'error')));
    }
    this.renderDetails(validity);
  }

  /** Draws attention to the summary, as when saving was refused. */
  public flash(): void {
    this.summary.classList.remove('flash');
    void this.summary.offsetWidth;
    this.summary.classList.add('flash');
  }

  // A problem with `author` (the object) shows under the Author field.
  private problemField(problem: MdzipJsonProblem): string | undefined {
    if (!problem.field) return undefined;
    if (this.controls.has(problem.field)) return problem.field;
    const top = problem.field.split('.')[0]!;
    if (top === 'author') return 'author.name';
    return this.controls.has(top) ? top : undefined;
  }

  private displayValue(spec: FieldSpec): string {
    const value = valueAt(this.value, spec.path);
    if (spec.kind === 'keywords') {
      if (value === undefined) return '';
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(', ') : JSON.stringify(value);
    }
    if (spec.kind === 'select' && spec.path[0] === 'mode' && value === undefined) {
      return 'document';
    }
    if (value === undefined) return '';
    // A value of the wrong type shows as written, so the problem is visible.
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private entryPointOptions(): Array<{ value: string; label: string }> {
    const current = this.value.entryPoint;
    const paths = [...this.options.markdownPaths];
    if (typeof current === 'string' && !paths.includes(current)) paths.unshift(current);
    return paths.map((path) => ({ value: path, label: path }));
  }

  private fillSelect(select: HTMLSelectElement, spec: FieldSpec): void {
    const options = spec.options!();
    const signature = options.map((o) => `${o.value}\u0000${o.label}`).join('\u0001');
    if (select.dataset.options === signature) return;
    select.dataset.options = signature;
    select.replaceChildren(...options.map((o) => {
      const option = this.doc.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      return option;
    }));
  }

  private section(title: string, specs: FieldSpec[]): void {
    const section = this.el('section', 'mmf-section');
    const heading = this.el('h3', 'mmf-section-title');
    heading.textContent = title;
    section.append(heading);
    this.fields(section, specs);
    this.body.append(section);
  }

  private fields(parent: HTMLElement, specs: FieldSpec[]): void {
    for (const spec of specs) {
      const key = spec.path.join('.');
      const id = `mmf-${key.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
      const field = this.el('div', 'mmf-field');
      const label = this.doc.createElement('label');
      label.htmlFor = id;
      this.labelWithKey(label, spec.label, spec.path.join('.'));
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (spec.kind === 'textarea') {
        input = this.doc.createElement('textarea');
        input.rows = 3;
      } else if (spec.kind === 'select') {
        input = this.doc.createElement('select');
      } else {
        input = this.doc.createElement('input');
        input.type = spec.inputType ?? 'text';
        input.spellcheck = spec.path[0] === 'title' || spec.path[0] === 'keywords';
      }
      input.id = id;
      input.name = key;
      if (spec.placeholder && spec.kind !== 'select') (input as HTMLInputElement).placeholder = spec.placeholder;
      input.disabled = !this.options.editable;
      const error = this.el('p', 'mmf-error');
      error.id = `${id}-error`;
      error.hidden = true;
      const describedBy = [error.id];
      field.append(label, input);
      if (spec.hint) {
        const hint = this.el('p', 'mmf-hint');
        hint.id = `${id}-hint`;
        hint.textContent = spec.hint;
        field.append(hint);
        describedBy.unshift(hint.id);
      }
      input.setAttribute('aria-describedby', describedBy.join(' '));
      field.append(error);
      parent.append(field);
      input.addEventListener(spec.kind === 'select' ? 'change' : 'input', () => this.commit(spec, input.value));
      this.controls.set(key, { input, error, spec });
    }
  }

  private commit(spec: FieldSpec, raw: string): void {
    let value: unknown;
    if (spec.kind === 'keywords') {
      const words = raw.split(',').map((w) => w.trim()).filter(Boolean);
      value = words.length ? words : undefined;
    } else {
      // An empty field removes the property (an empty title isn't allowed).
      value = raw.trim() === '' ? undefined : raw;
    }
    if (spec.path[0] === 'author' && value === undefined) {
      // Clearing the last author field removes `author` rather than leaving `{}`.
      const author = asRecord(this.value.author) ?? {};
      const others = Object.keys(author).filter((key) => key !== spec.path[1]);
      if (others.length === 0) {
        this.options.onChange(['author'], undefined);
        return;
      }
    }
    this.options.onChange(spec.path, value);
  }

  private renderDetails(validity: MdzipJsonValidity): void {
    const rows: Array<[string, string, string]> = [];
    for (const [path, label] of DETAIL_LABELS) {
      const value = valueAt(this.value, path.split('.'));
      const text = path === 'created' || path === 'modified'
        ? displayDate(value)
        : path === 'producer' ? displayProducer(value) : typeof value === 'string' ? value : '';
      if (text) rows.push([label, text, path]);
    }
    this.details.replaceChildren(...rows.flatMap(([label, text, path]) => {
      const dt = this.doc.createElement('dt');
      this.labelWithKey(dt, label, path);
      const dd = this.doc.createElement('dd');
      dd.textContent = text;
      return [dt, dd];
    }));
    this.custom.replaceChildren();
    if (validity.customFields.length) {
      const note = this.el('p', 'mmf-hint');
      note.textContent = `Other fields, kept as they are: ${validity.customFields.join(', ')}. `;
      const edit = this.button('Edit in JSON', () => this.options.onEditJson());
      edit.classList.add('mmf-link');
      note.append(edit);
      this.custom.append(note);
    }
  }

  // "Opens with (entryPoint)": the friendly name, then the manifest's own
  // name for it when that's different, so the form and the JSON line up.
  private labelWithKey(target: HTMLElement, label: string, key: string): void {
    target.textContent = label;
    if (label.toLowerCase() === key.toLowerCase()) {
      return;
    }
    const code = this.doc.createElement('code');
    code.className = 'mmf-key';
    code.textContent = key;
    target.append(' (', code, ')');
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }
}
