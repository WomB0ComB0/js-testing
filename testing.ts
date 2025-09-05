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

(() => {
	("use strict");

	console.log("🚀 IIFE Started - Setting up selfExecute decorator");

	const selfExecute = (
		target: any,
		propertyKey: string,
		descriptor?: PropertyDescriptor,
	): PropertyDescriptor | void => {
		if (!descriptor) return;

		console.log(
			`📝 Decorator applied to: ${target.constructor.name}.${propertyKey}`,
		);

		const originalMethod = descriptor.value;
		const instancesMap = new WeakMap();

		descriptor.value = function (...args: any[]): any {
			const hasExecuted = instancesMap.get(this);

			if (!hasExecuted) {
				console.log(
					`⚡ Auto-executing ${propertyKey}() for the first time on instance`,
				);
				instancesMap.set(this, true);
				const result = originalMethod.apply(this, args);
				console.log(`✅ ${propertyKey}() completed auto-execution`);
				return result;
			} else {
				console.log(`🔄 Manual call to ${propertyKey}()`);
				return originalMethod.apply(this, args);
			}
		};

		descriptor.value._originalMethod = originalMethod;
		descriptor.value._autoExecuteOnInstance = (instance: any) => {
			if (!instancesMap.get(instance)) {
				console.log(
					`🎯 Triggering auto-execution of ${propertyKey} on instance`,
				);
				descriptor.value.call(instance);
			}
		};

		return descriptor;
	};

	class TaskRunner {
		public name: string;
		public tasks: string[];
		public monitoringActive?: boolean;

		constructor(name: string) {
			this.name = name;
			this.tasks = [];
			console.log(`🏗️  Created TaskRunner: ${name}`);
		}

		public initialize(): TaskRunner {
			console.log(`🔧 Initializing ${this.name}...`);
			this.tasks.push("System check");
			this.tasks.push("Load configuration");
			console.log(`📋 Added ${this.tasks.length} startup tasks`);
			return this;
		}

		public startMonitoring(): TaskRunner {
			console.log(`👁️  Starting monitoring for ${this.name}...`);
			this.monitoringActive = true;
			console.log(
				`📊 Monitoring status: ${this.monitoringActive ? "ACTIVE" : "INACTIVE"}`,
			);
			return this;
		}

		public addTask(task: string): TaskRunner {
			console.log(`➕ Adding task: ${task}`);
			this.tasks.push(task);
			return this;
		}

		public showStatus(): TaskRunner {
			console.log(`\n📈 === ${this.name} Status ===`);
			console.log(`   Tasks: ${this.tasks.length}`);
			console.log(`   Monitoring: ${this.monitoringActive ? "✅" : "❌"}`);
			console.log(`   Tasks List: ${this.tasks.join(", ")}`);
			console.log(`================================\n`);
			return this;
		}
	}

	console.log(
		"🔧 Manually applying decorators (simulating @selfExecute syntax)",
	);

	const initDescriptor = Object.getOwnPropertyDescriptor(
		TaskRunner.prototype,
		"initialize",
	);
	if (initDescriptor) {
		selfExecute(TaskRunner.prototype, "initialize", initDescriptor);
		Object.defineProperty(TaskRunner.prototype, "initialize", initDescriptor);
	}

	const monitorDescriptor = Object.getOwnPropertyDescriptor(
		TaskRunner.prototype,
		"startMonitoring",
	);
	if (monitorDescriptor) {
		selfExecute(TaskRunner.prototype, "startMonitoring", monitorDescriptor);
		Object.defineProperty(
			TaskRunner.prototype,
			"startMonitoring",
			monitorDescriptor,
		);
	}

	console.log("\n" + "=".repeat(50));
	console.log("🎭 DEMO: Creating TaskRunner instance");
	console.log("=".repeat(50));

	const runner = new TaskRunner("MainApp");

	setTimeout(() => {
		console.log("\n" + "=".repeat(50));
		console.log("🎯 TRIGGERING AUTO-EXECUTION");
		console.log("=".repeat(50));

		const initMethod = (TaskRunner.prototype as any).initialize;
		const monitorMethod = (TaskRunner.prototype as any).startMonitoring;

		if (initMethod._autoExecuteOnInstance) {
			initMethod._autoExecuteOnInstance(runner);
		}
		if (monitorMethod._autoExecuteOnInstance) {
			monitorMethod._autoExecuteOnInstance(runner);
		}

		setTimeout(() => {
			console.log("\n" + "=".repeat(50));
			console.log("🧪 DEMO: Manual method calls (after auto-execution)");
			console.log("=".repeat(50));

			runner.initialize();
			runner.startMonitoring();

			runner.addTask("Process user input");
			runner.addTask("Generate reports");

			runner.showStatus();

			console.log("🏁 IIFE Demo Complete!");
		}, 200);
	}, 100);

	console.log("⏱️  Creating instance and setting up auto-execution...\n");
})();

(() => {
	console.log(
		"\n" + "🔄 BONUS: Simplified self-executing pattern".padEnd(50, "="),
	);

	class SimpleDemo {
		public ready?: boolean;

		constructor() {
			this.setup();
			this.announce();
		}

		public setup(): void {
			console.log("🛠️  SimpleDemo: Running setup automatically");
			this.ready = true;
		}

		public announce(): void {
			console.log("📢 SimpleDemo: Ready to go!");
		}

		public doWork(): void {
			console.log(`💼 Working... (ready: ${this.ready})`);
		}
	}

	const demo = new SimpleDemo();
	demo.doWork();
})();
