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

export default function CodePreview({ language, code }) {
  return (
    <div data-testid="files-code-highlighted">
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: 0,
          background: 'transparent',
          fontSize: 'var(--text-caption1)',
          lineHeight: 1.6,
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)', background: 'transparent' } }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
