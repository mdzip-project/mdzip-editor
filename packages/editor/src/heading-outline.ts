/*
 * Heading outline: a table of contents built from rendered Markdown's
 * headings, which highlights the section being read and jumps to a section
 * on click. Framework-free, with no dependency on the rest of the editor, so
 * any page can use it (mdzip.org's spec page started it as heading-outline.js).
 *
 * Markup (style it with these classes; nothing is styled inline):
 *
 *   nav.mdz-outline > p.mdz-outline-title + ol.mdz-outline-list
 *     > li.mdz-outline-item[data-level] > a.mdz-outline-link + ol…
 *
 * The current link gets `.is-current` and `aria-current="location"`; the
 * items above it in the tree get `.is-open`. With `collapse`, the nav gets
 * `.is-collapsible`. The editor's style sheet only uses `--mdz-outline-*`
 * variables for colors, so themes can restyle it.
 */
import { slugifyMdzipHeading } from '@mdzip/renderer';

export interface MdzipOutlineHeading {
  id: string;
  text: string;
  /** 1 to 6. */
  level: number;
  /** The heading element, when it's in the DOM. */
  element: HTMLElement | null;
}

export interface MdzipOutlineCollectOptions {
  /** Heading levels to list. Default `[2, 3]`. */
  levels?: readonly number[];
}

export interface MdzipHeadingOutlineOptions extends MdzipOutlineCollectOptions {
  /** Element holding the rendered Markdown. */
  content: HTMLElement;
  /** Element the outline is rendered into. */
  container: HTMLElement;
  /** Accessible name and visible title. Default "On this page". */
  label?: string;
  /** Show the visible title. Default `true`. */
  showTitle?: boolean;
  /** Show deeper levels only under the current section, so a long document's outline stays short. Default `true`. */
  collapse?: boolean;
  /** The element that scrolls the content, when it isn't the window (an editor's preview pane, say). */
  scrollContainer?: HTMLElement | null;
  /** Pixels from the top of the scroll area where a heading counts as reached. Default 96. */
  offset?: number;
  /**
   * Called on click. Call `event.preventDefault()` to scroll some other way
   * (for a heading whose element isn't in the DOM yet, say).
   */
  onNavigate?: (heading: MdzipOutlineHeading, event: MouseEvent) => void;
  /**
   * Where the headings come from. Default: {@link collectMdzipOutlineHeadings}
   * over `content`. Supply it when some headings aren't in the DOM, such as a
   * long document rendered in parts; give those `element: null`.
   */
  headings?: () => MdzipOutlineHeading[];
  /**
   * Finds a heading's element when `element` is `null` or no longer in the
   * document. Headings are in document order, so the first one without an
   * element ends the search for the current section.
   */
  findElement?: (heading: MdzipOutlineHeading) => HTMLElement | null;
}

export interface MdzipHeadingOutline {
  /** The headings listed, in document order. */
  readonly headings: MdzipOutlineHeading[];
  /** The heading marked current, or `null`. */
  readonly current: MdzipOutlineHeading | null;
  /** Rebuilds the outline, after the content changed. */
  refresh(): void;
  /** Marks the current section again, after the content moved without scrolling. */
  update(): void;
  /** Removes the outline and its listeners. */
  destroy(): void;
}

/**
 * The headings in `root` at the given levels, in document order. A heading
 * without an id gets one (its slug, numbered `-1`, `-2` when taken), so it
 * can be linked to. Enough for an app that draws its own outline.
 */
export function collectMdzipOutlineHeadings(
  root: ParentNode,
  options: MdzipOutlineCollectOptions = {}
): MdzipOutlineHeading[] {
  const levels = options.levels ?? [2, 3];
  if (!levels.length) return [];
  const selector = levels.map((level) => `h${level}`).join(',');
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const headings: MdzipOutlineHeading[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!element.id) {
      const base = slugifyMdzipHeading(text) || 'section';
      let id = base;
      for (let n = 1; doc.getElementById(id); n += 1) id = `${base}-${n}`;
      element.id = id;
    }
    headings.push({ id: element.id, text, level: Number(element.tagName[1]), element });
  }
  return headings;
}

/** Renders an outline into `options.container` and keeps the current section marked. */
export function createMdzipHeadingOutline(options: MdzipHeadingOutlineOptions): MdzipHeadingOutline {
  const { content, container } = options;
  if (!content || !container) throw new Error('A heading outline needs content and container elements.');
  const label = options.label ?? 'On this page';
  const collapse = options.collapse !== false;
  const offset = options.offset ?? 96;
  const scroller = options.scrollContainer ?? null;
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const scrollTarget: HTMLElement | Window = scroller ?? win;

  let headings: MdzipOutlineHeading[] = [];
  let links = new Map<string, HTMLAnchorElement>();
  let current: MdzipOutlineHeading | null = null;
  let frame = 0;
  let destroyed = false;

  const elementOf = (heading: MdzipOutlineHeading): HTMLElement | null => {
    if (heading.element?.isConnected) return heading.element;
    heading.element = options.findElement?.(heading) ?? null;
    return heading.element;
  };

  function render(): void {
    headings = options.headings ? options.headings() : collectMdzipOutlineHeadings(content, options);
    links = new Map();
    current = null;
    container.textContent = '';
    if (!headings.length) {
      container.hidden = true;
      return;
    }
    const nav = doc.createElement('nav');
    nav.className = 'mdz-outline';
    nav.setAttribute('aria-label', label);
    if (collapse) nav.classList.add('is-collapsible');
    if (options.showTitle !== false) {
      const title = doc.createElement('p');
      title.className = 'mdz-outline-title';
      title.textContent = label;
      nav.append(title);
    }
    const top = doc.createElement('ol');
    top.className = 'mdz-outline-list';
    nav.append(top);

    // Nest by level: each item opens a sublist for deeper headings.
    const stack: Array<{ level: number; list: HTMLOListElement; item: HTMLLIElement | null }> = [{ level: 0, list: top, item: null }];
    for (const heading of headings) {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= heading.level) stack.pop();
      const parent = stack[stack.length - 1]!;
      let list = parent.list;
      if (parent.item) {
        let sublist = parent.item.querySelector<HTMLOListElement>(':scope > ol');
        if (!sublist) {
          sublist = doc.createElement('ol');
          sublist.className = 'mdz-outline-list';
          parent.item.append(sublist);
        }
        list = sublist;
      }
      const item = doc.createElement('li');
      item.className = 'mdz-outline-item';
      item.dataset['level'] = String(heading.level);
      const link = doc.createElement('a');
      link.className = 'mdz-outline-link';
      // The document's own URL plus the anchor, not a bare "#id": a <base>
      // element would otherwise send the link to another page.
      try {
        const target = new URL(doc.URL);
        target.hash = encodeURIComponent(heading.id);
        link.href = target.href;
      } catch {
        link.href = `#${encodeURIComponent(heading.id)}`;
      }
      link.textContent = heading.text;
      link.addEventListener('click', (event) => {
        options.onNavigate?.(heading, event);
        if (!event.defaultPrevented) {
          const element = elementOf(heading);
          if (scroller || !element) {
            // The page's own anchor jump would scroll the window, not the pane.
            event.preventDefault();
            element?.scrollIntoView({ block: 'start' });
          }
        }
        setCurrent(heading);
      });
      item.append(link);
      list.append(item);
      links.set(heading.id, link);
      stack.push({ level: heading.level, list, item });
    }
    container.append(nav);
    container.hidden = false;
    update();
  }

  function setCurrent(heading: MdzipOutlineHeading | null): void {
    if (heading === current) return;
    container.querySelectorAll('.is-current, .is-open').forEach((node) => {
      node.classList.remove('is-current', 'is-open');
      node.removeAttribute('aria-current');
    });
    current = heading;
    const link = heading ? links.get(heading.id) : undefined;
    if (!link) return;
    link.classList.add('is-current');
    link.setAttribute('aria-current', 'location');
    for (let node = link.parentElement; node && node !== container; node = node.parentElement) {
      if (node.classList.contains('mdz-outline-item')) node.classList.add('is-open');
    }
    // Keep the current link visible when the outline itself scrolls.
    if (container.scrollHeight > container.clientHeight) {
      const box = container.getBoundingClientRect();
      const at = link.getBoundingClientRect();
      if (at.top < box.top || at.bottom > box.bottom) {
        container.scrollTop += at.top - box.top - box.height / 3;
      }
    }
  }

  // The current section is the last heading above the reading line.
  function update(): void {
    frame = 0;
    if (destroyed) return;
    const line = (scroller ? scroller.getBoundingClientRect().top : 0) + offset;
    let found: MdzipOutlineHeading | null = null;
    for (const heading of headings) {
      const element = elementOf(heading);
      if (!element || element.getBoundingClientRect().top > line) break;
      found = heading;
    }
    setCurrent(found ?? headings[0] ?? null);
  }

  function onScroll(): void {
    if (!frame) frame = win.requestAnimationFrame(update);
  }

  scrollTarget.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll, { passive: true });
  render();

  return {
    get headings() { return headings.slice(); },
    get current() { return current; },
    refresh: render,
    update,
    destroy() {
      destroyed = true;
      scrollTarget.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', onScroll);
      if (frame) win.cancelAnimationFrame(frame);
      container.textContent = '';
      container.hidden = true;
    }
  };
}
