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

// Configuration - Tailored for Accomplice Focus
const CONFIG = {
	featureToggles: {
		enableUpgrades: false, // Set to false to disable upgrade purchasing
		enableDoorClicking: true, // Enable/Disable door clicking
		enableAccompliceRecruitment: true, // Enable/Disable accomplice recruitment
	},
	timing: {
		checkInterval: 50, // Increased check frequency
		restPeriod: 10000,
		activePeriod: 2000,
		upgradeDelay: 500,
		modalTimeout: 2000,
		initTimeout: 10000,
		inviteDelay: 2000, // Added delay between invitation attempts
	},
	retry: {
		maxErrors: 5,
		retryDelay: 100,
		maxRetries: 3,
	},
	selectors: {
		door: 'img[src="/door.png"]',
		upgrades: ".p-3.cursor-pointer",
		gameContainer: ".flex.min-h-screen",
		disabledUpgrade: "opacity-50",
		moneyAmount: ".text-3xl.md\\:text-4xl.mt-4.font-bold.text-purple-300",
		modal: 'div[role="dialog"]',
		emailInput: 'input[type="email"]',
	},
	accomplice: {
		email: "odnims@farmingdale.edu",
		recruitButtonText: "recruit accomplice (+10% $/s boost)",
		sendButtonText: "send invitation",
		states: {
			READY: "ready",
			DIALOG_OPEN: "dialog_open",
			EMAIL_ENTERED: "email_entered",
			SUBMITTING: "submitting",
			COOLDOWN: "cooldown",
		},
		timings: {
			dialogWait: 500,
			emailWait: 500,
			submitWait: 1000,
			cooldown: 2000,
		},
	},
	logging: {
		clickInterval: 100,
		dateFormat: new Intl.NumberFormat("en-US"),
		enableStatsLogging: false, // Disable general stats logging
	},
};

class GameStats {
	constructor() {
		this.clickCount = 0;
		this.errorCount = 0;
		this.upgradeHistory = new Map();
		this.moneyStats = {
			current: 0,
			previousCheck: 0,
			perSecond: 0,
			lastUpdate: Date.now(),
		};
	}

	updateMoneyStats(currentMoney) {
		const now = Date.now();
		const timeDiff = (now - this.moneyStats.lastUpdate) / 1000;

		if (timeDiff > 0) {
			this.moneyStats.perSecond =
				(currentMoney - this.moneyStats.previousCheck) / timeDiff;
			this.moneyStats.previousCheck = currentMoney;
			this.moneyStats.current = currentMoney;
			this.moneyStats.lastUpdate = now;
		}
	}

	logStats() {
		if (CONFIG.logging.enableStatsLogging) {
			console.log(
				`
                Stats Update:
                Clicks: ${this.clickCount}
                Money: $${CONFIG.logging.dateFormat.format(this.moneyStats.current)}
                Money/sec: $${CONFIG.logging.dateFormat.format(Math.round(this.moneyStats.perSecond))}
                Errors: ${this.errorCount}
            `.trim(),
			);
		}
	}
}

class UpgradeManager {
	constructor(stats) {
		this.stats = stats;
		this.lastUpgradeTime = 0;
	}

	calculateEfficiencyScore(upgrade) {
		const baseEfficiency = upgrade.revenuePerSecond / upgrade.cost;
		const diminishingFactor = 0.95 ** upgrade.owned;
		const tierBonus = Math.log10(upgrade.cost) / 10;
		const rateOfReturnDays = upgrade.cost / (upgrade.revenuePerSecond * 86400);

		return (
			baseEfficiency *
			diminishingFactor *
			(1 + tierBonus) *
			(1 / (1 + rateOfReturnDays))
		);
	}

	async findAndPurchaseBestUpgrade(currentMoney) {
		const upgrades = Array.from(
			document.querySelectorAll(CONFIG.selectors.upgrades),
		)
			.filter((el) => !el.classList.contains(CONFIG.selectors.disabledUpgrade))
			.map((el) => this.parseUpgradeInfo(el))
			.filter((upgrade) => upgrade && upgrade.cost <= currentMoney)
			.map((upgrade) => ({
				...upgrade,
				efficiencyScore: this.calculateEfficiencyScore(upgrade),
			}))
			.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

		if (upgrades.length > 0) {
			return this.purchaseUpgrade(upgrades[0]);
		}
		return false;
	}

	parseUpgradeInfo(element) {
		try {
			const getText = (selector) =>
				element.querySelector(selector)?.textContent || "";
			const parseNumber = (str) => parseInt(str.replace(/[^0-9]/g, "")) || 0;

			const info = {
				name: getText(".text-purple-200.font-semibold"),
				cost: parseNumber(getText(".text-purple-300:nth-child(3)")),
				revenuePerSecond: parseNumber(getText(".text-purple-300:nth-child(4)")),
				owned: parseNumber(getText(".text-purple-400")),
				element,
			};

			return Object.values(info).every((val) => val !== undefined)
				? info
				: null;
		} catch (error) {
			console.error("Error parsing upgrade:", error);
			return null;
		}
	}

	async purchaseUpgrade(upgrade) {
		const now = Date.now();
		if (now - this.lastUpgradeTime < CONFIG.timing.upgradeDelay) return false;

		try {
			upgrade.element.click();
			this.lastUpgradeTime = now;

			// Update history
			const history = this.stats.upgradeHistory.get(upgrade.name) || {
				purchases: 0,
				totalSpent: 0,
			};
			history.purchases++;
			history.totalSpent += upgrade.cost;

			this.stats.upgradeHistory.set(upgrade.name, history);
			console.log(
				`Purchased upgrade: ${upgrade.name}, Spent: $${CONFIG.logging.dateFormat.format(upgrade.cost)},  Owned: ${upgrade.owned + 1}`,
			);
			return true;
		} catch (error) {
			console.error("Error purchasing upgrade:", error);
			return false;
		}
	}
}

class DoorClicker {
	constructor(stats) {
		this.stats = stats;
	}

	async clickDoor() {
		try {
			const door = document.querySelector(CONFIG.selectors.door);
			if (!door) {
				console.warn("Door element not found");
				return false;
			}
			door.click();
			this.stats.clickCount++;
			if (this.stats.clickCount % CONFIG.logging.clickInterval === 0) {
				this.stats.logStats();
			}
			return true;
		} catch (error) {
			console.error("Error clicking door:", error);
			return false;
		}
	}
}

class AccompliceRecruiter {
	constructor() {
		this.state = CONFIG.accomplice.states.READY;
		this.lastInviteAttempt = 0;
	}

	async attemptRecruitment() {
		if (!CONFIG.featureToggles.enableAccompliceRecruitment) return;

		try {
			if (
				this.state === CONFIG.accomplice.states.COOLDOWN &&
				Date.now() - this.lastInviteAttempt < CONFIG.accomplice.timings.cooldown
			) {
				return; // In cooldown period, skip attempt
			}

			if (this.state === CONFIG.accomplice.states.READY) {
				if (!(await this.openDialog())) return;
				this.state = CONFIG.accomplice.states.DIALOG_OPEN;
			}

			if (this.state === CONFIG.accomplice.states.DIALOG_OPEN) {
				if (!(await this.enterEmail())) return;
				this.state = CONFIG.accomplice.states.EMAIL_ENTERED;
			}

			if (this.state === CONFIG.accomplice.states.EMAIL_ENTERED) {
				if (!(await this.submitInvitation())) return;
				this.state = CONFIG.accomplice.states.SUBMITTING;
				this.lastInviteAttempt = Date.now();
			}

			if (this.state === CONFIG.accomplice.states.SUBMITTING) {
				this.state = CONFIG.accomplice.states.COOLDOWN;
				console.log("Successfully attempted accomplice recruitment!");
			}
		} catch (error) {
			console.error("Error in accomplice recruitment process:", error);
			this.resetState();
		}
	}

	async openDialog() {
		try {
			const recruitButton = this.findRecruitButton();
			if (!recruitButton) return false;

			recruitButton.click();
			await new Promise((resolve) =>
				setTimeout(resolve, CONFIG.accomplice.timings.dialogWait),
			);
			return true;
		} catch (error) {
			console.error("Failed to open recruitment dialog:", error);
			return false;
		}
	}

	async enterEmail() {
		try {
			const modal = document.querySelector(CONFIG.selectors.modal);
			if (!modal) {
				console.warn("Modal dialog not found");
				this.resetState();
				return false;
			}

			const emailInput = modal.querySelector(CONFIG.selectors.emailInput);
			if (!emailInput) {
				console.warn("Email input not found");
				this.resetState();
				return false;
			}

			emailInput.value = CONFIG.accomplice.email;
			await new Promise((resolve) =>
				setTimeout(resolve, CONFIG.accomplice.timings.emailWait),
			);
			return true;
		} catch (error) {
			console.error("Failed to enter email:", error);
			this.resetState();
			return false;
		}
	}

	async submitInvitation() {
		try {
			const modal = document.querySelector(CONFIG.selectors.modal);
			if (!modal) {
				console.warn("Modal dialog not found");
				this.resetState();
				return false;
			}

			const sendButton = this.findSendButton(modal);
			if (!sendButton) {
				console.warn("Send invitation button not found");
				this.resetState();
				return false;
			}

			sendButton.click();
			await new Promise((resolve) =>
				setTimeout(resolve, CONFIG.accomplice.timings.submitWait),
			);
			return true;
		} catch (error) {
			console.error("Failed to submit invitation:", error);
			this.resetState();
			return false;
		}
	}

	findRecruitButton() {
		const buttons = Array.from(document.querySelectorAll("button"));
		return buttons.find((button) =>
			button.textContent.includes(CONFIG.accomplice.recruitButtonText),
		);
	}

	findSendButton(modal) {
		if (!modal) return null;
		const buttons = Array.from(modal.querySelectorAll("button"));
		return buttons.find((button) =>
			button.textContent.includes(CONFIG.accomplice.sendButtonText),
		);
	}

	resetState() {
		this.state = CONFIG.accomplice.states.READY;
	}
}

class GameAutomation {
	constructor() {
		this.stats = new GameStats();
		this.upgradeManager = new UpgradeManager(this.stats);
		this.doorClicker = new DoorClicker(this.stats);
		this.accompliceRecruiter = new AccompliceRecruiter();
		this.automationInterval = null;
		this.isRunning = false;
	}

	async automateGame() {
		try {
			if (CONFIG.featureToggles.enableAccompliceRecruitment) {
				await this.accompliceRecruiter.attemptRecruitment();
			}

			if (CONFIG.featureToggles.enableDoorClicking) {
				await this.doorClicker.clickDoor();
			}

			if (CONFIG.featureToggles.enableUpgrades) {
				const currentMoney = this.stats.moneyStats.current;
				await this.upgradeManager.findAndPurchaseBestUpgrade(currentMoney);
			}

			this.stats.updateMoneyStats(this.stats.moneyStats.current);
		} catch (error) {
			this.stats.errorCount++;
			console.error("Automation Error:", error);
		} finally {
			this.scheduleNextRun();
		}
	}

	scheduleNextRun() {
		this.automationInterval = setTimeout(
			() => this.automateGame(),
			CONFIG.timing.checkInterval,
		);
	}

	async start() {
		if (this.isRunning) {
			console.log("Automation already running");
			return;
		}

		try {
			const gameContainer = document.querySelector(
				CONFIG.selectors.gameContainer,
			);
			if (!gameContainer) {
				throw new Error("Game container not found");
			}

			this.isRunning = true;
			console.log("Starting automation...");
			this.automateGame();
		} catch (error) {
			console.error("Failed to start automation:", error);
			this.stop();
		}
	}

	stop() {
		if (this.automationInterval) {
			clearTimeout(this.automationInterval);
			this.automationInterval = null;
		}
		this.isRunning = false;
		console.log("Automation stopped");
	}
}

// Initialization
const gameAutomation = new GameAutomation();

(async function init() {
	try {
		const initTimeout = CONFIG.timing.initTimeout;
		const startTime = Date.now();

		while (!document.querySelector(CONFIG.selectors.gameContainer)) {
			if (Date.now() - startTime > initTimeout) {
				throw new Error("Game failed to load within timeout period");
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		await gameAutomation.start();
	} catch (error) {
		console.error("Initialization failed:", error);
	}
})();

// Expose stop function
window.stopAutomation = () => gameAutomation.stop();
