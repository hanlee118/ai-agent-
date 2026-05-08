declare module "@google/stitch-sdk" {
  export type StitchToolClientOptions = {
    apiKey: string;
    baseUrl: string;
    timeout?: number;
  };

  export class StitchToolClient {
    constructor(options: StitchToolClientOptions);
    callTool<T = unknown>(toolName: string, args?: Record<string, unknown>): Promise<T>;
    close(): Promise<void>;
  }
}
