import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UploadedFileLike } from '../interfaces/uploaded-file.interface';

@Injectable()
export class FileStorageService {
  async save(file: UploadedFileLike, folder: string): Promise<string> {
    const base = process.env.UPLOAD_ROOT || 'uploads';
    const targetDir = join(base, folder);
    await mkdir(targetDir, { recursive: true });
    const fileName = `${Date.now()}-${file.originalname}`.replace(/\s+/g, '-');
    const fullPath = join(targetDir, fileName);
    await writeFile(fullPath, file.buffer);
    return fullPath;
  }
}
