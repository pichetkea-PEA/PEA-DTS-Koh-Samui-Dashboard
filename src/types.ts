export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  iconLink?: string;
  webViewLink?: string;
  folderId?: string;
  subfolderName?: string;
  folderPath?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  parentId?: string;
}

export interface AgentPrinciplePreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
  focusMode: 'Balanced' | 'Executive' | 'Deep Dive' | 'Action-Oriented' | 'Bullet-Points';
}

export interface AgentFileResult {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize?: string;
  modifiedTime?: string;
  originalText?: string;
  summary?: string;
  wordCount?: number;
  characterCount?: number;
  processedAt?: string;
  status: 'idle' | 'reading' | 'analyzing' | 'completed' | 'error';
  error?: string;
  chatHistory?: Array<{ id: string; role: 'user' | 'model'; content: string; timestamp: string }>;
}

export interface FileTypeOption {
  id: string;
  label: string;
  extensions: string[];
  mimeTypes: string[];
  iconName: string;
}
