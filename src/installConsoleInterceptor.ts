type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    return stringifyJson({
      name: value.name,
      message: value.message,
      stack: value.stack,
    })
  }
  return stringifyJson(value)
}

function stringifyJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
      return v
    })
  } catch (_err) {
    return String(value)
  }
}

function normalizeFile(file: string): string {
  try {
    const url = new URL(file)
    return `${url.pathname}${url.search ? '' : ''}`
  } catch (_err) {
    return file.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
  }
}

function isConsoleWrapperFn(fn: string, level: ConsoleLevel): boolean {
  return (
    fn === `Object.${level}`
    || fn === `console.${level}`
    || fn === level
    || fn === 'anonymous'
  )
}

function parseStackLine(line: string, level: ConsoleLevel) {
  const trimmed = line.trim()
  const match = trimmed.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/)
  if (!match) return null

  const fn = match[1] || ''
  return {
    fn: isConsoleWrapperFn(fn, level) ? '' : fn,
    file: normalizeFile(match[2]),
    line: match[3],
    column: match[4],
  }
}

function parseCaller(stack: string | undefined, level: ConsoleLevel) {
  const lines = (stack || '').split('\n').slice(1)
  const parsed = lines
    .filter(line =>
      !line.includes('installConsoleInterceptor')
      && !line.includes('/node_modules/')
    )
    .map(line => parseStackLine(line, level))
    .filter(Boolean) as Array<{ fn: string; file: string; line: string; column: string }>

  const caller = parsed.find(item => item.fn) || parsed[0]
  return caller || { fn: '', file: 'unknown', line: '', column: '' }
}

export function installConsoleInterceptor() {
  if (!import.meta.env.DEV) return
  if ((window as any).__consoleInterceptorInstalled) return
  ;(window as any).__consoleInterceptorInstalled = true

  for (const level of LEVELS) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const caller = parseCaller(new Error().stack, level)
      const location = `[${caller.file}:${caller.line}:${caller.column}]`
      const fn = caller.fn ? ` [${caller.fn}]` : ''
      original(`${location}${fn}`, ...args.map(stringifyArg))
    }
  }

  console.info('[console-interceptor] installed')
}
