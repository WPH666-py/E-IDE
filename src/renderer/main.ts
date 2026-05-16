import { EditorView } from '@codemirror/view'
import { initEditor, getEditorContent, setEditorContent, setEditorLang, clearDiagnostics, showDiagnostics, openDiagnosticsPanel } from './codemirror-setup'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

interface AIModel {
  name: string
  apiKey: string
  baseUrl: string
  model: string
}

interface VSCodeExtension {
  publisher: { publisherName: string; displayName: string }
  extensionName: string
  displayName: string
  shortDescription: string
  versions: { version: string; lastUpdated: string; files: { assetType: string; source: string }[] }[]
  statistics: { statisticName: string; value: number }[]
  categories: string[]
  tags: string[]
}

interface InstalledExtension {
  id: string
  name: string
  publisher: string
  displayName: string
  description: string
  version: string
  iconUrl: string
  installDate: string
  disabled: boolean
}

class EIDEApp {
  private currentProjectPath: string | null = null
  private fileTree: FileNode[] = []
  private aiModels: AIModel[] = []
  private currentAIModel: string | null = null
  private currentFile: string | null = null
  private openTabs: string[] = []
  private clipboardData: { type: 'cut' | 'copy'; path: string; name: string } | null = null
  private contextTarget: { path: string; type: 'file' | 'directory' } | null = null
  private language: string = 'zh-CN'
  private marketplaceExtensions: VSCodeExtension[] = []
  private marketplaceTab: string = 'popular'
  private installedExtensions: InstalledExtension[] = []
  private disabledExtensions: InstalledExtension[] = []
  private downloadStates: Map<string, DownloadProgress> = new Map()
  private softwareList: SoftwareItem[] = []
  private aiContextFiles: string[] = []
  private filePickerSelections: Set<string> = new Set()
  private messagePairStack: HTMLElement[] = []

  private runnableFiles: any[] = []
  private runnableLoaded = false
  private detectedRuntimes: any[] = []
  private customRuntimes: any[] = []
  private selectedRuntime: string = ''

  private isRemoteMode = false
  private sshConfig: any = null
  private fileSnapshots: Map<HTMLElement, Map<string, string>> = new Map()
  private cmView: EditorView | null = null
  private inlineInputResolve: ((value: string | null) => void) | null = null
  private inlineConfirmResolve: ((value: boolean) => void) | null = null

  constructor() {
    this.setupEventListeners()
    this.loadAIModels()
    this.loadSettings()
    this.setupResizeHandles()
    this.setupGlobalClickHandler()
    this.setupDownloadListener()
    this.setupInlineDialogs()
    this.setupContextMenuDelegation()
  }

  private setupDownloadListener(): void {
    if (window.eideAPI) {
      window.eideAPI.onDownloadProgress((progress: DownloadProgress) => {
        this.downloadStates.set(progress.id, progress)
        this.renderMarketplaceGrid()
        this.renderRightPanelExtensions()

        if (progress.status === 'completed') {
          this.showToast(`✅ ${this.getSoftwareDisplayName(progress.id)} 下载安装完成！`, 'success')
          this.loadInstalledExtensions()
          this.saveInstalledSoftware(progress.id)
          this.renderMarketplaceGrid()
          this.renderRightPanelExtensions()
        } else if (progress.status === 'error') {
          this.showToast(`❌ ${this.getSoftwareDisplayName(progress.id)} 下载失败: ${progress.error || '未知错误'}`, 'error')
        } else if (progress.status === 'cancelled') {
          this.showToast(`⏹ ${this.getSoftwareDisplayName(progress.id)} 下载已取消`, 'info')
        }
      })
    }
  }

  private getSoftwareDisplayName(id: string): string {
    const sw = this.softwareList.find(s => s.id === id)
    if (sw) return sw.displayName
    const ext = this.installedExtensions.find(e => e.id === id)
    if (ext) return ext.displayName
    return id
  }

  private saveInstalledSoftware(id: string): void {
    const sw = this.softwareList.find(s => s.id === id)
    if (!sw) return
    if (this.isExtensionInstalled(id)) return
    const pubMap: Record<string, string> = {
      language: '编程语言', runtime: '运行时', tool: '开发工具',
      framework: '开发框架', database: '数据库', plugin: '扩展插件'
    }
    const ext: InstalledExtension = {
      id: sw.id,
      name: sw.name,
      publisher: pubMap[sw.category] || '开发工具',
      displayName: sw.displayName,
      description: sw.description,
      version: sw.version,
      iconUrl: sw.iconUrl,
      installDate: new Date().toISOString().split('T')[0],
      disabled: false
    }
    this.installedExtensions.push(ext)
    this.saveInstalledExtensions()
    this.updateSettingsPluginList()
  }

  private showToast(message: string, type: 'success' | 'error' | 'info'): void {
    const existing = document.querySelector('.download-toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.className = `download-toast toast-${type}`
    toast.textContent = message
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      padding: 12px 20px; border-radius: 8px; font-size: 0.88rem;
      color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      animation: toastIn 0.3s ease;
      max-width: 400px; word-break: break-all;
    `
    if (type === 'success') toast.style.background = '#2e7d32'
    else if (type === 'error') toast.style.background = '#c62828'
    else toast.style.background = '#1565c0'

    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity 0.3s'
      setTimeout(() => toast.remove(), 300)
    }, 4000)
  }

  private setupEventListeners(): void {
    const searchInput = document.getElementById('projectSearch') as HTMLInputElement
    searchInput?.addEventListener('input', (e) => {
      this.searchLocalProjects((e.target as HTMLInputElement).value)
    })

    const codeEditorEl = document.getElementById('codeEditor')
    if (codeEditorEl) {
      this.cmView = initEditor(codeEditorEl)
      this.cmView.dom.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        this.showEditorContextMenu(e.clientX, e.clientY)
      })
    }

    const fileExplorer = document.getElementById('fileExplorer')
    fileExplorer?.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const target = e.target as HTMLElement
      const fileItem = target.closest('.file-item') as HTMLElement | null
      if (fileItem) {
        const path = fileItem.getAttribute('data-path')
        const type = fileItem.getAttribute('data-type') as 'file' | 'directory'
        if (path && type) {
          this.contextTarget = { path, type }
          this.showFileContextMenu(e.clientX, e.clientY)
        }
      } else if (this.currentProjectPath) {
        this.contextTarget = { path: this.currentProjectPath, type: 'directory' }
        this.showFileContextMenu(e.clientX, e.clientY)
      }
    })

    const tabsBar = document.getElementById('tabsBar')
    tabsBar?.addEventListener('click', (e) => {
      this.handleTabBarClick(e)
    })

    if (window.eideAPI) {
      window.eideAPI.onProjectCreated((path: string) => {
        this.enterProject(path)
      })
      window.eideAPI.onProjectOpened((path: string) => {
        this.enterProject(path)
      })
      window.eideAPI.onProjectClosed(() => {
        this.closeProject()
      })
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        this.saveCurrentFile()
      }
    })

    const aiInput = document.getElementById('aiInput')
    aiInput?.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.showAIInputContextMenu(e.clientX, e.clientY)
    })
  }

  private setupContextMenuDelegation(): void {
    const fileCtxMenu = document.getElementById('fileContextMenu')
    fileCtxMenu?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.context-item') as HTMLElement | null
      if (!item) return
      const action = item.getAttribute('data-action')
      if (!action) return
      e.stopPropagation()
      this.hideAllContextMenus()
      switch (action) {
        case 'newFile': this.ctxNewFile(); break
        case 'newFolder': this.ctxNewFolder(); break
        case 'copyPath': this.ctxCopyPath(); break
        case 'rename': this.ctxRename(); break
        case 'cut': this.ctxCut(); break
        case 'copy': this.ctxCopy(); break
        case 'paste': this.ctxPaste(); break
        case 'delete': this.ctxDelete(); break
        case 'openFilePicker': this.openFilePicker(); break
      }
    })

    const editorCtxMenu = document.getElementById('editorContextMenu')
    editorCtxMenu?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.context-item') as HTMLElement | null
      if (!item) return
      const action = item.getAttribute('data-editor-action')
      if (!action) return
      e.stopPropagation()
      this.hideAllContextMenus()
      this.editorCtxAction(action)
    })

    const aiCtxMenu = document.getElementById('aiInputContextMenu')
    aiCtxMenu?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.context-item') as HTMLElement | null
      if (!item) return
      const action = item.getAttribute('data-action')
      if (!action) return
      e.stopPropagation()
      this.hideAllContextMenus()
      if (action === 'openFilePicker') this.openFilePicker()
    })
  }

  private setupInlineDialogs(): void {
    const inputField = document.getElementById('inlineInputField') as HTMLInputElement
    const inputModal = document.getElementById('inlineInputModal')
    const inputTitle = document.getElementById('inlineInputTitle')
    const inputConfirm = document.getElementById('inlineInputConfirm')
    const inputCancel = document.getElementById('inlineInputCancel')
    const inputClose = document.getElementById('inlineInputClose')

    const hideInputModal = () => {
      inputModal?.classList.remove('show')
      if (this.inlineInputResolve) {
        this.inlineInputResolve(null)
        this.inlineInputResolve = null
      }
    }

    inputConfirm?.addEventListener('click', () => {
      const value = inputField?.value.trim() || ''
      inputModal?.classList.remove('show')
      if (this.inlineInputResolve) {
        this.inlineInputResolve(value)
        this.inlineInputResolve = null
      }
    })
    inputCancel?.addEventListener('click', hideInputModal)
    inputClose?.addEventListener('click', hideInputModal)
    inputModal?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'inlineInputModal') hideInputModal()
    })
    inputField?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = inputField.value.trim()
        inputModal?.classList.remove('show')
        if (this.inlineInputResolve) {
          this.inlineInputResolve(value)
          this.inlineInputResolve = null
        }
      } else if (e.key === 'Escape') {
        hideInputModal()
      }
    })

    const confirmModal = document.getElementById('inlineConfirmModal')
    const confirmMsg = document.getElementById('inlineConfirmMsg')
    const confirmTitle = document.getElementById('inlineConfirmTitle')
    const confirmOk = document.getElementById('inlineConfirmOk')
    const confirmCancel = document.getElementById('inlineConfirmCancel')
    const confirmClose = document.getElementById('inlineConfirmClose')

    const hideConfirmModal = () => {
      confirmModal?.classList.remove('show')
      if (this.inlineConfirmResolve) {
        this.inlineConfirmResolve(false)
        this.inlineConfirmResolve = null
      }
    }

    confirmOk?.addEventListener('click', () => {
      confirmModal?.classList.remove('show')
      if (this.inlineConfirmResolve) {
        this.inlineConfirmResolve(true)
        this.inlineConfirmResolve = null
      }
    })
    confirmCancel?.addEventListener('click', hideConfirmModal)
    confirmClose?.addEventListener('click', hideConfirmModal)
    confirmModal?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'inlineConfirmModal') hideConfirmModal()
    })
  }

  private showInlineInput(title: string, defaultValue: string, placeholder: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.inlineInputResolve = resolve
      const modal = document.getElementById('inlineInputModal')
      const titleEl = document.getElementById('inlineInputTitle')
      const input = document.getElementById('inlineInputField') as HTMLInputElement
      if (titleEl) titleEl.textContent = title
      if (input) {
        input.value = defaultValue
        input.placeholder = placeholder
        setTimeout(() => { input.focus(); input.select() }, 100)
      }
      if (modal) modal.classList.add('show')
    })
  }

  private showInlineConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.inlineConfirmResolve = resolve
      const modal = document.getElementById('inlineConfirmModal')
      const titleEl = document.getElementById('inlineConfirmTitle')
      const msgEl = document.getElementById('inlineConfirmMsg')
      if (titleEl) titleEl.textContent = title
      if (msgEl) msgEl.textContent = message
      if (modal) modal.classList.add('show')
    })
  }

  private showAIInputContextMenu(x: number, y: number): void {
    const menu = document.getElementById('aiInputContextMenu')
    if (menu) {
      if (!this.currentProjectPath) {
        menu.innerHTML = '<div class="context-item" style="color:#999;cursor:default">请先打开项目</div>'
      } else {
        menu.innerHTML = `
          <div class="context-item" data-action="openFilePicker">&#128206; 添加文件到上下文</div>
          <div class="context-item" data-action="openFilePicker">&#128193; 添加文件夹到上下文</div>
        `
      }
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      menu.classList.add('show')
    }
  }

  private setupGlobalClickHandler(): void {
    document.addEventListener('click', (e) => {
      let el = e.target as Node
      if (el.nodeType !== 1) el = el.parentElement!
      const target = el as HTMLElement
      if (!target.closest('.dropdown-menu') && !target.closest('.menu-button')) {
        this.closeDropdowns()
      }
      if (!target.closest('.context-menu')) {
        this.hideAllContextMenus()
      }
      if (target.closest('#filePickerOverlay') && !target.closest('.file-picker-box')) {
        this.hideFilePicker()
      }
    })
  }

  private setupResizeHandles(): void {
    const explorerHandle = document.getElementById('explorerResizeHandle')
    const terminalHandle = document.getElementById('terminalResizeHandle')

    explorerHandle?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.startResize('explorer', e)
    })

    terminalHandle?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.startResize('terminal', e)
    })
  }

  private startResize(type: 'explorer' | 'terminal', e: MouseEvent): void {
    const startX = e.clientX
    const startY = e.clientY

    const explorerPanel = document.getElementById('fileExplorerPanel')
    const editorArea = document.querySelector('.editor-area') as HTMLElement
    const terminal = document.getElementById('terminal')

    if (!explorerPanel || !editorArea) return

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (type === 'explorer') {
        const deltaX = moveEvent.clientX - startX
        const newWidth = Math.max(160, Math.min(480, explorerPanel.offsetWidth + deltaX))
        explorerPanel.style.width = `${newWidth}px`
      } else if (type === 'terminal' && terminal) {
        const deltaY = moveEvent.clientY - startY
        const editorHeight = editorArea.offsetHeight
        const terminalHeight = terminal.offsetHeight
        const maxTerminalHeight = editorHeight * 0.5
        const newTerminalHeight = Math.max(120, Math.min(maxTerminalHeight, terminalHeight - deltaY))
        terminal.style.flex = `none`
        terminal.style.height = `${newTerminalHeight}px`
      }
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  showPage(pageId: string): void {
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active')
    })
    const target = document.getElementById(pageId)
    if (target) {
      target.classList.add('active')
    }
    if (pageId === 'editorPage' && this.cmView) {
      setTimeout(() => this.cmView!.requestMeasure(), 0)
    }
  }

  toggleDropdown(dropdownId: string): void {
    this.closeDropdowns()
    const dropdown = document.getElementById(dropdownId)
    if (dropdown) {
      dropdown.classList.toggle('show')
    }
  }

  closeDropdowns(): void {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
      menu.classList.remove('show')
    })
  }

  showSettingsModal(): void {
    const modal = document.getElementById('settingsModal')
    if (modal) {
      modal.classList.add('show')
      this.loadInstalledExtensions()
      this.renderSettingsContent()
    }
  }

  hideSettingsModal(): void {
    const modal = document.getElementById('settingsModal')
    if (modal) {
      modal.classList.remove('show')
    }
  }

  private loadSettings(): void {
    const savedLang = localStorage.getItem('eide-language')
    if (savedLang) {
      this.language = savedLang
    }
  }

  changeLanguage(lang: string): void {
    this.language = lang
    localStorage.setItem('eide-language', lang)
  }

  private renderSettingsContent(): void {
    const languageSelect = document.getElementById('settingsLanguage') as HTMLSelectElement
    if (languageSelect) {
      languageSelect.value = this.language
    }
    this.updateSettingsPluginList()
  }

  showFileContextMenu(x: number, y: number): void {
    const menu = document.getElementById('fileContextMenu')
    if (menu) {
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      menu.classList.add('show')
    }
  }

  showEditorContextMenu(x: number, y: number): void {
    const menu = document.getElementById('editorContextMenu')
    if (menu) {
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      menu.classList.add('show')
    }
  }

  hideAllContextMenus(): void {
    document.querySelectorAll('.context-menu.show').forEach(menu => {
      menu.classList.remove('show')
    })
  }

  async selectDirectory(inputId: string): Promise<void> {
    if (!window.eideAPI) return
    const result = await window.eideAPI.selectDirectory()
    if (!result.canceled && result.path) {
      const input = document.getElementById(inputId) as HTMLInputElement
      if (input) {
        input.value = result.path
      }
    }
  }

  async createProject(): Promise<void> {
    const name = (document.getElementById('newProjectName') as HTMLInputElement).value.trim()
    const basePath = (document.getElementById('newProjectPath') as HTMLInputElement).value.trim()
    const statusEl = document.getElementById('newProjectStatus')

    if (!name) {
      this.setStatus(statusEl, '请输入项目名称', 'error')
      return
    }
    if (!basePath) {
      this.setStatus(statusEl, '请选择项目目录', 'error')
      return
    }

    this.setStatus(statusEl, '正在创建项目...', 'info')

    try {
      if (window.eideAPI) {
        const result = await window.eideAPI.createProject(name, basePath)
        if (result.success && result.path) {
          this.setStatus(statusEl, '项目创建成功！', 'success')
          setTimeout(() => {
            this.enterProject(result.path!)
          }, 500)
        } else {
          this.setStatus(statusEl, result.error || '创建失败', 'error')
        }
      }
    } catch (error) {
      this.setStatus(statusEl, `创建失败: ${error}`, 'error')
    }
  }

  async openProject(): Promise<void> {
    const path = (document.getElementById('openProjectPath') as HTMLInputElement).value.trim()
    const statusEl = document.getElementById('openProjectStatus')

    if (!path) {
      this.setStatus(statusEl, '请选择项目目录', 'error')
      return
    }

    this.setStatus(statusEl, '正在打开项目...', 'info')

    try {
      if (window.eideAPI) {
        const result = await window.eideAPI.openProject(path)
        if (result.success) {
          this.setStatus(statusEl, '项目打开成功！', 'success')
          setTimeout(() => {
            this.enterProject(path)
          }, 500)
        } else {
          this.setStatus(statusEl, result.error || '打开失败', 'error')
        }
      }
    } catch (error) {
      this.setStatus(statusEl, `打开失败: ${error}`, 'error')
    }
  }

  async connectSSH(): Promise<void> {
    const username = (document.getElementById('sshUsername') as HTMLInputElement).value.trim()
    const host = (document.getElementById('sshHost') as HTMLInputElement).value.trim()
    const password = (document.getElementById('sshPassword') as HTMLInputElement).value.trim()
    const port = parseInt((document.getElementById('sshPort') as HTMLInputElement).value.trim()) || 22
    const statusEl = document.getElementById('sshStatus')

    if (!username || !host || !password) {
      this.setStatus(statusEl, '请填写完整的连接信息', 'error')
      return
    }

    this.setStatus(statusEl, '正在连接...', 'info')

    try {
      if (window.eideAPI) {
        const config = { username, host, password, port }
        const result = await window.eideAPI.connectSSH(config)
        if (result.success) {
          this.setStatus(statusEl, '连接成功！正在加载文件...', 'success')
          this.sshConfig = config
          this.isRemoteMode = true
          this.currentProjectPath = '/home/' + username
          this.showPage('editorPage')
          await this.loadFileTree('/')
          this.detectEnvironments()
          this.loadRunOptions()
          document.title = `E-IDE - 🔒 ${username}@${host}`
          this.showToast(`✅ SSH 已连接: ${username}@${host}`, 'success')
        } else {
          this.setStatus(statusEl, result.error || '连接失败', 'error')
        }
      }
    } catch (error) {
      this.setStatus(statusEl, `连接失败: ${error}`, 'error')
    }
  }

  async cloneGitRepo(): Promise<void> {
    const repoUrl = (document.getElementById('gitRepoUrl') as HTMLInputElement).value.trim()
    const proxyUrl = (document.getElementById('gitProxyUrl') as HTMLInputElement).value.trim()
    const targetPath = (document.getElementById('gitTargetPath') as HTMLInputElement).value.trim()
    const statusEl = document.getElementById('gitCloneStatus')

    if (!repoUrl) {
      this.setStatus(statusEl, '请输入仓库链接', 'error')
      return
    }
    if (!targetPath) {
      this.setStatus(statusEl, '请选择目标目录', 'error')
      return
    }

    this.setStatus(statusEl, '正在下拉项目...', 'info')

    try {
      if (window.eideAPI) {
        const result = await window.eideAPI.cloneGitRepo(repoUrl, targetPath, proxyUrl || undefined)
        if (result.success && result.path) {
          this.setStatus(statusEl, '下拉成功！', 'success')
          setTimeout(() => {
            this.enterProject(result.path!)
          }, 500)
        } else {
          this.setStatus(statusEl, result.error || '下拉失败', 'error')
        }
      }
    } catch (error) {
      this.setStatus(statusEl, `下拉失败: ${error}`, 'error')
    }
  }

  downloadTrae(): void {
    window.open('https://www.trae.com.cn/', '_blank')
  }

  private async enterProject(path: string): Promise<void> {
    this.currentProjectPath = path
    localStorage.setItem('lastProjectPath', path)
    this.showPage('editorPage')
    await this.loadFileTree(path)
    this.loadInstalledExtensions()
    this.renderRightPanelExtensions()
    this.detectEnvironments()
    this.loadRunOptions()
    document.title = `E-IDE - ${path.split(/[\\/]/).pop()}`
    if (this.cmView) {
      setTimeout(() => this.cmView!.requestMeasure(), 50)
    }
  }

  closeProject(): void {
    if (this.isRemoteMode && this.sshConfig && window.eideAPI) {
      window.eideAPI.disconnectSSH(this.sshConfig).catch(() => {})
      this.isRemoteMode = false
      this.sshConfig = null
    }
    this.currentProjectPath = null
    localStorage.removeItem('lastProjectPath')
    this.showPage('homepage')
    this.openTabs = []
    const tabsBar = document.getElementById('tabsBar')
    if (tabsBar) tabsBar.innerHTML = ''
    document.title = 'E-IDE - 轻量化开发环境'
  }

  async loadFileTree(dirPath: string): Promise<void> {
    if (!window.eideAPI) return
    try {
      let result
      if (this.isRemoteMode && this.sshConfig) {
        result = await window.eideAPI.readRemoteDir(this.sshConfig, dirPath)
      } else {
        result = await window.eideAPI.readDir(dirPath)
      }
      if (result.success && result.nodes) {
        this.fileTree = result.nodes
        this.renderFileTree()
      }
    } catch (_error) {
      this.fileTree = []
      this.renderFileTree()
    }
  }

  renderFileTree(): void {
    const fileExplorer = document.getElementById('fileExplorer')
    if (!fileExplorer) return
    fileExplorer.innerHTML = this.generateFileTreeHTML(this.fileTree, 0)
    fileExplorer.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = item.getAttribute('data-path')
        const type = item.getAttribute('data-type')
        if (path && type === 'file') {
          this.openFile(path)
        } else if (path && type === 'directory') {
          this.toggleDirectory(item as HTMLElement, path)
        }
      })
    })
  }

  generateFileTreeHTML(nodes: FileNode[], level: number): string {
    let html = ''
    nodes.forEach(node => {
      const icon = node.type === 'directory' ? '📁' : '📄'
      html += `
        <div class="file-item" data-path="${node.path}" data-type="${node.type}" style="padding-left: ${level * 16 + 8}px">
          ${icon} ${node.name}
        </div>
      `
    })
    return html
  }

  private async toggleDirectory(item: HTMLElement, dirPath: string): Promise<void> {
    const childContainer = item.nextElementSibling as HTMLElement | null
    if (childContainer && childContainer.classList.contains('dir-children')) {
      childContainer.remove()
      item.textContent = item.textContent?.replace('📂', '📁') || item.textContent
      return
    }

    if (!window.eideAPI) return
    let result
    if (this.isRemoteMode && this.sshConfig) {
      result = await window.eideAPI.readRemoteDir(this.sshConfig, dirPath)
    } else {
      result = await window.eideAPI.readDir(dirPath)
    }
    if (result.success && result.nodes && result.nodes.length > 0) {
      item.textContent = item.textContent?.replace('📁', '📂') || item.textContent
      const container = document.createElement('div')
      container.classList.add('dir-children')
      const level = parseInt(item.style.paddingLeft) / 16
      container.innerHTML = this.generateFileTreeHTML(result.nodes, level + 1)
      item.after(container)
      container.querySelectorAll('.file-item').forEach(child => {
        child.addEventListener('click', (e) => {
          e.stopPropagation()
          const path = child.getAttribute('data-path')
          const type = child.getAttribute('data-type')
          if (path && type === 'file') {
            this.openFile(path)
          } else if (path && type === 'directory') {
            this.toggleDirectory(child as HTMLElement, path)
          }
        })
      })
    }
  }

  async openFile(filePath: string): Promise<void> {
    try {
      if (window.eideAPI) {
        let content: string
        if (this.isRemoteMode && this.sshConfig) {
          const result = await window.eideAPI.readRemoteFile(this.sshConfig, filePath)
          if (!result.success) throw new Error(result.error || '读取失败')
          content = result.content || ''
        } else {
          content = await window.eideAPI.readFile(filePath)
        }
        if (this.cmView) {
          setEditorContent(this.cmView, content)
          setEditorLang(this.cmView, filePath)
          this.currentFile = filePath
          this.addTab(filePath)
        }
      }
    } catch (error) {
      console.error('打开文件失败:', error)
    }
  }

  private renderTabs(): void {
    const tabsBar = document.getElementById('tabsBar')
    if (!tabsBar) return
    tabsBar.innerHTML = this.openTabs.map((filePath, i) => {
      const fileName = filePath.split(/[\\/]/).pop() || 'untitled'
      const isActive = filePath === this.currentFile
      return `<div class="tab${isActive ? ' active' : ''}" data-tab-index="${i}" data-path="${filePath.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">
        <span>${fileName}</span>
        <span class="tab-close">&times;</span>
      </div>`
    }).join('')
  }

  private addTab(filePath: string): void {
    const tabsBar = document.getElementById('tabsBar')
    if (!tabsBar) return

    const fileName = filePath.split(/[\\/]/).pop() || 'untitled'

    if (!this.openTabs.includes(filePath)) {
      this.openTabs.push(filePath)
    }
    this.renderTabs()

    if (this.currentFile !== filePath) {
      this.loadFileToEditor(filePath)
    }
  }

  private async loadFileToEditor(filePath: string): Promise<void> {
    try {
      if (window.eideAPI) {
        const content = await window.eideAPI.readFile(filePath)
        if (this.cmView) {
          setEditorContent(this.cmView, content)
          setEditorLang(this.cmView, filePath)
          this.currentFile = filePath
        }
      }
    } catch (error) {
      console.error('加载文件失败:', error)
    }
  }

  private handleTabBarClick(e: MouseEvent): void {
    let el = e.target as Node
    if (el.nodeType !== 1) {
      el = el.parentElement!
    }
    const target = el as HTMLElement
    const closeBtn = target.closest('.tab-close')
    const tab = target.closest('.tab') as HTMLElement | null

    if (closeBtn && tab) {
      e.stopPropagation()
      const filePath = tab.getAttribute('data-path')
      if (filePath) {
        this.closeTab(filePath)
      }
      return
    }

    if (tab && !closeBtn) {
      const filePath = tab.getAttribute('data-path')
      if (filePath) {
        this.switchToTab(filePath)
      }
    }
  }

  private async switchToTab(filePath: string): Promise<void> {
    const tabsBar = document.getElementById('tabsBar')
    if (!tabsBar) return

    tabsBar.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-path') === filePath)
    })

    if (this.currentFile !== filePath) {
      await this.loadFileToEditor(filePath)
    }
  }

  closeTab(filePath: string): void {
    const index = this.openTabs.indexOf(filePath)
    if (index === -1) return

    if (this.currentFile === filePath) {
      this.saveCurrentFile()
    }

    const tabsBar = document.getElementById('tabsBar')
    if (!tabsBar) return

    const tabs = tabsBar.querySelectorAll('.tab')
    for (const t of tabs) {
      if (t.getAttribute('data-path') === filePath) {
        t.remove()
        break
      }
    }

    this.openTabs.splice(index, 1)

    if (this.currentFile === filePath) {
      if (this.openTabs.length > 0) {
        const newIndex = Math.min(index, this.openTabs.length - 1)
        this.switchToTab(this.openTabs[newIndex])
      } else {
        this.currentFile = null
        if (this.cmView) {
          setEditorContent(this.cmView, '')
          clearDiagnostics(this.cmView)
        }
      }
    }
  }

  async saveCurrentFile(): Promise<void> {
    if (!this.currentFile || !window.eideAPI || !this.cmView) return
    try {
      const content = getEditorContent(this.cmView)
      if (this.isRemoteMode && this.sshConfig) {
        await window.eideAPI.writeRemoteFile(this.sshConfig, this.currentFile, content)
      } else {
        await window.eideAPI.writeFile(this.currentFile, content)
      }
      console.log(`文件已保存: ${this.currentFile}`)
    } catch (error) {
      console.error('保存文件失败:', error)
    }
  }

  private autoSaveCurrentFile(): void {
    if (this.currentFile) {
      this.saveCurrentFile()
    }
  }

  async saveAs(): Promise<void> {
    if (!this.currentFile || !window.eideAPI || !this.cmView) return
    try {
      const result = await window.eideAPI.selectDirectory()
      if (!result.canceled && result.path) {
        const fileName = this.currentFile.split(/[\\/]/).pop() || 'untitled.txt'
        const newPath = `${result.path}/${fileName}`
        const content = getEditorContent(this.cmView)
        await window.eideAPI.writeFile(newPath, content)
        this.currentFile = newPath
        console.log(`文件已另存为: ${newPath}`)
      }
    } catch (error) {
      console.error('另存为失败:', error)
    }
  }

  private loadAIModels(): void {
    const saved = localStorage.getItem('eide-ai-models')
    if (saved) {
      try {
        this.aiModels = JSON.parse(saved)
      } catch {
        this.aiModels = [
          { name: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
          { name: 'glm', apiKey: '', baseUrl: 'https://open.bigmodel.cn', model: 'glm-4' },
          { name: 'kimi', apiKey: '', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
          { name: 'qwen', apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen-turbo' },
          { name: 'gpt', apiKey: '', baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
          { name: 'claude', apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' }
        ]
      }
    } else {
      this.aiModels = [
        { name: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
        { name: 'glm', apiKey: '', baseUrl: 'https://open.bigmodel.cn', model: 'glm-4' },
        { name: 'kimi', apiKey: '', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
        { name: 'qwen', apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen-turbo' },
        { name: 'gpt', apiKey: '', baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
        { name: 'claude', apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' }
      ]
    }
  }

  onModelChange(): void {
    const select = document.getElementById('aiModelSelect') as HTMLSelectElement
    if (select) {
      this.currentAIModel = select.value
    }
  }

  showAIConfigModal(): void {
    const modal = document.getElementById('aiConfigModal')
    const body = document.getElementById('aiConfigBody')
    if (modal && body) {
      this.renderAIConfig(body)
      modal.classList.add('show')
    }
  }

  hideAIConfigModal(): void {
    const modal = document.getElementById('aiConfigModal')
    if (modal) {
      modal.classList.remove('show')
    }
  }

  openFilePicker(): void {
    if (!this.currentProjectPath) {
      this.showToast('请先打开项目', 'info')
      return
    }
    this.filePickerSelections = new Set(this.aiContextFiles)
    this.hideAllContextMenus()
    this.renderFilePickerList()
    const overlay = document.getElementById('filePickerOverlay')
    if (overlay) overlay.classList.add('show')
  }

  hideFilePicker(): void {
    const overlay = document.getElementById('filePickerOverlay')
    if (overlay) overlay.classList.remove('show')
  }

  confirmFilePicker(): void {
    this.aiContextFiles = Array.from(this.filePickerSelections)
    this.renderContextBar()
    this.hideFilePicker()
  }

  private renderFilePickerList(): void {
    const list = document.getElementById('filePickerList')
    if (!list || !this.currentProjectPath) return

    const buildFlat = (nodes: FileNode[], prefix: string): { display: string; path: string; isDir: boolean }[] => {
      const result: { display: string; path: string; isDir: boolean }[] = []
      for (const node of nodes) {
        const fullPath = node.path
        const isDir = node.type === 'directory'
        result.push({ display: `${prefix}${isDir ? '📁' : '📄'} ${node.name}`, path: fullPath, isDir })
      }
      return result
    }

    const items = buildFlat(this.fileTree, '')
    list.innerHTML = items.map(item => {
      const selected = this.filePickerSelections.has(item.path)
      return `
        <div class="file-picker-item ${selected ? 'selected' : ''} ${item.isDir ? 'dir' : ''}"
             onclick="app.toggleFilePickerSelection('${item.path.replace(/\\/g, '\\\\')}', ${item.isDir})"
             data-path="${item.path.replace(/\\/g, '\\\\')}">
          ${item.display}
        </div>
      `
    }).join('')
  }

  toggleFilePickerSelection(path: string, isDir: boolean): void {
    if (isDir) {
      const children = this.collectDirPaths(path)
      const allSelected = children.every(p => this.filePickerSelections.has(p))
      if (allSelected) {
        children.forEach(p => this.filePickerSelections.delete(p))
      } else {
        children.forEach(p => this.filePickerSelections.add(p))
      }
    } else {
      if (this.filePickerSelections.has(path)) {
        this.filePickerSelections.delete(path)
      } else {
        this.filePickerSelections.add(path)
      }
    }
    this.renderFilePickerList()
  }

  private collectDirPaths(dirPath: string): string[] {
    const result: string[] = []
    const walk = (nodes: FileNode[], targetDir: string) => {
      for (const node of nodes) {
        const nodePath = node.path
        if (nodePath === targetDir || nodePath.startsWith(targetDir + '\\') || nodePath.startsWith(targetDir + '/')) {
          if (node.type === 'directory') {
            result.push(nodePath)
          } else {
            result.push(nodePath)
          }
        }
      }
    }
    walk(this.fileTree, dirPath)
    return result.length > 0 ? result : [dirPath]
  }

  removeContextFile(filePath: string): void {
    this.aiContextFiles = this.aiContextFiles.filter(f => f !== filePath)
    this.renderContextBar()
  }

  private renderContextBar(): void {
    const bar = document.getElementById('aiContextBar')
    if (!bar) return
    if (this.aiContextFiles.length === 0) {
      bar.innerHTML = ''
      return
    }
    const chips = this.aiContextFiles.map(f => {
      const name = f.split(/[\\/]/).pop() || f
      const isDir = this.fileTree.some(n => n.path === f && n.type === 'directory')
      return `<span class="ai-context-chip" title="${f}">${isDir ? '📁' : '📄'} ${name}<span class="chip-remove" onclick="app.removeContextFile('${f.replace(/\\/g, '\\\\')}')">&times;</span></span>`
    }).join('')
    bar.innerHTML = chips + `<span class="ai-context-add-btn" onclick="app.openFilePicker()">+ 添加</span>`
  }

  private async getContextFileContents(): Promise<string> {
    if (this.aiContextFiles.length === 0 || !window.eideAPI) return ''
    const parts: string[] = []
    for (const filePath of this.aiContextFiles) {
      try {
        const content = await window.eideAPI.readFile(filePath)
        const relPath = this.currentProjectPath
          ? filePath.replace(this.currentProjectPath + '\\', '').replace(this.currentProjectPath + '/', '')
          : filePath
        const truncated = content.length > 4000 ? content.substring(0, 4000) + '\n...(文件截断)' : content
        parts.push(`📄 文件: ${relPath}\n\`\`\`\n${truncated}\n\`\`\``)
      } catch {
        parts.push(`📄 文件: ${filePath} (无法读取)`)
      }
    }
    return parts.length > 0 ? '\n\n***以下为用户附加的文件上下文***\n' + parts.join('\n\n') : ''
  }

  undoLastMessagePair(): void {
    const pair = this.messagePairStack.pop()
    if (!pair) return
    this.undoMessagePair(pair)
  }

  private async saveFileSnapshot(pairEl: HTMLElement, absPath: string): Promise<void> {
    if (!window.eideAPI) return
    const norm = absPath.replace(/\\/g, '/')
    if (!this.fileSnapshots.has(pairEl)) {
      this.fileSnapshots.set(pairEl, new Map())
    }
    const snap = this.fileSnapshots.get(pairEl)!
    if (!snap.has(norm)) {
      try {
        if (this.isRemoteMode && this.sshConfig) {
          const r = await window.eideAPI.readRemoteFile(this.sshConfig, absPath)
          if (r.success) snap.set(norm, r.content || '')
        } else {
          const content = await window.eideAPI.readFile(absPath)
          snap.set(norm, content)
        }
      } catch {}
    }
  }

  private async undoMessagePair(pairEl: HTMLElement): Promise<void> {
    const snap = this.fileSnapshots.get(pairEl)
    let restoredCount = 0
    if (snap && window.eideAPI) {
      for (const [filePath, originalContent] of snap.entries()) {
        try {
          if (this.isRemoteMode && this.sshConfig) {
            await window.eideAPI.writeRemoteFile(this.sshConfig, filePath, originalContent)
          } else {
            await window.eideAPI.writeFile(filePath, originalContent)
          }
          restoredCount++
        } catch {}
      }
      this.fileSnapshots.delete(pairEl)
    }

    const userMsg = pairEl.getAttribute('data-user-message') || ''
    if (userMsg) {
      const input = document.getElementById('aiInput') as HTMLTextAreaElement
      if (input) input.value = userMsg
    }

    const idx = this.messagePairStack.indexOf(pairEl)
    if (idx !== -1) this.messagePairStack.splice(idx, 1)

    pairEl.remove()

    if (restoredCount > 0) {
      if (this.currentProjectPath) {
        await this.loadFileTree(this.currentProjectPath)
      }
      if (this.currentFile && window.eideAPI) {
        try {
          let content: string
          if (this.isRemoteMode && this.sshConfig) {
            const r = await window.eideAPI.readRemoteFile(this.sshConfig, this.currentFile)
            content = r.content || ''
          } else {
            content = await window.eideAPI.readFile(this.currentFile)
          }
          if (this.cmView) {
            setEditorContent(this.cmView, content)
          }
        } catch {}
      }
      this.loadRunOptions()
      this.showToast(`↩ 已撤销并回滚 ${restoredCount} 个文件`, 'info')
    } else {
      this.showToast('↩ 已撤销该轮对话', 'info')
    }
  }

  private renderAIConfig(container: HTMLElement): void {
    const modelNames: Record<string, string> = {
      deepseek: 'DeepSeek',
      glm: 'GLM (智谱)',
      kimi: 'Kimi',
      qwen: 'Qwen (千问)',
      gpt: 'GPT',
      claude: 'Claude'
    }

    container.innerHTML = `
      <div class="ai-config-panel">
        ${this.aiModels.map(model => `
          <div class="config-card">
            <div class="config-card-header">
              <span>${modelNames[model.name] || model.name}</span>
              <span class="model-status ${model.apiKey ? 'connected' : 'disconnected'}">
                ${model.apiKey ? '已配置' : '未配置'}
              </span>
            </div>
            <div class="config-field">
              <label>API Key</label>
              <input type="password" id="aiKey-${model.name}" value="${model.apiKey}"
                     placeholder="输入API密钥" onchange="app.updateAIModelField('${model.name}', 'apiKey', this.value)">
            </div>
            <div class="config-field">
              <label>Base URL</label>
              <input type="text" id="aiUrl-${model.name}" value="${model.baseUrl}"
                     placeholder="API地址" onchange="app.updateAIModelField('${model.name}', 'baseUrl', this.value)">
            </div>
            <div class="config-field">
              <label>模型名称</label>
              <input type="text" id="aiModel-${model.name}" value="${model.model || ''}"
                     placeholder="如: deepseek-chat / gpt-4o / glm-4 / claude-3-5-sonnet"
                     onchange="app.updateAIModelField('${model.name}', 'model', this.value)">
            </div>
          </div>
        `).join('')}
        <button class="btn btn-primary" style="width:100%;padding:0.6rem;font-size:0.88rem;margin-top:0.5rem" onclick="app.confirmAIConfig()">确定</button>
      </div>
    `
  }

  confirmAIConfig(): void {
    for (const model of this.aiModels) {
      const keyInput = document.getElementById(`aiKey-${model.name}`) as HTMLInputElement
      const urlInput = document.getElementById(`aiUrl-${model.name}`) as HTMLInputElement
      const modelInput = document.getElementById(`aiModel-${model.name}`) as HTMLInputElement
      if (keyInput) model.apiKey = keyInput.value
      if (urlInput) model.baseUrl = urlInput.value
      if (modelInput) model.model = modelInput.value
    }
    localStorage.setItem('eide-ai-models', JSON.stringify(this.aiModels))
    for (const model of this.aiModels) {
      if (model.apiKey && window.eideAPI) {
        window.eideAPI.aiConfigureModel(model.name, model.apiKey, model.baseUrl, model.model)
      }
    }
    const configuredCount = this.aiModels.filter(m => m.apiKey).length
    const totalCount = this.aiModels.length
    this.hideAIConfigModal()
    this.renderAIModelSelect()
    this.showToast(`✅ 已保存 AI 配置 (${configuredCount}/${totalCount} 个模型已配置)`, 'success')
  }

  updateAIModelField(modelName: string, field: 'apiKey' | 'baseUrl' | 'model', value: string): void {
    const model = this.aiModels.find(m => m.name === modelName)
    if (model) {
      model[field] = value
      const statusEl = document.querySelector(`#aiKey-${modelName}`)?.closest('.config-card')?.querySelector('.model-status')
      if (statusEl && field === 'apiKey') {
        statusEl.className = `model-status ${value ? 'connected' : 'disconnected'}`
        statusEl.textContent = value ? '已配置' : '未配置'
      }
    }
  }

  private renderAIModelSelect(): void {
    const select = document.getElementById('aiModelSelect') as HTMLSelectElement
    if (!select) return
    const prevValue = select.value
    const modelNames: Record<string, string> = {
      deepseek: 'DeepSeek', glm: 'GLM (智谱)', kimi: 'Kimi',
      qwen: 'Qwen (千问)', gpt: 'GPT', claude: 'Claude'
    }
    let html = '<option value="">选择模型...</option>'
    for (const model of this.aiModels) {
      html += `<option value="${model.name}">${modelNames[model.name] || model.name}</option>`
    }
    html += '<option disabled>──── CLI 智能编程模式 ────</option>'
    const cliModels = this.aiModels.filter(m => ['deepseek', 'gpt', 'glm', 'claude'].includes(m.name))
    for (const model of cliModels) {
      const label = `${modelNames[model.name]}-CLI`
      html += `<option value="${model.name}-cli">${label}</option>`
    }
    select.innerHTML = html
    select.value = prevValue
  }

  updateAIModel(modelName: string, field: 'apiKey' | 'baseUrl', value: string): void {
    const model = this.aiModels.find(m => m.name === modelName)
    if (model) {
      model[field] = value
      localStorage.setItem('eide-ai-models', JSON.stringify(this.aiModels))
      const statusEl = document.querySelector(`#aiConfigModal .config-card-header span:last-child`)
      if (statusEl && field === 'apiKey') {
        statusEl.className = `model-status ${value ? 'connected' : 'disconnected'}`
        statusEl.textContent = value ? '已配置' : '未配置'
      }
    }
  }

  switchAITab(tabId: string): void {
    document.querySelectorAll('.ai-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent?.includes(tabId === 'chat' ? 'AI 助手' : '软件和插件'))
    })
    document.querySelectorAll('.ai-panel-content').forEach(content => {
      content.classList.remove('active')
    })
    const targetPanel = document.getElementById(tabId === 'chat' ? 'aiChatPanel' : 'aiPluginPanel')
    if (targetPanel) {
      targetPanel.classList.add('active')
      if (tabId === 'plugins') {
        this.renderRightPanelExtensions()
      }
    }
  }

  async sendAIMessage(): Promise<void> {
    const input = document.getElementById('aiInput') as HTMLTextAreaElement
    const message = input.value.trim()
    if (!message) return
    if (!this.currentAIModel) {
      this.addAIMessage('ai', '请先选择AI模型')
      return
    }

    const isCLI = this.currentAIModel.endsWith('-cli')
    const baseModel = isCLI ? this.currentAIModel.replace('-cli', '') : this.currentAIModel
    const modelObj = this.aiModels.find(m => m.name === baseModel)
    if (!modelObj || !modelObj.apiKey) {
      this.addAIMessage('ai', `模型 "${this.currentAIModel}" 未配置API密钥，请先在配置中填入密钥`)
      return
    }

    let fullMessage = message
    const ctxContent = await this.getContextFileContents()
    if (ctxContent) {
      fullMessage = message + ctxContent
    }

    const pairEl = document.createElement('div')
    pairEl.className = 'message-pair'
    pairEl.setAttribute('data-user-message', message)

    this.addMessageToPair(pairEl, 'user', message)
    input.value = ''

    const thinkingEl = document.createElement('div')
    thinkingEl.className = 'message ai-message'
    thinkingEl.id = 'thinking-message-' + Date.now()
    const loadingText = isCLI ? '🔧 CLI Agent 正在工作...' : '思考中...'
    thinkingEl.innerHTML = '<span class="loading-spinner"></span>' + loadingText
    pairEl.appendChild(thinkingEl)

    const undoBtn = document.createElement('button')
    undoBtn.className = 'message-undo-btn'
    undoBtn.textContent = '↩ 撤销'
    undoBtn.onclick = async () => {
      await this.undoMessagePair(pairEl)
    }
    pairEl.appendChild(undoBtn)

    const chat = document.getElementById('aiChat')
    if (chat) {
      chat.appendChild(pairEl)
      chat.scrollTop = chat.scrollHeight
    }
    this.messagePairStack.push(pairEl)

    if (isCLI) {
      let cleanup: (() => void) | null = null
      let skillMsgEl: HTMLElement | null = null

      if (window.eideAPI && window.eideAPI.onCLIProgress) {
        cleanup = window.eideAPI.onCLIProgress((progress: any) => {
          if (progress.type === 'skill_start') {
            skillMsgEl = this.addAIMessageWithStatus('ai', `🔧 调用技能: ${progress.skillName}...`, 'skill')
          } else if (progress.type === 'skill_end' && skillMsgEl) {
            const result = progress.skillResult || progress.skillError || ''
            const short = result.length > 200 ? result.substring(0, 200) + '...' : result
            skillMsgEl.textContent = `✅ ${progress.skillName}: ${short}`
            skillMsgEl.className = 'message ai-message skill-result'
          } else if (progress.type === 'error') {
            this.addMessageToPair(pairEl, 'ai', `❌ ${progress.content}`)
          }
        })
      }

      try {
        const response = await this.callCLIModel(baseModel, fullMessage)
        thinkingEl.remove()
        if (cleanup) cleanup()
        if (response.success && response.content) {
          this.addMessageToPair(pairEl, 'ai', response.content)
          this.tryApplyCLIChanges(response.content)
          this.autoRefreshAfterCLI()
        } else {
          this.addMessageToPair(pairEl, 'ai', `调用失败: ${response.error || '未知错误'}`)
          this.showModelErrorHelp(response.error || '', baseModel)
        }
      } catch (error: any) {
        thinkingEl.remove()
        if (cleanup) cleanup()
        this.addMessageToPair(pairEl, 'ai', `调用失败: ${error.message || error}`)
        this.showModelErrorHelp(error.message || String(error), baseModel)
      }
    } else {
      try {
        const response = await this.callAIModelAPI(baseModel, fullMessage)
        thinkingEl.remove()
        if (response.success && response.content) {
          this.addMessageToPair(pairEl, 'ai', response.content)
        } else {
          this.addMessageToPair(pairEl, 'ai', `调用失败: ${response.error || '未知错误'}`)
          this.showModelErrorHelp(response.error || '', baseModel)
        }
      } catch (error: any) {
        thinkingEl.remove()
        this.addMessageToPair(pairEl, 'ai', `调用失败: ${error.message || error}`)
        this.showModelErrorHelp(error.message || String(error), baseModel)
      }
    }
  }

  private addMessageToPair(pair: HTMLElement, sender: 'user' | 'ai', content: string): HTMLElement {
    const div = document.createElement('div')
    div.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`
    div.textContent = content
    const undoBtn = pair.querySelector('.message-undo-btn')
    if (undoBtn) {
      pair.insertBefore(div, undoBtn)
    } else {
      pair.appendChild(div)
    }
    const chat = document.getElementById('aiChat')
    if (chat) chat.scrollTop = chat.scrollHeight
    return div
  }

  private async callAIModelAPI(modelName: string, message: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!window.eideAPI) {
      return { success: false, error: 'eideAPI 不可用' }
    }
    return window.eideAPI.aiSendMessage(modelName, message)
  }

  private async callCLIModel(modelName: string, task: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!window.eideAPI) {
      return { success: false, error: 'eideAPI 不可用' }
    }
    const context = {
      projectPath: this.currentProjectPath || '',
      currentFile: this.currentFile || undefined,
      osInfo: `${navigator.platform} / ${navigator.userAgent}`,
      workingDir: this.currentProjectPath || '未打开项目'
    }
    return window.eideAPI.aiExecuteCLI(modelName, task, context)
  }

  private tryApplyCLIChanges(content: string): void {
    const fileRegex = /```file:([^\n]+)\n([\s\S]*?)```/g
    let match
    const changes: { file: string; content: string }[] = []
    while ((match = fileRegex.exec(content)) !== null) {
      changes.push({ file: match[1].trim(), content: match[2].trim() })
    }
    if (changes.length === 0) return

    const btnContainer = document.createElement('div')
    btnContainer.style.cssText = 'padding:0.5rem;margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap'
    const fileList = changes.map(c => c.file).join(', ')
    const applyBtn = document.createElement('button')
    applyBtn.className = 'ext-btn install'
    applyBtn.style.cssText = 'font-size:0.8rem;padding:0.4rem 0.8rem'
    applyBtn.textContent = `📝 应用修改 (${changes.length}个文件: ${fileList})`
    applyBtn.onclick = async () => {
      applyBtn.textContent = '应用修改中...'
      applyBtn.disabled = true

      const pairEl = applyBtn.closest('.message-pair') as HTMLElement | null
      const modifiedAbsPaths: string[] = []
      for (const change of changes) {
        if (window.eideAPI && this.currentProjectPath) {
          const absPath = this.currentProjectPath.replace(/\\/g, '/') + '/' + change.file.replace(/\\/g, '/')
          if (pairEl) {
            await this.saveFileSnapshot(pairEl, absPath)
          }
          const result = await window.eideAPI.aiApplyChange(this.currentProjectPath, change.file, change.content)
          if (result.success) {
            this.showToast(`✅ 已修改: ${change.file}`, 'success')
            modifiedAbsPaths.push(absPath)
          } else {
            this.showToast(`❌ 修改失败: ${change.file} - ${result.error}`, 'error')
          }
        }
      }

      if (modifiedAbsPaths.length > 0) {
        this.refreshAffectedFiles(modifiedAbsPaths)
        this.loadRunOptions()
      }

      applyBtn.textContent = '✅ 修改完成'
      setTimeout(() => btnContainer.remove(), 3000)
    }
    btnContainer.appendChild(applyBtn)
    const chat = document.getElementById('aiChat')
    if (chat) {
      chat.appendChild(btnContainer)
      chat.scrollTop = chat.scrollHeight
    }
  }

  private async refreshAffectedFiles(modifiedAbsPaths: string[]): Promise<void> {
    if (!this.currentProjectPath || !window.eideAPI) return

    await this.loadFileTree(this.currentProjectPath)

    for (const tabPath of this.openTabs) {
      const normTab = tabPath.replace(/\\/g, '/')
      const isAffected = modifiedAbsPaths.some(p => p.replace(/\\/g, '/') === normTab)
      if (isAffected) {
        try {
          let content: string
          if (this.isRemoteMode && this.sshConfig) {
            const r = await window.eideAPI.readRemoteFile(this.sshConfig, tabPath)
            content = r.content || ''
          } else {
            content = await window.eideAPI.readFile(tabPath)
          }
          if (this.cmView && this.currentFile === tabPath) {
            setEditorContent(this.cmView, content)
          }
        } catch {}
      }
    }

    if (this.currentFile) {
      const normCur = this.currentFile.replace(/\\/g, '/')
      const affected = modifiedAbsPaths.find(p => p.replace(/\\/g, '/') === normCur)
      if (!affected) {
        if (this.cmView) {
          try {
            let content: string
            if (this.isRemoteMode && this.sshConfig) {
              const r = await window.eideAPI.readRemoteFile(this.sshConfig, this.currentFile)
              content = r.content || ''
            } else {
              content = await window.eideAPI.readFile(this.currentFile)
            }
            setEditorContent(this.cmView, content)
          } catch {}
        }
      }
    }
  }

  private async autoRefreshAfterCLI(): Promise<void> {
    if (!this.currentProjectPath) return
    await this.loadFileTree(this.currentProjectPath)
    this.loadRunOptions()
    if (this.currentFile && window.eideAPI) {
      try {
        let content: string
        if (this.isRemoteMode && this.sshConfig) {
          const r = await window.eideAPI.readRemoteFile(this.sshConfig, this.currentFile)
          content = r.content || ''
        } else {
          content = await window.eideAPI.readFile(this.currentFile)
        }
        if (this.cmView) {
          setEditorContent(this.cmView, content)
        }
      } catch {}
    }
  }

  private showModelErrorHelp(error: string, modelName: string): void {
    const website = modelName ? (() => {
      const m: Record<string, string> = {
        deepseek: 'https://platform.deepseek.com',
        glm: 'https://open.bigmodel.cn',
        kimi: 'https://platform.moonshot.cn',
        qwen: 'https://dashscope.aliyuncs.com',
        gpt: 'https://platform.openai.com',
        claude: 'https://console.anthropic.com'
      }
      return m[modelName] || ''
    })() : ''

    if (error.includes('401') || error.includes('密钥')) {
      this.addAIMessage('ai', `⚠️ 模型名称或API密钥错误，请检查配置。\n📎 官网: ${website}`)
    } else if (error.includes('402') || error.includes('欠费')) {
      this.addAIMessage('ai', `💰 该模型已欠费，请交费充值后使用。\n📎 官网: ${website}`)
    }
  }

  private addAIMessage(sender: 'user' | 'ai', content: string, isThinking = false): void {
    const chat = document.getElementById('aiChat')
    if (!chat) return
    const div = document.createElement('div')
    div.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`
    if (isThinking) {
      div.id = 'thinking-message'
      div.innerHTML = '<span class="loading-spinner"></span>' + content
    } else {
      div.textContent = content
    }
    chat.appendChild(div)
    chat.scrollTop = chat.scrollHeight
  }

  private addAIMessageWithStatus(sender: 'user' | 'ai', content: string, status: string): HTMLElement {
    const chat = document.getElementById('aiChat')
    const div = document.createElement('div')
    div.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'} skill-msg`
    div.style.cssText = 'color:#888;font-size:0.82rem;padding:0.3rem 0.6rem;margin:0.2rem 0;border-left:3px solid #007acc;background:#f0f7ff'
    div.textContent = content
    if (chat) {
      chat.appendChild(div)
      chat.scrollTop = chat.scrollHeight
    }
    return div
  }

  private removeThinkingMessage(): void {
    const el = document.getElementById('thinking-message')
    if (el) el.remove()
  }

  private searchLocalProjects(_query: string): void {}

  private setStatus(el: HTMLElement | null, msg: string, type: 'error' | 'success' | 'info'): void {
    if (el) {
      el.textContent = msg
      el.className = `status-msg ${type}`
    }
  }

  showFileMenu(): void {}
  showSettings(): void {}

  openTerminal(): void {
    alert('按钮点击成功！正在打开终端...')
    console.log('[Renderer] openTerminal called')
    
    if (!window.eideAPI) {
      alert('错误：window.eideAPI 不存在！')
      console.error('[Renderer] window.eideAPI not available!')
      return
    }

    const cwd = this.currentProjectPath || undefined
    console.log('[Renderer] Opening terminal with cwd:', cwd)
    
    try {
      window.eideAPI.openTerminal(cwd)
      console.log('[Renderer] openTerminal API call sent')
      alert(`终端打开请求已发送！目录: ${cwd || '默认'}`)
    } catch (error) {
      console.error('[Renderer] Error calling openTerminal:', error)
      alert(`调用失败: ${error}`)
    }
  }

  showGitMenu(): void {
    this.showGitPushModal()
  }

  showGitPushModal(): void {
    const modal = document.getElementById('gitPushModal')
    if (modal) {
      const localInput = document.getElementById('gitLocalPath') as HTMLInputElement
      if (localInput && !localInput.value && this.currentProjectPath) {
        localInput.value = this.currentProjectPath
      }
      modal.classList.add('show')
    }
  }

  hideGitPushModal(): void {
    const modal = document.getElementById('gitPushModal')
    if (modal) modal.classList.remove('show')
  }

  selectGitLocalPath(): void {
    if (!window.eideAPI) return
    window.eideAPI.selectDirectory().then(result => {
      if (!result.canceled && result.path) {
        const input = document.getElementById('gitLocalPath') as HTMLInputElement
        if (input) input.value = result.path
      }
    })
  }

  async loadGitStatus(): Promise<void> {
    const localPath = (document.getElementById('gitLocalPath') as HTMLInputElement).value.trim()
    if (!localPath || !window.eideAPI) return
    const area = document.getElementById('gitStatusArea')
    if (area) {
      area.style.display = 'block'
      area.textContent = '正在检查...'
    }
    const result = await window.eideAPI.gitStatus(localPath)
    if (area) {
      if (result.success) {
        const files = result.files || []
        const branch = result.branch || '未检测到分支'
        area.innerHTML = `<div>✅ 分支: <b>${branch}</b></div><div>📄 变更文件 (${files.length}): ${files.slice(0, 20).join(', ') || '无'}</div>`
        area.style.color = '#333'
      } else {
        area.textContent = `⚠ ${result.error}`
        area.style.color = '#e74c3c'
      }
    }
  }

  async gitPush(): Promise<void> {
    const username = (document.getElementById('gitUsername') as HTMLInputElement).value.trim()
    const token = (document.getElementById('gitToken') as HTMLInputElement).value.trim()
    const remoteUrl = (document.getElementById('gitRemoteUrl') as HTMLInputElement).value.trim()
    const branch = (document.getElementById('gitBranch') as HTMLInputElement).value.trim() || 'main'
    const localPath = (document.getElementById('gitLocalPath') as HTMLInputElement).value.trim()
    const commitMsg = (document.getElementById('gitCommitMsg') as HTMLInputElement).value.trim()

    if (!username || !token || !remoteUrl || !localPath) {
      this.showToast('请填写完整信息', 'error')
      return
    }

    if (!window.eideAPI) return
    this.showToast('⬆ 正在推送代码...', 'info')

    const result = await window.eideAPI.gitPush({
      localPath, remoteUrl, branch, username, token, commitMessage: commitMsg
    })

    if (result.success) {
      this.showToast(`✅ 推送成功！${username}/${remoteUrl} → ${branch}`, 'success')
      this.hideGitPushModal()
    } else {
      this.showToast(`❌ 推送失败: ${result.error}`, 'error')
    }
  }

  runProject(): void {
    const select = document.getElementById('runFileSelect') as HTMLSelectElement
    const browserSelect = document.getElementById('runBrowserSelect') as HTMLSelectElement
    const selectedFile = (select?.value || '').replace(/\\/g, '/')
    if (!selectedFile) {
      this.showToast('请先选择要运行的文件', 'info')
      return
    }
    const runnable = this.runnableFiles.find(r => r.path.replace(/\\/g, '/') === selectedFile)
    if (!runnable) {
      this.showToast('运行配置未找到，请刷新', 'error')
      return
    }
    if (runnable.isWeb) {
      const browser = browserSelect?.value || 'edge'
      if (window.eideAPI) {
        window.eideAPI.runOpenBrowser(runnable.path, browser)
        const browserNames: Record<string, string> = { edge: 'Edge', chrome: 'Chrome', quark: '夸克' }
        this.showToast(`🌐 正在用 ${browserNames[browser] || browser} 打开网页...`, 'info')
      }
      return
    }
    if (!window.eideAPI) return
    let runtimeName = runnable.runtime
    let runtimePath = runnable.runtimePath

    if (this.selectedRuntime && this.selectedRuntime.startsWith('custom_')) {
      const cr = this.customRuntimes.find(r => r.id === this.selectedRuntime)
      if (cr) {
        runtimeName = 'custom'
        runtimePath = cr.exePath
      }
    }

    this.showToast(`▶ 正在运行: ${runnable.name} (${runnable.runtimeDisplay})`, 'info')

    if (this.isRemoteMode && this.sshConfig) {
      window.eideAPI.sshRunFile(
        this.sshConfig,
        runnable.path,
        runtimeName,
        this.currentProjectPath || '/'
      ).then((result: any) => {
        this.showRunOutput(result)
      }).catch((err: any) => {
        this.showToast(`❌ 运行异常: ${err.message}`, 'error')
      })
      return
    }

    window.eideAPI.runExecute(
      runnable.path,
      runtimeName,
      runtimePath,
      this.currentProjectPath || ''
    ).then((result: any) => {
      this.showRunOutput(result)
    }).catch((err: any) => {
      this.showToast(`❌ 运行异常: ${err.message}`, 'error')
    })
  }

  private showRunOutput(result: any): void {
    if (result.success) {
      const outputEl = document.createElement('div')
      outputEl.style.cssText = 'position:fixed;bottom:48px;right:24px;z-index:9999;width:500px;max-width:90vw;max-height:300px;overflow-y:auto;background:#1e1e1e;color:#4ec9b0;border-radius:8px;padding:12px;font-family:Consolas,monospace;font-size:0.78rem;box-shadow:0 4px 20px rgba(0,0,0,0.3);white-space:pre-wrap;word-break:break-all'
      outputEl.textContent = result.output || '(无输出)'
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '×'
      closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:none;border:none;color:#888;font-size:1rem;cursor:pointer'
      closeBtn.onclick = () => outputEl.remove()
      outputEl.appendChild(closeBtn)
      document.body.appendChild(outputEl)
      setTimeout(() => outputEl.remove(), 60000)
    } else {
      this.showToast(`❌ 运行失败: ${result.error}`, 'error')
    }
  }

  async detectEnvironments(): Promise<void> {
    this.loadCustomRuntimes()
    if (!window.eideAPI) {
      this.renderEnvRuntimeSelect()
      return
    }
    try {
      if (this.isRemoteMode && this.sshConfig) {
        this.detectedRuntimes = await window.eideAPI.sshDetectRuntimes(this.sshConfig, this.currentProjectPath || '/home')
      } else {
        this.detectedRuntimes = await window.eideAPI.detectRuntimes()
      }
    } catch {
      this.detectedRuntimes = []
    }
    this.renderEnvRuntimeSelect()
  }

  private loadCustomRuntimes(): void {
    const saved = localStorage.getItem('eide-custom-runtimes')
    if (saved) {
      try { this.customRuntimes = JSON.parse(saved) } catch { this.customRuntimes = [] }
    }
  }

  private saveCustomRuntimes(): void {
    localStorage.setItem('eide-custom-runtimes', JSON.stringify(this.customRuntimes))
  }

  async addCustomRuntime(): Promise<void> {
    if (!window.eideAPI) return
    const result = await window.eideAPI.selectExe()
    if (result.canceled || !result.path) return

    const name = prompt('请输入该环境的显示名称（如: Lua 5.4）：', '')
    if (!name) return

    const exePath = result.path
    const id = 'custom_' + Date.now()
    this.customRuntimes.push({
      id,
      name,
      displayName: name,
      exePath,
      version: '用户自定义',
      isCustom: true
    })
    this.saveCustomRuntimes()
    this.selectedRuntime = id
    this.renderEnvRuntimeSelect()
    const select = document.getElementById('envRuntimeSelect') as HTMLSelectElement
    if (select) select.value = id
    this.showToast(`✅ 已添加自定义环境: ${name}`, 'success')
  }

  removeCustomRuntime(id: string): void {
    this.customRuntimes = this.customRuntimes.filter(r => r.id !== id)
    if (this.selectedRuntime === id) {
      this.selectedRuntime = ''
      this.renderRunSelect()
    }
    this.saveCustomRuntimes()
    this.renderEnvRuntimeSelect()
    this.showToast('已移除自定义环境', 'info')
  }

  private getAllRuntimes(): any[] {
    return [...this.detectedRuntimes, ...this.customRuntimes]
  }

  onEnvRuntimeChange(value: string): void {
    this.selectedRuntime = value
    this.renderRunSelect()
    const browserSel = document.getElementById('runBrowserSelect') as HTMLSelectElement
    if (browserSel) {
      browserSel.style.display = value === 'browser' ? 'inline-block' : 'none'
    }
  }

  onRunFileChange(value: string): void {
    const normalizedValue = (value || '').replace(/\\/g, '/')
    const runnable = this.runnableFiles.find(r => r.path.replace(/\\/g, '/') === normalizedValue)
    const browserSel = document.getElementById('runBrowserSelect') as HTMLSelectElement
    if (browserSel) {
      browserSel.style.display = runnable?.isWeb ? 'inline-block' : 'none'
    }
  }

  onRunBrowserChange(_value: string): void {}

  private renderEnvRuntimeSelect(): void {
    const select = document.getElementById('envRuntimeSelect') as HTMLSelectElement
    if (!select) return
    const prevValue = select.value
    const iconMap: Record<string, string> = {
      python: '🐍', node: '💚', java: '☕', gcc: '⚙️', php: '🐘',
      go: '🔵', cargo: '🦀', r: '📊', matlab: '🔢', dotnet: '🟣',
      git: '🔀', browser: '🌐'
    }
    let html = '<option value="">全部</option>'
    for (const rt of this.detectedRuntimes) {
      const icon = iconMap[rt.id] || '📦'
      const ver = rt.version ? ` ${rt.version}` : ''
      html += `<option value="${rt.id}">${icon} ${rt.displayName}${ver}</option>`
    }
    html += '<option value="browser">🌐 网页预览</option>'
    if (this.customRuntimes.length > 0) {
      html += '<option disabled>──── 自定义环境 ────</option>'
      for (const rt of this.customRuntimes) {
        html += `<option value="${rt.id}">✏ ${rt.displayName}</option>`
      }
    }
    select.innerHTML = html

    if ((prevValue && prevValue !== '__add_custom__')) {
      select.value = prevValue
    }
  }

  private filterRunnablesByRuntime(): any[] {
    if (!this.selectedRuntime) return this.runnableFiles
    if (this.selectedRuntime === 'browser') {
      return this.runnableFiles.filter(r => r.isWeb)
    }
    return this.runnableFiles.filter(r => r.runtime === this.selectedRuntime)
  }

  async loadRunOptions(): Promise<void> {
    if (!this.currentProjectPath || !window.eideAPI) return
    if (this.isRemoteMode && this.sshConfig) {
      this.runnableFiles = await window.eideAPI.sshScanRunnables(this.sshConfig, this.currentProjectPath)
    } else {
      this.runnableFiles = await window.eideAPI.scanProjectRunnables(this.currentProjectPath)
    }
    this.runnableLoaded = true
    this.renderRunSelect()
  }

  private renderRunSelect(): void {
    const select = document.getElementById('runFileSelect') as HTMLSelectElement
    if (!select) return
    const prev = select.value
    const files = this.filterRunnablesByRuntime()
    const byType: Record<string, string> = {
      web: '🌐 网页', package: '📦 包管理', script: '📄 脚本'
    }
    const typeBuckets: Record<string, any[]> = {}
    for (const r of files) {
      const k = r.packageType || 'script'
      if (!typeBuckets[k]) typeBuckets[k] = []
      typeBuckets[k].push(r)
    }
    let html = '<option value="">选择运行文件...</option>'
    for (const [k, flist] of Object.entries(typeBuckets)) {
      html += `<optgroup label="${byType[k] || k} (${flist.length})">`
      for (const f of flist) {
        html += `<option value="${f.path}">${f.relativePath} (${f.type})</option>`
      }
      html += '</optgroup>'
    }
    select.innerHTML = html
    const normPrev = prev.replace(/\\/g, '/')
    if (prev && files.some((r: any) => r.path.replace(/\\/g, '/') === normPrev)) {
      select.value = prev
    }
  }

  private async ctxNewFile(): Promise<void> {
    if (!this.contextTarget || !window.eideAPI) return
    const fileName = await this.showInlineInput('新建文件', '新建文件.txt', '请输入文件名')
    if (!fileName) return

    const type = this.contextTarget.type
    const targetPath = this.contextTarget.path
    const isRemote = this.isRemoteMode && !!this.sshConfig
    const sep = isRemote ? '/' : '\\'
    const parentPath = type === 'directory'
      ? targetPath
      : targetPath.substring(0, targetPath.lastIndexOf(sep))

    const fullPath = parentPath + sep + fileName

    const writePromise = isRemote
      ? window.eideAPI.writeRemoteFile(this.sshConfig, fullPath, '')
      : window.eideAPI.writeFile(fullPath, '')

    try {
      await writePromise
      this.showToast(`文件已创建: ${fileName}`, 'success')
      if (this.currentProjectPath) {
        this.loadFileTree(this.currentProjectPath)
      }
    } catch (error: any) {
      this.showToast(`创建文件失败: ${error}`, 'error')
    }
  }

  private async ctxNewFolder(): Promise<void> {
    if (!this.contextTarget || !window.eideAPI) return
    const folderName = await this.showInlineInput('新建文件夹', '新建文件夹', '请输入文件夹名称')
    if (!folderName) return

    const type = this.contextTarget.type
    const targetPath = this.contextTarget.path
    const isRemote = this.isRemoteMode && !!this.sshConfig
    const sep = isRemote ? '/' : '\\'
    const parentPath = type === 'directory'
      ? targetPath
      : targetPath.substring(0, targetPath.lastIndexOf(sep))

    const fullPath = parentPath + sep + folderName

    try {
      const result = await window.eideAPI.createDir(fullPath)
      if (result.success) {
        this.showToast(`文件夹已创建: ${folderName}`, 'success')
        if (this.currentProjectPath) {
          this.loadFileTree(this.currentProjectPath)
        }
      } else {
        this.showToast(`创建文件夹失败: ${result.error}`, 'error')
      }
    } catch (error: any) {
      this.showToast(`创建文件夹失败: ${error}`, 'error')
    }
  }

  private ctxCopyPath(): void {
    if (!this.contextTarget) return

    const absolutePath = this.contextTarget.path
    navigator.clipboard.writeText(absolutePath).then(() => {
      this.showToast('路径已复制到剪贴板', 'success')
    }).catch(() => {
      this.showToast('复制失败', 'error')
    })
  }

  private async ctxRename(): Promise<void> {
    if (!this.contextTarget || !window.eideAPI) return

    const oldPath = this.contextTarget.path
    const oldName = oldPath.split(/[\\/]/).pop() || ''
    const newName = await this.showInlineInput('重命名', oldName, '请输入新名称')
    if (!newName || newName === oldName) return

    const isRemote = this.isRemoteMode && !!this.sshConfig
    const sep = isRemote ? '/' : '\\'
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf(sep))
    const newPath = parentDir + sep + newName

    try {
      const result = await window.eideAPI.rename(oldPath, newPath)
      if (result.success) {
        this.showToast(`已重命名: ${oldName} → ${newName}`, 'success')
        if (this.currentFile === oldPath) {
          this.currentFile = newPath
          const tabIdx = this.openTabs.indexOf(oldPath)
          if (tabIdx !== -1) {
            this.openTabs[tabIdx] = newPath
            this.renderTabs()
          }
        }
        if (this.currentProjectPath) {
          this.loadFileTree(this.currentProjectPath)
        }
      } else {
        this.showToast(`重命名失败: ${result.error}`, 'error')
      }
    } catch (error: any) {
      this.showToast(`重命名失败: ${error}`, 'error')
    }
  }

  private ctxCut(): void {
    if (!this.contextTarget) return

    const name = this.contextTarget.path.split(/[\\/]/).pop() || ''
    this.clipboardData = { type: 'cut', path: this.contextTarget.path, name }
    this.showToast(`已剪切: ${name}`, 'info')
  }

  private ctxCopy(): void {
    if (!this.contextTarget) return

    const name = this.contextTarget.path.split(/[\\/]/).pop() || ''
    this.clipboardData = { type: 'copy', path: this.contextTarget.path, name }
    this.showToast(`已复制: ${name}`, 'info')
  }

  private async ctxPaste(): Promise<void> {
    if (!this.clipboardData || !this.contextTarget || !window.eideAPI) {
      this.showToast('没有可粘贴的内容', 'info')
      return
    }

    const isRemote = this.isRemoteMode && !!this.sshConfig
    const sep = isRemote ? '/' : '\\'
    const targetDir = this.contextTarget.type === 'directory'
      ? this.contextTarget.path
      : this.contextTarget.path.substring(0, this.contextTarget.path.lastIndexOf(sep))

    const srcPath = this.clipboardData.path
    const srcName = this.clipboardData.name
    const destPath = targetDir + sep + srcName
    const isCut = this.clipboardData.type === 'cut'

    try {
      const content = await window.eideAPI.readFile(srcPath)
      await window.eideAPI.writeFile(destPath, content)
      if (isCut) {
        await window.eideAPI.deleteFileOrDir(srcPath)
        this.clipboardData = null
      }
      this.showToast(`已粘贴: ${srcName}`, 'success')
      if (this.currentProjectPath) {
        this.loadFileTree(this.currentProjectPath)
      }
    } catch (error: any) {
      this.showToast(`粘贴失败: ${error}`, 'error')
    }
  }

  private async ctxDelete(): Promise<void> {
    if (!this.contextTarget || !window.eideAPI) return

    const targetPath = this.contextTarget.path
    const name = targetPath.split(/[\\/]/).pop() || ''
    const confirmed = await this.showInlineConfirm('确认删除', `确定要删除 "${name}" 吗？此操作不可撤销。`)
    if (!confirmed) return

    try {
      const result = await window.eideAPI.deleteFileOrDir(targetPath)
      if (result.success) {
        this.showToast(`已删除: ${name}`, 'success')
        if (this.currentFile && this.currentFile.startsWith(targetPath)) {
          this.currentFile = ''
          this.openTabs = this.openTabs.filter(t => !t.startsWith(targetPath))
          this.renderTabs()
          if (this.cmView) {
            setEditorContent(this.cmView, '')
          }
        }
        if (this.currentProjectPath) {
          this.loadFileTree(this.currentProjectPath)
        }
      } else {
        this.showToast(`删除失败: ${result.error}`, 'error')
      }
    } catch (error: any) {
      this.showToast(`删除失败: ${error}`, 'error')
    }
  }

  private editorCtxAction(action: string): void {
    this.hideAllContextMenus()
    if (!this.cmView) return

    const view = this.cmView
    const selection = view.state.selection.main
    const from = selection.from
    const to = selection.to
    const selectedText = view.state.sliceDoc(from, to)

    switch (action) {
      case 'cut':
        navigator.clipboard.writeText(selectedText).then(() => {
          view.dispatch({ changes: { from, to, insert: '' } })
        }).catch(() => {})
        break
      case 'copy':
        navigator.clipboard.writeText(selectedText).catch(() => {})
        break
      case 'paste':
        navigator.clipboard.readText().then(text => {
          view.dispatch({ changes: { from, to, insert: text } })
          this.autoSaveCurrentFile()
        }).catch(() => {
          this.showToast('粘贴失败', 'error')
        })
        break
      case 'refactor':
        if (selectedText) {
          const newName = prompt('重构 - 输入新名称:', selectedText)
          if (newName && newName !== selectedText) {
            view.dispatch({ changes: { from, to, insert: newName } })
            this.autoSaveCurrentFile()
          }
        } else {
          this.showToast('请先选中一段文本', 'info')
        }
        break
    }
  }

  showMarketplace(): void {
    const modal = document.getElementById('marketplaceModal')
    if (modal) {
      modal.classList.add('show')
      this.loadInstalledExtensions()
      this.loadSoftwareList()
      if (this.marketplaceExtensions.length === 0) {
        this.fetchPopularExtensions()
      } else {
        this.renderMarketplaceGrid()
      }
    }
  }

  hideMarketplace(): void {
    const modal = document.getElementById('marketplaceModal')
    if (modal) {
      modal.classList.remove('show')
    }
  }

  switchMarketplaceTab(tab: string, el: HTMLElement): void {
    this.marketplaceTab = tab
    document.querySelectorAll('.marketplace-tab').forEach(t => t.classList.remove('active'))
    el.classList.add('active')
    this.renderMarketplaceGrid()
  }

  async searchMarketplace(): Promise<void> {
    const input = document.getElementById('marketplaceSearchInput') as HTMLInputElement
    const sortBy = (document.getElementById('marketplaceSortBy') as HTMLSelectElement).value
    const query = input?.value.trim() || ''

    const grid = document.getElementById('marketplaceGrid')
    if (grid) {
      grid.innerHTML = '<div class="marketplace-loading"><span class="loading-spinner"></span> 正在搜索...</div>'
    }

    try {
      const body = {
        filters: [{
          criteria: [
            { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
            { filterType: 10, value: query || 'popular' },
            { filterType: 12, value: '4096' }
          ],
          pageNumber: 1,
          pageSize: 50,
          sortBy: parseInt(sortBy),
          sortOrder: 0
        }],
        flags: 914
      }

      const resp = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json;api-version=3.0-preview.1'
        },
        body: JSON.stringify(body)
      })

      const data = await resp.json()
      this.marketplaceExtensions = data.results?.[0]?.extensions || []
      this.marketplaceTab = 'popular'
      document.querySelectorAll('.marketplace-tab').forEach(t => t.classList.remove('active'))
      const popularTab = document.querySelector('.marketplace-tab')
      if (popularTab) popularTab.classList.add('active')
      this.renderMarketplaceGrid()
    } catch (error) {
      console.error('搜索插件失败:', error)
      if (grid) {
        grid.innerHTML = '<div class="marketplace-empty">搜索失败，请检查网络连接后重试</div>'
      }
    }
  }

  private async fetchPopularExtensions(): Promise<void> {
    try {
      const body = {
        filters: [{
          criteria: [
            { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
            { filterType: 12, value: '4096' }
          ],
          pageNumber: 1,
          pageSize: 50,
          sortBy: 4,
          sortOrder: 1
        }],
        flags: 914
      }

      const resp = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json;api-version=3.0-preview.1'
        },
        body: JSON.stringify(body)
      })

      const data = await resp.json()
      this.marketplaceExtensions = data.results?.[0]?.extensions || []
      this.renderMarketplaceGrid()
    } catch (error) {
      console.error('获取热门插件失败:', error)
      const grid = document.getElementById('marketplaceGrid')
      if (grid) {
        grid.innerHTML = '<div class="marketplace-empty">加载失败，请检查网络连接后重试</div>'
      }
    }
  }

  private loadInstalledExtensions(): void {
    const saved = localStorage.getItem('eide-installed-extensions')
    if (saved) {
      try {
        this.installedExtensions = JSON.parse(saved)
      } catch {
        this.installedExtensions = []
      }
    }
    this.disabledExtensions = this.installedExtensions.filter(ext => ext.disabled)
  }

  private saveInstalledExtensions(): void {
    localStorage.setItem('eide-installed-extensions', JSON.stringify(this.installedExtensions))
  }

  private isExtensionInstalled(extId: string): boolean {
    return this.installedExtensions.some(ext => ext.id === extId)
  }

  private isExtensionDisabled(extId: string): boolean {
    return this.disabledExtensions.some(ext => ext.id === extId)
  }

  private getExtensionStat(ext: VSCodeExtension, name: string): number {
    const stat = ext.statistics?.find(s => s.statisticName === name)
    return stat?.value || 0
  }

  private formatNumber(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return n.toString()
  }

  private getExtensionIconUrl(ext: VSCodeExtension): string {
    const version = ext.versions?.[0]
    if (!version) return ''
    const iconFile = version.files?.find(f => f.assetType === 'Microsoft.VisualStudio.Services.Icons.Default')
    return iconFile?.source || ''
  }

  private async loadSoftwareList(): Promise<void> {
    if (window.eideAPI) {
      try {
        this.softwareList = await window.eideAPI.getSoftwareList()
      } catch {
        this.softwareList = []
      }
    }
  }

  async downloadSoftware(id: string): Promise<void> {
    if (!window.eideAPI) return
    const state = this.downloadStates.get(id)
    if (state && (state.status === 'downloading' || state.status === 'extracting' || state.status === 'installing')) {
      return
    }
    const result = await window.eideAPI.startDownload(id)
    if (result.external) {
      this.showToast(`🔗 正在打开 ${this.getSoftwareDisplayName(id)} 官网下载页面...`, 'info')
    }
  }

  async cancelDownload(id: string): Promise<void> {
    if (!window.eideAPI) return
    await window.eideAPI.cancelDownload(id)
    this.downloadStates.delete(id)
    this.renderMarketplaceGrid()
  }

  async uninstallSoftware(id: string): Promise<void> {
    if (!confirm('确定要卸载此软件吗？')) return
    if (!window.eideAPI) return
    const result = await window.eideAPI.uninstallSoftware(id)
    if (result.success) {
      this.installedExtensions = this.installedExtensions.filter(ext => ext.id !== id)
      this.disabledExtensions = this.installedExtensions.filter(ext => ext.disabled)
      this.saveInstalledExtensions()
      this.downloadStates.delete(id)
      this.renderMarketplaceGrid()
      this.updateSettingsPluginList()
      this.renderRightPanelExtensions()
      this.showToast(`🗑 ${this.getSoftwareDisplayName(id)} 已卸载`, 'info')
    } else {
      this.showToast(`❌ 卸载失败: ${result.error}`, 'error')
    }
  }

  private getDownloadStatusText(state: DownloadProgress): string {
    switch (state.status) {
      case 'downloading': return `下载中 ${state.progress}%`
      case 'extracting': return `解压中 ${state.progress}%`
      case 'installing': return '安装中...'
      case 'completed': return '已完成'
      case 'error': return '失败'
      case 'cancelled': return '已取消'
      default: return '等待中'
    }
  }

  private getDownloadSpeedText(state: DownloadProgress): string {
    if (state.speed <= 0) return ''
    if (state.speed > 1024 * 1024) return `${(state.speed / 1024 / 1024).toFixed(1)} MB/s`
    if (state.speed > 1024) return `${(state.speed / 1024).toFixed(0)} KB/s`
    return `${state.speed.toFixed(0)} B/s`
  }

  private formatSize(bytes: number): string {
    if (bytes <= 0) return ''
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${bytes} B`
  }

  private renderMarketplaceGrid(): void {
    const grid = document.getElementById('marketplaceGrid')
    if (!grid) return

    if (this.marketplaceTab === 'installed') {
      this.renderInstalledExtensions(grid)
      return
    }

    if (this.marketplaceTab === 'disabled') {
      this.renderDisabledExtensions(grid)
      return
    }

    let allCards = ''

    allCards += this.buildSoftwareCards()

    if (this.marketplaceExtensions.length > 0) {
      allCards += this.marketplaceExtensions.map(ext => {
        const extId = `${ext.publisher.publisherName}.${ext.extensionName}`
        const installed = this.isExtensionInstalled(extId)
        const disabled = this.isExtensionDisabled(extId)
        const iconUrl = this.getExtensionIconUrl(ext)
        const installs = this.getExtensionStat(ext, 'install')
        const rating = this.getExtensionStat(ext, 'averagerating')
        const ratingCount = this.getExtensionStat(ext, 'ratingcount')
        const dlState = this.downloadStates.get(extId)

        let actionBtn = ''
        if (dlState && (dlState.status === 'downloading' || dlState.status === 'extracting' || dlState.status === 'installing')) {
          actionBtn = this.renderDownloadProgressBar(extId, dlState)
        } else if (disabled) {
          actionBtn = `<button class="ext-btn disabled" onclick="app.enableExtension('${extId}')">已禁用</button>`
        } else if (installed) {
          actionBtn = `<button class="ext-btn installed">已安装</button>
                       <button class="ext-btn" onclick="app.disableExtension('${extId}')">禁用</button>`
        } else {
          actionBtn = `<button class="ext-btn install" onclick="app.installExtension('${extId}', '${ext.displayName.replace(/'/g, "\\'")}', '${ext.publisher.publisherName}', '${ext.versions?.[0]?.version || ''}', '${iconUrl}', '${(ext.shortDescription || '').replace(/'/g, "\\'")}')">安装</button>`
        }

        return `
          <div class="ext-card">
            <div class="ext-card-header">
              <div class="ext-icon">${iconUrl ? `<img src="${iconUrl}" alt="">` : '📦'}</div>
              <div>
                <div class="ext-name" title="${ext.displayName}">${ext.displayName}</div>
                <div class="ext-publisher">${ext.publisher.displayName}</div>
              </div>
            </div>
            <div class="ext-desc">${ext.shortDescription || '暂无描述'}</div>
            <div class="ext-meta">
              <span>⬇ ${this.formatNumber(installs)}</span>
              <span>⭐ ${rating.toFixed(1)} (${ratingCount})</span>
              <span>📦 ${ext.versions?.[0]?.version || 'N/A'}</span>
            </div>
            <div class="ext-actions">${actionBtn}</div>
          </div>
        `
      }).join('')
    }

    if (!allCards) {
      grid.innerHTML = '<div class="marketplace-empty">暂无数据</div>'
      return
    }

    grid.innerHTML = allCards
  }

  private buildSoftwareCards(): string {
    if (this.softwareList.length === 0) return ''

    const categoryLabels: Record<string, string> = {
      language: '🔤 编程语言', runtime: '⚡ 运行时', tool: '🔧 开发工具',
      framework: '🏗 开发框架', database: '🗄 数据库', plugin: '📦 扩展插件'
    }

    return this.softwareList.map(sw => {
      const installed = sw.installed || this.isExtensionInstalled(sw.id)
      const dlState = this.downloadStates.get(sw.id)
      const categoryLabel = categoryLabels[sw.category] || sw.category

      let actionBtn = ''
      if (dlState && (dlState.status === 'downloading' || dlState.status === 'extracting' || dlState.status === 'installing')) {
        actionBtn = this.renderDownloadProgressBar(sw.id, dlState)
      } else if (dlState?.status === 'error') {
        actionBtn = `<div class="download-error">${dlState.error || '下载失败'}</div>
                     <button class="ext-btn install" onclick="app.downloadSoftware('${sw.id}')">重试</button>`
      } else if (installed) {
        actionBtn = `<button class="ext-btn installed">已安装</button>
                     <button class="ext-btn" onclick="app.uninstallSoftware('${sw.id}')" style="color:#e74c3c">卸载</button>`
      } else {
        const isExternal = sw.installerType === 'external'
        const btnLabel = isExternal ? '前往官网下载' : '下载安装'
        actionBtn = `<button class="ext-btn install" onclick="app.downloadSoftware('${sw.id}')">${btnLabel}</button>`
      }

      const iconMap: Record<string, string> = {
        python_3_13: '🐍', python_3_12: '🐍', python_3_11: '🐍', python_3_10: '🐍',
        mingw_c_cpp: '⚙️', mingw_c_cpp_8: '⚙️',
        dotnet_sdk_9: '�', dotnet_sdk_8: '🟣',
        java_jdk_21: '☕', java_jdk_17: '☕', java_jdk_11: '☕', java_jdk_8: '☕',
        node_22: '💚', node_20: '💚', node_18: '💚',
        php_8_4: '🐘', php_8_3: '🐘', php_8_2: '🐘', php_8_1: '🐘',
        r_4_4: '📊', r_4_3: '📊',
        go_1_23: '🔵', go_1_22: '🔵',
        rust_latest: '🦀',
        mysql_8_4: '🐬', mysql_8_0: '🐬',
        git_latest: '🔀',
        vue_cli: '💚', create_react_app: '⚛️', angular_cli: '🅰️', vite: '⚡', typescript: '🔷',
        anaconda_latest: '🐍', composer: '🎼', maven: '🐘', gradle: '�', cmake: '�',
        redis_server_win: '�',
        matlab: '🔢', lingo: '📐', bt_panel: '🖥',
        mysql_connector_python: '🔌'
      }

      return `
        <div class="ext-card">
          <div class="ext-card-header">
            <div class="ext-icon" style="font-size:1.4rem">${iconMap[sw.id] || '📦'}</div>
            <div>
              <div class="ext-name" title="${sw.displayName}">${sw.displayName}</div>
              <div class="ext-publisher">${categoryLabel}</div>
            </div>
          </div>
          <div class="ext-desc">${sw.description}</div>
          <div class="ext-meta">
            <span>📦 ${sw.version}</span>
            <span>📥 ${sw.installerType === 'npm' ? 'npm' : sw.installerType === 'external' ? '官网' : sw.installerType}</span>
          </div>
          <div class="ext-actions">${actionBtn}</div>
        </div>
      `
    }).join('')
  }

  private renderSoftwareGrid(grid: HTMLElement): void {
    grid.innerHTML = this.buildSoftwareCards() || '<div class="marketplace-empty">暂无软件数据</div>'
  }

  private renderDownloadProgressBar(id: string, state: DownloadProgress): string {
    const statusText = this.getDownloadStatusText(state)
    const speedText = this.getDownloadSpeedText(state)
    const sizeText = state.totalSize > 0 ? `${this.formatSize(state.downloadedSize)} / ${this.formatSize(state.totalSize)}` : ''

    return `
      <div class="download-progress-container">
        <div class="download-progress-bar">
          <div class="download-progress-fill" style="width:${state.progress}%"></div>
        </div>
        <div class="download-progress-info">
          <span>${statusText}</span>
          ${speedText ? `<span>${speedText}</span>` : ''}
          ${sizeText ? `<span>${sizeText}</span>` : ''}
        </div>
        <button class="ext-btn" onclick="app.cancelDownload('${id}')" style="font-size:0.7rem;padding:0.2rem 0.4rem">取消</button>
      </div>
    `
  }

  private renderInstalledExtensions(grid: HTMLElement): void {
    const active = this.installedExtensions.filter(ext => !ext.disabled)
    if (active.length === 0) {
      grid.innerHTML = '<div class="marketplace-empty">暂无已安装的插件</div>'
      return
    }

    grid.innerHTML = active.map(ext => `
      <div class="ext-card">
        <div class="ext-card-header">
          <div class="ext-icon">${ext.iconUrl ? `<img src="${ext.iconUrl}" alt="">` : '📦'}</div>
          <div>
            <div class="ext-name" title="${ext.displayName}">${ext.displayName}</div>
            <div class="ext-publisher">${ext.publisher}</div>
          </div>
        </div>
        <div class="ext-desc">${ext.description || '暂无描述'}</div>
        <div class="ext-meta">
          <span>📦 ${ext.version}</span>
          <span>📅 ${ext.installDate}</span>
        </div>
        <div class="ext-actions">
          <button class="ext-btn" onclick="app.disableExtension('${ext.id}')">禁用</button>
          <button class="ext-btn" onclick="app.uninstallExtension('${ext.id}')" style="color:#e74c3c">卸载</button>
        </div>
      </div>
    `).join('')
  }

  private renderDisabledExtensions(grid: HTMLElement): void {
    if (this.disabledExtensions.length === 0) {
      grid.innerHTML = '<div class="marketplace-empty">暂无已禁用的插件</div>'
      return
    }

    grid.innerHTML = this.disabledExtensions.map(ext => `
      <div class="ext-card">
        <div class="ext-card-header">
          <div class="ext-icon">${ext.iconUrl ? `<img src="${ext.iconUrl}" alt="">` : '📦'}</div>
          <div>
            <div class="ext-name" title="${ext.displayName}">${ext.displayName}</div>
            <div class="ext-publisher">${ext.publisher}</div>
          </div>
        </div>
        <div class="ext-desc">${ext.description || '暂无描述'}</div>
        <div class="ext-meta">
          <span>📦 ${ext.version}</span>
          <span>📅 ${ext.installDate}</span>
        </div>
        <div class="ext-actions">
          <button class="ext-btn install" onclick="app.enableExtension('${ext.id}')">启用</button>
          <button class="ext-btn" onclick="app.uninstallExtension('${ext.id}')" style="color:#e74c3c">卸载</button>
        </div>
      </div>
    `).join('')
  }

  installExtension(extId: string, displayName: string, publisher: string, version: string, iconUrl: string, description: string): void {
    if (this.isExtensionInstalled(extId)) {
      alert('该插件已安装')
      return
    }

    const ext: InstalledExtension = {
      id: extId,
      name: extId.split('.').pop() || extId,
      publisher,
      displayName,
      description,
      version,
      iconUrl,
      installDate: new Date().toISOString().split('T')[0],
      disabled: false
    }

    this.installedExtensions.push(ext)
    this.saveInstalledExtensions()
    this.renderMarketplaceGrid()
    this.updateSettingsPluginList()
    this.renderRightPanelExtensions()
  }

  uninstallExtension(extId: string): void {
    if (!confirm('确定要卸载此插件吗？')) return
    const isSoftware = this.softwareList.some(s => s.id === extId)
    if (isSoftware && window.eideAPI) {
      window.eideAPI.uninstallSoftware(extId).catch(() => {})
    }
    this.installedExtensions = this.installedExtensions.filter(ext => ext.id !== extId)
    this.disabledExtensions = this.installedExtensions.filter(ext => ext.disabled)
    this.saveInstalledExtensions()
    this.downloadStates.delete(extId)
    this.renderMarketplaceGrid()
    this.updateSettingsPluginList()
    this.renderRightPanelExtensions()
  }

  disableExtension(extId: string): void {
    const ext = this.installedExtensions.find(e => e.id === extId)
    if (ext) {
      ext.disabled = true
      this.disabledExtensions = this.installedExtensions.filter(e => e.disabled)
      this.saveInstalledExtensions()
      this.renderMarketplaceGrid()
      this.updateSettingsPluginList()
      this.renderRightPanelExtensions()
    }
  }

  enableExtension(extId: string): void {
    const ext = this.installedExtensions.find(e => e.id === extId)
    if (ext) {
      ext.disabled = false
      this.disabledExtensions = this.installedExtensions.filter(e => e.disabled)
      this.saveInstalledExtensions()
      this.renderMarketplaceGrid()
      this.updateSettingsPluginList()
      this.renderRightPanelExtensions()
    }
  }

  private updateSettingsPluginList(): void {
    const pluginListEl = document.getElementById('settingsPluginList')
    if (!pluginListEl) return

    const activeExtensions = this.installedExtensions.filter(ext => !ext.disabled)
    if (activeExtensions.length === 0) {
      pluginListEl.innerHTML = `
        <div style="padding:0.8rem;background:#f9f9f9;border-radius:6px;font-size:0.84rem;color:#888;text-align:center">
          暂无已安装插件<br>
          <span style="font-size:0.78rem;color:#aaa;margin-top:0.3rem;display:inline-block">
            可从VSCode插件市场安装
          </span>
        </div>
      `
      return
    }

    pluginListEl.innerHTML = activeExtensions.map(ext => `
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #f0f0f0;font-size:0.82rem">
        <span>📦</span>
        <span style="flex:1;color:#333">${ext.displayName}</span>
        <span style="color:#999;font-size:0.75rem">${ext.version}</span>
        <button onclick="app.disableExtension('${ext.id}')" style="padding:0.15rem 0.5rem;border:1px solid #e0e0e0;border-radius:3px;background:#fff;color:#888;font-size:0.72rem;cursor:pointer">禁用</button>
      </div>
    `).join('')
  }

  private renderRightPanelExtensions(): void {
    const pluginListEl = document.getElementById('pluginList')
    if (!pluginListEl) return

    const activeExtensions = this.installedExtensions.filter(ext => !ext.disabled)

    const downloadingItems: string[] = []
    this.downloadStates.forEach((state, id) => {
      if (state.status === 'downloading' || state.status === 'extracting' || state.status === 'installing') {
        downloadingItems.push(id)
      }
    })

    if (activeExtensions.length === 0 && downloadingItems.length === 0) {
      pluginListEl.innerHTML = `
        <div style="padding:1.5rem 1rem;text-align:center;color:#bbb;font-size:0.84rem">
          暂无已安装的软件和插件<br>
          <span style="font-size:0.76rem;color:#ccc;margin-top:0.4rem;display:inline-block">
            前往 <a href="javascript:app.showMarketplace()" style="color:#007acc">软件和插件市场</a> 下载
          </span>
        </div>
      `
      return
    }

    let html = ''

    downloadingItems.forEach(id => {
      const state = this.downloadStates.get(id)!
      const sw = this.softwareList.find(s => s.id === id)
      const displayName = sw?.displayName || id
      html += `
        <div class="plugin-item" style="flex-direction:column;align-items:stretch;gap:0.3rem">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="plugin-icon">⬇</span>
            <div class="plugin-info" style="flex:1">
              <div class="plugin-name">${displayName}</div>
              <div class="plugin-desc">${this.getDownloadStatusText(state)} ${this.getDownloadSpeedText(state)}</div>
            </div>
          </div>
          <div class="download-progress-bar" style="height:3px;margin:0">
            <div class="download-progress-fill" style="width:${state.progress}%;height:3px"></div>
          </div>
        </div>
      `
    })

    activeExtensions.forEach(ext => {
      html += `
        <div class="plugin-item">
          <span class="plugin-icon">${ext.iconUrl ? `<img src="${ext.iconUrl}" style="width:20px;height:20px;border-radius:3px;object-fit:contain" alt="">` : '📦'}</span>
          <div class="plugin-info">
            <div class="plugin-name">${ext.displayName}</div>
            <div class="plugin-desc">${ext.publisher} · ${ext.version}</div>
          </div>
          <div class="plugin-toggle on" onclick="app.disableExtension('${ext.id}')" title="点击禁用"></div>
        </div>
      `
    })

    pluginListEl.innerHTML = html
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new EIDEApp()
})