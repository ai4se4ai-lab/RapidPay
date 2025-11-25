// src/utils/gitUtils.ts
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Interface for repository information
 */
export interface RepositoryInfo {
  remoteUrl: string;
  branch: string;
  commitCount: number;
  workspaceRoot: string;
}

/**
 * Get Git repository information
 * @returns Repository information or null if not available
 */
export async function getRepositoryInfo(): Promise<RepositoryInfo | null> {
  try {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showInformationMessage('No workspace folder open');
      return null;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    
    // Check if git is available and this is a git repository
    try {
      await execPromise('git rev-parse --is-inside-work-tree', { cwd: workspaceRoot });
    } catch (error) {
      vscode.window.showInformationMessage('The current workspace is not a Git repository or Git is not installed.');
      return null;
    }
    
    // Get remote URL if available (but don't error if not)
    let remoteUrl = '';
    try {
      const { stdout } = await execPromise('git config --get remote.origin.url', { cwd: workspaceRoot });
      remoteUrl = stdout.trim();
    } catch (error) {
      // Remote origin might not be configured, but that's okay
      vscode.window.showInformationMessage('No remote origin configured for this repository.');
      remoteUrl = 'No remote origin';
    }
    
    // These commands should work even without a remote
    const { stdout: branch } = await execPromise('git branch --show-current', { cwd: workspaceRoot });
    const { stdout: commits } = await execPromise('git rev-list --count HEAD', { cwd: workspaceRoot });
    
    return {
      remoteUrl: remoteUrl,
      branch: branch.trim(),
      commitCount: parseInt(commits.trim(), 10),
      workspaceRoot: workspaceRoot
    };
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get repository info: ${error}`);
    return null;
  }
}

/**
 * Get the workspace root path
 * @returns Workspace root path or null if not available
 */
export function getWorkspaceRoot(): string | null {
  if (!vscode.workspace.workspaceFolders) {
    return null;
  }
  
  return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

/**
 * Get the latest commit information
 * @returns Object containing commit hash, message, and diff
 */
export async function getLatestCommitInfo(): Promise<{ hash: string; message: string; diff: string } | null> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return null;
  }
  
  try {
    const { stdout: commitHash } = await execPromise('git rev-parse HEAD', { cwd: workspaceRoot });
    const { stdout: commitMessage } = await execPromise('git log -1 --pretty=%B', { cwd: workspaceRoot });
    const { stdout: diff } = await execPromise('git show --name-status', { cwd: workspaceRoot });
    
    return {
      hash: commitHash.trim(),
      message: commitMessage.trim(),
      diff: diff.trim()
    };
  } catch (error) {
    console.error(`Failed to get latest commit info: ${error}`);
    return null;
  }
}

/**
 * Check if a commit has been made in the last few seconds
 * @param seconds Number of seconds to check
 * @returns True if a commit was made in the specified period
 */
export async function wasCommitMadeRecently(seconds: number = 10): Promise<boolean> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return false;
  }
  
  try {
    const { stdout: lastCommitTime } = await execPromise(
      'git log -1 --format=%ct HEAD',
      { cwd: workspaceRoot }
    );
    
    const lastCommitTimestamp = parseInt(lastCommitTime.trim(), 10);
    const currentTime = Math.floor(Date.now() / 1000);
    
    return (currentTime - lastCommitTimestamp) < seconds;
  } catch (error) {
    console.error(`Failed to check if commit was made recently: ${error}`);
    return false;
  }
}

/**
 * Get commit hash of HEAD
 * @returns Commit hash or empty string if not available
 */
export async function getCurrentCommitHash(): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  
  if (!workspaceRoot) {
    return '';
  }
  
  try {
    const { stdout } = await execPromise('git rev-parse HEAD', { cwd: workspaceRoot });
    return stdout.trim();
  } catch (error) {
    console.error(`Failed to get current commit hash: ${error}`);
    return '';
  }
}

/**
 * Get the latest commit hash (alias for getCurrentCommitHash)
 * @param workspacePath Optional workspace path override
 * @returns Latest commit hash or null
 */
export async function getLatestCommit(workspacePath?: string): Promise<string | null> {
  const cwd = workspacePath || getWorkspaceRoot();
  
  if (!cwd) {
    return null;
  }
  
  try {
    const { stdout } = await execPromise('git rev-parse HEAD', { cwd });
    return stdout.trim();
  } catch (error) {
    console.error(`Failed to get latest commit: ${error}`);
    return null;
  }
}

/**
 * Get the list of files modified in a commit
 * @param commitHash Commit hash
 * @param workspacePath Workspace path
 * @returns Array of modified file paths
 */
export async function getCommitFiles(commitHash: string, workspacePath?: string): Promise<string[]> {
  const cwd = workspacePath || getWorkspaceRoot();
  
  if (!cwd) {
    return [];
  }
  
  try {
    const { stdout } = await execPromise(
      `git diff-tree --no-commit-id --name-only -r ${commitHash}`,
      { cwd }
    );
    return stdout.trim().split('\n').filter(f => f);
  } catch (error) {
    console.error(`Failed to get commit files: ${error}`);
    return [];
  }
}

/**
 * Get the diff for a specific commit
 * @param commitHash Commit hash
 * @param workspacePath Workspace path
 * @returns Diff content or empty string
 */
export async function getCommitDiff(commitHash: string, workspacePath?: string): Promise<string> {
  const cwd = workspacePath || getWorkspaceRoot();
  
  if (!cwd) {
    return '';
  }
  
  try {
    const { stdout } = await execPromise(
      `git show ${commitHash} --format=""`,
      { cwd, maxBuffer: 5 * 1024 * 1024 }
    );
    return stdout;
  } catch (error) {
    console.error(`Failed to get commit diff: ${error}`);
    return '';
  }
}