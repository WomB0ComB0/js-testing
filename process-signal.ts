/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//!/usr/bin/env node

import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface SignalInfo {
	name: string;
	number: number;
	description: string;
	catchable: boolean;
	terminates: boolean;
	category: "standard" | "realtime" | "job_control" | "system";
}

class SignalHandler {
	private static readonly SIGNAL_DATABASE: Record<string, SignalInfo> = {
		SIGHUP: {
			name: "SIGHUP",
			number: 1,
			description:
				"Hangup detected on controlling terminal or death of controlling process",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGINT: {
			name: "SIGINT",
			number: 2,
			description: "Interrupt from keyboard (Ctrl+C)",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGQUIT: {
			name: "SIGQUIT",
			number: 3,
			description: "Quit from keyboard (Ctrl+\\)",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGILL: {
			name: "SIGILL",
			number: 4,
			description: "Illegal instruction",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGTRAP: {
			name: "SIGTRAP",
			number: 5,
			description: "Trace/breakpoint trap",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGABRT: {
			name: "SIGABRT",
			number: 6,
			description: "Abort signal from abort()",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGBUS: {
			name: "SIGBUS",
			number: 7,
			description: "Bus error (bad memory access)",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGFPE: {
			name: "SIGFPE",
			number: 8,
			description: "Floating-point exception",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGKILL: {
			name: "SIGKILL",
			number: 9,
			description: "Kill signal (cannot be caught or ignored)",
			catchable: false,
			terminates: true,
			category: "standard",
		},
		SIGUSR1: {
			name: "SIGUSR1",
			number: 10,
			description: "User-defined signal 1",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGSEGV: {
			name: "SIGSEGV",
			number: 11,
			description: "Segmentation violation (invalid memory reference)",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGUSR2: {
			name: "SIGUSR2",
			number: 12,
			description: "User-defined signal 2",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGPIPE: {
			name: "SIGPIPE",
			number: 13,
			description: "Broken pipe: write to pipe with no readers",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGALRM: {
			name: "SIGALRM",
			number: 14,
			description: "Timer signal from alarm()",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGTERM: {
			name: "SIGTERM",
			number: 15,
			description: "Termination signal",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGSTKFLT: {
			name: "SIGSTKFLT",
			number: 16,
			description: "Stack fault on coprocessor (unused)",
			catchable: true,
			terminates: true,
			category: "standard",
		},
		SIGCHLD: {
			name: "SIGCHLD",
			number: 17,
			description: "Child stopped or terminated",
			catchable: true,
			terminates: false,
			category: "job_control",
		},
		SIGCONT: {
			name: "SIGCONT",
			number: 18,
			description: "Continue if stopped",
			catchable: true,
			terminates: false,
			category: "job_control",
		},
		SIGSTOP: {
			name: "SIGSTOP",
			number: 19,
			description: "Stop process (cannot be caught or ignored)",
			catchable: false,
			terminates: false,
			category: "job_control",
		},
		SIGTSTP: {
			name: "SIGTSTP",
			number: 20,
			description: "Stop typed at terminal (Ctrl+Z)",
			catchable: true,
			terminates: false,
			category: "job_control",
		},
		SIGTTIN: {
			name: "SIGTTIN",
			number: 21,
			description: "Terminal input for background process",
			catchable: true,
			terminates: false,
			category: "job_control",
		},
		SIGTTOU: {
			name: "SIGTTOU",
			number: 22,
			description: "Terminal output for background process",
			catchable: true,
			terminates: false,
			category: "job_control",
		},
		SIGURG: {
			name: "SIGURG",
			number: 23,
			description: "Urgent condition on socket",
			catchable: true,
			terminates: false,
			category: "system",
		},
		SIGXCPU: {
			name: "SIGXCPU",
			number: 24,
			description: "CPU time limit exceeded",
			catchable: true,
			terminates: true,
			category: "system",
		},
		SIGXFSZ: {
			name: "SIGXFSZ",
			number: 25,
			description: "File size limit exceeded",
			catchable: true,
			terminates: true,
			category: "system",
		},
		SIGVTALRM: {
			name: "SIGVTALRM",
			number: 26,
			description: "Virtual alarm clock",
			catchable: true,
			terminates: true,
			category: "system",
		},
		SIGPROF: {
			name: "SIGPROF",
			number: 27,
			description: "Profiling timer expired",
			catchable: true,
			terminates: true,
			category: "system",
		},
		SIGWINCH: {
			name: "SIGWINCH",
			number: 28,
			description: "Window resize signal",
			catchable: true,
			terminates: false,
			category: "system",
		},
		SIGIO: {
			name: "SIGIO",
			number: 29,
			description: "I/O now possible",
			catchable: true,
			terminates: false,
			category: "system",
		},
		SIGPWR: {
			name: "SIGPWR",
			number: 30,
			description: "Power failure",
			catchable: true,
			terminates: true,
			category: "system",
		},
		SIGSYS: {
			name: "SIGSYS",
			number: 31,
			description: "Bad system call",
			catchable: true,
			terminates: true,
			category: "system",
		},
	};

	private logFile: string;
	private handlers: Map<NodeJS.Signals, (signal: NodeJS.Signals) => void> =
		new Map();

	constructor(logFile?: string) {
		this.logFile = logFile || path.join(process.cwd(), "signal_handler.log");
		this.setupHandlers();
	}

	private setupHandlers(): void {
		const catchableSignals: NodeJS.Signals[] = [
			"SIGHUP",
			"SIGINT",
			"SIGQUIT",
			"SIGILL",
			"SIGTRAP",
			"SIGABRT",
			"SIGBUS",
			"SIGFPE",
			"SIGUSR1",
			"SIGSEGV",
			"SIGUSR2",
			"SIGPIPE",
			"SIGALRM",
			"SIGTERM",
			"SIGSTKFLT",
			"SIGCHLD",
			"SIGCONT",
			"SIGTSTP",
			"SIGTTIN",
			"SIGTTOU",
			"SIGURG",
			"SIGXCPU",
			"SIGXFSZ",
			"SIGVTALRM",
			"SIGPROF",
			"SIGWINCH",
			"SIGIO",
			"SIGPWR",
			"SIGSYS",
		];

		catchableSignals.forEach((signal) => {
			const handler = (receivedSignal: NodeJS.Signals) => {
				this.handleSignal(receivedSignal);
			};

			this.handlers.set(signal, handler);

			try {
				process.on(signal, handler);
			} catch (error) {
				console.warn(`Warning: Cannot catch signal ${signal}: ${error}`);
			}
		});
	}

	private handleSignal(signal: NodeJS.Signals): void {
		const signalInfo = SignalHandler.SIGNAL_DATABASE[signal];
		const timestamp = new Date().toISOString();

		const message = this.formatSignalMessage(signal, signalInfo, timestamp);

		// Log to console
		console.log(message);

		// Log to file
		this.logToFile(message);

		// Handle specific signal behaviors
		this.handleSignalBehavior(signal, signalInfo);
	}

	private formatSignalMessage(
		signal: NodeJS.Signals,
		info: SignalInfo | undefined,
		timestamp: string,
	): string {
		if (!info) {
			return `🚨 [${timestamp}] UNKNOWN SIGNAL: ${signal} (${this.getSignalNumber(signal)})`;
		}

		const emoji = this.getSignalEmoji(info);
		const category = info.category.toUpperCase().replace("_", " ");

		return [
			`${emoji} [${timestamp}] SIGNAL CAUGHT: ${info.name} (${info.number})`,
			`   Category: ${category}`,
			`   Description: ${info.description}`,
			`   Catchable: ${info.catchable ? "Yes" : "No"}`,
			`   Terminates: ${info.terminates ? "Yes" : "No"}`,
			`   PID: ${process.pid}`,
			`   Memory Usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
			"─".repeat(80),
		].join("\n");
	}

	private getSignalEmoji(info: SignalInfo): string {
		switch (info.category) {
			case "standard":
				return info.terminates ? "💀" : "⚡";
			case "job_control":
				return "🎮";
			case "system":
				return "🔧";
			case "realtime":
				return "⏰";
			default:
				return "📡";
		}
	}

	private getSignalNumber(signal: NodeJS.Signals): number {
		return SignalHandler.SIGNAL_DATABASE[signal]?.number || -1;
	}

	private logToFile(message: string): void {
		try {
			fs.appendFileSync(this.logFile, message + "\n\n", "utf8");
		} catch (error) {
			console.error(`Failed to write to log file: ${error}`);
		}
	}

	private handleSignalBehavior(
		signal: NodeJS.Signals,
		info: SignalInfo | undefined,
	): void {
		if (!info) return;

		switch (signal) {
			case "SIGINT":
				console.log("🛑 Graceful shutdown initiated...");
				this.gracefulShutdown();
				break;

			case "SIGTERM":
				console.log("🔚 Termination requested...");
				this.gracefulShutdown();
				break;

			case "SIGUSR1":
				console.log("📊 Status report requested");
				this.printStatus();
				break;

			case "SIGUSR2":
				console.log("🔄 Configuration reload requested");
				this.reloadConfiguration();
				break;

			case "SIGWINCH":
				console.log("📏 Terminal window resized");
				break;

			case "SIGCHLD":
				console.log("👶 Child process state changed");
				break;

			default:
				if (info.terminates) {
					console.log(`⚠️  Fatal signal received. Preparing for shutdown...`);
					this.gracefulShutdown(1);
				}
		}
	}

	private gracefulShutdown(exitCode: number = 0): void {
		console.log("🧹 Performing cleanup...");

		// Cleanup handlers
		this.handlers.forEach((handler, signal) => {
			try {
				process.removeListener(signal, handler);
			} catch (error) {
				console.warn(`Warning: Could not remove handler for ${signal}`);
			}
		});

		console.log("✅ Cleanup completed. Exiting...");
		process.exit(exitCode);
	}

	private printStatus(): void {
		const usage = process.memoryUsage();
		console.log("📈 Process Status:");
		console.log(`   PID: ${process.pid}`);
		console.log(`   Uptime: ${Math.floor(process.uptime())}s`);
		console.log(`   Memory: ${Math.round(usage.rss / 1024 / 1024)}MB RSS`);
		console.log(`   Heap Used: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
	}

	private reloadConfiguration(): void {
		console.log("🔄 Configuration reload not implemented in this example");
	}

	public static getSignalInfo(
		signalNameOrNumber: string | number,
	): SignalInfo | undefined {
		if (typeof signalNameOrNumber === "number") {
			return Object.values(SignalHandler.SIGNAL_DATABASE).find(
				(info) => info.number === signalNameOrNumber,
			);
		}
		return SignalHandler.SIGNAL_DATABASE[signalNameOrNumber.toUpperCase()];
	}

	public listAllSignals(): void {
		console.log("📋 Available Signals:");
		console.log("─".repeat(100));

		Object.values(SignalHandler.SIGNAL_DATABASE)
			.sort((a, b) => a.number - b.number)
			.forEach((info) => {
				const emoji = this.getSignalEmoji(info);
				console.log(
					`${emoji} ${info.number.toString().padStart(2)}) ${info.name.padEnd(12)} - ${info.description}`,
				);
			});
	}
}

// CLI Interface
function main(): void {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`
Signal Handler System - TypeScript Edition

Usage:
  ${process.argv[1]} [options]

Options:
  --help, -h          Show this help message
  --list, -l          List all available signals
  --info <signal>     Get information about a specific signal
  --log <file>        Specify log file (default: ./signal_handler.log)
  --test              Send test signals to demonstrate handling

Examples:
  ${process.argv[1]} --list
  ${process.argv[1]} --info SIGTERM
  ${process.argv[1]} --log /tmp/signals.log
  ${process.argv[1]} --test
    `);
		process.exit(0);
	}

	const logFile = args.includes("--log")
		? args[args.indexOf("--log") + 1]
		: undefined;

	const handler = new SignalHandler(logFile);

	if (args.includes("--list") || args.includes("-l")) {
		handler.listAllSignals();
		process.exit(0);
	}

	if (args.includes("--info")) {
		const signal = args[args.indexOf("--info") + 1];
		if (!signal) {
			console.error("❌ Please specify a signal name or number");
			process.exit(1);
		}

		const info = SignalHandler.getSignalInfo(signal);
		if (!info) {
			console.error(`❌ Signal '${signal}' not found`);
			process.exit(1);
		}

		console.log(`📡 Signal Information: ${info.name}`);
		console.log(`   Number: ${info.number}`);
		console.log(`   Description: ${info.description}`);
		console.log(`   Category: ${info.category}`);
		console.log(`   Catchable: ${info.catchable ? "Yes" : "No"}`);
		console.log(`   Terminates: ${info.terminates ? "Yes" : "No"}`);
		process.exit(0);
	}

	if (args.includes("--test")) {
		console.log("🧪 Testing signal handling...");
		console.log("Send signals to this process (PID: " + process.pid + ")");
		console.log("Try: kill -USR1 " + process.pid);
		console.log("Try: kill -USR2 " + process.pid);
		console.log("Try: kill -WINCH " + process.pid);
		console.log("Press Ctrl+C to test SIGINT");
	}

	console.log(`🚀 Signal handler started (PID: ${process.pid})`);
	console.log(`📝 Logging to: ${handler["logFile"]}`);
	console.log("💡 Send SIGUSR1 for status, SIGUSR2 for config reload");
	console.log("🛑 Use Ctrl+C or SIGTERM for graceful shutdown");

	// Keep the process alive
	setInterval(() => {
		// Heartbeat - could be used for monitoring
	}, 1000);
}

if (require.main === module) {
	main();
}

export { SignalHandler, type SignalInfo };
