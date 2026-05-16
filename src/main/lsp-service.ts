import { createConnection, ProposedFeatures, TextDocuments } from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

class LSPService {
  private connection = createConnection(ProposedFeatures.all)
  private documents: TextDocuments<TextDocument>

  constructor() {
    this.documents = new TextDocuments(TextDocument)
    this.setupLSP()
  }

  private setupLSP(): void {
    this.documents.listen(this.connection)

    this.connection.onInitialize(() => {
      return {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: {
            resolveProvider: true
          },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          codeActionProvider: true,
          renameProvider: true
        }
      }
    })

    this.connection.onCompletion(() => {
      return this.handleCompletion()
    })

    this.connection.onHover(() => {
      return this.handleHover()
    })

    this.connection.onDefinition(() => {
      return this.handleDefinition()
    })

    this.connection.listen()
  }

  private handleCompletion(): any {
    return {
      isIncomplete: false,
      items: [
        {
          label: 'console.log',
          kind: 2,
          detail: '控制台输出',
          insertText: 'console.log(${1:value})'
        }
      ]
    }
  }

  private handleHover(): any {
    return {
      contents: '这是一个代码提示示例'
    }
  }

  private handleDefinition(): any {
    return null
  }

  start(): void {
    this.connection.listen()
  }
}

export { LSPService }