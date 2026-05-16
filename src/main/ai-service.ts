import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { readFile, readdir, writeFile } from 'fs/promises'
import { join, relative } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'

interface AIModelConfig {
  name: string
  apiKey: string
  baseUrl: string
  model: string
  maxTokens?: number
  temperature?: number
}

interface AIRequest {
  model: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

interface AIResponse {
  success: boolean
  content?: string
  error?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface CLIContext {
  projectPath: string
  currentFile?: string
  selectedFiles?: string[]
  osInfo: string
  workingDir: string
}

interface SkillParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
  required: boolean
}

interface SkillDefinition {
  name: string
  displayName: string
  description: string
  params: SkillParam[]
  execute: (params: Record<string, any>, context: CLIContext) => Promise<string>
}

interface SkillInvocation {
  skillName: string
  params: Record<string, any>
}

interface SkillStepResult {
  invocation: SkillInvocation
  result: string
  error?: string
}

interface CLIProgress {
  type: 'thinking' | 'skill_start' | 'skill_end' | 'reply' | 'error'
  skillName?: string
  skillParams?: Record<string, any>
  skillResult?: string
  skillError?: string
  content?: string
}

class AIService {
  private models: Map<string, AIModelConfig> = new Map()
  private httpClients: Map<string, AxiosInstance> = new Map()
  private skills: Map<string, SkillDefinition> = new Map()
  private progressCallback: ((p: CLIProgress) => void) | null = null

  constructor() {
    this.initializeDefaultModels()
    this.initializeSkills()
  }

  private initializeDefaultModels(): void {
    const defaultModels: AIModelConfig[] = [
      { name: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', maxTokens: 8192, temperature: 0.7 },
      { name: 'glm', apiKey: '', baseUrl: 'https://open.bigmodel.cn', model: 'glm-4', maxTokens: 8192, temperature: 0.7 },
      { name: 'kimi', apiKey: '', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k', maxTokens: 4096, temperature: 0.7 },
      { name: 'qwen', apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com', model: 'qwen-turbo', maxTokens: 4096, temperature: 0.7 },
      { name: 'gpt', apiKey: '', baseUrl: 'https://api.openai.com', model: 'gpt-4o', maxTokens: 8192, temperature: 0.7 },
      { name: 'claude', apiKey: '', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022', maxTokens: 8192, temperature: 0.7 }
    ]
    defaultModels.forEach(model => {
      this.models.set(model.name, model)
    })
  }

  private initializeSkills(): void {
    const skillDefs: SkillDefinition[] = [
      {
        name: 'read_file', displayName: '读取文件',
        description: '读取项目中指定文件的内容。可以指定行号范围只读取部分内容。',
        params: [
          { name: 'path', type: 'string', description: '文件路径，相对于项目根目录', required: true },
          { name: 'startLine', type: 'number', description: '起始行号(从1开始)，可选', required: false },
          { name: 'endLine', type: 'number', description: '结束行号，可选', required: false }
        ],
        execute: async (params, ctx) => {
          const filePath = join(ctx.projectPath, params.path)
          if (!existsSync(filePath)) return `错误: 文件不存在: ${params.path}`
          const content = await readFile(filePath, 'utf-8')
          const lines = content.split('\n')
          const start = Math.max(1, params.startLine || 1) - 1
          const end = Math.min(lines.length, params.endLine || lines.length)
          return lines.slice(start, end)
            .map((l, i) => `${start + i + 1}: ${l}`).join('\n') ||
            `文件 ${params.path} 为空`
        }
      },
      {
        name: 'write_file', displayName: '写入文件',
        description: '创建或覆盖项目中的文件。传入完整文件内容。',
        params: [
          { name: 'path', type: 'string', description: '文件路径，相对于项目根目录', required: true },
          { name: 'content', type: 'string', description: '要写入的完整文件内容', required: true }
        ],
        execute: async (params, ctx) => {
          const filePath = join(ctx.projectPath, params.path)
          await mkdirRecursive(join(filePath, '..'))
          await writeFile(filePath, params.content, 'utf-8')
          const lines = params.content.split('\n').length
          return `文件已写入: ${params.path} (${lines} 行)`
        }
      },
      {
        name: 'list_dir', displayName: '列出目录',
        description: '列出项目中指定目录的文件和子目录。',
        params: [
          { name: 'path', type: 'string', description: '目录路径，相对于项目根目录，留空表示根目录', required: false },
          { name: 'depth', type: 'number', description: '递归深度(1-3)，默认1', required: false }
        ],
        execute: async (params, ctx) => {
          const dirPath = join(ctx.projectPath, params.path || '.')
          if (!existsSync(dirPath)) return `错误: 目录不存在: ${params.path || '.'}`
          const maxDepth = Math.min(3, params.depth || 1)
          const result: string[] = []
          await listDirRecursive(dirPath, ctx.projectPath, result, 1, maxDepth)
          return result.join('\n') || '目录为空'
        }
      },
      {
        name: 'search_code', displayName: '搜索代码',
        description: '在项目文件中搜索匹配的文本或正则表达式。返回匹配的文件路径和行内容。',
        params: [
          { name: 'pattern', type: 'string', description: '要搜索的文本或正则表达式', required: true },
          { name: 'dir', type: 'string', description: '搜索的目录，相对于项目根目录，默认搜索整个项目', required: false },
          { name: 'fileTypes', type: 'string', description: '限定文件扩展名，逗号分隔，如 ts,js,py', required: false }
        ],
        execute: async (params, ctx) => {
          const searchDir = join(ctx.projectPath, params.dir || '.')
          if (!existsSync(searchDir)) return `错误: 目录不存在: ${params.dir || '.'}`
          const pattern = params.pattern as string
          const exts: Set<string> = params.fileTypes
            ? new Set((params.fileTypes as string).split(',').map((e: string) => e.trim().toLowerCase()))
            : new Set<string>(['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go',
              'php', 'r', 'html', 'css', 'vue', 'json', 'yaml', 'md', 'sql', 'xml', 'sh', 'bat', 'ps1', 'swift', 'kt', 'm', 'txt'])
          const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '__pycache__', 'vendor', 'target', '.next'])
          const results: string[] = []
          await searchInDir(searchDir, ctx.projectPath, pattern, exts, ignoreDirs, results)
          if (results.length === 0) return `未找到匹配 "${pattern}" 的内容`
          return results.slice(0, 50).join('\n')
        }
      },
      {
        name: 'run_command', displayName: '执行命令',
        description: '在项目目录中执行一个终端命令，返回命令输出。用于安装依赖、运行脚本、查看git状态等。',
        params: [
          { name: 'command', type: 'string', description: '要执行的终端命令', required: true }
        ],
        execute: async (params, ctx) => {
          return new Promise((resolve) => {
            const cmd = (params.command as string).trim()
            const timeout = 30000
            let output = ''
            let killed = false

            const timer = setTimeout(() => {
              killed = true
              resolve(output + '\n(命令超时已终止)')
            }, timeout)

            try {
              const isWin = process.platform === 'win32'
              const child = spawn(isWin ? 'cmd.exe' : 'sh', [
                isWin ? '/c' : '-c', cmd
              ], {
                cwd: ctx.projectPath || process.cwd(),
                stdio: 'pipe',
                env: { ...process.env, CI: 'true' }
              })

              child.stdout?.on('data', (d: Buffer) => { output += d.toString() })
              child.stderr?.on('data', (d: Buffer) => { output += d.toString() })

              child.on('close', () => {
                if (killed) return
                clearTimeout(timer)
                resolve(output.slice(0, 4000) || '(命令执行成功，无输出)')
              })

              child.on('error', (err: Error) => {
                clearTimeout(timer)
                resolve(`命令执行失败: ${err.message}`)
              })
            } catch (err: any) {
              clearTimeout(timer)
              resolve(`命令执行异常: ${err.message}`)
            }
          })
        }
      },
      {
        name: 'ask_user', displayName: '询问用户',
        description: '当需要用户做决定时，向用户提问。用户回复后将作为下一轮上下文。',
        params: [
          { name: 'question', type: 'string', description: '要询问用户的问题', required: true },
          { name: 'options', type: 'string', description: '可选选项，逗号分隔，如: 是,否,跳过', required: false }
        ],
        execute: async (params, _ctx) => {
          const question = params.question as string
          const options = params.options as string
          return options
            ? `请用户回答: ${question}\n选项: ${options}`
            : `请用户回答: ${question}`
        }
      }
    ]

    skillDefs.forEach(skill => this.skills.set(skill.name, skill))
  }

  private buildSkillSystemPrompt(): string {
    const skillList = Array.from(this.skills.values())
    const skillDesc = skillList.map(s => {
      const paramsDesc = s.params.map(p => `  - ${p.name} (${p.type}${p.required ? ', 必填' : ''}): ${p.description}`).join('\n')
      return `### ${s.name}: ${s.description}\n参数:\n${paramsDesc || '  无参数'}`
    }).join('\n\n')

    return `你是一个强大的 AI 编程助手 CLI 工具，拥有多个 Skill（技能）来帮助你完成任务。

## 可用技能 (Skills)
${skillDesc}

## 技能调用格式
当你需要使用技能时，用以下 XML 格式调用（可以一次调用多个）：
<skill name="技能名">
  <param name="参数名">参数值</param>
</skill>

## 工作规则
1. **必须先使用技能获取信息，再给出修改建议**。不要猜测代码内容。
2. 修改文件前先用 read_file 读取文件内容
3. 用 search_code 搜索相关代码
4. 用 list_dir 了解项目结构
5. 需要编译/运行/安装依赖时用 run_command
6. 需要用户确认时用 ask_user
7. 修改代码后用 write_file 写入，确保是完整文件内容
8. 多个 skill 可以同时调用
9. 最终答案使用中文
10. 如果不需要技能就直接回复`
  }

  private parseSkillInvocations(content: string): SkillInvocation[] {
    const regex = /<skill name="(\w+)">\s*([\s\S]*?)<\/skill>/g
    const invocations: SkillInvocation[] = []
    let match
    while ((match = regex.exec(content)) !== null) {
      const skillName = match[1]
      const paramsBlock = match[2]
      const params: Record<string, any> = {}
      const paramRegex = /<param name="(\w+)">([\s\S]*?)<\/param>/g
      let pm
      while ((pm = paramRegex.exec(paramsBlock)) !== null) {
        params[pm[1]] = pm[2].trim()
      }
      invocations.push({ skillName, params })
    }
    return invocations
  }

  private stripSkillTags(content: string): string {
    return content.replace(/<skill[\s\S]*?<\/skill>/g, '').trim()
  }

  async configureModel(modelName: string, apiKey: string, customConfig?: Partial<AIModelConfig>): Promise<{ success: boolean; error?: string }> {
    const model = this.models.get(modelName)
    if (!model) {
      return { success: false, error: `不支持的模型: ${modelName}` }
    }
    try {
      model.apiKey = apiKey
      if (customConfig) {
        if (customConfig.baseUrl) model.baseUrl = customConfig.baseUrl
        if (customConfig.model) model.model = customConfig.model
      }
      this.createHttpClient(model)
      return { success: true }
    } catch (error) {
      return { success: false, error: `配置模型失败: ${error}` }
    }
  }

  async sendMessage(modelName: string, message: string, systemPrompt?: string): Promise<AIResponse> {
    const model = this.models.get(modelName)
    if (!model || !model.apiKey) {
      return { success: false, error: `模型 ${modelName} 未配置或API密钥为空` }
    }
    try {
      const messages: AIRequest['messages'] = []
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt })
      }
      messages.push({ role: 'user', content: message })

      const request: AIRequest = {
        model: model.model,
        messages,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
        stream: false
      }

      const response = await this.makeAPIRequest(model, request)
      return this.parseAPIResponse(modelName, response)
    } catch (error: any) {
      const errMsg = error?.response?.status === 401 ? 'API密钥错误，请检查密钥是否正确'
        : error?.response?.status === 402 ? '该模型已欠费，请交费充值后使用'
        : error?.response?.status === 429 ? '请求过于频繁，请稍后重试'
        : `发送消息失败: ${error.message || error}`
      return { success: false, error: errMsg }
    }
  }

  async executeCLI(modelName: string, task: string, context: CLIContext, onProgress?: (p: CLIProgress) => void): Promise<AIResponse> {
    const model = this.models.get(modelName)
    if (!model || !model.apiKey) {
      return { success: false, error: `模型 ${modelName} 未配置或API密钥为空，请先在配置中填入API密钥` }
    }

    this.progressCallback = onProgress || null

    const skillSystemPrompt = this.buildSkillSystemPrompt()
    const initialFileContext = await this.collectFileContext(context)

    const systemPrompt = `${skillSystemPrompt}

## 操作系统与项目信息
- 操作系统: ${context.osInfo}
- 工作目录: ${context.workingDir}
- 当前打开文件: ${context.currentFile || '无'}
${initialFileContext ? '\n## 项目文件概览\n' + initialFileContext : ''}`

    const messages: AIRequest['messages'] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ]

    const MAX_TURNS = 10
    let finalContent = ''

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      this.emitProgress({ type: 'thinking' })

      try {
        const request: AIRequest = {
          model: model.model,
          messages,
          max_tokens: model.maxTokens || 8192,
          temperature: model.temperature,
          stream: false
        }

        const response = await this.makeAPIRequest(model, request)
        const parsed = this.parseAPIResponse(modelName, response)
        if (!parsed.success) return parsed

        const rawContent = parsed.content || ''
        const skillInvocations = this.parseSkillInvocations(rawContent)
        const plainText = this.stripSkillTags(rawContent)

        if (skillInvocations.length === 0) {
          finalContent = plainText
          this.emitProgress({ type: 'reply', content: finalContent })
          return { success: true, content: finalContent, usage: parsed.usage }
        }

        const skillResults: string[] = []
        for (const inv of skillInvocations) {
          const skill = this.skills.get(inv.skillName)
          if (!skill) {
            skillResults.push(`错误: 未知技能 "${inv.skillName}"`)
            continue
          }

          this.emitProgress({
            type: 'skill_start',
            skillName: inv.skillName,
            skillParams: inv.params
          })

          try {
            const result = await skill.execute(inv.params, context)
            skillResults.push(`skill:${inv.skillName} 结果:\n${result}`)
            this.emitProgress({
              type: 'skill_end',
              skillName: inv.skillName,
              skillResult: result
            })
          } catch (err: any) {
            skillResults.push(`skill:${inv.skillName} 执行失败: ${err.message}`)
            this.emitProgress({
              type: 'skill_end',
              skillName: inv.skillName,
              skillError: err.message
            })
          }
        }

        const skillResultBlock = skillResults.join('\n---\n')
        const assistantMsg = skillInvocations.length === 1 && !plainText
          ? `已调用 ${invocationsSummary(skillInvocations)}`
          : plainText + '\n\n(已调用: ' + invocationsSummary(skillInvocations) + ')'

        messages.push({ role: 'assistant', content: assistantMsg })
        messages.push({
          role: 'user',
          content: `系统通知: 技能已执行完毕，以下是执行结果。请基于结果继续分析或回复用户。\n${skillResultBlock}`
        })

        if (plainText && turn === MAX_TURNS - 1) {
          finalContent = plainText
        }
      } catch (error: any) {
        const errMsg = error?.response?.status === 401 ? 'API密钥错误，请检查密钥是否正确'
          : error?.response?.status === 402 ? '该模型已欠费，请交费充值后使用'
          : `CLI 执行失败: ${error.message || error}`
        this.emitProgress({ type: 'error', content: errMsg })
        return { success: false, error: errMsg }
      }
    }

    this.emitProgress({ type: 'reply', content: finalContent || '已完成分析' })
    return { success: true, content: finalContent || '已完成多轮分析' }
  }

  async applyCLIChange(projectPath: string, filename: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = join(projectPath, filename)
      await mkdirRecursive(join(filePath, '..'))
      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: `写入文件失败: ${error.message}` }
    }
  }

  private async collectFileContext(context: CLIContext): Promise<string> {
    const parts: string[] = []
    const filesToRead: string[] = []

    if (context.currentFile) {
      filesToRead.push(context.currentFile)
    } else if (context.selectedFiles && context.selectedFiles.length > 0) {
      filesToRead.push(...context.selectedFiles.slice(0, 20))
    } else if (context.projectPath) {
      await this.collectProjectFiles(context.projectPath, filesToRead, 0)
    }

    for (const file of filesToRead.slice(0, 15)) {
      try {
        const content = await readFile(file, 'utf-8')
        const relPath = relative(context.projectPath, file)
        const ext = (file.split('.').pop() || 'txt').toLowerCase()
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
          py: 'python', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
          rs: 'rust', go: 'go', php: 'php', r: 'r', sql: 'sql',
          html: 'html', css: 'css', vue: 'vue', json: 'json', yaml: 'yaml',
          md: 'markdown', xml: 'xml', sh: 'bash', bat: 'batch', ps1: 'powershell',
          m: 'matlab', txt: 'text'
        }
        const lang = langMap[ext] || 'text'
        const truncated = content.length > 5000 ? content.substring(0, 5000) + '\n... (文件截断)' : content
        parts.push(`文件: ${relPath} (${lang})\n${truncated}`)
      } catch {
        parts.push(`文件: ${file} (无法读取)`)
      }
    }

    return parts.length > 0 ? parts.join('\n---\n') : ''
  }

  private async collectProjectFiles(dirPath: string, files: string[], depth: number): Promise<void> {
    if (depth > 2 || files.length >= 15) return
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '__pycache__', 'vendor', 'target'])
    const textExtensions = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go',
      'php', 'r', 'sql', 'html', 'css', 'vue', 'json', 'yaml', 'yml', 'xml', 'md', 'toml', 'ini', 'cfg', 'env', 'm', 'swift', 'kt'])
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ignoreDirs.has(entry.name)) continue
        const fullPath = join(dirPath, entry.name)
        if (entry.isDirectory()) {
          await this.collectProjectFiles(fullPath, files, depth + 1)
        } else if (textExtensions.has(entry.name.split('.').pop()?.toLowerCase() || '')) {
          files.push(fullPath)
        }
      }
    } catch { }
  }

  private emitProgress(p: CLIProgress): void {
    if (this.progressCallback) {
      this.progressCallback(p)
    }
  }

  async checkBalance(modelName: string): Promise<AIResponse> {
    const model = this.models.get(modelName)
    if (!model || !model.apiKey) {
      return { success: false, error: `模型 ${modelName} 未配置` }
    }
    return { success: true }
  }

  getAvailableModels(): string[] {
    return Array.from(this.models.keys())
  }

  getModelConfig(modelName: string): AIModelConfig | undefined {
    return this.models.get(modelName)
  }

  removeModel(modelName: string): void {
    this.models.delete(modelName)
    this.httpClients.delete(modelName)
  }

  getSkillList(): { name: string; displayName: string; description: string }[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name, displayName: s.displayName, description: s.description
    }))
  }

  private createHttpClient(model: AIModelConfig): void {
    const client = axios.create({
      baseURL: model.baseUrl,
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      }
    })
    this.httpClients.set(model.name, client)
  }

  private async makeAPIRequest(model: AIModelConfig, request: AIRequest): Promise<AxiosResponse> {
    const client = this.httpClients.get(model.name)
    if (!client) {
      throw new Error(`HTTP客户端未初始化: ${model.name}`)
    }
    let endpoint = '/v1/chat/completions'
    let payload: any = { ...request }

    if (model.name === 'claude') {
      endpoint = '/v1/messages'
      payload = {
        model: request.model,
        max_tokens: request.max_tokens || 8192,
        system: request.messages.find(m => m.role === 'system')?.content || '',
        messages: request.messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content }))
      }
    } else if (model.name === 'qwen') {
      endpoint = '/v1/services/aigc/text-generation/generation'
    }

    return await client.post(endpoint, payload)
  }

  private parseAPIResponse(modelName: string, response: AxiosResponse): AIResponse {
    try {
      const data = response.data
      let content = ''
      let usage = undefined

      if (modelName === 'claude') {
        content = data.content?.[0]?.text || ''
        usage = data.usage
      } else if (modelName === 'qwen') {
        content = data.output?.text || ''
        usage = data.usage
      } else {
        content = data.choices?.[0]?.message?.content || ''
        usage = data.usage
      }

      if (!content) {
        return { success: false, error: 'API响应格式错误' }
      }
      return { success: true, content, usage }
    } catch (error) {
      return { success: false, error: `解析API响应失败: ${error}` }
    }
  }

  getModelWebsite(modelName: string): string {
    const websites: Record<string, string> = {
      deepseek: 'https://platform.deepseek.com',
      glm: 'https://open.bigmodel.cn',
      kimi: 'https://platform.moonshot.cn',
      qwen: 'https://dashscope.aliyuncs.com',
      gpt: 'https://platform.openai.com',
      claude: 'https://console.anthropic.com'
    }
    return websites[modelName] || 'https://example.com'
  }
}

function invocationsSummary(invocations: SkillInvocation[]): string {
  return invocations.map(i => i.skillName).join(', ')
}

async function mkdirRecursive(dir: string): Promise<void> {
  if (existsSync(dir)) return
  await mkdirRecursive(join(dir, '..'))
  const { mkdir } = await import('fs/promises')
  await mkdir(dir)
}

async function listDirRecursive(dirPath: string, basePath: string, result: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth) return
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea'])
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries.slice(0, 100)) {
      if (entry.name.startsWith('.') || ignoreDirs.has(entry.name)) continue
      const fullPath = join(dirPath, entry.name)
      const relPath = relative(basePath, fullPath).replace(/\\/g, '/')
      const indent = '  '.repeat(depth)
      if (entry.isDirectory()) {
        result.push(`${indent}📁 ${relPath}/`)
        await listDirRecursive(fullPath, basePath, result, depth + 1, maxDepth)
      } else {
        result.push(`${indent}📄 ${relPath}`)
      }
    }
  } catch { }
}

async function searchInDir(
  dirPath: string, basePath: string, pattern: string,
  exts: Set<string>, ignoreDirs: Set<string>, results: string[]
): Promise<void> {
  if (results.length >= 50) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= 50) return
      if (entry.name.startsWith('.') || ignoreDirs.has(entry.name)) continue
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await searchInDir(fullPath, basePath, pattern, exts, ignoreDirs, results)
      } else if (exts.has(entry.name.split('.').pop()?.toLowerCase() || '')) {
        try {
          const content = await readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length && results.length < 50; i++) {
            if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
              const relPath = relative(basePath, fullPath).replace(/\\/g, '/')
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`)
            }
          }
        } catch { }
      }
    }
  } catch { }
}

export { AIService, type AIModelConfig, type AIResponse, type CLIContext, type CLIProgress }
export type { SkillDefinition, SkillInvocation, SkillStepResult }