import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJS } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'

const ROOT = process.cwd()

const JS_GLOBS = [
  'src',
  'electron'
]
const GO_GLOBS = [
  'pool-server-go/cmd',
  'pool-server-go/internal'
]

const EXCLUDE_FILES = new Set([
  'pool-server-go/poolserver'
])

function listFiles(dir, predicate) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const curr = stack.pop()
    if (!fs.existsSync(curr)) continue
    const entries = fs.readdirSync(curr, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(curr, e.name)
      const rel = path.relative(ROOT, p)
      if (EXCLUDE_FILES.has(rel)) continue
      if (e.isDirectory()) stack.push(p)
      else if (predicate(p)) out.push(p)
    }
  }
  out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  return out
}

function getIndent(line = '') {
  const m = line.match(/^\s*/)
  return m ? m[0] : ''
}

function hasCommentBeforeLine(lines, lineNo) {
  let j = lineNo - 2
  while (j >= 0 && lines[j].trim() === '') j--
  if (j < 0) return false
  const t = lines[j].trim()
  return t.startsWith('//') || t.startsWith('/*') || t.endsWith('*/')
}

function mkJSComment(indent, name, kind) {
  const noun = kind === 'class' ? '类' : '方法'
  return `${indent}/**\n${indent} * ${name} ${noun}：中文注释，便于团队快速理解该段逻辑。\n${indent} */`
}

function safeNameFromKey(keyNode) {
  if (!keyNode) return ''
  if (keyNode.type === 'Identifier') return keyNode.name
  if (keyNode.type === 'StringLiteral') return keyNode.value
  if (keyNode.type === 'NumericLiteral') return String(keyNode.value)
  return ''
}

function parseJsAst(content) {
  return parseJS(content, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    ranges: false,
    plugins: [
      'jsx',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'dynamicImport',
      'optionalChaining',
      'nullishCoalescingOperator',
      'objectRestSpread',
      'topLevelAwait',
      'numericSeparator',
      'logicalAssignment',
      'privateIn'
    ]
  })
}

function collectTargets(ast, lineOffset = 0) {
  const targets = []

  function visit(node, parent, state) {
    if (!node || typeof node !== 'object') return

    let nextState = state

    if (node.type === 'Program') {
      nextState = { ...state, topLevel: true }
    }

    if (node.type === 'ClassDeclaration' && node.id?.name && node.loc?.start?.line) {
      targets.push({
        line: node.loc.start.line + lineOffset,
        name: node.id.name,
        kind: 'class'
      })
    }

    if (node.type === 'FunctionDeclaration' && node.id?.name && node.loc?.start?.line) {
      targets.push({
        line: node.loc.start.line + lineOffset,
        name: node.id.name,
        kind: 'function'
      })
    }

    if (node.type === 'VariableDeclaration' && node.loc?.start?.line) {
      // 仅处理顶层声明，避免给短生命周期回调过度加注释。
      const isTopLevel = parent?.type === 'Program' || parent?.type === 'ExportNamedDeclaration'
      if (isTopLevel) {
        for (const decl of node.declarations || []) {
          if (decl?.id?.type !== 'Identifier') continue
          const initType = decl?.init?.type || ''
          if (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression') {
            targets.push({
              line: node.loc.start.line + lineOffset,
              name: decl.id.name,
              kind: 'function'
            })
            break
          }
        }
      }
    }

    if ((node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') && node.loc?.start?.line) {
      const name = node.type === 'ClassPrivateMethod'
        ? (node.key?.id?.name || node.key?.name || 'privateMethod')
        : safeNameFromKey(node.key) || 'method'
      targets.push({
        line: node.loc.start.line + lineOffset,
        name,
        kind: 'method'
      })
    }

    if (node.type === 'ObjectMethod' && node.loc?.start?.line) {
      // 仅对顶层对象方法加注释（如 preload 暴露 API）。
      const isLikelyTopLevelObjectMethod = parent?.type === 'ObjectExpression' && (state.functionDepth || 0) === 0
      if (isLikelyTopLevelObjectMethod) {
        const name = safeNameFromKey(node.key) || 'objectMethod'
        targets.push({
          line: node.loc.start.line + lineOffset,
          name,
          kind: 'method'
        })
      }
    }

    const childState = {
      ...nextState,
      functionDepth: (state.functionDepth || 0) + (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'ClassMethod' ||
        node.type === 'ClassPrivateMethod' ||
        node.type === 'ObjectMethod'
          ? 1
          : 0
      )
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const v = node[key]
      if (!v) continue
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && item.type) visit(item, node, childState)
        }
      } else if (v && typeof v === 'object' && v.type) {
        visit(v, node, childState)
      }
    }
  }

  visit(ast.program || ast, null, { functionDepth: 0, topLevel: true })
  return targets
}

function applyInsertionsToLines(lines, insertions) {
  const sorted = [...insertions]
    .filter(x => Number.isFinite(x.line) && x.line >= 1)
    .sort((a, b) => b.line - a.line)

  for (const it of sorted) {
    const idx = Math.max(0, Math.min(lines.length, it.line - 1))
    lines.splice(idx, 0, it.text)
  }
  return lines
}

function dedupeTargets(targets) {
  const byLine = new Map()
  for (const t of targets) {
    if (!t?.line || !t?.name) continue
    if (!byLine.has(t.line)) byLine.set(t.line, t)
  }
  return [...byLine.values()]
}

function processJSFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)
  let targets = []

  if (filePath.endsWith('.vue')) {
    const sfc = parseSFC(raw, { filename: filePath })
    const blocks = []
    if (sfc?.descriptor?.script) blocks.push(sfc.descriptor.script)
    if (sfc?.descriptor?.scriptSetup) blocks.push(sfc.descriptor.scriptSetup)

    for (const block of blocks) {
      if (!block?.content) continue
      const ast = parseJsAst(block.content)
      const offset = (block.loc?.start?.line || 1) - 1
      const sub = collectTargets(ast, offset)
      targets.push(...sub)
    }
  } else {
    const ast = parseJsAst(raw)
    targets = collectTargets(ast, 0)
  }

  targets = dedupeTargets(targets)

  const insertions = []
  for (const t of targets) {
    const lineNo = t.line
    if (lineNo < 1 || lineNo > lines.length) continue
    if (hasCommentBeforeLine(lines, lineNo)) continue
    const indent = getIndent(lines[lineNo - 1])
    insertions.push({ line: lineNo, text: mkJSComment(indent, t.name, t.kind) })
  }

  if (insertions.length === 0) return 0

  const nextLines = applyInsertionsToLines(lines, insertions)
  fs.writeFileSync(filePath, nextLines.join('\n'))
  return insertions.length
}

function mkGoComment(name) {
  return `// ${name} 方法：中文注释，便于团队快速理解该段逻辑。`
}

function processGoFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const insertions = []

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    const m = t.match(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/)
    if (!m) continue
    const name = m[1]
    const lineNo = i + 1
    if (hasCommentBeforeLine(lines, lineNo)) continue
    const indent = getIndent(lines[i])
    insertions.push({ line: lineNo, text: `${indent}${mkGoComment(name)}` })
  }

  if (insertions.length === 0) return 0
  const nextLines = applyInsertionsToLines(lines, insertions)
  fs.writeFileSync(filePath, nextLines.join('\n'))
  return insertions.length
}

let total = 0
const changed = []

for (const base of JS_GLOBS) {
  const files = listFiles(path.join(ROOT, base), p => p.endsWith('.js') || p.endsWith('.vue'))
  for (const f of files) {
    const n = processJSFile(f)
    if (n > 0) {
      total += n
      changed.push(`${path.relative(ROOT, f)} (+${n})`)
    }
  }
}

for (const base of GO_GLOBS) {
  const files = listFiles(path.join(ROOT, base), p => p.endsWith('.go'))
  for (const f of files) {
    const n = processGoFile(f)
    if (n > 0) {
      total += n
      changed.push(`${path.relative(ROOT, f)} (+${n})`)
    }
  }
}

for (const row of changed) console.log(row)
console.log(`TOTAL_INSERTED=${total}`)
