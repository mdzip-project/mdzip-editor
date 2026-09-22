import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * `highlight.js`'s default entry point (`import hljs from 'highlight.js'`)
 * registers every bundled language grammar at import time — a meaningful
 * chunk of the webview bundle (#45). This registers `highlight.js/lib/core`
 * with only the languages `DEFAULT_CODE_BLOCK_LANGUAGES` (view.ts) offers in
 * the code-block-language picker, plus `xml`/`tsx` for fence-info spellings
 * that don't match a toolbar id 1:1. A fenced code block naming a language
 * outside this set renders as plain, unhighlighted code (both call sites
 * already guard with `hljs.getLanguage(language)` before highlighting) —
 * same as today's behavior for a made-up language name, just now also true
 * for real but uncurated languages.
 */
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
// highlight.js has no distinct tsx grammar; the typescript grammar handles
// JSX/TSX well enough in practice, and DEFAULT_CODE_BLOCK_LANGUAGES offers
// 'tsx' as its own toolbar entry (view.ts), so it needs its own registration
// key rather than relying on 'typescript' aliasing to it.
hljs.registerLanguage('tsx', typescript);
// highlight.js's HTML grammar lives under the 'xml' module; register it
// under both keys since fenced blocks are written as both ```html and ```xml.
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

export default hljs;
