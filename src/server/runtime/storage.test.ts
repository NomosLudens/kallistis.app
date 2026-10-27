import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeStorage, MediaStorageUnavailableError } from "./storage";

const { getRequest } = vi.hoisted(() => ({ getRequest: vi.fn() }));
let temporaryRoot: string | undefined;

vi.mock("@tanstack/react-start/server", () => ({ getRequest }));

describe("runtime media storage", () => {
  afterEach(async () => {
    getRequest.mockReset();
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
      temporaryRoot = undefined;
    }
  });

  it("fails explicitly in a Worker without the suspended R2 binding", () => {
    getRequest.mockReturnValue({
      __kallistisRuntimeEnv: {
        workerRuntime: true,
        mediaStorageMode: "disabled",
      },
    });

    expect(() => createRuntimeStorage()).toThrow(MediaStorageUnavailableError);
  });

  it("does not fall back to local filesystem in an ambiguously configured Worker", () => {
    getRequest.mockReturnValue({
      __kallistisRuntimeEnv: {
        workerRuntime: true,
      },
    });

    expect(() => createRuntimeStorage()).toThrow(MediaStorageUnavailableError);
  });

  it("uses the configured R2 binding when the Worker mode is canonical", () => {
    const bucket = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      head: vi.fn(),
      list: vi.fn(),
    };
    getRequest.mockReturnValue({
      __kallistisRuntimeEnv: {
        workerRuntime: true,
        mediaStorageMode: "r2",
        media: bucket,
      },
    });

    expect(() => createRuntimeStorage()).not.toThrow();
  });

  it("keeps local durable storage for Node development without Worker bindings", async () => {
    getRequest.mockImplementation(() => {
      throw new Error("no request context");
    });
    temporaryRoot = await mkdtemp(join(tmpdir(), "kallistis-storage-test-"));
    const storage = createRuntimeStorage(temporaryRoot);

    await storage.put("qa/example.txt", "persisted", "text/plain");
    await expect(storage.get("qa/example.txt")).resolves.toMatchObject({
      contentType: "application/octet-stream",
      size: 9,
    });
  });
});
