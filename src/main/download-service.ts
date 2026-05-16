import { app } from 'electron'
import { join } from 'path'
import { mkdir, unlink } from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import { spawn } from 'child_process'
import https from 'https'
import http from 'http'
import AdmZip from 'adm-zip'

export interface DownloadItem {
  id: string
  name: string
  displayName: string
  url: string
  category: 'language' | 'runtime' | 'tool' | 'framework' | 'database' | 'plugin'
  installerType: 'exe' | 'msi' | 'zip' | 'tar.gz' | 'vsix' | 'npm' | 'external'
  version: string
  iconUrl: string
  description: string
}

export interface DownloadProgress {
  id: string
  status: 'pending' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'error' | 'cancelled'
  progress: number
  totalSize: number
  downloadedSize: number
  speed: number
  error?: string
}

export interface SoftwareRegistry {
  [key: string]: DownloadItem
}

const BASE_DIR = join(__dirname, '..', 'dwn_software_plugin')
const DOWNLOADS_DIR = join(BASE_DIR, 'downloads')
const INSTALL_DIR = join(BASE_DIR, 'installed')

export const SOFTWARE_REGISTRY: SoftwareRegistry = {
  python_3_13: {
    id: 'python_3_13', name: 'python',
    displayName: 'Python 3.13',
    url: 'https://registry.npmmirror.com/-/binary/python/3.13.2/python-3.13.2-amd64.exe',
    category: 'language', installerType: 'exe', version: '3.13.2', iconUrl: '',
    description: 'Python 3.13 最新版解释器，支持数据分析、AI、Web后端（npmmirror 镜像）'
  },
  python_3_12: {
    id: 'python_3_12', name: 'python',
    displayName: 'Python 3.12',
    url: 'https://registry.npmmirror.com/-/binary/python/3.12.8/python-3.12.8-amd64.exe',
    category: 'language', installerType: 'exe', version: '3.12.8', iconUrl: '',
    description: 'Python 3.12 稳定版解释器（npmmirror 镜像）'
  },
  python_3_11: {
    id: 'python_3_11', name: 'python',
    displayName: 'Python 3.11',
    url: 'https://registry.npmmirror.com/-/binary/python/3.11.9/python-3.11.9-amd64.exe',
    category: 'language', installerType: 'exe', version: '3.11.9', iconUrl: '',
    description: 'Python 3.11 长期维护版解释器（npmmirror 镜像）'
  },
  python_3_10: {
    id: 'python_3_10', name: 'python',
    displayName: 'Python 3.10',
    url: 'https://registry.npmmirror.com/-/binary/python/3.10.11/python-3.10.11-amd64.exe',
    category: 'language', installerType: 'exe', version: '3.10.11', iconUrl: '',
    description: 'Python 3.10 经典稳定版解释器（npmmirror 镜像）'
  },

  mingw_c_cpp: {
    id: 'mingw_c_cpp', name: 'mingw64',
    displayName: 'MinGW-w64 (C/C++) 13.2',
    url: 'https://ghfast.top/https://github.com/niXman/mingw-builds-binaries/releases/download/13.2.0-rt_v11-rev1/x86_64-13.2.0-release-posix-seh-ucrt-rt_v11-rev1.7z',
    category: 'language', installerType: 'zip', version: '13.2.0', iconUrl: '',
    description: 'GCC 13.2 C/C++ 编译器工具链，支持 C11/C17/C++23（ghfast 加速）'
  },
  mingw_c_cpp_8: {
    id: 'mingw_c_cpp_8', name: 'mingw64',
    displayName: 'MinGW-w64 (C/C++) 8.1',
    url: 'https://ghfast.top/https://github.com/niXman/mingw-builds-binaries/releases/download/8.1.0/rt_v6-rev0/x86_64-8.1.0-release-posix-seh-rt_v6-rev0.7z',
    category: 'language', installerType: 'zip', version: '8.1.0', iconUrl: '',
    description: 'GCC 8.1 C/C++ 经典稳定版，兼容性好（ghfast 加速）'
  },

  dotnet_sdk_9: {
    id: 'dotnet_sdk_9', name: 'dotnet-sdk',
    displayName: '.NET SDK 9.0 (C#)',
    url: 'https://dotnet.microsoft.com/download/dotnet/thank-you/sdk-9.0.100-windows-x64-installer',
    category: 'language', installerType: 'external', version: '9.0', iconUrl: '',
    description: '.NET 9.0 SDK，支持 C#/F#/VB.NET 开发（跳转微软官网下载）'
  },
  dotnet_sdk_8: {
    id: 'dotnet_sdk_8', name: 'dotnet-sdk',
    displayName: '.NET SDK 8.0 (C#) LTS',
    url: 'https://dotnet.microsoft.com/download/dotnet/thank-you/sdk-8.0.404-windows-x64-installer',
    category: 'language', installerType: 'external', version: '8.0 LTS', iconUrl: '',
    description: '.NET 8.0 LTS 长期支持版 SDK，支持 C#/F#/VB.NET（跳转微软官网下载）'
  },

  java_jdk_21: {
    id: 'java_jdk_21', name: 'jdk',
    displayName: 'OpenJDK 21 (Java)',
    url: 'https://mirrors.huaweicloud.com/adoptium/21.0.5%2B11/OpenJDK21U-jdk_x64_windows_hotspot_21.0.5_11.zip',
    category: 'language', installerType: 'zip', version: '21.0.5', iconUrl: '',
    description: 'Java 21 LTS 开发工具包，长期支持版本（华为云镜像）'
  },
  java_jdk_17: {
    id: 'java_jdk_17', name: 'jdk',
    displayName: 'OpenJDK 17 (Java)',
    url: 'https://mirrors.huaweicloud.com/adoptium/17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip',
    category: 'language', installerType: 'zip', version: '17.0.13', iconUrl: '',
    description: 'Java 17 LTS 开发工具包，最广泛使用的版本（华为云镜像）'
  },
  java_jdk_11: {
    id: 'java_jdk_11', name: 'jdk',
    displayName: 'OpenJDK 11 (Java)',
    url: 'https://mirrors.huaweicloud.com/adoptium/11.0.25%2B9/OpenJDK11U-jdk_x64_windows_hotspot_11.0.25_9.zip',
    category: 'language', installerType: 'zip', version: '11.0.25', iconUrl: '',
    description: 'Java 11 LTS 经典稳定版（华为云镜像）'
  },
  java_jdk_8: {
    id: 'java_jdk_8', name: 'jdk',
    displayName: 'OpenJDK 8 (Java)',
    url: 'https://mirrors.huaweicloud.com/adoptium/8.0.432%2B6/OpenJDK8U-jdk_x64_windows_hotspot_8u432b06.zip',
    category: 'language', installerType: 'zip', version: '8u432', iconUrl: '',
    description: 'Java 8 最经典的 JDK 版本，兼容性最强（华为云镜像）'
  },

  node_22: {
    id: 'node_22', name: 'node',
    displayName: 'Node.js 22',
    url: 'https://registry.npmmirror.com/-/binary/node/v22.13.1/node-v22.13.1-x64.msi',
    category: 'runtime', installerType: 'msi', version: '22.13.1', iconUrl: '',
    description: 'Node.js 22 最新版运行时（npmmirror 镜像）'
  },
  node_20: {
    id: 'node_20', name: 'node',
    displayName: 'Node.js 20 LTS',
    url: 'https://registry.npmmirror.com/-/binary/node/v20.18.1/node-v20.18.1-x64.msi',
    category: 'runtime', installerType: 'msi', version: '20.18.1', iconUrl: '',
    description: 'Node.js 20 LTS 长期支持版运行时（npmmirror 镜像）'
  },
  node_18: {
    id: 'node_18', name: 'node',
    displayName: 'Node.js 18 LTS',
    url: 'https://registry.npmmirror.com/-/binary/node/v18.20.5/node-v18.20.5-x64.msi',
    category: 'runtime', installerType: 'msi', version: '18.20.5', iconUrl: '',
    description: 'Node.js 18 LTS 经典稳定版运行时（npmmirror 镜像）'
  },

  php_8_4: {
    id: 'php_8_4', name: 'php',
    displayName: 'PHP 8.4',
    url: 'https://windows.php.net/downloads/releases/php-8.4.3-nts-Win32-vs17-x64.zip',
    category: 'language', installerType: 'zip', version: '8.4.3', iconUrl: '',
    description: 'PHP 8.4 最新版脚本语言'
  },
  php_8_3: {
    id: 'php_8_3', name: 'php',
    displayName: 'PHP 8.3',
    url: 'https://windows.php.net/downloads/releases/php-8.3.14-nts-Win32-vs16-x64.zip',
    category: 'language', installerType: 'zip', version: '8.3.14', iconUrl: '',
    description: 'PHP 8.3 稳定版脚本语言'
  },
  php_8_2: {
    id: 'php_8_2', name: 'php',
    displayName: 'PHP 8.2',
    url: 'https://windows.php.net/downloads/releases/php-8.2.26-nts-Win32-vs16-x64.zip',
    category: 'language', installerType: 'zip', version: '8.2.26', iconUrl: '',
    description: 'PHP 8.2 经典稳定版脚本语言'
  },
  php_8_1: {
    id: 'php_8_1', name: 'php',
    displayName: 'PHP 8.1',
    url: 'https://windows.php.net/downloads/releases/php-8.1.31-nts-Win32-vs16-x64.zip',
    category: 'language', installerType: 'zip', version: '8.1.31', iconUrl: '',
    description: 'PHP 8.1 长期支持版脚本语言'
  },

  go_1_23: {
    id: 'go_1_23', name: 'go',
    displayName: 'Go 1.23',
    url: 'https://go.dev/dl/go1.23.5.windows-amd64.msi',
    category: 'language', installerType: 'msi', version: '1.23.5', iconUrl: '',
    description: 'Go 1.23 编程语言，高性能并发编程首选'
  },
  go_1_22: {
    id: 'go_1_22', name: 'go',
    displayName: 'Go 1.22',
    url: 'https://go.dev/dl/go1.22.10.windows-amd64.msi',
    category: 'language', installerType: 'msi', version: '1.22.10', iconUrl: '',
    description: 'Go 1.22 经典稳定版编程语言'
  },

  rust_latest: {
    id: 'rust_latest', name: 'rust',
    displayName: 'Rust 最新版',
    url: 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe',
    category: 'language', installerType: 'exe', version: 'latest', iconUrl: '',
    description: 'Rust 系统级编程语言，安装 rustup 工具链管理器'
  },

  mysql_8_4: {
    id: 'mysql_8_4', name: 'mysql',
    displayName: 'MySQL 8.4',
    url: 'https://registry.npmmirror.com/-/binary/mysql/MySQL-8.4/mysql-8.4.3-winx64.zip',
    category: 'database', installerType: 'zip', version: '8.4.3', iconUrl: '',
    description: 'MySQL 8.4 关系型数据库，社区版（npmmirror 镜像）'
  },
  mysql_8_0: {
    id: 'mysql_8_0', name: 'mysql',
    displayName: 'MySQL 8.0',
    url: 'https://registry.npmmirror.com/-/binary/mysql/MySQL-8.0/mysql-8.0.40-winx64.zip',
    category: 'database', installerType: 'zip', version: '8.0.40', iconUrl: '',
    description: 'MySQL 8.0 经典稳定版数据库（npmmirror 镜像）'
  },

  r_4_4: {
    id: 'r_4_4', name: 'r_lang',
    displayName: 'R 语言 4.4',
    url: 'https://mirrors.tuna.tsinghua.edu.cn/CRAN/bin/windows/base/R-4.4.2-win.exe',
    category: 'language', installerType: 'exe', version: '4.4.2', iconUrl: '',
    description: 'R 语言统计计算环境（清华 TUNA 镜像）'
  },
  r_4_3: {
    id: 'r_4_3', name: 'r_lang',
    displayName: 'R 语言 4.3',
    url: 'https://mirrors.tuna.tsinghua.edu.cn/CRAN/bin/windows/base/old/4.3.3/R-4.3.3-win.exe',
    category: 'language', installerType: 'exe', version: '4.3.3', iconUrl: '',
    description: 'R 语言经典版本（清华 TUNA 镜像）'
  },

  git_latest: {
    id: 'git_latest', name: 'git',
    displayName: 'Git 版本控制',
    url: 'https://registry.npmmirror.com/-/binary/git-for-windows/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe',
    category: 'tool', installerType: 'exe', version: '2.47.1', iconUrl: '',
    description: 'Git 分布式版本控制系统（npmmirror 镜像）'
  },

  vue_cli: {
    id: 'vue_cli', name: '@vue/cli',
    displayName: 'Vue CLI 脚手架',
    url: '', category: 'framework', installerType: 'npm', version: 'latest', iconUrl: '',
    description: 'Vue.js 前端框架官方脚手架，一键创建 Vue 项目（npmmirror 镜像源）'
  },
  create_react_app: {
    id: 'create_react_app', name: 'create-react-app',
    displayName: 'React 脚手架 (CRA)',
    url: '', category: 'framework', installerType: 'npm', version: 'latest', iconUrl: '',
    description: 'React 官方脚手架 create-react-app（npmmirror 镜像源）'
  },
  angular_cli: {
    id: 'angular_cli', name: '@angular/cli',
    displayName: 'Angular CLI 脚手架',
    url: '', category: 'framework', installerType: 'npm', version: 'latest', iconUrl: '',
    description: 'Angular 官方命令行脚手架工具（npmmirror 镜像源）'
  },
  vite: {
    id: 'vite', name: 'vite',
    displayName: 'Vite 构建工具',
    url: '', category: 'framework', installerType: 'npm', version: 'latest', iconUrl: '',
    description: '下一代前端构建工具 Vite，极速开发体验（npmmirror 镜像源）'
  },
  typescript: {
    id: 'typescript', name: 'typescript',
    displayName: 'TypeScript 编译器',
    url: '', category: 'tool', installerType: 'npm', version: 'latest', iconUrl: '',
    description: 'TypeScript 全局编译器 tsc（npmmirror 镜像源）'
  },

  anaconda_latest: {
    id: 'anaconda_latest', name: 'anaconda',
    displayName: 'Anaconda (Python 环境)',
    url: 'https://repo.anaconda.com/archive/Anaconda3-2024.10-1-Windows-x86_64.exe',
    category: 'tool', installerType: 'exe', version: '2024.10', iconUrl: '',
    description: 'Anaconda Python 数据科学发行版，内置 conda 包管理（官方源）'
  },
  composer: {
    id: 'composer', name: 'composer',
    displayName: 'Composer (PHP 包管理)',
    url: 'https://getcomposer.org/Composer-Setup.exe',
    category: 'tool', installerType: 'exe', version: 'latest', iconUrl: '',
    description: 'PHP 依赖管理工具 Composer'
  },
  maven: {
    id: 'maven', name: 'maven',
    displayName: 'Maven (Java 构建)',
    url: 'https://mirrors.huaweicloud.com/apache/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip',
    category: 'tool', installerType: 'zip', version: '3.9.9', iconUrl: '',
    description: 'Apache Maven Java 项目构建管理工具（华为云镜像）'
  },
  gradle: {
    id: 'gradle', name: 'gradle',
    displayName: 'Gradle (Java 构建)',
    url: 'https://services.gradle.org/distributions/gradle-8.12-bin.zip',
    category: 'tool', installerType: 'zip', version: '8.12', iconUrl: '',
    description: 'Gradle 现代化 Java/Android 项目构建工具'
  },
  cmake: {
    id: 'cmake', name: 'cmake',
    displayName: 'CMake (C++ 构建)',
    url: 'https://ghfast.top/https://github.com/Kitware/CMake/releases/download/v3.31.4/cmake-3.31.4-windows-x86_64.msi',
    category: 'tool', installerType: 'msi', version: '3.31.4', iconUrl: '',
    description: 'CMake 跨平台 C/C++ 构建系统（ghfast 加速）'
  },

  mysql_connector_python: {
    id: 'mysql_connector_python', name: 'mysql-connector-python',
    displayName: 'MySQL Python 驱动',
    url: 'https://pypi.org/project/mysql-connector-python/',
    category: 'plugin', installerType: 'external', version: 'latest', iconUrl: '',
    description: 'MySQL Python 数据库连接器（pip install，跳转 PyPI 页面）'
  },
  redis_server_win: {
    id: 'redis_server_win', name: 'redis',
    displayName: 'Redis (内存数据库)',
    url: 'https://ghfast.top/https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.msi',
    category: 'database', installerType: 'msi', version: '5.0.14', iconUrl: '',
    description: 'Redis 高性能内存数据库 Windows 版（ghfast 加速）'
  },

  matlab: {
    id: 'matlab', name: 'matlab',
    displayName: 'MATLAB R2024b',
    url: 'https://www.mathworks.com/downloads/',
    category: 'language', installerType: 'external', version: 'R2024b', iconUrl: '',
    description: 'MATLAB 数值计算与科学仿真环境（商业软件，跳转官网）'
  },
  lingo: {
    id: 'lingo', name: 'lingo',
    displayName: 'LINGO 22',
    url: 'https://www.lindo.com/index.php/ls-downloads',
    category: 'tool', installerType: 'external', version: '22.0', iconUrl: '',
    description: 'LINGO 线性/非线性优化求解器（商业软件，跳转官网）'
  },
  bt_panel: {
    id: 'bt_panel', name: '宝塔面板',
    displayName: '宝塔面板 (Windows)',
    url: 'https://www.bt.cn/download/windows.html',
    category: 'tool', installerType: 'external', version: 'latest', iconUrl: '',
    description: '宝塔 Windows 面板，一键部署 Web 环境（跳转官网）'
  }
}

export class DownloadService {
  private activeDownloads: Map<string, DownloadProgress> = new Map()
  private cancelFlags: Map<string, boolean> = new Map()
  private progressCallbacks: Map<string, (progress: DownloadProgress) => void> = new Map()

  constructor() {
    this.ensureDirs()
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(DOWNLOADS_DIR, { recursive: true })
    await mkdir(INSTALL_DIR, { recursive: true })
  }

  getSoftwareList(): DownloadItem[] {
    return Object.values(SOFTWARE_REGISTRY)
  }

  getSoftware(id: string): DownloadItem | undefined {
    return SOFTWARE_REGISTRY[id]
  }

  isInstalled(id: string): boolean {
    const installPath = join(INSTALL_DIR, id)
    return existsSync(installPath)
  }

  getInstallPath(id: string): string {
    return join(INSTALL_DIR, id)
  }

  onProgress(id: string, callback: (progress: DownloadProgress) => void): void {
    this.progressCallbacks.set(id, callback)
  }

  removeProgressListener(id: string): void {
    this.progressCallbacks.delete(id)
  }

  private emitProgress(progress: DownloadProgress): void {
    this.activeDownloads.set(progress.id, progress)
    const cb = this.progressCallbacks.get(progress.id)
    if (cb) {
      cb(progress)
    }
  }

  async startDownload(item: DownloadItem): Promise<void> {
    if (this.activeDownloads.has(item.id) &&
        (this.activeDownloads.get(item.id)!.status === 'downloading' ||
         this.activeDownloads.get(item.id)!.status === 'extracting' ||
         this.activeDownloads.get(item.id)!.status === 'installing')) {
      return
    }

    this.cancelFlags.set(item.id, false)

    if (item.installerType === 'external') {
      const { shell } = await import('electron')
      shell.openExternal(item.url)
      this.emitProgress({
        id: item.id, status: 'completed', progress: 100,
        totalSize: 0, downloadedSize: 0, speed: 0
      })
      return
    }

    if (item.installerType === 'npm') {
      await this.installViaNpm(item)
      return
    }

    const fileName = item.url.split('/').pop()?.split('?')[0] || `${item.name}.download`
    const downloadPath = join(DOWNLOADS_DIR, fileName)

    this.emitProgress({
      id: item.id, status: 'downloading', progress: 0,
      totalSize: 0, downloadedSize: 0, speed: 0
    })

    try {
      await this.downloadFile(item.url, downloadPath, item.id)

      if (this.cancelFlags.get(item.id)) {
        await unlink(downloadPath).catch(() => {})
        this.emitProgress({
          id: item.id, status: 'cancelled', progress: 0,
          totalSize: 0, downloadedSize: 0, speed: 0
        })
        return
      }

      this.emitProgress({
        id: item.id, status: 'extracting', progress: 100,
        totalSize: 0, downloadedSize: 0, speed: 0
      })

      if (item.installerType === 'zip' || item.installerType === 'tar.gz') {
        await this.extractArchive(downloadPath, join(INSTALL_DIR, item.id), item.id)
        await unlink(downloadPath).catch(() => {})
      } else if (item.installerType === 'exe' || item.installerType === 'msi') {
        this.emitProgress({
          id: item.id, status: 'installing', progress: 100,
          totalSize: 0, downloadedSize: 0, speed: 0
        })
        await this.runInstaller(downloadPath, item)
      }

      if (!this.cancelFlags.get(item.id)) {
        this.emitProgress({
          id: item.id, status: 'completed', progress: 100,
          totalSize: 0, downloadedSize: 0, speed: 0
        })
      }
    } catch (error: any) {
      await unlink(downloadPath).catch(() => {})
      this.emitProgress({
        id: item.id, status: 'error', progress: 0,
        totalSize: 0, downloadedSize: 0, speed: 0,
        error: error.message || '下载失败'
      })
    }
  }

  cancelDownload(id: string): void {
    this.cancelFlags.set(id, true)
  }

  private downloadFile(url: string, destPath: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      const file = createWriteStream(destPath)

      const request = protocol.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            this.downloadFile(redirectUrl, destPath, id).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          file.close()
          reject(new Error(`HTTP ${response.statusCode}: 下载失败`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0
        let lastTime = Date.now()
        let lastSize = 0

        response.on('data', (chunk: Buffer) => {
          if (this.cancelFlags.get(id)) {
            request.destroy()
            file.close()
            return
          }
          downloadedSize += chunk.length
          const now = Date.now()
          const timeDiff = (now - lastTime) / 1000
          let speed = 0
          if (timeDiff > 0.5) {
            speed = (downloadedSize - lastSize) / timeDiff
            lastTime = now
            lastSize = downloadedSize
          }
          const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0

          this.emitProgress({
            id, status: 'downloading', progress,
            totalSize, downloadedSize, speed
          })
        })

        response.pipe(file)
        file.on('finish', () => resolve())
        file.on('error', reject)
      })

      request.on('error', (err) => {
        file.close()
        reject(err)
      })

      request.on('timeout', () => {
        request.destroy()
        file.close()
        reject(new Error('下载超时'))
      })
    })
  }

  private async extractArchive(archivePath: string, destDir: string, id: string): Promise<void> {
    await mkdir(destDir, { recursive: true })

    try {
      const zip = new AdmZip(archivePath)
      const entries = zip.getEntries()

      let rootDir = ''
      if (entries.length > 0) {
        const firstEntry = entries[0]
        const parts = firstEntry.entryName.split('/')
        if (parts.length > 0 && entries.every(e => e.entryName.startsWith(parts[0] + '/'))) {
          rootDir = parts[0] + '/'
        }
      }

      let extractedCount = 0
      const totalEntries = entries.length

      for (const entry of entries) {
        if (this.cancelFlags.get(id)) return
        const relativePath = rootDir ? entry.entryName.substring(rootDir.length) : entry.entryName
        if (!relativePath) continue
        const targetPath = join(destDir, relativePath)
        if (entry.isDirectory) {
          await mkdir(targetPath, { recursive: true })
        } else {
          await mkdir(join(targetPath, '..'), { recursive: true })
          const content = entry.getData()
          const { writeFile } = await import('fs/promises')
          await writeFile(targetPath, content)
        }
        extractedCount++
        if (extractedCount % 50 === 0 || extractedCount === totalEntries) {
          this.emitProgress({
            id, status: 'extracting',
            progress: Math.round((extractedCount / totalEntries) * 100),
            totalSize: totalEntries, downloadedSize: extractedCount, speed: 0
          })
        }
      }
    } catch (err: any) {
      throw new Error(`解压失败: ${err.message}`)
    }
  }

  private async runInstaller(installerPath: string, item: DownloadItem): Promise<void> {
    return new Promise((resolve, reject) => {
      const installDir = join(INSTALL_DIR, item.id)
      let child: any

      if (item.installerType === 'exe') {
        const isNSIS = item.id.includes('anaconda') || item.name.includes('anaconda') || item.name.includes('rust')
        const args = isNSIS
          ? ['/S', `/D=${installDir}`]
          : ['/quiet', '/norestart', `TargetDir=${installDir}`, 'InstallAllUsers=0', 'PrependPath=0', 'Include_test=0']
        child = spawn(installerPath, args, { stdio: 'ignore', detached: true })
      } else {
        child = spawn('msiexec', [
          '/i', installerPath, '/quiet', '/norestart',
          `INSTALLDIR="${installDir}"`, 'ALLUSERS=0'
        ], { stdio: 'ignore', detached: true })
      }

      child.on('error', (err: Error) => reject(new Error(`安装启动失败: ${err.message}`)))
      child.on('close', (code: number) => {
        if (code === 0 || code === 3010) resolve()
        else reject(new Error(`安装程序退出码: ${code}`))
      })
      setTimeout(() => resolve(), 5000)
    })
  }

  private installViaNpm(item: DownloadItem): Promise<void> {
    this.emitProgress({
      id: item.id, status: 'downloading', progress: 0,
      totalSize: 0, downloadedSize: 0, speed: 0
    })

    return new Promise((resolve, reject) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(npmCmd, [
        'install', '-g', item.name,
        '--registry=https://registry.npmmirror.com'
      ], { stdio: 'pipe', shell: true })

      child.stdout?.on('data', () => {
        this.emitProgress({
          id: item.id, status: 'installing', progress: 50,
          totalSize: 0, downloadedSize: 0, speed: 0
        })
      })

      child.stderr?.on('data', () => {})

      child.on('error', (err: Error) => reject(new Error(`npm 安装失败: ${err.message}`)))
      child.on('close', (code: number) => {
        if (code === 0) {
          this.emitProgress({
            id: item.id, status: 'completed', progress: 100,
            totalSize: 0, downloadedSize: 0, speed: 0
          })
          resolve()
        } else {
          reject(new Error(`npm 安装失败，退出码: ${code}`))
        }
      })
    })
  }

  async uninstallSoftware(id: string): Promise<void> {
    const installPath = join(INSTALL_DIR, id)
    if (existsSync(installPath)) {
      const { rm } = await import('fs/promises')
      await rm(installPath, { recursive: true, force: true })
    }
  }
}