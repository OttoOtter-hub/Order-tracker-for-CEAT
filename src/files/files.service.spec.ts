import { NotFoundException } from "@nestjs/common";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { FilesService } from "./files.service";

describe("FilesService — client download access", () => {
  let uploadDir: string;
  let storedRepo: ReturnType<typeof makeFakeRepo>;
  let piRepo: ReturnType<typeof makeFakeRepo>;
  let additionalRepo: ReturnType<typeof makeFakeRepo>;
  let versionsRepo: ReturnType<typeof makeFakeRepo>;
  let service: FilesService;

  const client = (customerId: string): RequestUser => ({
    id: `user-${customerId}`,
    email: `${customerId}@example.com`,
    role: Role.CLIENT,
    customerId,
  });
  const ops: RequestUser = {
    id: "ops-1",
    email: "ops@ceat.com",
    role: Role.OPS,
    customerId: null,
  };

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "ceat-files-spec-"));
    storedRepo = makeFakeRepo();
    piRepo = makeFakeRepo();
    additionalRepo = makeFakeRepo();
    versionsRepo = makeFakeRepo();
    service = new FilesService(
      storedRepo as any,
      piRepo as any,
      additionalRepo as any,
      versionsRepo as any,
      { get: () => uploadDir } as any,
    );

    // "old" was the card's original file before a replacement: only the
    // archive still references it; the PI row now points at "new".
    for (const id of ["old", "new"]) {
      storedRepo.seed({
        id,
        storageKey: `${id}.pdf`,
        originalName: `${id}.pdf`,
      });
      writeFileSync(join(uploadDir, `${id}.pdf`), id);
    }
    piRepo.seed({
      id: "pi-1",
      customer: { id: "cust-1" },
      piFileUrl: "/files/new/download",
    });
    versionsRepo.seed({
      id: "v-1",
      pi: { id: "pi-1", customer: { id: "cust-1" } },
      fileUrl: "/files/old/download",
    });
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  async function readAll(id: string, actor: RequestUser): Promise<string> {
    const { stream } = await service.getDownloadable(id, actor);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString();
  }

  it("lets the owning client download an archived (replaced) version", async () => {
    expect(await readAll("old", client("cust-1"))).toBe("old");
    expect(await readAll("new", client("cust-1"))).toBe("new");
  });

  it("404s another customer's client on the archived version", async () => {
    await expect(
      service.getDownloadable("old", client("cust-2")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("ops downloads it without any ownership lookup", async () => {
    expect(await readAll("old", ops)).toBe("old");
  });
});
