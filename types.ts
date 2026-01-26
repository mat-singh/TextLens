
export interface ExtractionResult {
  id: string;
  timestamp: number;
  text: string;
  previewUrl: string;
}

export enum AppState {
  IDLE = 'IDLE',
  CAPTURING = 'CAPTURING',
  PROCESSING = 'PROCESSING',
  ERROR = 'ERROR'
}
