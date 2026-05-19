import {readFile} from "node:fs/promises";
import path from "node:path";
import type {EmailCodeProvider} from "../mailbox.js";
import {findLatestVerificationMail, normalizeMailbox} from "./verification-matcher.js";

const EMAILS_FILE = path.resolve(process.cwd(), "hotmail", "emails.txt");
const API_BASE = "https://mail.xiongmaodianjing.top/api/fetch";
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 5000;

interface XmdEmail {
    date?: string;
    from?: string;
    subject?: string;
    html_body?: string;
    text_body?: string;
}

interface XmdResponse {
    status?: string;
    emails?: XmdEmail[];
}

let emailCache: string[] | null = null;

async function loadEmails(): Promise<string[]> {
    if (emailCache) {
        return emailCache;
    }
    let raw: string;
    try {
        raw = await readFile(EMAILS_FILE, "utf8");
    } catch {
        throw new Error(
            `未找到 ${EMAILS_FILE}，请创建该文件并按一行一个的格式写入 outlook 邮箱`,
        );
    }
    const list = Array.from(
        new Set(
            raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#"))
                .map((line) => normalizeMailbox(line))
                .filter(Boolean),
        ),
    );
    if (list.length === 0) {
        throw new Error(`${EMAILS_FILE} 为空，请填入至少一个 outlook 邮箱`);
    }
    emailCache = list;
    return list;
}

function chooseRandom(list: string[]): string {
    return list[Math.floor(Math.random() * list.length)];
}

function parseTimestamp(date: string | undefined): number {
    const raw = String(date ?? "").trim();
    if (!raw) {
        return Date.now();
    }
    const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
    const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const parsed = Date.parse(withZone);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

async function fetchInbox(email: string): Promise<XmdEmail[]> {
    const url = `${API_BASE}/${encodeURIComponent(email)}/1`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`xiongmaodian fetch HTTP ${response.status}`);
    }
    const payload = (await response.json()) as XmdResponse;
    if (payload?.status !== "success" || !Array.isArray(payload.emails)) {
        throw new Error(
            `xiongmaodian fetch payload invalid: status=${String(payload?.status)}`,
        );
    }
    return payload.emails;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHotmailXiongmaodianProvider(): EmailCodeProvider {
    return {
        async getEmailAddress(): Promise<string> {
            const list = await loadEmails();
            return chooseRandom(list);
        },
        async getEmailVerificationCode(email: string): Promise<string> {
            const targetEmail = normalizeMailbox(email);
            for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
                console.log(
                    `pollHotmailOtp(xiongmaodian): attempt=${attempt}/${POLL_ATTEMPTS} targetEmail=${targetEmail}`,
                );

                let emails: XmdEmail[] = [];
                try {
                    emails = await fetchInbox(targetEmail);
                } catch (error) {
                    console.warn(
                        `pollHotmailOtp(xiongmaodian) 拉取失败: ${(error as Error).message}`,
                    );
                }

                if (emails.length > 0) {
                    const candidates = emails.map((mail) => ({
                        sender: String(mail.from ?? ""),
                        recipient: targetEmail,
                        subject: String(mail.subject ?? ""),
                        content:
                            String(mail.html_body ?? "") ||
                            String(mail.text_body ?? ""),
                        timestamp: parseTimestamp(mail.date),
                        extraTexts: [String(mail.text_body ?? "")],
                    }));

                    const matched = findLatestVerificationMail(candidates, {
                        targetEmail,
                        candidateMatcher: (mail) =>
                            /(OpenAI|ChatGPT)/i.test(
                                `${mail.subject ?? ""}\n${mail.content ?? ""}\n${mail.sender ?? ""}`,
                            ),
                    });

                    if (matched?.verificationCode) {
                        return matched.verificationCode;
                    }
                }

                if (attempt < POLL_ATTEMPTS) {
                    await sleep(POLL_INTERVAL_MS);
                }
            }
            throw new Error(`Hotmail(xiongmaodian) 等待验证码超时: ${email}`);
        },
    };
}
