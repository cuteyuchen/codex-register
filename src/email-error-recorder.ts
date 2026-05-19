import {appendFile, mkdir, readFile, rm} from "node:fs/promises";
import path from "node:path";

const emailSourceFileByEmail = new Map<string, string>();

function normalizeEmail(email: string): string {
    return String(email ?? "").trim().toLowerCase();
}

export function recordEmailSourceFile(email: string, sourceFilePath: string): void {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPath = String(sourceFilePath ?? "").trim();
    if (!normalizedEmail || !normalizedPath) {
        return;
    }
    emailSourceFileByEmail.set(normalizedEmail, path.resolve(normalizedPath));
}

export function getEmailSourceFile(email: string): string | undefined {
    return emailSourceFileByEmail.get(normalizeEmail(email));
}

export function getErrorEmailFilePath(sourceFilePath: string): string {
    return path.join(path.dirname(path.resolve(sourceFilePath)), "error_emails.txt");
}

export async function clearErrorEmailFile(sourceFilePath: string): Promise<string> {
    const errorFile = getErrorEmailFilePath(sourceFilePath);
    await rm(errorFile, {force: true});
    return errorFile;
}

export async function appendErrorEmail(
    email: string,
    sourceFilePath = getEmailSourceFile(email),
): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !sourceFilePath) {
        return null;
    }

    const errorFile = getErrorEmailFilePath(sourceFilePath);
    await mkdir(path.dirname(errorFile), {recursive: true});

    try {
        const raw = await readFile(errorFile, "utf8");
        const exists = raw
            .split(/\r?\n/)
            .map((line) => normalizeEmail(line))
            .includes(normalizedEmail);
        if (exists) {
            return errorFile;
        }
    } catch {
        // missing file is expected on the first failure
    }

    await appendFile(errorFile, `${normalizedEmail}\n`, "utf8");
    return errorFile;
}
