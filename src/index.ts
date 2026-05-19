import {appConfig} from "./config.js";
import {generateRandomDeviceProfile} from "./device-profile.js";
import {appendErrorEmail, clearErrorEmailFile} from "./email-error-recorder.js";
import {
    getHotmailXiongmaodianEmailsFile,
    getHotmailXiongmaodianRemainingEmailCount,
} from "./mail/hotmail-xiongmaodian.js";
import {OpenAIClient} from "./openai.js";
import {createSMSBroker} from "./sms/index.js";

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

function readNumberArg(flag: string): number | null {
    const raw = readArgValue(flag).trim();
    if (!raw) {
        return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}


const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({
    apiKey: appConfig.heroSMSApiKey,
    pollAttempts: appConfig.heroSMSPollAttempts,
    pollIntervalMs: appConfig.heroSMSPollIntervalMs,
    maxPrice: appConfig.heroSMSMaxPrice,
    country: appConfig.heroSMSCountry
}) : undefined

async function recordAuthFailureEmail(email: string): Promise<void> {
    const errorFile = await appendErrorEmail(email);
    if (errorFile) {
        console.error(`[失败记录] 已写入 ${errorFile}`);
    }
}

interface RunOnceResult {
    email: string;
}

class AuthRunError extends Error {
    readonly email: string;
    readonly cause: unknown;

    constructor(email: string, cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        super(message);
        this.name = "AuthRunError";
        this.email = email;
        this.cause = cause;
    }
}

async function runOnce(): Promise<RunOnceResult> {
    const email = readArgValue("--email").trim();
    const manualOtp = hasFlag("--otp");
    const directSignupAuth = hasFlag("--sign");
    const saveAccessToken = hasFlag("--at");
    const deviceProfile = generateRandomDeviceProfile();
    if (directSignupAuth) {
        const client = new OpenAIClient({
            email: email || undefined,
            password: appConfig.defaultPassword,
            deviceProfile,
            manualMode: manualOtp,
            signupScreenHint: "signup",
            smsBroker
        });
        let result;
        try {
            result = await client.authRegisterAndAuthorizeHTTP();
        } catch (error) {
            await recordAuthFailureEmail(client.email);
            throw new AuthRunError(client.email, error);
        }
        console.log(
            `[✅️授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
        );
        return {email: client.email};
    }

    const registerClient = new OpenAIClient({
        email: email || undefined,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: manualOtp,
        smsBroker
    });
    try {
        await registerClient.authRegisterHTTP();
    } catch (error) {
        await recordAuthFailureEmail(registerClient.email);
        throw new AuthRunError(registerClient.email, error);
    }

    if (saveAccessToken) {
        const accessToken = await registerClient.getChatGPTAccessToken();
        const accessTokenFile = await registerClient.saveChatGPTAccessToken(accessToken);
        console.log(`[✅️注册成功] 邮箱：${registerClient.email} 密码：${appConfig.defaultPassword}`);
        console.log(`[access_token_file] ${accessTokenFile}`);
        console.log(`[access_token] ${accessToken}`);
        return {email: registerClient.email};
    }

    const loginClient = new OpenAIClient({
        email: registerClient.email,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: manualOtp,
        smsBroker
    });
    let result;
    try {
        result = await loginClient.authLoginHTTP();
    } catch (error) {
        await recordAuthFailureEmail(loginClient.email);
        throw new AuthRunError(loginClient.email, error);
    }
    console.log(
        `[✅️授权成功] 邮箱：${loginClient.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
    );
    return {email: loginClient.email};
}

async function main() {
    let round = 0;
    let successCount = 0;
    let failCount = 0;
    const successEmails: string[] = [];
    const failedEmails: string[] = [];
    const manualEmail = readArgValue("--email").trim();
    const authOnly = hasFlag("--auth");
    const manualOtp = hasFlag("--otp");
    const maxRounds = readNumberArg("--n");

    if (authOnly) {
        if (!manualEmail) {
            throw new Error("使用 --auth 时必须同时指定 --email");
        }
        try {
            const deviceProfile = generateRandomDeviceProfile();
            const client = new OpenAIClient({
                email: manualEmail,
                password: appConfig.defaultPassword,
                deviceProfile,
                manualMode: manualOtp,
                smsBroker,
            });
            const result = await client.authLoginHTTP();
            console.log(
                `[✅️授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
            );
        } catch (error) {
            console.error(`[❌️授权失败]`, error);
        }
        return;
    }

    if (manualEmail) {
        try {
            await runOnce();
        } catch (error) {
            console.error(`[❌️授权失败]`, error);
        }
        return;
    }

    const usesXiongmaodianQueue = appConfig.provider === "hotmail" && appConfig.hotmailMode === "xiongmaodian";
    if (usesXiongmaodianQueue) {
        const errorFile = await clearErrorEmailFile(getHotmailXiongmaodianEmailsFile());
        console.log(`[失败记录] 已清理 ${errorFile}`);
    }

    while (!maxRounds || round < maxRounds) {
        if (usesXiongmaodianQueue) {
            const remainingEmails = await getHotmailXiongmaodianRemainingEmailCount();
            if (remainingEmails <= 0) {
                console.log("邮箱列表已全部使用完毕，自动停止");
                break;
            }
        }

        round += 1;
        console.log(
            `第 ${round} 轮开始: 成功=${successCount} 失败=${failCount} 模式=自动`,
        );
        try {
            const result = await runOnce();
            successEmails.push(result.email);
            successCount += 1;
        } catch (error) {
            failCount += 1;
            console.error(`[❌️授权失败]`, error);
            if (error instanceof AuthRunError && error.email) {
                failedEmails.push(error.email);
            }
        }

        if ((!maxRounds || round < maxRounds) && appConfig.loopDelayMs > 0) {
            console.log(`[延迟] 轮次间等待 ${appConfig.loopDelayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, appConfig.loopDelayMs));
        }
    }

    console.log(
        `自动模式结束: 已执行=${round} 成功=${successCount} 失败=${failCount}`,
    );
    console.log(`成功邮箱(${successEmails.length}): ${successEmails.length ? successEmails.join(", ") : "无"}`);
    console.log(`失败邮箱(${failedEmails.length}): ${failedEmails.length ? failedEmails.join(", ") : "无"}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
