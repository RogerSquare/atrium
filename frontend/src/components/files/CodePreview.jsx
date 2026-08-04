// Syntax-highlighted file preview (ui-files-preview-001).
//
// Loaded LAZILY from FilesView (React.lazy) so the highlighter + grammars
// stay out of the main bundle — the plain <pre> renders as the Suspense
// fallback and for extensions with no registered grammar. PrismLight with a
// hand-picked grammar set keeps this chunk small; add languages here as the
// workspace grows.

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'

SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('docker', docker)
SyntaxHighlighter.registerLanguage('diff', diff) // PR patch view (feat-files-pr-diff-001)

// Line numbers + click-to-point (ui-files-tree-lines-001): `onLineClick`
// makes every line a target — FilesView highlights it and copies a
// `project/path:line` reference. Diff mode passes neither (hunks carry
// their own line semantics). wrapLongLines is off when numbers are on:
// wrapped lines would desync the gutter.
export default function CodePreview({ language, code, showLineNumbers = false, highlightedLine = null, onLineClick = null }) {
  return (
    <div data-testid="files-code-highlighted">
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        showLineNumbers={showLineNumbers}
        lineNumberStyle={{ minWidth: '2.4em', color: 'var(--text-tertiary)', userSelect: 'none' }}
        wrapLines={!!onLineClick}
        lineProps={onLineClick ? (n) => ({
          'data-line': n,
          onClick: () => onLineClick(n),
          style: {
            display: 'block',
            cursor: 'pointer',
            background: n === highlightedLine ? 'color-mix(in srgb, var(--apple-yellow) 14%, transparent)' : undefined,
          },
        }) : undefined}
        customStyle={{
          margin: 0,
          padding: 0,
          background: 'transparent',
          fontSize: 'var(--text-caption1)',
          lineHeight: 1.6,
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)', background: 'transparent' } }}
        wrapLongLines={!showLineNumbers}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
