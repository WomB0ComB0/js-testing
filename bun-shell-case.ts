import { $ } from 'bun';
import { platform as osPlatform } from 'node:os';
// Removed unused 'exec' import

/**
 * Enum representing the detected operating system platform.
 */
export enum Platform {
    Windows = 'windows',
    Mac = 'mac',
    Linux = 'linux',
    Unknown = 'unknown',
}

/**
 * Interface describing the detected platform information.
 */
export interface IPlatformInfo {
    /** The detected operating system platform. */
    platform: Platform;
    /** True if the platform is Windows. */
    isWindows: boolean;
    /** True if the platform is macOS. */
    isMac: boolean;
    /** True if the platform is Linux. */
    isLinux: boolean;
    /** True if running under Windows Subsystem for Linux. */
    isWsl: boolean;
    /** True if running under WSL version 2. */
    isWsl2: boolean;
}

function determinePlatformInfo(): IPlatformInfo {
    const os = osPlatform();
    const isWindows = os === 'win32';
    const isMac = os === 'darwin';
    const isLinux = os === 'linux';

    const isWsl = process.env.WSL_DISTRO_NAME !== undefined;
    const isWsl2 = isWsl && process.env.WSL_INTEROP !== undefined;

    let platform: Platform;
    if (isWindows) platform = Platform.Windows;
    else if (isMac) platform = Platform.Mac;
    else if (isLinux) platform = Platform.Linux;
    else platform = Platform.Unknown;

    return Object.freeze({
        platform,
        isWindows,
        isMac,
        isLinux,
        isWsl,
        isWsl2,
    });
}

/**
 * Singleton instance containing information about the current platform.
 * Uses Object.freeze for immutability.
 */
export const platformInfo: IPlatformInfo = determinePlatformInfo();

// --- Package Manager Detection ---

interface PackageManagerInfo {
    name: string;
    command: string;
}

const nodePackageManagers: ReadonlyArray<PackageManagerInfo> = [
    { name: 'bun', command: 'bun --version' },
    { name: 'pnpm', command: 'pnpm --version' },
    { name: 'yarn', command: 'yarn --version' },
    { name: 'npm', command: 'npm --version' },
];

function getSystemPackageManagers(): ReadonlyArray<PackageManagerInfo> {
    switch (platformInfo.platform) {
        case Platform.Mac:
            return [{ name: 'brew', command: 'brew --version' }];
        case Platform.Windows:
            return [
                { name: 'winget', command: 'winget --version' },
                { name: 'scoop', command: 'scoop --version' },
                { name: 'choco', command: 'choco --version' },
            ];
        case Platform.Linux:
            return [
                { name: 'apt', command: 'apt --version' }, // Common on Debian/Ubuntu
                { name: 'dnf', command: 'dnf --version' }, // Fedora, RHEL 8+
                { name: 'pacman', command: 'pacman --version' }, // Arch
                { name: 'paru', command: 'paru --version' }, // Arch AUR Helper (often installed with pacman)
                { name: 'yum', command: 'yum --version' }, // CentOS/RHEL 7
            ];
        default:
            return [];
    }
}

const systemPackageManagers = getSystemPackageManagers();
const allKnownPackageManagers = [...nodePackageManagers, ...systemPackageManagers];

/**
 * Checks if a command exists and runs successfully.
 * @param pmInfo - The package manager info { name, command }.
 * @returns The name of the package manager if found, otherwise null.
 */
async function checkPackageManager(pmInfo: PackageManagerInfo): Promise<string | null> {
    try {
        const result = await $`${pmInfo.command}`.nothrow();
        if (result.exitCode === 0) {
            console.debug(`Detected package manager: ${pmInfo.name}`);
            return pmInfo.name;
        }
    } catch (error: any) {
        if (error?.code !== 'ENOENT' && !error.message?.includes('command not found')) {
            console.debug(`Error checking for ${pmInfo.name} (${pmInfo.command}): ${error.message}`);
        }
    }
    return null;
}

/**
 * Detects the first available Node.js package manager (npm, yarn, pnpm, bun).
 * @returns Promise resolving to the name of the first detected Node.js package manager, or null if none are found.
 */
export async function detectNodePackageManager(): Promise<string | null> {
    console.debug('Detecting Node.js package managers...');
    for (const pm of nodePackageManagers) {
        const found = await checkPackageManager(pm);
        if (found) return found;
    }
    console.debug('No standard Node.js package manager detected.');
    return null;
}

/**
 * Detects the first available *system* package manager (apt, brew, winget, etc.).
 * Useful for installing system-level software like Node.js itself.
 * @returns Promise resolving to the name of the first detected system package manager, or null if none are found.
 */
export async function detectSystemPackageManager(): Promise<string | null> {
    console.debug('Detecting system package managers...');
    if (systemPackageManagers.length === 0) {
        console.debug('No system package managers configured for this platform:', platformInfo.platform);
        return null;
    }
    for (const pm of systemPackageManagers) {
        const found = await checkPackageManager(pm);
        if (found) return found;
    }
    console.debug('No supported system package manager detected.');
    return null;
}


/**
 * Installs Node.js using a specified *system* package manager.
 * Note: This function requires appropriate permissions (e.g., sudo on Linux/Mac).
 * It relies on Bun's `$` which handles shell execution.
 *
 * @param systemPackageManager - The system package manager to use (e.g., 'apt', 'brew', 'winget').
 * @returns Promise that resolves when installation command completes, or rejects on error.
 * @throws Error if the package manager is unsupported or the command fails.
 */
export async function installNodeJS(systemPackageManager: string): Promise<void> {
    const commands: { [key: string]: string | undefined } = {
        // Linux
        'apt': 'sudo apt update && sudo apt install -y nodejs',
        'dnf': 'sudo dnf install -y nodejs', // Might need nodejs-npm package separately on some distros
        'yum': 'sudo yum install -y nodejs', // Older RHEL/CentOS
        'pacman': 'sudo pacman -Syu --noconfirm nodejs npm', // Often need npm explicitly
        'paru': 'paru -Syu --noconfirm nodejs npm', // Assumes paru is set up for non-interactive use

        // macOS
        'brew': 'brew install node',

        // Windows
        'winget': 'winget install -e --id Node.js.Nodejs', // ID might vary slightly, check with `winget search Node.js`
        'choco': 'choco install nodejs --yes', // Use --yes for non-interactive
        'scoop': 'scoop install nodejs',
    };

    const command = commands[systemPackageManager];

    if (!command) {
        throw new Error(`Unsupported package manager for Node.js installation: ${systemPackageManager}`);
    }

    console.log(`Attempting to install Node.js using ${systemPackageManager}...`);
    console.log(`Executing: ${command}`);

    try {
        const result = await $`${command}`;

        if (result.exitCode !== 0) {
            throw new Error(`Node.js installation command failed with exit code ${result.exitCode}.`);
        }
        console.log(`Node.js installation command via ${systemPackageManager} completed successfully.`);
    } catch (error: any) {
        console.error(`Error installing Node.js using ${systemPackageManager}: ${error.message}`);
        throw error;
    }
}


// --- Example Usage / Diagnostic Script ---
// This block runs only when the script is executed directly (e.g., `bun run platform.ts`)
if (require.main === module) {
    async function runDiagnostic(): Promise<void> {
        console.log('--- Platform Information ---');
        console.log(`Platform: ${platformInfo.platform}`);
        console.log(`Is Windows: ${platformInfo.isWindows}`);
        console.log(`Is Mac: ${platformInfo.isMac}`);
        console.log(`Is Linux: ${platformInfo.isLinux}`);
        console.log(`Is WSL: ${platformInfo.isWsl} (WSL2: ${platformInfo.isWsl2})`);
        console.log('--------------------------\n');

        console.log('--- Package Manager Detection ---');
        const nodePM = await detectNodePackageManager();
        console.log(`Detected Node.js PM: ${nodePM ?? 'None'}`);

        const systemPM = await detectSystemPackageManager();
        console.log(`Detected System PM: ${systemPM ?? 'None'}`);
        console.log('-------------------------------\n');

        // Example: Try installing Node.js if a system PM was found
        // Uncomment carefully! This will attempt to install Node.js.
        /*
        if (systemPM) {
            try {
                console.log(`Attempting Node.js installation using ${systemPM}...`);
                await installNodeJS(systemPM);
                console.log("Node.js installation initiated successfully.");
            } catch (error) {
                console.error("Node.js installation failed:", error.message);
            }
        } else {
            console.log("Cannot attempt Node.js installation: No supported system package manager detected.");
        }
        */
    }

    runDiagnostic().catch(error => {
        console.error("Diagnostic script failed:", error);
        process.exit(1);
    });
}