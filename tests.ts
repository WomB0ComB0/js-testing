"use strict";

class TimerManager {
  private timers: (NodeJS.Timer)[] = [];

  timeout(ms: number, callback: () => void): NodeJS.Timer {
    const t = setTimeout(callback, ms);
    this.timers.push(t);
    return t;
  }

  interval(ms: number, callback: () => void): NodeJS.Timer {
    const i = setInterval(callback, ms);
    this.timers.push(i);
    return i;
  }

  immediate(callback: () => void): NodeJS.Timer {
    const r = setImmediate(callback);
    this.timers.push(r);
    return r;
  }

  clear(...timers: (NodeJS.Timer)[]): void {
    timers.forEach(timer => {
      if (typeof timer === 'object' && timer !== null) {
        if ('hasRef' in timer) {
          clearTimeout(timer as NodeJS.Timeout);
        } else if ('_idleNext' in timer) {
          clearImmediate(timer as NodeJS.Immediate);
        }
      }
    });
  }

  clearAll(): void {
    this.clear(...this.timers);
    this.timers = [];
  }

  withTimers<T>(fn: (tm: TimerManager) => Promise<T>): Promise<T> {
    return fn(this).finally(() => this.clearAll());
  }
}

const exitWithCode = (code: number): never => process.exit(code);

async function main(): Promise<number> {
  const timerManager = new TimerManager();
  
  return timerManager.withTimers(async (tm) => {
    const t = tm.timeout(1000, () => console.log('test'));
    const i = tm.interval(1000, () => console.log('test'));
    const r = tm.immediate(() => console.log('test'));
    
    try {
      console.log('Running script...');

      // ?...<...expression(s)>>>...
      Promise.all([])

      tm.clear(t);
      return 0;
    } catch (error) {
      console.error('\x1b[31m[Script]: Fatal error\x1b[0m', error);
      return 1;
    }
  });
}

if (require.main === module) {
  (async () => {
    try {
      const exitCode = await main();
      console.log('\x1b[32m[Script]: Completed successfully\x1b[0m');
      exitWithCode(exitCode);
    } catch (error) {
      console.error('\x1b[31m[Script]: Fatal error\x1b[0m', error);
      exitWithCode(1);
    }
  })();
}

const timerManager = new TimerManager();
export { timerManager, TimerManager, exitWithCode };