import { exec, spawn } from 'child_process'
import * as os from 'os'

export class TerminalService {
  private currentDir: string = ''

  constructor() {}

  openNativeTerminal(cwd?: string): void {
    this.currentDir = cwd || os.homedir()
    
    console.log('[TerminalService] Opening terminal in:', this.currentDir)

    if (process.platform === 'win32') {
      this.openWindowsTerminal(this.currentDir)
    } else if (process.platform === 'darwin') {
      this.openMacOSTerminal(this.currentDir)
    } else {
      this.openLinuxTerminal(this.currentDir)
    }
  }

  private openWindowsTerminal(cwd: string): void {
    try {
      const command = `start "E-IDE Terminal" cmd.exe /K "cd /d "${cwd}""`
      
      console.log('[TerminalService] Executing command:', command)
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('[TerminalService] exec error:', error)
          console.error('[TerminalService] stderr:', stderr)
          
          console.log('[TerminalService] Trying alternative method...')
          this.tryAlternativeMethod(cwd)
        } else {
          console.log('[TerminalService] Success! stdout:', stdout)
        }
      })
      
    } catch (error) {
      console.error('[TerminalService] Exception:', error)
      this.tryAlternativeMethod(cwd)
    }
  }

  private tryAlternativeMethod(cwd: string): void {
    try {
      const cmdPath = process.env.ComSpec || 'cmd.exe'
      
      console.log('[TerminalService] Alternative: spawning', cmdPath)
      
      spawn(cmdPath, ['/K', `cd /d "${cwd}"`], {
        cwd: cwd,
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
      
      console.log('[TerminalService] Alternative method completed')
      
    } catch (error) {
      console.error('[TerminalService] Alternative also failed:', error)
    }
  }

  private openMacOSTerminal(cwd: string): void {
    exec(`open -a Terminal "${cwd}"`, (error) => {
      if (error) {
        exec(`open -a iTerm "${cwd}"`)
      }
    })
  }

  private openLinuxTerminal(cwd: string): void {
    exec(`gnome-terminal --working-directory="${cwd}" &`)
  }

  getCurrentDir(): string {
    return this.currentDir
  }
}
