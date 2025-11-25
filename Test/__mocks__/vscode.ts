// Test/__mocks__/vscode.ts
/**
 * Mock for VS Code API used in unit tests
 */

export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue(undefined)
  }),
  workspaceFolders: [{
    uri: { fsPath: '/mock/workspace' }
  }],
  openTextDocument: jest.fn().mockResolvedValue({
    getText: jest.fn().mockReturnValue('')
  }),
  fs: {
    readFile: jest.fn()
  }
};

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    show: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn()
  }),
  createWebviewPanel: jest.fn().mockReturnValue({
    webview: {
      html: '',
      onDidReceiveMessage: jest.fn()
    },
    onDidDispose: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn()
  }),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  withProgress: jest.fn()
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

export const Uri = {
  file: jest.fn((path: string) => ({ fsPath: path, path })),
  parse: jest.fn((str: string) => ({ fsPath: str, path: str }))
};

export const EventEmitter = jest.fn().mockImplementation(() => ({
  event: jest.fn(),
  fire: jest.fn(),
  dispose: jest.fn()
}));

export const Disposable = {
  from: jest.fn()
};

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
  SourceControl = 1
}

export const Range = jest.fn().mockImplementation((startLine: number, startChar: number, endLine: number, endChar: number) => ({
  start: { line: startLine, character: startChar },
  end: { line: endLine, character: endChar }
}));

export const Position = jest.fn().mockImplementation((line: number, character: number) => ({
  line,
  character
}));

export const Selection = jest.fn();

export const TextEdit = {
  replace: jest.fn(),
  insert: jest.fn(),
  delete: jest.fn()
};

export const WorkspaceEdit = jest.fn().mockImplementation(() => ({
  replace: jest.fn(),
  insert: jest.fn(),
  delete: jest.fn()
}));

export const languages = {
  registerHoverProvider: jest.fn(),
  registerCodeActionsProvider: jest.fn(),
  createDiagnosticCollection: jest.fn().mockReturnValue({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn()
  })
};

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3
};

export const Diagnostic = jest.fn();

export const extensions = {
  getExtension: jest.fn()
};

export const env = {
  clipboard: {
    writeText: jest.fn()
  }
};

