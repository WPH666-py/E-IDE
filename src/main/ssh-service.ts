import { Client } from 'ssh2'

interface SSHConfig {
  username: string
  host: string
  password: string
  port: number
}

interface SSHConnection {
  client: Client
  sftp?: any
}

interface RemoteFileNode {
  name: string
  type: 'file' | 'directory'
  path: string
  size: number
  modified: number
  children?: RemoteFileNode[]
}

class SSHService {
  private connections: Map<string, SSHConnection> = new Map()

  async connect(config: SSHConfig): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const connectionId = this.generateConnectionId(config)

      this.disconnect(config)

      const client = new Client()

      client.on('ready', () => {
        this.connections.set(connectionId, { client })
        resolve({ success: true })
      })

      client.on('error', (err) => {
        resolve({
          success: false,
          error: `连接失败: ${err.message}`
        })
      })

      try {
        client.connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          readyTimeout: 10000
        })
      } catch (error) {
        resolve({
          success: false,
          error: `连接异常: ${error}`
        })
      }
    })
  }

  async readRemoteDir(config: SSHConfig, remotePath: string): Promise<{ success: boolean; nodes?: RemoteFileNode[]; error?: string }> {
    return new Promise(async (resolve) => {
      const connection = this.connections.get(this.generateConnectionId(config))
      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      try {
        const sftp = await this.getSFTP(connection)
        if (!sftp) {
          resolve({ success: false, error: '无法建立SFTP通道' })
          return
        }

        sftp.readdir(remotePath, (err: any, list: any[]) => {
          if (err) {
            resolve({ success: false, error: `读取目录失败: ${err.message}` })
            return
          }

          const nodes: RemoteFileNode[] = (list || [])
            .filter((f: any) => !f.filename.startsWith('.') && f.filename !== '..')
            .map((f: any) => ({
              name: f.filename,
              type: (f.longname && f.longname.startsWith('d')) ? ('directory' as const) : ('file' as const),
              path: remotePath.replace(/\/$/, '') + '/' + f.filename,
              size: f.attrs?.size || 0,
              modified: f.attrs?.mtime ? f.attrs.mtime * 1000 : 0
            }))
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
              return a.name.localeCompare(b.name)
            })

          resolve({ success: true, nodes })
        })
      } catch (error: any) {
        resolve({ success: false, error: `读取目录异常: ${error.message}` })
      }
    })
  }

  async readRemoteFile(config: SSHConfig, remotePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    return new Promise(async (resolve) => {
      const connection = this.connections.get(this.generateConnectionId(config))
      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      try {
        const sftp = await this.getSFTP(connection)
        if (!sftp) {
          resolve({ success: false, error: '无法建立SFTP通道' })
          return
        }

        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(remotePath)

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        readStream.on('error', (err: Error) => {
          resolve({ success: false, error: `读取文件失败: ${err.message}` })
        })

        readStream.on('end', () => {
          resolve({ success: true, content: Buffer.concat(chunks).toString('utf-8') })
        })
      } catch (error: any) {
        resolve({ success: false, error: `读取文件异常: ${error.message}` })
      }
    })
  }

  async writeRemoteFile(config: SSHConfig, remotePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    return new Promise(async (resolve) => {
      const connection = this.connections.get(this.generateConnectionId(config))
      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      try {
        const sftp = await this.getSFTP(connection)
        if (!sftp) {
          resolve({ success: false, error: '无法建立SFTP通道' })
          return
        }

        const { Readable } = await import('stream')
        const stream = Readable.from([content])
        const writeStream = sftp.createWriteStream(remotePath)

        stream.pipe(writeStream)

        writeStream.on('close', () => {
          resolve({ success: true })
        })

        writeStream.on('error', (err: Error) => {
          resolve({ success: false, error: `写入文件失败: ${err.message}` })
        })
      } catch (error: any) {
        resolve({ success: false, error: `写入文件异常: ${error.message}` })
      }
    })
  }

  async executeCommand(config: SSHConfig, command: string): Promise<{ success: boolean; output?: string; error?: string }> {
    return new Promise((resolve) => {
      const connectionId = this.generateConnectionId(config)
      const connection = this.connections.get(connectionId)

      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      connection.client.exec(command, (err, stream) => {
        if (err) {
          resolve({ success: false, error: `执行命令失败: ${err.message}` })
          return
        }

        let output = ''
        let errorOutput = ''

        stream.on('data', (data: Buffer) => {
          output += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString()
        })

        stream.on('close', (code: number) => {
          if (code === 0) {
            resolve({ success: true, output: output.trim() })
          } else {
            resolve({ success: false, error: errorOutput.trim() || `命令执行失败，退出码: ${code}` })
          }
        })
      })
    })
  }

  async uploadFile(config: SSHConfig, localPath: string, remotePath: string): Promise<{ success: boolean; error?: string }> {
    return new Promise(async (resolve) => {
      const connectionId = this.generateConnectionId(config)
      const connection = this.connections.get(connectionId)

      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      try {
        const fs = await import('fs')
        const sftp = await this.getSFTP(connection)

        if (!sftp) {
          resolve({ success: false, error: '无法建立SFTP连接' })
          return
        }

        const readStream = fs.createReadStream(localPath)
        const writeStream = sftp.createWriteStream(remotePath)

        readStream.pipe(writeStream)

        writeStream.on('close', () => {
          resolve({ success: true })
        })

        writeStream.on('error', (err: Error) => {
          resolve({ success: false, error: `上传失败: ${err.message}` })
        })
      } catch (error) {
        resolve({ success: false, error: `上传异常: ${error}` })
      }
    })
  }

  async downloadFile(config: SSHConfig, remotePath: string, localPath: string): Promise<{ success: boolean; error?: string }> {
    return new Promise(async (resolve) => {
      const connectionId = this.generateConnectionId(config)
      const connection = this.connections.get(connectionId)

      if (!connection) {
        resolve({ success: false, error: '请先建立SSH连接' })
        return
      }

      try {
        const fs = await import('fs')
        const sftp = await this.getSFTP(connection)

        if (!sftp) {
          resolve({ success: false, error: '无法建立SFTP连接' })
          return
        }

        const readStream = sftp.createReadStream(remotePath)
        const writeStream = fs.createWriteStream(localPath)

        readStream.pipe(writeStream)

        writeStream.on('close', () => {
          resolve({ success: true })
        })

        writeStream.on('error', (err: Error) => {
          resolve({ success: false, error: `下载失败: ${err.message}` })
        })
      } catch (error) {
        resolve({ success: false, error: `下载异常: ${error}` })
      }
    })
  }

  async disconnect(config: SSHConfig): Promise<void> {
    const connectionId = this.generateConnectionId(config)
    const connection = this.connections.get(connectionId)

    if (connection) {
      try { connection.client.end() } catch {}
      this.connections.delete(connectionId)
    }
  }

  private generateConnectionId(config: SSHConfig): string {
    return `${config.username}@${config.host}:${config.port}`
  }

  private getSFTP(connection: SSHConnection): Promise<any> {
    return new Promise((resolve) => {
      if (connection.sftp) {
        resolve(connection.sftp)
        return
      }

      connection.client.sftp((err, sftp) => {
        if (err) {
          resolve(null)
          return
        }

        connection.sftp = sftp
        resolve(sftp)
      })
    })
  }

  async detectRemoteRuntimes(config: SSHConfig, homeDir: string): Promise<any[]> {
    const runtimes: any[] = []
    const defs: { id: string; displayName: string; cmds: string[]; versionCmd: string }[] = [
      { id: 'python', displayName: 'Python', cmds: ['python3', 'python'], versionCmd: '--version' },
      { id: 'node', displayName: 'Node.js', cmds: ['node'], versionCmd: '--version' },
      { id: 'java', displayName: 'Java', cmds: ['java'], versionCmd: '-version' },
      { id: 'gcc', displayName: 'GCC (C/C++)', cmds: ['gcc'], versionCmd: '--version' },
      { id: 'php', displayName: 'PHP', cmds: ['php'], versionCmd: '--version' },
      { id: 'go', displayName: 'Go', cmds: ['go'], versionCmd: 'version' },
      { id: 'cargo', displayName: 'Rust / Cargo', cmds: ['cargo'], versionCmd: '--version' },
      { id: 'r', displayName: 'R 语言', cmds: ['R', 'Rscript'], versionCmd: '--version' },
      { id: 'dotnet', displayName: '.NET / C#', cmds: ['dotnet'], versionCmd: '--version' },
      { id: 'bash', displayName: 'Bash', cmds: ['bash'], versionCmd: '--version' },
      { id: 'perl', displayName: 'Perl', cmds: ['perl'], versionCmd: '--version' },
      { id: 'ruby', displayName: 'Ruby', cmds: ['ruby'], versionCmd: '--version' }
    ]

    for (const def of defs) {
      for (const cmd of def.cmds) {
        const r = await this.executeCommand(config, `command -v ${cmd} 2>/dev/null || which ${cmd} 2>/dev/null`)
        if (r.success && r.output) {
          const exePath = r.output.trim()
          const ver = await this.executeCommand(config, `${exePath} ${def.versionCmd} 2>&1 | head -1`)
          let version = ''
          if (ver.success && ver.output) {
            version = ver.output.trim().substring(0, 50)
          }
          runtimes.push({
            id: def.id, name: def.id, displayName: def.displayName,
            exeNames: [cmd], paths: [exePath], version
          })
          break
        }
      }
    }

    const npmR = await this.executeCommand(config, 'command -v npm 2>/dev/null && npm ls -g --depth=0 2>/dev/null | head -20')
    if (npmR.success && npmR.output) {
      const pkgs = ['vue/cli', 'angular/cli', 'create-react-app', 'vite', 'typescript', 'ts-node']
      for (const pkg of pkgs) {
        if (npmR.output.includes(pkg) || npmR.output.includes(pkg.replace('/', '-'))) {
          runtimes.push({
            id: pkg.replace(/^@/, '').replace('/', '-'), name: pkg, displayName: pkg,
            exeNames: [pkg.split('/').pop()!], paths: [], version: 'npm global'
          })
        }
      }
    }

    return runtimes
  }

  async scanRemoteRunnables(config: SSHConfig, projectPath: string, runtimes: any[]): Promise<any[]> {
    const exts: Record<string, string> = {
      py: 'python', pyw: 'python', js: 'node', mjs: 'node', cjs: 'node',
      ts: 'node', tsx: 'node', jsx: 'node', java: 'java',
      c: 'gcc', cpp: 'gcc', cc: 'gcc', cxx: 'gcc', h: 'gcc', hpp: 'gcc',
      php: 'php', phtml: 'php', go: 'go', rs: 'cargo', r: 'r', R: 'r',
      cs: 'dotnet', csproj: 'dotnet', sh: 'bash', pl: 'perl', rb: 'ruby',
      html: 'browser', htm: 'browser', xhtml: 'browser'
    }
    const result: any[] = []
    await this.scanRemoteDir(config, projectPath, projectPath, exts, runtimes, result, 0)
    result.sort((a, b) => {
      if (a.packageType !== b.packageType) {
        const order = ['web', 'package', 'script']
        return order.indexOf(a.packageType) - order.indexOf(b.packageType)
      }
      return a.relativePath.localeCompare(b.relativePath)
    })
    return result
  }

  private async scanRemoteDir(
    config: SSHConfig, dir: string, projectPath: string,
    exts: Record<string, string>, runtimes: any[], result: any[], depth: number
  ): Promise<void> {
    if (result.length >= 60 || depth > 4) return
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '__pycache__', 'vendor', 'target', '.next'])
    const r = await this.readRemoteDir(config, dir)
    if (!r.success || !r.nodes) return

    for (const node of r.nodes) {
      if (result.length >= 60) return
      if (skipDirs.has(node.name)) continue
      if (node.type === 'directory') {
        await this.scanRemoteDir(config, node.path, projectPath, exts, runtimes, result, depth + 1)
      } else {
        const ext = (node.name.split('.').pop() || '').toLowerCase()
        const runtimeId = exts[ext]
        if (!runtimeId) continue

        const relPath = node.path.replace(projectPath + '/', '').replace(projectPath, '')
        if (runtimeId === 'browser') {
          result.push({
            path: node.path, name: node.name, relativePath: relPath,
            type: 'HTML', runtime: 'browser', runtimePath: '',
            runtimeDisplay: '浏览器预览', packageType: 'web', isWeb: true
          })
          continue
        }

        const rt = runtimes.find((r: any) => r.id === runtimeId)
        if (!rt) continue

        const typeName: Record<string, string> = {
          python: 'Python', node: 'Node.js', java: 'Java', gcc: 'C/C++',
          php: 'PHP', go: 'Go', cargo: 'Rust', r: 'R', dotnet: '.NET',
          bash: 'Shell', perl: 'Perl', ruby: 'Ruby'
        }

        result.push({
          path: node.path, name: node.name, relativePath: relPath,
          type: typeName[runtimeId] || ext.toUpperCase(),
          runtime: runtimeId,
          runtimePath: rt.paths?.[0] || rt.name,
          runtimeDisplay: rt.displayName + (rt.version ? ` (${rt.version})` : ''),
          packageType: 'script', isWeb: false
        })
      }
    }
  }

  getConnections(): string[] {
    return Array.from(this.connections.keys())
  }

  isConnected(config: SSHConfig): boolean {
    const connectionId = this.generateConnectionId(config)
    return this.connections.has(connectionId)
  }
}

export { SSHService, type SSHConfig, type RemoteFileNode }
