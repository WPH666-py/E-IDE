import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers, drawSelection, highlightSpecialChars, rectangularSelection } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, indentUnit, LanguageSupport } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap, lintGutter, Diagnostic, openLintPanel, setDiagnostics } from '@codemirror/lint'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { html } from '@codemirror/lang-html'
import { cpp } from '@codemirror/lang-cpp'
import { php } from '@codemirror/lang-php'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'

const langMap: Record<string, () => LanguageSupport> = {
  js: javascript, jsx: () => javascript({ jsx: true }), mjs: javascript, cjs: javascript,
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ jsx: true, typescript: true }),
  py: python, pyw: python,
  java: java,
  html: html, htm: html, xhtml: html,
  c: cpp, cpp: cpp, cc: cpp, cxx: cpp, h: cpp, hpp: cpp,
  php: php, phtml: php,
  rs: rust,
  go: go,
  css: css, scss: css, less: css,
  json: json,
  md: markdown, markdown: markdown,
  sql: sql,
  xml: xml, svg: xml, yaml: xml, yml: xml, toml: xml,
  sh: () => javascript({ typescript: true }),
  bash: () => javascript({ typescript: true }),
  bat: () => javascript({ typescript: true }),
  cmd: () => javascript({ typescript: true }),
  ps1: () => javascript({ typescript: true }),
  rb: () => javascript({ typescript: true }),
  r: () => javascript({ typescript: true }),
  m: () => javascript({ typescript: true }),
  lua: () => javascript({ typescript: true }),
  pl: () => javascript({ typescript: true })
}

export function getLangForFile(filePath: string): LanguageSupport | null {
  const ext = (filePath.split('.').pop() || 'txt').toLowerCase()
  const factory = langMap[ext]
  if (factory) return factory()
  return null
}

const languageCompartment = new Compartment()

let cmEditorView: EditorView | null = null

export function getCMView(): EditorView | null {
  return cmEditorView
}

export function initEditor(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      highlightSpecialChars(),
      rectangularSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      lintGutter(),
      languageCompartment.of([]),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab
      ])
    ]
  })

  const view = new EditorView({
    state,
    parent
  })

  cmEditorView = view
  return view
}

export function setEditorLang(view: EditorView, filePath: string) {
  const lang = getLangForFile(filePath)
  view.dispatch({
    effects: languageCompartment.reconfigure(lang ? lang : [])
  })
}

export function setEditorContent(view: EditorView, content: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content }
  })
}

export function getEditorContent(view: EditorView): string {
  return view.state.doc.toString()
}

export function showDiagnostics(view: EditorView, diags: Diagnostic[]) {
  view.dispatch(setDiagnostics(view.state, diags))
}

export function clearDiagnostics(view: EditorView) {
  view.dispatch(setDiagnostics(view.state, []))
}

export function openDiagnosticsPanel(view: EditorView) {
  openLintPanel(view)
}
