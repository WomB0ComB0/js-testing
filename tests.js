var __awaiter =
	(this && this.__awaiter) ||
	((thisArg, _arguments, P, generator) => {
		function adopt(value) {
			return value instanceof P
				? value
				: new P((resolve) => {
						resolve(value);
					});
		}
		return new (P || (P = Promise))((resolve, reject) => {
			function fulfilled(value) {
				try {
					step(generator.next(value));
				} catch (e) {
					reject(e);
				}
			}
			function rejected(value) {
				try {
					step(generator["throw"](value));
				} catch (e) {
					reject(e);
				}
			}
			function step(result) {
				result.done
					? resolve(result.value)
					: adopt(result.value).then(fulfilled, rejected);
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next());
		});
	});
var __generator =
	(this && this.__generator) ||
	((thisArg, body) => {
		var _ = {
				label: 0,
				sent: () => {
					if (t[0] & 1) throw t[1];
					return t[1];
				},
				trys: [],
				ops: [],
			},
			f,
			y,
			t,
			g = Object.create(
				(typeof Iterator === "function" ? Iterator : Object).prototype,
			);
		return (
			(g.next = verb(0)),
			(g["throw"] = verb(1)),
			(g["return"] = verb(2)),
			typeof Symbol === "function" &&
				(g[Symbol.iterator] = function () {
					return this;
				}),
			g
		);
		function verb(n) {
			return (v) => step([n, v]);
		}
		function step(op) {
			if (f) throw new TypeError("Generator is already executing.");
			while ((g && ((g = 0), op[0] && (_ = 0)), _))
				try {
					if (
						((f = 1),
						y &&
							(t =
								op[0] & 2
									? y["return"]
									: op[0]
										? y["throw"] || ((t = y["return"]) && t.call(y), 0)
										: y.next) &&
							!(t = t.call(y, op[1])).done)
					)
						return t;
					if (((y = 0), t)) op = [op[0] & 2, t.value];
					switch (op[0]) {
						case 0:
						case 1:
							t = op;
							break;
						case 4:
							_.label++;
							return { value: op[1], done: false };
						case 5:
							_.label++;
							y = op[1];
							op = [0];
							continue;
						case 7:
							op = _.ops.pop();
							_.trys.pop();
							continue;
						default:
							if (
								!((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
								(op[0] === 6 || op[0] === 2)
							) {
								_ = 0;
								continue;
							}
							if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
								_.label = op[1];
								break;
							}
							if (op[0] === 6 && _.label < t[1]) {
								_.label = t[1];
								t = op;
								break;
							}
							if (t && _.label < t[2]) {
								_.label = t[2];
								_.ops.push(op);
								break;
							}
							if (t[2]) _.ops.pop();
							_.trys.pop();
							continue;
					}
					op = body.call(thisArg, _);
				} catch (e) {
					op = [6, e];
					y = 0;
				} finally {
					f = t = 0;
				}
			if (op[0] & 5) throw op[1];
			return { value: op[0] ? op[1] : void 0, done: true };
		}
	});
var timer = {
	timeout: (ms, callback) => {
		var t = setTimeout(callback, ms);
		return t;
	},
	interval: (ms, callback) => {
		var i = setInterval(callback, ms);
		return i;
	},
	immediate: (callback) => {
		var r = setImmediate(callback);
		return r;
	},
	clear: () => {
		var timers = [];
		for (var _i = 0; _i < arguments.length; _i++) {
			timers[_i] = arguments[_i];
		}
		timers.forEach((timer) => {
			if (typeof timer === "object" && timer !== null) {
				if ("hasRef" in timer) {
					clearTimeout(timer);
				} else if ("_idleNext" in timer) {
					clearImmediate(timer);
				}
			}
		});
	},
};
/**
 * Exit handler to ensure graceful shutdown
 */
var exitWithCode = (code) => process.exit(code);
function main() {
	return __awaiter(this, void 0, void 0, function () {
		var t, i, r;
		return __generator(this, (_a) => {
			t = timer.timeout(1000, () => console.log("test"));
			i = timer.interval(1000, () => console.log("test"));
			r = timer.immediate(() => console.log("test"));
			try {
				console.log("Running script...");
				timer.clear(t);
				return [2 /*return*/, 0];
			} catch (error) {
				console.error("\x1b[31m[Script]: Fatal error\x1b[0m", error);
				return [2 /*return*/, 1];
			} finally {
				console.log("\x1b[32m[Script]: Completed successfully\x1b[0m");
			}
			return [2 /*return*/];
		});
	});
}
if (require.main === module) {
	(() =>
		__awaiter(void 0, void 0, void 0, function () {
			var exitCode, error_1;
			return __generator(this, (_a) => {
				switch (_a.label) {
					case 0:
						_a.trys.push([0, 2, , 3]);
						return [4 /*yield*/, main()];
					case 1:
						exitCode = _a.sent();
						console.log("\x1b[32m[Script]: Completed successfully\x1b[0m");
						exitWithCode(exitCode);
						return [3 /*break*/, 3];
					case 2:
						error_1 = _a.sent();
						console.error("\x1b[31m[Script]: Fatal error\x1b[0m", error_1);
						exitWithCode(1);
						return [3 /*break*/, 3];
					case 3:
						return [2 /*return*/];
				}
			});
		}))();
}
Object.assign(global, {
	timer: timer,
	exitWithCode: exitWithCode,
});
