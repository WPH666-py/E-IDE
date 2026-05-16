import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative, basename } from 'path'
import { spawn, execSync } from 'child_process'
import { shell } from 'electron'

interface RunnableFile {
  path: string
  name: string
  relativePath: string
  type: string
  runtime: string
  runtimePath: string
  runtimeDisplay: string
  packageType: string
  isWeb: boolean
}

interface DetectedRuntime {
  id: string
  name: string
  displayName: string
  exeNames: string[]
  paths: string[]
  version: string
}

interface RunResult {
  success: boolean
  output?: string
  error?: string
}

export class RunService {
  private DWN_DIR = join(__dirname, '..', 'dwn_software_plugin', 'installed')

  async detectRuntimes(): Promise<DetectedRuntime[]> {
    const runtimes: DetectedRuntime[] = []

    const dwnPaths = await this.scanInstalledDir()
    const sysPaths = await this.scanSystemPaths()

    const defs: Omit<DetectedRuntime, 'paths' | 'version'>[] = [
      { id: 'python', name: 'python', displayName: 'Python', exeNames: ['python.exe', 'python3.exe'] },
      { id: 'node', name: 'node', displayName: 'Node.js', exeNames: ['node.exe'] },
      { id: 'java', name: 'java', displayName: 'Java', exeNames: ['java.exe'] },
      { id: 'gcc', name: 'gcc', displayName: 'GCC (C/C++)', exeNames: ['gcc.exe', 'g++.exe'] },
      { id: 'php', name: 'php', displayName: 'PHP', exeNames: ['php.exe'] },
      { id: 'go', name: 'go', displayName: 'Go', exeNames: ['go.exe'] },
      { id: 'cargo', name: 'cargo', displayName: 'Rust / Cargo', exeNames: ['cargo.exe', 'rustc.exe'] },
      { id: 'r', name: 'R', displayName: 'R 语言', exeNames: ['R.exe', 'Rscript.exe'] },
      { id: 'matlab', name: 'matlab', displayName: 'MATLAB', exeNames: ['matlab.exe'] },
      { id: 'dotnet', name: 'dotnet', displayName: '.NET / C#', exeNames: ['dotnet.exe'] },
      { id: 'git', name: 'git', displayName: 'Git Bash', exeNames: ['bash.exe'] }
    ]

    for (const def of defs) {
      const paths: string[] = []
      for (const exeName of def.exeNames) {
        const fp = this.findExe(exeName, dwnPaths, sysPaths)
        if (fp) { paths.push(fp) }
      }
      if (paths.length > 0) {
        let version = ''
        try { version = execSync(`"${paths[0]}" --version 2>&1 || "${paths[0]}" -v 2>&1 || "${paths[0]}" version 2>&1`, { timeout: 5000, encoding: 'utf-8', windowsHide: true }).split('\n')[0].trim().substring(0, 60) } catch {}
        runtimes.push({ ...def, paths: [...new Set(paths)], version })
      }
    }

    this.detectNpm(runtimes)
    return runtimes
  }

  private detectNpm(runtimes: DetectedRuntime[]): void {
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const ls = execSync(`${npmCmd} ls -g --depth=0 2>&1`, { timeout: 5000, encoding: 'utf-8', windowsHide: true })
      const pkgs = ['@vue/cli', '@angular/cli', 'create-react-app', 'vite', 'typescript', 'ts-node', 'eslint', 'nodemon']
      for (const pkg of pkgs) {
        if (ls.includes(pkg)) {
          runtimes.push({
            id: pkg.replace(/^@/, '').replace('/', '-'), name: pkg, displayName: pkg,
            exeNames: [pkg.split('/').pop()! + '.cmd'], paths: [], version: 'npm global'
          })
        }
      }
    } catch {}
  }

  private async scanInstalledDir(): Promise<string[]> {
    const paths: string[] = []
    await this.walkDir(this.DWN_DIR, paths, 4)
    return paths
  }

  private async scanSystemPaths(): Promise<string[]> {
    const paths: string[] = []
    const systemDirs = [
      'C:\\Python312', 'C:\\Python313', 'C:\\Python311', 'C:\\Python310',
      'C:\\Program Files\\Python312', 'C:\\Program Files\\Python313',
      'C:\\Program Files\\nodejs',
      'C:\\Program Files\\Java\\jdk-21', 'C:\\Program Files\\Java\\jdk-17',
      'C:\\Program Files\\Java\\jdk-11', 'C:\\Program Files\\Java\\jdk-8',
      'C:\\Program Files (x86)\\Java',
      'C:\\php', 'C:\\Program Files\\php',
      'C:\\Go', 'C:\\Program Files\\Go',
      'C:\\R', 'C:\\Program Files\\R',
      'C:\\Program Files\\MATLAB',
      'C:\\Program Files\\dotnet',
      'C:\\Program Files\\Git\\bin',
      'C:\\mingw64\\bin', 'C:\\MinGW\\bin',
      'C:\\Program Files\\CMake\\bin',
      'C:\\msys64\\mingw64\\bin', 'C:\\msys64\\usr\\bin',
      'D:\\mingw64\\bin', 'D:\\MinGW\\bin',
      'C:\\Users\\' + (process.env.USERNAME || '') + '\\anaconda3',
      'C:\\Users\\' + (process.env.USERNAME || '') + '\\Anaconda3',
      'C:\\ProgramData\\anaconda3', 'C:\\ProgramData\\Anaconda3',
      'C:\\Anaconda3',
      process.env.USERPROFILE + '\\anaconda3',
      process.env.USERPROFILE + '\\Anaconda3',
      process.env.LOCALAPPDATA + '\\Programs\\Python',
      process.env.APPDATA + '\\npm',
      process.env.USERPROFILE + '\\.cargo\\bin',
      process.env.USERPROFILE + '\\go\\bin',
    ].filter(d => existsSync(d))

    for (const dir of systemDirs) {
      paths.push(dir)
      await this.walkDir(dir, paths, 1)
    }

    const pathEnv = process.env.PATH || ''
    for (const segment of pathEnv.split(';')) {
      if (segment && existsSync(segment.trim())) {
        paths.push(segment.trim())
      }
    }

    return [...new Set(paths)]
  }

  private findExe(exeName: string, dwnPaths: string[], sysPaths: string[]): string | null {
    for (const dir of [...dwnPaths, ...sysPaths]) {
      const fp = join(dir, exeName)
      if (existsSync(fp)) return fp
    }
    try {
      const result = execSync(`where ${exeName} 2>nul`, { timeout: 3000, encoding: 'utf-8', windowsHide: true }).trim()
      if (result) return result.split('\n')[0].trim()
    } catch {}
    return null
  }

  private async walkDir(dir: string, paths: string[], maxDepth: number, depth = 0): Promise<void> {
    if (depth > maxDepth || !existsSync(dir)) return
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          paths.push(full)
          await this.walkDir(full, paths, maxDepth, depth + 1)
        }
      }
      if (paths.indexOf(dir) === -1) paths.push(dir)
    } catch {}
  }

  async scanProjectRunnables(projectPath: string, runtimes: DetectedRuntime[]): Promise<RunnableFile[]> {
    const result: RunnableFile[] = []
    await this.scanDir(projectPath, projectPath, runtimes, result)
    result.sort((a, b) => {
      if (a.packageType !== b.packageType) {
        const order = ['web', 'package', 'script']
        return order.indexOf(a.packageType) - order.indexOf(b.packageType)
      }
      return a.relativePath.localeCompare(b.relativePath)
    })
    return result
  }

  private async scanDir(dir: string, projectPath: string, runtimes: DetectedRuntime[], result: RunnableFile[]): Promise<void> {
    if (result.length >= 60) return
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '__pycache__', 'vendor', 'target', '.next', 'dwn_software_plugin'])
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (result.length >= 60) return
        if (entry.name.startsWith('.') || skipDirs.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await this.scanDir(full, projectPath, runtimes, result)
        } else {
          const runnable = this.classifyFile(full, projectPath, runtimes)
          if (runnable) result.push(runnable)
        }
      }
    } catch {}
  }

  private classifyFile(filePath: string, projectPath: string, runtimes: DetectedRuntime[]): RunnableFile | null {
    const name = basename(filePath)
    const relPath = relative(projectPath, filePath)
    const ext = (name.split('.').pop() || '').toLowerCase()

    const webExts = ['html', 'htm', 'xhtml']
    if (webExts.includes(ext)) {
      const rt = runtimes.find(r => r.id === 'browser') || {
        id: 'browser', name: 'browser', displayName: '浏览器', exeNames: [], paths: [], version: ''
      }
      return {
        path: filePath, name, relativePath: relPath, type: 'web',
        runtime: 'browser', runtimePath: '', runtimeDisplay: '浏览器预览',
        packageType: 'web', isWeb: true
      }
    }

    const typeMap: Record<string, { runtimeId: string; type: string }> = {
      py: { runtimeId: 'python', type: 'Python' },
      pyw: { runtimeId: 'python', type: 'Python' },
      js: { runtimeId: 'node', type: 'JavaScript' },
      mjs: { runtimeId: 'node', type: 'ES Module' },
      cjs: { runtimeId: 'node', type: 'CommonJS' },
      ts: { runtimeId: 'node', type: 'TypeScript' },
      tsx: { runtimeId: 'node', type: 'TSX' },
      jsx: { runtimeId: 'node', type: 'JSX' },
      java: { runtimeId: 'java', type: 'Java' },
      c: { runtimeId: 'gcc', type: 'C' },
      cpp: { runtimeId: 'gcc', type: 'C++' },
      cc: { runtimeId: 'gcc', type: 'C++' },
      cxx: { runtimeId: 'gcc', type: 'C++' },
      h: { runtimeId: 'gcc', type: 'C Header' },
      hpp: { runtimeId: 'gcc', type: 'C++ Header' },
      php: { runtimeId: 'php', type: 'PHP' },
      phtml: { runtimeId: 'php', type: 'PHP' },
      go: { runtimeId: 'go', type: 'Go' },
      rs: { runtimeId: 'cargo', type: 'Rust' },
      r: { runtimeId: 'r', type: 'R' },
      R: { runtimeId: 'r', type: 'R' },
      m: { runtimeId: 'matlab', type: 'MATLAB' },
      cs: { runtimeId: 'dotnet', type: 'C#' },
      csproj: { runtimeId: 'dotnet', type: 'C# Project' },
      bat: { runtimeId: 'cmd', type: 'Batch' },
      cmd: { runtimeId: 'cmd', type: 'Batch' },
      sh: { runtimeId: 'git', type: 'Shell' },
      ps1: { runtimeId: 'powershell', type: 'PowerShell' },
      sql: { runtimeId: 'sql', type: 'SQL' }
    }

    const info = typeMap[ext]
    if (!info) return null

    if (info.runtimeId === 'cmd' || info.runtimeId === 'powershell' || info.runtimeId === 'sql') {
      return {
        path: filePath, name, relativePath: relPath, type: info.type,
        runtime: info.runtimeId, runtimePath: info.runtimeId, runtimeDisplay: info.type,
        packageType: 'script', isWeb: false
      }
    }

    const runtime = runtimes.find(r => r.id === info.runtimeId)
    if (!runtime) return null

    return {
      path: filePath, name, relativePath: relPath, type: info.type,
      runtime: info.runtimeId,
      runtimePath: runtime.paths[0] || runtime.name,
      runtimeDisplay: runtime.displayName + (runtime.version ? ` (${runtime.version})` : ''),
      packageType: 'script',
      isWeb: false
    }
  }

  async runFile(filePath: string, runtime: string, runtimePath: string, cwd: string): Promise<RunResult> {
    const ext = (filePath.split('.').pop() || '').toLowerCase()

    const config: Record<string, { exe: string; args: string[]; needShell?: boolean }> = {
      python: { exe: runtimePath, args: [`"${filePath}"`] },
      node: { exe: runtimePath, args: [`"${filePath}"`] },
      java: { exe: runtimePath, args: ['-cp', `"${cwd}"`, basename(filePath).replace('.java', '')] },
      gcc: {
        exe: runtimePath,
        args: [`"${filePath}"`, '-o', `"${join(cwd, 'a.out')}"`, '&&', `"${join(cwd, 'a.out')}"`],
        needShell: true
      },
      php: { exe: runtimePath, args: [`"${filePath}"`] },
      go: { exe: runtimePath, args: ['run', `"${filePath}"`] },
      cargo: { exe: runtimePath, args: ['run', '--manifest-path', `"${filePath}"`] },
      r: { exe: runtimePath, args: ['--no-save', '--no-restore', '-e', `source("${filePath.replace(/\\/g, '\\\\')}")`] },
      matlab: { exe: runtimePath, args: ['-nosplash', '-nodesktop', '-r', `run("${filePath.replace(/\\/g, '\\\\')}")`] },
      dotnet: { exe: runtimePath, args: ['run', '--project', cwd] },
      cmd: { exe: 'cmd.exe', args: ['/c', `"${filePath}"`] },
      powershell: { exe: 'powershell.exe', args: ['-ExecutionPolicy', 'Bypass', '-File', `"${filePath}"`] },
      git: { exe: 'bash.exe', args: [`"${filePath}"`] },
      sql: { exe: 'sqlcmd', args: ['-i', `"${filePath}"`] }
    }

    const cfg = config[runtime]
    if (!cfg) {
      if (runtime === 'custom') {
        return new Promise((resolve) => {
          const child = spawn(runtimePath, [`"${filePath}"`], {
            cwd,
            stdio: 'pipe',
            shell: true,
            env: { ...process.env }
          })
          let output = ''
          child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
          child.stderr?.on('data', (d: Buffer) => { output += d.toString() })
          const timer = setTimeout(() => {
            child.kill()
            resolve({ success: true, output: output || '(运行超时已终止)' })
          }, 60000)
          child.on('error', (err: Error) => {
            clearTimeout(timer)
            resolve({ success: false, error: `启动失败: ${err.message}` })
          })
          child.on('close', (code: number) => {
            clearTimeout(timer)
            resolve({ success: code === 0, output: output || `执行完成 (exit: ${code})` })
          })
        })
      }
      return { success: false, error: `不支持的运行时: ${runtime}` }
    }

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32'
      const child = spawn(cfg.exe, cfg.args, {
        cwd,
        stdio: 'pipe',
        shell: cfg.needShell ? true : isWin,
        env: { ...process.env }
      })

      let output = ''
      child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      const timer = setTimeout(() => {
        child.kill()
        resolve({ success: true, output: output || '(运行超时已终止)' })
      }, 60000)

      child.on('error', (err: Error) => {
        clearTimeout(timer)
        resolve({ success: false, error: `启动失败: ${err.message}` })
      })

      child.on('close', (code: number) => {
        clearTimeout(timer)
        resolve({ success: code === 0, output: output || `执行完成 (exit: ${code})` })
      })
    })
  }

  openInBrowser(filePath: string, browser?: string): void {
    const browserUrls: Record<string, string> = {
      edge: `microsoft-edge:file:///${filePath.replace(/\\/g, '/')}`,
      chrome: `google-chrome:file:///${filePath.replace(/\\/g, '/')}`,
      quark: `quark:file:///${filePath.replace(/\\/g, '/')}`
    }

    const browserPaths: Record<string, string[]> = {
      edge: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ],
      chrome: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
      ],
      quark: [
        process.env.LOCALAPPDATA + '\\Quark\\Application\\quark.exe',
        'C:\\Program Files\\Quark\\quark.exe'
      ]
    }

    const b = browser || 'edge'
    if (b === 'quark') {
      shell.openExternal('https://www.quarkbrowser.com/')
      return
    }

    const candidates = browserPaths[b] || []
    let exePath = ''
    for (const p of candidates) {
      if (existsSync(p)) { exePath = p; break }
    }

    if (exePath) {
      spawn(exePath, [`file:///${filePath.replace(/\\/g, '/')}`], {
        detached: true, stdio: 'ignore'
      }).unref()
    } else {
      shell.openExternal(`file:///${filePath.replace(/\\/g, '/')}`)
    }
  }
}
