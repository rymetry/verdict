import * as fs from "node:fs/promises";

/**
 * `fs.access` resolves on existence + readability and rejects otherwise.
 * Wrapped here so route handlers do not duplicate the try/catch pattern.
 */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
