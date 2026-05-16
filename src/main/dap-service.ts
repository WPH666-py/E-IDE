import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles, Breakpoint } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'

class DAPService extends DebugSession {
  private _variableHandles = new Handles<string>()
  private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>()
  private _localHandle: number = 0
  private _globalHandle: number = 0

  constructor() {
    super()
    this.setDebuggerLinesStartAt1(true)
    this.setDebuggerColumnsStartAt1(true)
  }

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    response.body = response.body || {}
    response.body.supportsConfigurationDoneRequest = true
    response.body.supportsEvaluateForHovers = true
    response.body.supportsStepBack = false
    response.body.supportsSetVariable = true

    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    _args: DebugProtocol.LaunchRequestArguments
  ): void {
    this.sendResponse(response)
    this.sendEvent(new TerminatedEvent())
  }

  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    const path = args.source.path as string
    const clientLines = args.lines || []

    const actualBreakpoints = clientLines.map(l => {
      const bp = new Breakpoint(true, l) as DebugProtocol.Breakpoint
      bp.id = this._breakpoints.size
      return bp
    })

    this._breakpoints.set(path, actualBreakpoints)

    response.body = {
      breakpoints: actualBreakpoints
    }
    this.sendResponse(response)
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [
        new Thread(1, 'thread 1')
      ]
    }
    this.sendResponse(response)
  }

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): void {
    const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0
    const maxFrames = typeof args.levels === 'number' ? args.levels : 1000

    const frames: StackFrame[] = []
    for (let i = startFrame; i < Math.min(startFrame + maxFrames, 10); i++) {
      frames.push(new StackFrame(
        i,
        `frame ${i}`,
        new Source(`file${i}.ts`, `path/to/file${i}.ts`),
        i,
        1
      ))
    }

    response.body = {
      stackFrames: frames,
      totalFrames: 10
    }
    this.sendResponse(response)
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    _args: DebugProtocol.ScopesArguments
  ): void {
    this._localHandle = this._variableHandles.create('local')
    this._globalHandle = this._variableHandles.create('global')
    response.body = {
      scopes: [
        new Scope('Local', this._localHandle, false),
        new Scope('Global', this._globalHandle, true)
      ]
    }
    this.sendResponse(response)
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const variables: DebugProtocol.Variable[] = []

    if (args.variablesReference === this._localHandle) {
      variables.push({
        name: 'localVar',
        type: 'string',
        value: 'local value',
        variablesReference: 0
      })
    } else if (args.variablesReference === this._globalHandle) {
      variables.push({
        name: 'globalVar',
        type: 'number',
        value: '42',
        variablesReference: 0
      })
    }

    response.body = {
      variables
    }
    this.sendResponse(response)
  }

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.sendResponse(response)
  }

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.sendResponse(response)
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.sendResponse(response)
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.sendResponse(response)
  }

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    _args: DebugProtocol.EvaluateArguments
  ): void {
    response.body = {
      result: 'evaluation result',
      variablesReference: 0
    }
    this.sendResponse(response)
  }
}

export { DAPService }