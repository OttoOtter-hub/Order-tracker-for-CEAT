import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  promises as fs,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Role } from "../common/enums/role.enum";
import { apiError } from "../common/errors/api-error";
import { decodeMultipartFilename } from "../common/utils/decode-multipart-filename";
import { RequestUser } from "../common/auth/request-user.interface";
import { PiAdditionalFile } from "../pi-additional-files/pi-additional-file.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { StoredFile } from "./stored-file.entity";

export interface DownloadableFile {
  file: StoredFile;
  stream: Readable;
}

/**
 * Local-disk storage (TOR allowed "локально/S3-совместимое" — local is the
 * simpler of the two and the deploy target is a plain VPS, not an object
 * store). Files are named by their own row id, not the original filename,
 * to avoid collisions/path traversal; `originalName` is kept for the
 * download's Content-Disposition header.
 */
@Injectable()
export class FilesService {
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(StoredFile)
    private readonly repo: Repository<StoredFile>,
    @InjectRepository(ProformaInvoice)
    private readonly piRepo: Repository<ProformaInvoice>,
    @InjectRepository(PiAdditionalFile)
    private readonly additionalFileRepo: Repository<PiAdditionalFile>,
    config: ConfigService,
  ) {
    this.uploadDir = resolve(config.get<string>("UPLOAD_DIR", "./uploads"));
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async save(
    file: Express.Multer.File,
    uploadedBy: string,
  ): Promise<StoredFile> {
    const id = randomUUID();
    const originalName = decodeMultipartFilename(file.originalname);
    const storageKey = `${id}${extname(originalName)}`;
    await fs.writeFile(join(this.uploadDir, storageKey), file.buffer);

    const stored = this.repo.create({
      id,
      originalName,
      mimeType: file.mimetype || "application/octet-stream",
      sizeBytes: String(file.size),
      storageKey,
      uploadedBy,
    });
    return this.repo.save(stored);
  }

  async getDownloadable(
    id: string,
    actor: RequestUser,
  ): Promise<DownloadableFile> {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `File ${id} not found`),
      );
    }
    if (actor.role !== Role.OPS) {
      await this.assertClientCanAccess(id, actor);
    }
    return this.openFromDisk(file);
  }

  /**
   * No access check at all — for callers that have already authorized the
   * request against their own entity (e.g. a marking file, which
   * assertClientCanAccess doesn't know about) and only need the bytes.
   */
  async openStoredFile(id: string): Promise<DownloadableFile> {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `File ${id} not found`),
      );
    }
    return this.openFromDisk(file);
  }

  private openFromDisk(file: StoredFile): DownloadableFile {
    const fullPath = join(this.uploadDir, file.storageKey);
    if (!existsSync(fullPath)) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `File ${file.id} not found on disk`),
      );
    }
    return { file, stream: createReadStream(fullPath) };
  }

  /**
   * Ownership check for `client`: a file is only downloadable if it's
   * actually referenced by a PI (or PI additional file) belonging to the
   * requester's own customer_id. Matched by exact URL equality against the
   * `/files/:id/download` string every *_url/fileUrl column is populated
   * with (see ProformaInvoicesService.storeUploadedFile) — not a LIKE scan,
   * since the id is already the unique, unguessable part of that string.
   */
  private async assertClientCanAccess(
    fileId: string,
    actor: RequestUser,
  ): Promise<void> {
    const url = `/files/${fileId}/download`;
    if (!actor.customerId) {
      throw new NotFoundException(
        apiError("NOT_FOUND", `File ${fileId} not found`),
      );
    }

    const piMatches = await this.piRepo.count({
      where: [
        { customer: { id: actor.customerId }, piFileUrl: url },
        { customer: { id: actor.customerId }, signedFileUrl: url },
        { customer: { id: actor.customerId }, pendingReplacementFileUrl: url },
      ],
    });
    if (piMatches > 0) {
      return;
    }

    const additionalFileMatches = await this.additionalFileRepo.count({
      where: { fileUrl: url, pi: { customer: { id: actor.customerId } } },
    });
    if (additionalFileMatches > 0) {
      return;
    }

    throw new NotFoundException(
      apiError("NOT_FOUND", `File ${fileId} not found`),
    );
  }
}
