interface EIDEAPI {
  selectDirectory: () => Promise<{ canceled: boolean; path: string }>
  selectExe: () => Promise<{ canceled: boolean; path: string }>
  createProject: (name: string, basePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  openProject: (path: string) => Promise<{ success: boolean; path?: string; error?: string }>
  closeProject: () => Promise<{ success: boolean }>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<{ success: boolean; nodes?: FileNode[]; error?: string }>
  createDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
  rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>
  deleteFileOrDir: (targetPath: string) => Promise<{ success: boolean; error?: string }>
  connectSSH: (config: { username: string; host: string; password: string; port: number }) => Promise<{ success: boolean; error?: string }>
  disconnectSSH: (config: { username: string; host: string; password: string; port: number }) => Promise<{ success: boolean }>
  readRemoteDir: (config: any, remotePath: string) => Promise<{ success: boolean; nodes?: any[]; error?: string }>
  readRemoteFile: (config: any, remotePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeRemoteFile: (config: any, remotePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  sshDetectRuntimes: (config: any, homeDir: string) => Promise<any[]>
  sshScanRunnables: (config: any, projectPath: string) => Promise<any[]>
  sshRunFile: (config: any, filePath: string, runtimeId: string, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
  cloneGitRepo: (repoUrl: string, targetPath: string, proxyUrl?: string) => Promise<{ success: boolean; path?: string; error?: string }>
  gitStatus: (localPath: string) => Promise<{ success: boolean; files?: string[]; branch?: string; error?: string }>
  gitPush: (config: any) => Promise<{ success: boolean; error?: string }>
  onProjectCreated: (callback: (path: string) => void) => void
  onProjectOpened: (callback: (path: string) => void) => void
  onProjectClosed: (callback: () => void) => void
  openTerminal: (cwd?: string) => void
  removeAllListeners: (channel: string) => void
  getSoftwareList: () => Promise<SoftwareItem[]>
  isSoftwareInstalled: (id: string) => Promise<boolean>
  startDownload: (id: string) => Promise<{ success: boolean; error?: string; external?: boolean }>
  cancelDownload: (id: string) => Promise<{ success: boolean }>
  uninstallSoftware: (id: string) => Promise<{ success: boolean; error?: string }>
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void
  aiConfigureModel: (modelName: string, apiKey: string, baseUrl?: string, model?: string) => Promise<{ success: boolean; error?: string }>
  aiSendMessage: (modelName: string, message: string) => Promise<{ success: boolean; content?: string; error?: string }>
  aiExecuteCLI: (modelName: string, task: string, context: any) => Promise<{ success: boolean; content?: string; error?: string }>
  aiApplyChange: (projectPath: string, filename: string, content: string) => Promise<{ success: boolean; error?: string }>
  aiGetWebsite: (modelName: string) => Promise<string>
  onCLIProgress: (callback: (progress: any) => void) => () => void
  detectRuntimes: () => Promise<any[]>
  scanProjectRunnables: (projectPath: string) => Promise<any[]>
  runExecute: (filePath: string, runtime: string, runtimePath: string, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>
  runOpenBrowser: (filePath: string, browser: string) => Promise<{ success: boolean }>
}

interface FileNode {
  name: string
  type: 'file' | 'directory'
  path: string
  children?: FileNode[]
}

interface AIModel {
  name: string
  apiKey: string
  baseUrl: string
  model: string
}

interface EIDEApp {
  showPage: (pageId: string) => void
  selectDirectory: (inputId: string) => Promise<void>
  createProject: () => Promise<void>
  openProject: () => Promise<void>
  connectSSH: () => Promise<void>
  cloneGitRepo: () => Promise<void>
  downloadTrae: () => void
  sendAIMessage: () => Promise<void>
  showFileMenu: () => void
  showSettings: () => void
  openTerminal: () => void
  showGitMenu: () => void
  runProject: () => void
}

declare global {
  interface Window {
    eideAPI: EIDEAPI
    app: EIDEApp
  }

  interface DownloadProgress {
    id: string
    status: 'pending' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'error' | 'cancelled'
    progress: number
    totalSize: number
    downloadedSize: number
    speed: number
    error?: string
  }

  interface SoftwareItem {
    id: string
    name: string
    displayName: string
    url: string
    category: 'language' | 'runtime' | 'tool' | 'framework' | 'database' | 'plugin'
    installerType: 'exe' | 'msi' | 'zip' | 'tar.gz' | 'vsix' | 'npm' | 'external'
    version: string
    iconUrl: string
    description: string
    installed: boolean
  }
}

export {}