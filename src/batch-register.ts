import {readFile} from "node:fs/promises";
import path from "node:path";
import {appConfig} from "./config.js";
import {generateRandomDeviceProfile} from "./device-profile.js";
import {
    appendErrorEmail,
    appendSuccessEmail,
    recordEmailSourceFile,
    removeEmailFromSourceFile,
} from "./email-error-recorder.js";
import {OpenAIClient} from "./openai.js";

const DEFAULT_DELAY_MS = 3000;

function readArgValue(flag: string): string {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return "";
    }
    return process.argv[index + 1] ?? "";
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

interface LoadedEmails {
    emails: string[];
    sourceFilePath?: string;
}

async function loadEmails(): Promise<LoadedEmails> {
    const emailsArg = readArgValue("--emails").trim();
    if (emailsArg) {
        return {
            emails: emailsArg
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        };
    }

    const fileArg = readArgValue("--file").trim();
    if (fileArg) {
        const filePath = path.resolve(fileArg);
        const raw = await readFile(filePath, "utf8");
        const emails = raw
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
        for (const email of emails) {
            recordEmailSourceFile(email, filePath);
        }
        return {emails, sourceFilePath: filePath};
    }

    return {emails: []};
}

async function sleep(ms: number): Promise<void> {
    if (ms <= 0) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runForEmail(email: string): Promise<void> {
    const deviceProfile = generateRandomDeviceProfile();
    const directSignupAuth = hasFlag("--sign");
    if (directSignupAuth) {
        const client = new OpenAIClient({
            email,
            password: appConfig.defaultPassword,
            deviceProfile,
            manualMode: false,
            signupScreenHint: "sign",
        });
        let result;
        try {
            result = await client.authRegisterAndAuthorizeHTTP();
        } catch (error) {
            const errorFile = await appendErrorEmail(client.email);
            if (errorFile) {
                console.error(`[失败记录] 已写入 ${errorFile}`);
            }
            throw error;
        }
        console.log(
            `[授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
        );
        const successFile = await appendSuccessEmail(client.email);
        if (successFile) {
            console.log(`[成功记录] 已写入 ${successFile}`);
        }
        const sourceFile = await removeEmailFromSourceFile(client.email);
        if (sourceFile) {
            console.log(`[邮箱文件] 授权成功，已从 ${sourceFile} 删除 ${client.email}`);
        }
        return;
    }

    const registerClient = new OpenAIClient({
        email,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: false,
    });

    await registerClient.authRegisterHTTP();

    const loginClient = new OpenAIClient({
        email: registerClient.email,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: false,
    });
    let result;
    try {
        result = await loginClient.authLoginHTTP();
    } catch (error) {
        const errorFile = await appendErrorEmail(loginClient.email);
        if (errorFile) {
            console.error(`[失败记录] 已写入 ${errorFile}`);
        }
        throw error;
    }
    console.log(
        `[授权成功] 邮箱：${loginClient.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
    );
    const successFile = await appendSuccessEmail(loginClient.email);
    if (successFile) {
        console.log(`[成功记录] 已写入 ${successFile}`);
    }
    const sourceFile = await removeEmailFromSourceFile(loginClient.email);
    if (sourceFile) {
        console.log(`[邮箱文件] 授权成功，已从 ${sourceFile} 删除 ${loginClient.email}`);
    }
}

async function main(): Promise<void> {
    const loadedEmails = await loadEmails();
    const {emails, sourceFilePath} = loadedEmails;
    const delayMs = Number.parseInt(readArgValue("--delay-ms").trim(), 10) || DEFAULT_DELAY_MS;
    const stopOnError = hasFlag("--stop-on-error");

    if (!emails.length) {
        throw new Error("没有可处理的邮箱，请用 --emails 或 --file 提供");
    }

    let successCount = 0;
    let failCount = 0;

    console.log(`准备批量注册并获取 token：${emails.length} 个邮箱`);

    for (let index = 0; index < emails.length; index += 1) {
        const email = emails[index];
        console.log(`[${index + 1}/${emails.length}] 开始处理 ${email}`);
        try {
            await runForEmail(email);
            successCount += 1;
        } catch (error) {
            failCount += 1;
            console.error(`[失败] 邮箱：${email}`, error);
            if (stopOnError) {
                throw error;
            }
        }

        if (index < emails.length - 1) {
            await sleep(delayMs);
        }
    }

    console.log(`执行结束：成功=${successCount} 失败=${failCount}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
