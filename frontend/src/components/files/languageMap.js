// Extension → Prism grammar name (ui-files-preview-001). Deliberately a
// separate tiny module: FilesView imports THIS statically to decide whether
// a file gets the lazy highlighter at all — importing anything from
// CodePreview.jsx would pull the whole highlighter chunk into the main
// bundle. Keep in sync with CodePreview's registerLanguage calls.

export const LANGUAGE_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript', mts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  css: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  sh: 'bash', bash: 'bash',
  py: 'python',
  yml: 'yaml', yaml: 'yaml',
  sql: 'sql',
  dockerfile: 'docker',
}

export function languageForPath(p) {
  const name = String(p || '').split('/').pop().toLowerCase()
  if (name === 'dockerfile') return 'docker'
  const ext = name.includes('.') ? name.split('.').pop() : ''
  return LANGUAGE_BY_EXT[ext] || null
}
