import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('eideAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  selectExe: () => ipcRenderer.invoke('dialog:selectExe'),

  createProject: (name: string, basePath: string) => ipcRenderer.invoke('project:create', name, basePath),
  openProject: (path: string) => ipcRenderer.invoke('project:open', path),
  closeProject: () => ipcRenderer.invoke('project:close'),

  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  readDir: (dirPath: string) => ipcRenderer.invoke('dir:read', dirPath),
  createDir: (dirPath: string) => ipcRenderer.invoke('file:create-dir', dirPath),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  deleteFileOrDir: (targetPath: string) => ipcRenderer.invoke('file:delete', targetPath),

  connectSSH: (config: { username: string; host: string; password: string; port: number }) =>
    ipcRenderer.invoke('ssh:connect', config),
  disconnectSSH: (config: { username: string; host: string; password: string; port: number }) =>
    ipcRenderer.invoke('ssh:disconnect', config),
  readRemoteDir: (config: any, remotePath: string) =>
    ipcRenderer.invoke('ssh:read-dir', config, remotePath),
  readRemoteFile: (config: any, remotePath: string) =>
    ipcRenderer.invoke('ssh:read-file', config, remotePath),
  writeRemoteFile: (config: any, remotePath: string, content: string) =>
    ipcRenderer.invoke('ssh:write-file', config, remotePath, content),
  sshDetectRuntimes: (config: any, homeDir: string) =>
    ipcRenderer.invoke('ssh:detect-runtimes', config, homeDir),
  sshScanRunnables: (config: any, projectPath: string) =>
    ipcRenderer.invoke('ssh:scan-runnables', config, projectPath),
  sshRunFile: (config: any, filePath: string, runtimeId: string, cwd: string) =>
    ipcRenderer.invoke('ssh:run-file', config, filePath, runtimeId, cwd),

  cloneGitRepo: (repoUrl: string, targetPath: string, proxyUrl?: string) =>
    ipcRenderer.invoke('git:clone', repoUrl, targetPath, proxyUrl),
  gitStatus: (localPath: string) => ipcRenderer.invoke('git:status', localPath),
  gitPush: (config: any) => ipcRenderer.invoke('git:push', config),

  onProjectCreated: (callback: (path: string) => void) =>
    ipcRenderer.on('project:created', (_event, path) => callback(path)),

  onProjectOpened: (callback: (path: string) => void) =>
    ipcRenderer.on('project:opened', (_event, path) => callback(path)),

  onProjectClosed: (callback: () => void) =>
    ipcRenderer.on('project:closed', () => callback()),

  openTerminal: (cwd?: string) => ipcRenderer.send('terminal:open', cwd),

  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),

  getSoftwareList: () => ipcRenderer.invoke('marketplace:get-software-list'),
  isSoftwareInstalled: (id: string) => ipcRenderer.invoke('marketplace:is-installed', id),
  startDownload: (id: string) => ipcRenderer.invoke('marketplace:start-download', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('marketplace:cancel-download', id),
  uninstallSoftware: (id: string) => ipcRenderer.invoke('marketplace:uninstall', id),

  onDownloadProgress: (callback: (progress: any) => void) =>
    ipcRenderer.on('marketplace:download-progress', (_event, progress) => callback(progress)),

  aiConfigureModel: (modelName: string, apiKey: string, baseUrl?: string, model?: string) =>
    ipcRenderer.invoke('ai:configure-model', modelName, apiKey, baseUrl, model),
  aiSendMessage: (modelName: string, message: string) =>
    ipcRenderer.invoke('ai:send-message', modelName, message),
  aiExecuteCLI: (modelName: string, task: string, context: any) =>
    ipcRenderer.invoke('ai:execute-cli', modelName, task, context),
  aiApplyChange: (projectPath: string, filename: string, content: string) =>
    ipcRenderer.invoke('ai:apply-change', projectPath, filename, content),
  aiGetWebsite: (modelName: string) =>
    ipcRenderer.invoke('ai:get-website', modelName),

  onCLIProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('ai:cli-progress', handler)
    return () => ipcRenderer.removeListener('ai:cli-progress', handler)
  },

  detectRuntimes: () => ipcRenderer.invoke('run:detect-runtimes'),
  scanProjectRunnables: (projectPath: string) => ipcRenderer.invoke('run:scan-project', projectPath),
  runExecute: (filePath: string, runtime: string, runtimePath: string, cwd: string) =>
    ipcRenderer.invoke('run:execute', filePath, runtime, runtimePath, cwd),
  runOpenBrowser: (filePath: string, browser: string) =>
    ipcRenderer.invoke('run:open-browser', filePath, browser)
})