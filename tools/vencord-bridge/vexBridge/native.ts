/*
 * VexBridge, Vencord Desktop only (runs in the Electron main process through Vencord's native helpers).
 * Writes vex-bridge.json atomically into the folder named by the VEX_BRIDGE_DIR environment variable or, if
 * unset, <Documents>/VexBridge. Only that one file name is ever written; the folder is never listed.
 */

import { IpcMainInvokeEvent } from "electron";
import { mkdir, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const FILE = "vex-bridge.json";
const MAX = 1024 * 1024;

export async function write(_: IpcMainInvokeEvent, text: string) {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX) throw new Error("VexBridge: refusing to write more than 1 MB");
    const dir = process.env.VEX_BRIDGE_DIR || join(homedir(), "Documents", "VexBridge");
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, FILE + ".tmp");
    await writeFile(tmp, text, "utf8");
    await rename(tmp, join(dir, FILE));
}
