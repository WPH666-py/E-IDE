import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { mkdir, readdir, stat, readFile, writeFile, rename, rm } from 'fs/promises'
import { TerminalService } from './terminal-service'
import { DownloadService, SOFTWARE_REGISTRY, DownloadProgress } from './download-service'
import { AIService, type CLIContext } from './ai-service'
import { RunService } from './run-service'
import { SSHService } from './ssh-service'
import { GitService } from './git-service'

class EIDE {
  private mainWindow: BrowserWindow | null = null
  private terminalService = new TerminalService()
  private downloadService = new DownloadService()
  private aiService = new AIService()
  private runService = new RunService()
  private sshService = new SSHService()
  private gitService = new GitService()

  constructor() {
    this.setupApp()
  }

  private setupApp(): void {
    app.whenReady().then(() => {
      this.createMainWindow()
      this.setupIPC()
      this.createMenu()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow()
      }
    })
  }

  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'preload.js')
      },
      titleBarStyle: 'default',
      backgroundColor: '#ffffff'
    })

    const isDev = process.env.NODE_ENV === 'development'

    if (isDev) {
      this.mainWindow.loadURL('http://localhost:3020')
      this.mainWindow.webContents.openDevTools()
    } else {
      this.mainWindow.loadFile(join(__dirname, 'renderer/index.html'))
    }
  }

  private setupIPC(): void {
    ipcMain.handle('dialog:selectDirectory', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openDirectory']
      })
      if (result.canceled) {
        return { canceled: true, path: '' }
      }
      return { canceled: false, path: result.filePaths[0] }
    })

    ipcMain.handle('dialog:selectExe', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openFile'],
        filters: [
          { name: '可执行文件', extensions: ['exe', 'cmd', 'bat', 'com', 'msi'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled) {
        return { canceled: true, path: '' }
      }
      return { canceled: false, path: result.filePaths[0] }
    })

    ipcMain.handle('project:create', async (_event, name: string, basePath: string) => {
      try {
        const projectPath = join(basePath, name)
        await mkdir(projectPath, { recursive: true })
        await mkdir(join(projectPath, 'src'), { recursive: true })
        const pkgJson = JSON.stringify({
          name,
          version: '1.0.0',
          description: '',
          main: 'src/index.ts',
          scripts: {},
          dependencies: {}
        }, null, 2)
        await writeFile(join(projectPath, 'package.json'), pkgJson, 'utf-8')
        await writeFile(join(projectPath, 'src/index.ts'), '', 'utf-8')
        return { success: true, path: projectPath }
      } catch (error) {
        return { success: false, error: `创建项目失败: ${error}` }
      }
    })

    ipcMain.handle('project:open', async (_event, path: string) => {
      try {
        const s = await stat(path)
        if (!s.isDirectory()) {
          return { success: false, error: '路径不是目录' }
        }
        return { success: true, path }
      } catch (error) {
        return { success: false, error: `打开项目失败: ${error}` }
      }
    })

    ipcMain.handle('project:close', async () => {
      return { success: true }
    })

    ipcMain.handle('file:read', async (_event, filePath: string) => {
      try {
        return await readFile(filePath, 'utf-8')
      } catch (error) {
        throw new Error(`读取文件失败: ${error}`)
      }
    })

    ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
      try {
        await writeFile(filePath, content, 'utf-8')
        return true
      } catch (error) {
        throw new Error(`写入文件失败: ${error}`)
      }
    })

    ipcMain.handle('file:create-dir', async (_event, dirPath: string) => {
      try {
        await mkdir(dirPath, { recursive: true })
        return { success: true }
      } catch (error) {
        return { success: false, error: `创建文件夹失败: ${error}` }
      }
    })

    ipcMain.handle('file:rename', async (_event, oldPath: string, newPath: string) => {
      try {
        await rename(oldPath, newPath)
        return { success: true }
      } catch (error) {
        return { success: false, error: `重命名失败: ${error}` }
      }
    })

    ipcMain.handle('file:delete', async (_event, targetPath: string) => {
      try {
        await rm(targetPath, { recursive: true, force: true })
        return { success: true }
      } catch (error) {
        return { success: false, error: `删除失败: ${error}` }
      }
    })

    ipcMain.handle('dir:read', async (_event, dirPath: string) => {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true })
        const nodes = entries
          .filter(entry => !entry.name.startsWith('.'))
          .map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            path: join(dirPath, entry.name)
          }))
        nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        return { success: true, nodes }
      } catch (error) {
        return { success: false, error: `读取目录失败: ${error}` }
      }
    })

    ipcMain.handle('ssh:connect', async (_event, config: any) => {
      return this.sshService.connect(config)
    })

    ipcMain.handle('ssh:disconnect', async (_event, config: any) => {
      await this.sshService.disconnect(config)
      return { success: true }
    })

    ipcMain.handle('ssh:read-dir', async (_event, config: any, remotePath: string) => {
      return this.sshService.readRemoteDir(config, remotePath)
    })

    ipcMain.handle('ssh:read-file', async (_event, config: any, remotePath: string) => {
      return this.sshService.readRemoteFile(config, remotePath)
    })

    ipcMain.handle('ssh:write-file', async (_event, config: any, remotePath: string, content: string) => {
      return this.sshService.writeRemoteFile(config, remotePath, content)
    })

    ipcMain.handle('ssh:detect-runtimes', async (_event, config: any, homeDir: string) => {
      try {
        return this.sshService.detectRemoteRuntimes(config, homeDir)
      } catch (err: any) {
        return []
      }
    })

    ipcMain.handle('ssh:scan-runnables', async (_event, config: any, projectPath: string) => {
      try {
        const runtimes = await this.sshService.detectRemoteRuntimes(config, '/home')
        return this.sshService.scanRemoteRunnables(config, projectPath, runtimes)
      } catch (err: any) {
        return []
      }
    })

    ipcMain.handle('ssh:run-file', async (_event, config: any, filePath: string, runtimeId: string, cwd: string) => {
      try {
        const cmd = this.buildRemoteRunCmd(filePath, runtimeId, cwd)
        const result = await this.sshService.executeCommand(config, cmd)
        return result
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('git:clone', async (_event, repoUrl: string, targetPath: string, proxyUrl?: string) => {
      try {
        const simpleGit = (await import('simple-git')).default
        const options: Record<string, string> = {}
        if (proxyUrl) {
          options['--config'] = `http.proxy=${proxyUrl}`
        }
        await simpleGit().clone(repoUrl, targetPath, options)
        const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'project'
        const clonedPath = join(targetPath, repoName)
        return { success: true, path: clonedPath }
      } catch (error) {
        return { success: false, error: `克隆仓库失败: ${error}` }
      }
    })

    ipcMain.handle('git:status', async (_event, localPath: string) => {
      return this.gitService.status(localPath)
    })

    ipcMain.handle('git:push', async (_event, config: any) => {
      return this.gitService.push(config)
    })

    ipcMain.on('terminal:open', (_event, cwd?: string) => {
      console.log('[IPC] terminal:open received, cwd:', cwd)
      this.terminalService.openNativeTerminal(cwd)
      console.log('[IPC] terminal:open completed')
    })

    ipcMain.handle('marketplace:get-software-list', async () => {
      return this.downloadService.getSoftwareList().map(item => ({
        ...item,
        installed: this.downloadService.isInstalled(item.id)
      }))
    })

    ipcMain.handle('marketplace:is-installed', async (_event, id: string) => {
      return this.downloadService.isInstalled(id)
    })

    ipcMain.handle('marketplace:start-download', async (_event, id: string) => {
      const item = SOFTWARE_REGISTRY[id]
      if (!item) {
        return { success: false, error: '未找到该软件' }
      }

      this.downloadService.onProgress(id, (progress: DownloadProgress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('marketplace:download-progress', progress)
        }
      })

      this.downloadService.startDownload(item).catch((err) => {
        console.error(`下载失败 [${id}]:`, err)
      })

      return { success: true, external: item.installerType === 'external' }
    })

    ipcMain.handle('marketplace:cancel-download', async (_event, id: string) => {
      this.downloadService.cancelDownload(id)
      this.downloadService.removeProgressListener(id)
      return { success: true }
    })

    ipcMain.handle('marketplace:uninstall', async (_event, id: string) => {
      try {
        await this.downloadService.uninstallSoftware(id)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('ai:configure-model', async (_event, modelName: string, apiKey: string, baseUrl?: string, model?: string) => {
      return this.aiService.configureModel(modelName, apiKey, { baseUrl, model })
    })

    ipcMain.handle('ai:send-message', async (_event, modelName: string, message: string) => {
      return this.aiService.sendMessage(modelName, message)
    })

    ipcMain.handle('ai:execute-cli', async (_event, modelName: string, task: string, context: CLIContext) => {
      return this.aiService.executeCLI(modelName, task, context, (progress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('ai:cli-progress', progress)
        }
      })
    })

    ipcMain.handle('ai:apply-change', async (_event, projectPath: string, filename: string, content: string) => {
      return this.aiService.applyCLIChange(projectPath, filename, content)
    })

    ipcMain.handle('ai:get-website', async (_event, modelName: string) => {
      return this.aiService.getModelWebsite(modelName)
    })

    ipcMain.handle('run:detect-runtimes', async () => {
      return this.runService.detectRuntimes()
    })

    ipcMain.handle('run:scan-project', async (_event, projectPath: string) => {
      const runtimes = await this.runService.detectRuntimes()
      const cachedRuntimes = this.runService as any
      cachedRuntimes._cached = runtimes
      return this.runService.scanProjectRunnables(projectPath, runtimes)
    })

    ipcMain.handle('run:execute', async (_event, filePath: string, runtime: string, runtimePath: string, cwd: string) => {
      const result = await this.runService.runFile(filePath, runtime, runtimePath, cwd)
      return { success: result.success, output: result.output, error: result.error }
    })

    ipcMain.handle('run:open-browser', async (_event, filePath: string, browser: string) => {
      this.runService.openInBrowser(filePath, browser)
      return { success: true }
    })
  }

  private buildRemoteRunCmd(filePath: string, runtimeId: string, cwd: string): string {
    const cmds: Record<string, string> = {
      python: `python3 "${filePath}" || python "${filePath}"`,
      node: `node "${filePath}"`,
      java: `cd "${cwd}" && javac *.java 2>/dev/null; java ${filePath.split('/').pop()?.replace('.java', '') || 'Main'}`,
      gcc: `gcc "${filePath}" -o /tmp/a.out 2>&1 && /tmp/a.out`,
      php: `php "${filePath}"`,
      go: `cd "${cwd}" && go run "${filePath}"`,
      cargo: `cargo run --manifest-path "${filePath}"`,
      r: `Rscript "${filePath}"`,
      dotnet: `cd "${cwd}" && dotnet run`,
      bash: `bash "${filePath}"`,
      perl: `perl "${filePath}"`,
      ruby: `ruby "${filePath}"`,
      custom: `"${filePath}"`
    }
    return cmds[runtimeId] || `"${filePath}"`
  }

  private createMenu(): void {
    Menu.setApplicationMenu(null)
  }

  private async handleNewProject(): Promise<void> {
    const result = await dialog.showOpenDialog(this.mainWindow!, {
      properties: ['openDirectory']
    })
    if (!result.canceled) {
      this.mainWindow?.webContents.send('project:created', result.filePaths[0])
    }
  }

  private async handleOpenProject(): Promise<void> {
    const result = await dialog.showOpenDialog(this.mainWindow!, {
      properties: ['openDirectory']
    })
    if (!result.canceled) {
      this.mainWindow?.webContents.send('project:opened', result.filePaths[0])
    }
  }

  private handleCloseProject(): void {
    this.mainWindow?.webContents.send('project:closed')
  }
}

new EIDE()