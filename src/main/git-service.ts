import simpleGit, { type SimpleGit } from 'simple-git'
import { existsSync } from 'fs'
import { join } from 'path'

interface GitPushConfig {
  localPath: string
  remoteUrl: string
  branch: string
  username: string
  token: string
  commitMessage: string
}

export class GitService {
  async status(localPath: string): Promise<{ success: boolean; files?: string[]; branch?: string; error?: string }> {
    try {
      if (!existsSync(join(localPath, '.git'))) {
        return { success: false, error: '该目录不是 Git 仓库，请先初始化' }
      }
      const git = simpleGit(localPath)
      const status = await git.status()
      const files = [
        ...status.modified,
        ...status.not_added,
        ...status.created,
        ...status.deleted,
        ...status.renamed.map(r => r.to)
      ]
      return { success: true, files, branch: status.current || '' }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async init(localPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(localPath)
      const isRepo = existsSync(join(localPath, '.git'))
      if (!isRepo) {
        await git.init()
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async push(config: GitPushConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(config.localPath)

      const isRepo = existsSync(join(config.localPath, '.git'))
      if (!isRepo) {
        await git.init()
      }

      const remoteUrl = `https://${config.username}:${config.token}@github.com/${config.remoteUrl}.git`

      let remotes: { name: string; refs: { fetch: string; push: string } }[] = []
      try {
        remotes = await git.getRemotes(true)
      } catch {}

      const originRemote = remotes.find(r => r.name === 'origin')
      if (originRemote) {
        await git.removeRemote('origin')
      }
      await git.addRemote('origin', remoteUrl)

      await git.add('./*')

      const status = await git.status()
      const hasChanges = [
        ...status.modified,
        ...status.not_added,
        ...status.created,
        ...status.deleted,
        ...status.renamed.map(r => r.to)
      ].length > 0

      if (!hasChanges) {
        return { success: false, error: '没有需要提交的更改' }
      }

      const msg = config.commitMessage || `提交于 ${new Date().toLocaleString()}`
      await git.commit(msg)

      try {
        await git.push(['-u', 'origin', config.branch, '--force'])
      } catch (pushErr: any) {
        const errMsg = pushErr?.message || String(pushErr)
        if (errMsg.includes('403') || errMsg.includes('auth')) {
          return { success: false, error: '认证失败，请检查 GitHub 用户名和 Token' }
        }
        if (errMsg.includes('404')) {
          return { success: false, error: '目标仓库不存在，请先在 GitHub 创建仓库' }
        }
        if (errMsg.includes('rejected')) {
          return { success: false, error: '推送被拒绝，已使用 --force 覆盖' }
        }
        return { success: false, error: `推送失败: ${errMsg.substring(0, 200)}` }
      }

      return { success: true }
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (msg.includes('Authentication failed') || msg.includes('403')) {
        return { success: false, error: '认证失败，请检查 GitHub 用户名和 Token' }
      }
      return { success: false, error: msg.substring(0, 200) }
    }
  }

  async pull(localPath: string, branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(localPath)
      await git.pull('origin', branch)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}
