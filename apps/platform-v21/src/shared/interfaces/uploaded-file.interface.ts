export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  path?: string;
}
